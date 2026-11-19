const mediaProviders = [
  {id:'native',title:'Наш плеер',detail:'Рекомендуемый · ТВ3, Universal и TVShows при наличии',action:'Смотреть'},
  {id:'endpoint',title:'Общий источник',detail:'Прямое видео в нашем плеере по ID сериала и номеру серии.',action:'Смотреть'},
  {id:'stremio',title:'Stremio',detail:'Прямое видео из подключённого дополнения в нашем плеере.',action:'Смотреть'},
  {id:'vidlink',title:'VidLink',detail:'Открывается в новой вкладке · возможна реклама. Русская озвучка и качество зависят от серии.',action:'Открыть'},
  {id:'namy',title:'Namy / Collaps',detail:'Запасной плеер с рекламой. Настройки и прогресс управляются поставщиком.',action:'Открыть'},
  {id:'alloha',title:'Alloha',detail:'Внешний плеер · возможна реклама. Подключается по готовой ссылке для вставки.',action:'Настроить'},
  {id:'tomion',title:'Tomion',detail:'Резервный источник. Ранее возвращал ошибку доступа.',action:'Проверить'},
  {id:'file',title:'Файл с устройства',detail:'MP4, WebM и другие форматы, которые поддерживает браузер.',action:'Выбрать видео'},
  {id:'custom',title:'Свой источник',detail:'Прямое видео или встраиваемый плеер.',action:'Настроить ссылку'}
];
function mediaAddress(template, season, episode) {
  try {
    const url = new URL(template.replaceAll('{season}', season).replaceAll('{episode}', episode));
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
function embedAddress(id,season,episode) {
  if (id === 'namy') return 'https://api.namy.ws/embed/movie/454?season=' + season + '&episode=' + (season === 7 && episode >= 12 ? '12-13' : episode);
  if (id === 'tomion') return 'https://tomion.org/tvb/412344?episode=' + episode + '&season=' + season + '&skips=1&vonly=true';
  return null;
}
function seriesNativeId(show) {
  const known = {tt3398228:818185,tt0903747:404900,tt3032476:796660,tt1475582:502838};
  return show.mazeId === 184 ? 818185 : known[show.imdb?.id] || null;
}

function canResolveSeriesNative(show) {
  return !!seriesNativeId(show) || /^tt\d{5,12}$/.test(show.imdb?.id || '');
}
async function resolveNative({season,episode,voice,quality,kinopoiskId=412344}, signal) {
  const api = 'https://plapi.cdnvideohub.com/api/v1/player/sv';
  const combined = kinopoiskId === 412344 && voice === 'ТВ3' && season === 3 && episode >= 23;
  const number = combined ? 23 : episode;
  async function get(path) {
    const response = await fetch(api + path,{signal});
    if (!response.ok) throw Error('Источник недоступен. Повтори попытку.');
    return response.json();
  }
  const list = await get('/playlist?pub=10428&id=' + kinopoiskId + '&aggr=kp&ep=' + number + '&sn=' + season);
  const matching = (Array.isArray(list.items) ? list.items : []).filter(row =>
    row.season === season && row.episode === number && row.vkId);
  const voices = [...new Set(matching.map(row => row.voiceStudio).filter(value => typeof value === 'string' && value.trim()))]
    .map(value => ({id:value,label:value}));
  const items = matching.filter(row => !voice || row.voiceStudio === voice);
  if (!items.length) throw Error(voice
    ? 'Для этой серии нет выбранной озвучки. Выбери другую в настройках источника.'
    : 'Наш источник не предоставил эту серию.');
  const candidates = quality === 'fullhd'
    ? ['mpegFullHdUrl','mpegHighUrl','mpegMediumUrl','hlsUrl']
    : ['mpegHighUrl','mpegMediumUrl','mpegFullHdUrl','hlsUrl'];
  for (const item of items.slice(0,voice ? 1 : 3)) {
    let media;
    try {
      media = await get('/video/' + encodeURIComponent(item.vkId));
    } catch (error) {
      if (signal?.aborted || voice) throw error;
      continue;
    }
    const seen = new Set();
    const streams = [];
    for (const key of candidates) {
      const url = mediaAddress(media.sources?.[key] || '',season,episode);
      if (!url || !new URL(url).hostname.endsWith('.okcdn.ru') || seen.has(url)) continue;
      seen.add(url);
      const format = key === 'hlsUrl' ? 'hls' : undefined;
      const qualityNote = quality === 'fullhd' && !format && key !== 'mpegFullHdUrl' ? ' · Выбрано доступное качество' : '';
      const measured = kinopoiskId === 412344 && season === 4 && episode === 11 &&
        voice === 'ТВ3' && quality === 'fullhd' && key === 'mpegFullHdUrl';
      streams.push({
        url,format,combined,label:(item.voiceStudio || voice || 'Наш плеер') + qualityNote,
        metadata:measured ? 'H.264 · видео 1,86 Мбит/с · AAC 262 кбит/с' : ''
      });
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
  return readLocal(episodeEndpointKey).url || '';
}

async function resolveEpisodeEndpoint(show,item,signal) {
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
  const url = typeof result?.url === 'string' && mediaAddress(result.url,item.season,item.episode);
  if (!url) throw Error('Общий источник не вернул HTTPS-ссылку на видео.');
  return {url,format:result.format === 'hls' ? 'hls' : undefined};
}

const stremioSourceKey = 'konfoly-stremio-source-v1';
let stremioManifest;

function stremioSource() {
  return readLocal(stremioSourceKey).url || '';
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

const vidLinkIds = new Map();

function canUseVidLink(show) {
  return Number.isInteger(show.tmdbId) || /^tt\d+$/.test(show.imdb?.id || '');
}

async function resolveVidLink(show,item,signal,time=0) {
  const imdb = show.imdb?.id;
  let id = show.tmdbId || vidLinkIds.get(imdb);
  if (!id) {
    if (!canUseVidLink(show)) throw Error('Для этого сериала нет идентификатора IMDb или TMDB.');
    const query = new URL('https://query.wikidata.org/sparql');
    query.searchParams.set('query','SELECT DISTINCT ?tmdb WHERE { ?show wdt:P345 "' + imdb + '" ; wdt:P4983 ?tmdb . } LIMIT 2');
    query.searchParams.set('format','json');
    const response = await fetch(query,{signal,credentials:'omit'});
    if (!response.ok) throw Error('Не удалось сопоставить сериал с каталогом VidLink.');
    const matches = (await response.json()).results?.bindings;
    if (matches?.length !== 1 || !/^\d+$/.test(matches[0].tmdb?.value || '')) {
      throw Error('Для этого сериала не найден однозначный идентификатор TMDB.');
    }
    id = Number(matches[0].tmdb.value);
    vidLinkIds.set(imdb,id);
  }
  const url = new URL('https://vidlink.pro/tv/' + id + '/' + item.season + '/' + item.episode);
  url.searchParams.set('autoplay','false');
  if (time > 0) url.searchParams.set('startAt',String(Math.floor(time)));
  return url.href;
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
        hls = new Hls({enableWorker:false,capLevelToPlayerSize:true});
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

function renderStreamChoices(container,name,items=[],selected,onChange) {
  container.hidden = items.length < 2;
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
  const label = make('label','watch-track-field',name);
  label.append(select);
  container.append(label);
}
