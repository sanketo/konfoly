import {canonicalEpisode, combinedEpisodeRule, mentalistCatalog, seriesIdentity} from './series-config.js';
import {integrationSettings} from './integrations.js';
import {mediaAddress} from './urls.js';
import {readLocal} from './storage.js';
import {make} from './dom.js';
import {enhance} from './select-ui.js';
import {seriesMetadata} from './series-metadata.js';

const mediaProviders = [
  {id:'native',title:'Наш плеер',detail:'Рекомендуемый · ТВ3, Universal и TVShows при наличии',action:'Смотреть'},
  {id:'endpoint',title:'Общий источник',detail:'Прямое видео в нашем плеере по ID сериала и номеру серии.',action:'Смотреть'},
  {id:'stremio',title:'Stremio',detail:'Прямое видео из подключённого дополнения в нашем плеере.',action:'Смотреть'},
  {id:'alloha',title:'Alloha',detail:'Встроенный плеер · возможна реклама.',action:'Настроить'},
  {id:'file',title:'Файл с устройства',detail:'MP4, WebM и другие форматы, которые поддерживает браузер.',action:'Выбрать видео'},
  ...Object.entries(integrationSettings.embeds || {}).map(([id,{title,detail}]) => ({id,title,detail,action:'Открыть'})),
  {id:'custom',title:'Свой источник',detail:'Прямое видео или встраиваемый плеер.',action:'Настроить ссылку'}
];
function configuredEmbed(id,season,episode) {
  const source = integrationSettings.embeds?.[id];
  if (!source) return null;
  return mediaAddress(source.address,season,source.episodeOverrides?.[season+':'+episode] ?? episode);
}

function seriesNativeId(show) {
  return seriesIdentity(show)?.kinopoiskId || null;
}

function canResolveSeriesNative(show) {
  return !!seriesNativeId(show) || /^tt\d{5,12}$/.test(show.imdb?.id || '');
}
const nativePlaylists = new Map();
async function nativeRequest(path,signal) {
  const base = integrationSettings.native?.address;
  if (!base) throw Error('Наш источник отключён.');
  const response = await fetch(new URL(path,base).href,{signal});
  if (!response.ok) throw Error('Источник недоступен. Повтори попытку.');
  return response.json();
}
async function nativePlaylist(kinopoiskId,season,number,signal) {
  const query = 'playlist?' + new URLSearchParams({pub:integrationSettings.native?.publisher,
    id:kinopoiskId,aggr:'kp',ep:number,sn:season});
  const cached = nativePlaylists.get(query);
  if (cached && Date.now() - cached.time < 180000) return cached.rows;
  const list = await nativeRequest(query,signal);
  const rows = (Array.isArray(list.items) ? list.items : []).filter(row =>
    Number(row.season) === season && Number(row.episode) === number && row.vkId);
  if (nativePlaylists.size >= 25) nativePlaylists.delete(nativePlaylists.keys().next().value);
  nativePlaylists.set(query,{time:Date.now(),rows});
  return rows;
}
function nativeVoices(rows) {
  return [...new Set(rows.map(row => row.voiceStudio).filter(value => typeof value === 'string' && value.trim()))]
    .map(value => ({id:value,label:value}));
}
async function discoverNativeVoices(kinopoiskId,season,episode,signal) {
  const rows = await nativePlaylist(kinopoiskId,season,episode,signal);
  const rule = combinedEpisodeRule(kinopoiskId,season,episode);
  if (!rule || episode === rule.first) return nativeVoices(rows);
  const merged = await nativePlaylist(kinopoiskId,season,rule.first,signal).catch(() => []);
  return nativeVoices([...rows,...merged.filter(row => row.voiceStudio === rule.voice)]);
}
async function resolveNative({season,episode,voice,quality,kinopoiskId=mentalistCatalog.kinopoiskId},signal) {
  const combined = voice && combinedEpisodeRule(kinopoiskId,season,episode,voice);
  const matching = await nativePlaylist(kinopoiskId,season,combined ? combined.first : episode,signal);
  const voices = nativeVoices(matching).filter(item => !combined || item.id === voice);
  const items = matching.filter(row => !voice || row.voiceStudio === voice);
  if (!items.length) throw Error(voice
    ? 'Для этой серии нет выбранной озвучки. Выбери другую в настройках источника.'
    : 'Наш источник не предоставил эту серию.');
  const candidates = quality === 'fullhd'
    ? ['mpegFullHdUrl','mpegHighUrl','mpegMediumUrl','hlsUrl']
    : ['mpegHighUrl','mpegMediumUrl','mpegFullHdUrl','hlsUrl'];
  for (const item of items) {
    let media;
    try {
      media = await nativeRequest('video/' + encodeURIComponent(item.vkId),signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      continue;
    }
    const seen = new Set();
    const streams = [];
    for (const key of candidates) {
      const url = mediaAddress(media.sources?.[key] || '',season,episode);
      if (!url || !new URL(url).hostname.endsWith('.' + integrationSettings.native?.mediaDomain) || seen.has(url)) continue;
      seen.add(url);
      const format = key === 'hlsUrl' ? 'hls' : undefined;
      const qualityNote = quality === 'fullhd' && !format && key !== 'mpegFullHdUrl' ? ' · Выбрано доступное качество' : '';
      streams.push({url,format,combined,label:(item.voiceStudio || voice || 'Наш плеер') + qualityNote});

    }
    if (streams.length) {
      const [stream,...alternatives] = streams;
      return {...stream,alternatives,voices,voice:item.voiceStudio || ''};
    }
  }
  throw Error('Источник не предоставил доступный MP4 или HLS для этой серии.');
}

function createExternalVideoFrame(url,title='Внешний видеоплеер') {
  const frame = document.createElement('iframe');
  frame.title = title;
  frame.allow = 'autoplay; fullscreen; picture-in-picture';
  frame.allowFullscreen = true;
  frame.referrerPolicy = 'strict-origin-when-cross-origin';
  frame.setAttribute('sandbox','allow-scripts allow-forms allow-presentation' +
    (new URL(url).origin === location.origin ? '' : ' allow-same-origin'));
  frame.src = url;
  return frame;
}

function seriesSource(show,item,settings,provider) {
  const id = item.season + ':' + item.episode;
  if (provider === 'alloha') {
    const value = settings.allohaEpisodes?.[id] || settings.allohaTemplate || show.sources?.alloha;
    return value ? {address:mediaAddress(value,item.season,item.episode)} : null;
  }
  const value = settings[id] || settings.template || show.sources?.video;
  if (value) return {address:mediaAddress(value,item.season,item.episode)};
  const manifest = settings.manifest || show.sources?.manifest;
  return manifest ? {manifest} : null;
}

async function resolveSeriesSource(source,item,signal) {
  const {season,episode} = item;
  if (source?.address) return source.address;
  if (!source?.manifest) throw Error('Для этой серии источник ещё не настроен.');
  const manifestUrl = mediaAddress(source.manifest,season,episode);
  if (!manifestUrl) throw Error('Для каталога видео нужен действительный HTTPS-адрес.');
  const response = await fetch(manifestUrl,{signal,credentials:'omit'});
  if (!response.ok) throw Error('Каталог видео недоступен.');
  const catalog = await response.json().catch(() => null);
  if (!catalog?.episodes || typeof catalog.episodes !== 'object') throw Error('Неверный формат каталога видео.');
  const value = catalog.episodes[season + ':' + episode];
  if (typeof value !== 'string') throw Error('В каталоге видео нет этой серии.');
  const address = mediaAddress(value,season,episode);
  if (!address) throw Error('Каталог не предоставил действительную ссылку на видео.');
  return address;
}

const episodeEndpointKey = 'konfoly-episode-endpoint-v1';

function episodeEndpoint() {
  return integrationSettings.episodeEndpoint || readLocal(episodeEndpointKey).url || '';
}

function integrationEditorAvailable() {
  return ['localhost','127.0.0.1','[::1]'].includes(location.hostname);
}
function allowedIntegrationEmbed(url) {
  const configured = integrationSettings.embedOrigins;
  return Array.isArray(configured) && configured.includes(new URL(url).origin);
}
async function resolveEpisodeEndpoint(show,item,signal,choice) {
  item = canonicalEpisode(show,item);
  const address = mediaAddress(episodeEndpoint(),item.season,item.episode);
  if (!address) throw Error('Укажи общий видеоисточник в настройках.');
  const request = new URL(address);
  for (const [key,value] of Object.entries({
    imdb:show.imdb?.id,tvmaze:show.mazeId,season:item.season,episode:item.episode
  })) {
    if (value != null) request.searchParams.set(key,value);
  }
  const response = await fetch(request,{signal,credentials:'omit',referrerPolicy:'no-referrer'});
  if (response.status === 404 || response.status === 204) throw Error('В общем источнике нет этой серии.');
  if (!response.ok) throw Error('Общий источник недоступен.');
  const result = await response.json().catch(() => null);
  const rows = Array.isArray(result?.streams) ? result.streams : [];
  const options = [];
  const addresses = new Set();
  for (const row of [result,...rows].slice(0,60)) {
    const url = typeof row?.url === 'string' && mediaAddress(row.url,item.season,item.episode);
    if (!url || addresses.has(url)) continue;
    const kind = row.kind === 'embed' ? 'embed' : 'video';
    if (kind === 'embed' && !allowedIntegrationEmbed(url)) continue;
    addresses.add(url);
    const label = typeof row.voice === 'string' ? row.voice.trim().slice(0,120) : '';
    options.push({url,kind,format:row.format === 'hls' ? 'hls' : undefined,label,
      provider:typeof row.provider === 'string' ? row.provider.slice(0,60) : '',
      choice:String(options.length),choiceLabel:label || 'Поток ' + (options.length+1)});
  }
  if (!options.length) throw Error('Общий источник не вернул HTTPS-ссылку на видео.');
  options.sort((a,b) => Number(a.kind === 'embed') - Number(b.kind === 'embed'));
  const stream = choice == null ? options[0] : options.find(option => option.choice === choice);
  if (!stream) throw Error('Этот поток больше недоступен. Открой источник заново.');
  return {...stream,alternatives:choice == null ? options.slice(1).filter(option => option.kind === 'video') : [],
    embedFallback:choice == null && stream.kind === 'video' ? options.find(option => option.kind === 'embed') : undefined,
    voices:options.map(option => ({id:option.choice,label:option.choiceLabel})),voice:stream.choice};
}

const stremioSourceKey = 'konfoly-stremio-source-v1';
let stremioManifest;

function stremioSource() {
  return integrationSettings.stremioManifest || readLocal(stremioSourceKey).url || '';
}

function stremioManifestAddress(value) {
  const https = typeof value === 'string' ? value.replace(/^stremio:\/\//i,'https://') : '';
  const address = mediaAddress(https,1,1);
  if (!address) return null;
  const url = new URL(address);
  return url.pathname.endsWith('/manifest.json') && !url.hash ? url.href : null;
}

async function fetchAddonJson(url,signal) {
  const response = await fetch(url,{signal,credentials:'omit',referrerPolicy:'no-referrer',redirect:'error'});
  if (!response.ok) throw Error(response.status === 404 ? 'Дополнение не нашло эту серию.' : 'Дополнение Stremio недоступно.');
  return response.json();
}

function canUseStremio(show) {
  return /^tt\d{5,12}$/.test(show.imdb?.id || '');
}

async function resolveStremio(show,item,signal,choice) {
  item = canonicalEpisode(show,item);
  const imdb = show.imdb?.id;
  if (!canUseStremio(show)) throw Error('Для этого сериала нет IMDb ID, который нужен дополнению.');
  const address = stremioManifestAddress(stremioSource());
  if (!address) throw Error('Укажи HTTPS-адрес manifest.json дополнения в настройках.');
  if (!stremioManifest || stremioManifest.address !== address || Date.now() - stremioManifest.loadedAt > 15 * 60 * 1000) {
    const data = await fetchAddonJson(address,signal);
    stremioManifest = {address,data,loadedAt:Date.now()};
  }
  const manifest = stremioManifest.data;
  const videoId = imdb + ':' + item.season + ':' + item.episode;
  const supported = Array.isArray(manifest?.resources) && manifest.resources.some(resource => {
    if (resource !== 'stream' && resource?.name !== 'stream') return false;
    const types = resource?.types ?? manifest.types;
    const prefixes = resource?.idPrefixes ?? manifest.idPrefixes;
    return Array.isArray(types) && types.includes('series') &&
      (prefixes == null || Array.isArray(prefixes) && prefixes.some(prefix => typeof prefix === 'string' && videoId.startsWith(prefix)));
  });
  if (!supported) throw Error('У дополнения нет потоков для сериалов с IMDb ID.');
  const request = new URL('stream/series/' + videoId + '.json',address);
  request.search = new URL(address).search;
  const result = await fetchAddonJson(request,signal);
  const options = [];
  const seen = new Set();
  for (const [index,stream] of (Array.isArray(result?.streams) ? result.streams.slice(0,50) : []).entries()) {
    if (stream?.behaviorHints?.notWebReady || stream?.behaviorHints?.proxyHeaders ||
        stream?.behaviorHints?.countryWhitelist || typeof stream?.url !== 'string') continue;
    const url = mediaAddress(stream.url,item.season,item.episode);
    if (!url || seen.has(url)) continue;
    const path = new URL(url).pathname;
    if (/\.(mkv|avi|mpd|torrent)$/i.test(path)) continue;
    seen.add(url);
    const providerLabel = [stream.name,stream.description || stream.title].filter(value => typeof value === 'string' && value.trim())
      .map(value => value.trim().split(/\r?\n/).slice(0,3).join(' · ')).join(' · ').slice(0,180);
    options.push({url,format:/\.m3u8$/i.test(path) ? 'hls' : undefined,label:'Stremio',
      choice:String(index),choiceLabel:providerLabel || 'Поток ' + (index+1)});
  }
  if (!options.length) throw Error('Дополнение не выдало прямое видео для нашего плеера.');
  const stream = choice == null ? options[0] : options.find(option => option.choice === choice);
  if (!stream) throw Error('Этот поток больше недоступен. Открой источник заново.');
  const alternatives = choice == null ? options.filter(option => option !== stream).slice(0,3) : [];
  return {...stream,alternatives,voices:options.map(option => ({id:option.choice,label:option.choiceLabel})),voice:stream.choice};
}

let hlsScript;
function loadHls() {
  if (window.Hls) return Promise.resolve(window.Hls);
  if (!hlsScript) {
    hlsScript = new Promise((resolve,reject) => {
      const script = document.createElement('script');
      script.src = 'vendor/hls-1.6.15.min.js';
      script.onload = () => window.Hls ? resolve(window.Hls) : reject(Error('HLS не загрузился'));
      script.onerror = () => {
        script.remove();
        reject(Error('HLS не загрузился'));
      };
      document.head.append(script);
    }).catch(error => {
      hlsScript = null;
      throw error;
    });
  }
  return hlsScript;
}

function openVideoStream(video,url,{format,onError,onBlocked,onAudioTracks,startupTimeout=18000}={}) {
  let stopped = false;
  let failed = false;
  let waiting = typeof video.readyState === 'number' && video.readyState < 2;
  let blocked = false;
  let timer;
  let hls;
  function clearTimer() { clearTimeout(timer); timer = undefined; }
  function ready() { waiting = false; clearTimer(); }
  function fail(code) {
    if (stopped || failed) return;
    failed = true;
    ready();
    onError?.(code);
  }
  function monitor() {
    clearTimer();
    if (!waiting || document.visibilityState === 'hidden' || blocked) return;
    timer = setTimeout(() => fail(2),startupTimeout);
  }
  video.addEventListener('loadeddata',ready);
  video.addEventListener('playing',ready);
  video.addEventListener('error',ready);
  document.addEventListener('visibilitychange',monitor);
  monitor();
  function publishNativeAudio() {
    if (!onAudioTracks || hls || !video.audioTracks) return;
    const tracks = Array.from(video.audioTracks);
    onAudioTracks(tracks.map((track,index) => ({
      id:String(index),label:track.label || track.language || 'Дорожка ' + (index+1)
    })),String(tracks.findIndex(track => track.enabled)),id => {
      tracks.forEach((track,index) => { track.enabled = String(index) === id; });
    });
  }
  video.audioTracks?.addEventListener?.('change',publishNativeAudio);
  video.audioTracks?.addEventListener?.('addtrack',publishNativeAudio);
  video.addEventListener('loadedmetadata',publishNativeAudio);
  function start() {
    if (!stopped) video.play().catch(error => {
      if (stopped) return;
      if (error.name === 'NotAllowedError') {
        blocked = true;
        clearTimer();
        onBlocked?.();
      }
    });
  }
  const isHls = format === 'hls' || /\.m3u8(?:[?#]|$)/i.test(url);
  const nativeHls = isHls && video.canPlayType('application/vnd.apple.mpegurl');
  if (!isHls || nativeHls && 'ManagedMediaSource' in window) {
    video.src = url;
    start();
  } else {
    loadHls().then(Hls => {
      if (stopped) return;
      if (Hls.isSupported()) {
        hls = new Hls({enableWorker:typeof Worker === 'function',capLevelToPlayerSize:true});
        hls.on(Hls.Events.ERROR,(_event,data) => {
          if (data.fatal) fail(data.type === Hls.ErrorTypes.NETWORK_ERROR ? 2 : 4);
        });
        const publishAudio = () => {
          const tracks = hls.audioTracks || [];
          onAudioTracks?.(tracks.map((track,index) => ({
            id:String(index),label:track.name || track.lang || 'Дорожка ' + (index+1)
          })),String(hls.audioTrack),id => { hls.audioTrack = Number(id); });
        };
        hls.on(Hls.Events.AUDIO_TRACKS_UPDATED,publishAudio);
        hls.on(Hls.Events.AUDIO_TRACK_SWITCHED,publishAudio);
        hls.on(Hls.Events.MEDIA_ATTACHED,() => {
          hls.loadSource(url);
          start();
        });
        hls.attachMedia(video);
      } else if (nativeHls) {
        video.src = url;
        start();
      } else {
        fail(4);
      }
    }).catch(() => {
      if (stopped) return;
      if (nativeHls) {
        video.src = url;
        start();
      } else fail(4);
    });
  }
  return () => {
    stopped = true;
    clearTimer();
    video.removeEventListener('loadeddata',ready);
    video.removeEventListener('playing',ready);
    video.removeEventListener('error',ready);
    document.removeEventListener('visibilitychange',monitor);
    video.audioTracks?.removeEventListener?.('change',publishNativeAudio);
    video.audioTracks?.removeEventListener?.('addtrack',publishNativeAudio);
    video.removeEventListener('loadedmetadata',publishNativeAudio);
    hls?.destroy();
  };
}

const localEpisodeFolders = new Map();

function indexEpisodeFiles(files,episodes) {
  const allowed = new Set(episodes.map(item => item.season + ':' + item.episode));
  const found = new Map();
  const duplicates = new Set();
  for (const file of files) {
    if (!/\.(mp4|m4v|webm|mov|ogv)$/i.test(file.name)) continue;
    const filename = file.name.replace(/\.[^.]+$/,'');
    const match = /(?:^|[^a-z0-9])s(\d{1,3})[ ._-]*e(\d{1,4})(?!\d)/i.exec(filename) ||
      /(?:^|[^a-z0-9])(\d{1,3})x(\d{1,4})(?!\d)/i.exec(filename);
    if (!match) continue;
    const remainder = filename.slice(match.index + match[0].length);
    if (/^(?:[ ._]*e\d|[ ._]*-\s*(?:s\d|e?\d{1,3}(?:$|[ ._])))/i.test(remainder) ||
      /(?:^|[^a-z0-9])s\d+[ ._-]*e\d+|(?:^|[^a-z0-9])\d{1,3}x\d{1,4}/i.test(remainder)) continue;
    const id = Number(match[1]) + ':' + Number(match[2]);
    if (!allowed.has(id) || duplicates.has(id)) continue;
    if (found.has(id)) {
      found.delete(id);
      duplicates.add(id);
    } else found.set(id,file);
  }
  return found;
}

function renderStreamChoices(container,name,items=[],selected,onChange,showSingle=false) {
  if (!container) return;
  container.hidden = items.length < (showSingle ? 1 : 2);
  container.replaceChildren();
  if (container.hidden) return;
  const select = make('select');
  select.setAttribute('aria-label',name);
  for (const item of items) {
    const option = make('option',null,item.label);
    option.value = item.id;
    select.append(option);
  }
  if (items.some(item => item.id === selected)) select.value = selected;
  select.onchange = () => onChange(select.value);
  const field = make('div','watch-track-field');
  field.append(make('label',null,name),select);
  container.append(field);
  enhance(select);
}

function previewEpisodeVoices(show,item,signal,callback) {
  const native = async () => {
    const id = seriesNativeId(show) || await seriesMetadata.kinopoiskId(show,signal);
    if (!id) return [];
    const number = canonicalEpisode(show,item);
    return discoverNativeVoices(id,number.season,number.episode,signal);
  };
  const providers = [
    ['native',native,canResolveSeriesNative(show)],
    ['stremio',async () => (await resolveStremio(show,item,signal)).voices,stremioSource() && canUseStremio(show)],
    ['endpoint',async () => (await resolveEpisodeEndpoint(show,item,signal)).voices,episodeEndpoint()]
  ].filter(([, , enabled]) => enabled);
  const found = new Map();
  for (const [source,load] of providers) void load().then(items => {
    if (!signal.aborted && items?.length) {
      found.set(source,items);
      callback(providers.flatMap(([id]) => (found.get(id) || []).map(item => ({
        id:id + ':' + item.id,
        label:id === 'native' ? item.label : item.label + (id === 'stremio' ? ' · Stremio' : ' · Дополнительный источник')
      }))));
    }
  }).catch(() => {});
}

export {configuredEmbed, mediaProviders, seriesNativeId, canResolveSeriesNative, nativePlaylists, nativeRequest, nativePlaylist, nativeVoices, discoverNativeVoices, resolveNative, createExternalVideoFrame, seriesSource, resolveSeriesSource, episodeEndpointKey, episodeEndpoint, integrationEditorAvailable, allowedIntegrationEmbed, resolveEpisodeEndpoint, stremioSourceKey, stremioManifest, stremioSource, stremioManifestAddress, fetchAddonJson, canUseStremio, resolveStremio, hlsScript, loadHls, openVideoStream, localEpisodeFolders, indexEpisodeFiles, renderStreamChoices, previewEpisodeVoices};
