import {readLocal, writeLocal} from './storage.js';
import {mediaAddress} from './urls.js';
import {canonicalEpisode, seriesIdentity} from './series-config.js';
import {integrationSettings} from './integrations.js';
import {seriesEditorial} from './series-data.js';
import {localizedSeriesTitle} from './series-titles-ru.js';
import {imdbScore, loadCinemetaRating, validImdb} from './cinemeta.js';

const seriesMetadata = (() => {
  const keyName = 'konfoly-kinopoisk-api-key';
  const tmdbKeyName = 'konfoly-tmdb-read-token';
  const maxAge = 14 * 86400000;
  const cached = new Map();
  const languages = {English:'en',Japanese:'ja',Korean:'ko',French:'fr',German:'de',Spanish:'es',
    Italian:'it',Portuguese:'pt',Dutch:'nl',Turkish:'tr',Chinese:'zh',Hindi:'hi',Polish:'pl',Ukrainian:'uk',Russian:'ru'};
  const itemKey = item => item.season + ':' + item.episode;
  const storageKey = show => 'konfoly-show-metadata:' + show.id;

  function apiKey() {
    try { return sessionStorage.getItem(keyName) || ''; } catch { return ''; }
  }
  function setApiKey(value) {
    try {
      if (value) sessionStorage.setItem(keyName,value);
      else sessionStorage.removeItem(keyName);
      for (const data of cached.values()) delete data.kpCheckedAt;
      return true;
    } catch { return false; }
  }
  function tmdbToken() {
    try { return sessionStorage.getItem(tmdbKeyName) || ''; } catch { return ''; }
  }
  function setTmdbToken(value) {
    try {
      if (value) sessionStorage.setItem(tmdbKeyName,value);
      else sessionStorage.removeItem(tmdbKeyName);
    for (const data of cached.values()) {
      delete data.tmdbCheckedAt;
      delete data.tmdbAgeCheckedAt;
    }
      return true;
    } catch { return false; }
  }
  async function tmdbRequest(path,signal,token) {
    const response = await fetch('https://api.themoviedb.org/3/' + path,{
      signal,credentials:'omit',redirect:'error',headers:{Authorization:'Bearer ' + token}
    });
    if (!response.ok) throw Error('TMDB временно недоступен.');
    return response.json();
  }
  async function tmdbSeriesId(show,signal,token) {
    let id = show.tmdbId || read(show).tmdbId;
    if (!id && /^tt\d{5,12}$/.test(show.imdb?.id || '')) {
      const data = await tmdbRequest('find/' + show.imdb.id + '?external_source=imdb_id',signal,token);
      if (data.tv_results?.length === 1) id = data.tv_results[0].id;
    }
    if (Number.isInteger(id)) { save(show,{tmdbId:id}); return id; }
    return null;
  }
  async function tmdbImages(show,signal,token) {
    const id = await tmdbSeriesId(show,signal,token);
    if (!id) return [];
    const data = await tmdbRequest('tv/' + id + '/images?include_image_language=ru,en,null',signal,token);
    const rank = {ru:0,en:1,null:2};
    return (Array.isArray(data.logos) ? data.logos : [])
      .filter(logo => /^\/[a-zA-Z0-9]+\.(png|svg)$/i.test(logo.file_path))
      .sort((a,b) => (rank[a.iso_639_1] ?? 3) - (rank[b.iso_639_1] ?? 3) || b.vote_count - a.vote_count)
      .slice(0,6).map(logo => 'https://image.tmdb.org/t/p/original' + logo.file_path);
  }

  function russianAgeRating(value) {
    const age = /^(?:age)?(0|6|12|16|18)\+?$/.exec(String(value ?? ''))?.[1];
    return age == null ? '' : age + '+';
  }

  function editorialAgeRating(show) {
    return seriesIdentity(show)?.ageRating || seriesEditorial[show.mazeId]?.ageRating;
  }

  async function loadTmdbAgeRating(show,signal,token,onChange) {
    const id = await tmdbSeriesId(show,signal,token);
    if (!id || signal.aborted) return;
    const {results = []} = await tmdbRequest('tv/' + id + '/content_ratings',signal,token);
    if (signal.aborted) return;
    const ru = russianAgeRating(results.find(entry => entry.iso_3166_1 === 'RU')?.rating);
    const us = results.find(entry => entry.iso_3166_1 === 'US')?.rating;
    const tmdbAgeRating = ru || (/^TV-(Y|Y7|Y7-FV|G|PG|14|MA)$/.test(us) ? us + ' (США)' : '');
    save(show,{tmdbAgeRating,tmdbAgeCheckedAt:Date.now()});
    if (tmdbAgeRating) onChange();
  }
  const logoChecks = new Map();
  function transparentLogo(address) {
    if (address.startsWith('assets/')) return Promise.resolve(true);
    if (!logoChecks.has(address)) {
      logoChecks.set(address,new Promise(resolve => {
        const logo = new Image();
        const timer = setTimeout(() => resolve(false),5500);
        function finish(result) { clearTimeout(timer); resolve(result); }
        logo.crossOrigin = 'anonymous';
        logo.onerror = () => finish(false);
        logo.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 32;
            const context = canvas.getContext('2d',{willReadFrequently:true});
            context.drawImage(logo,0,0,32,32);
            const {data} = context.getImageData(0,0,32,32);
            let transparent = 0;
            for (let pixel=3; pixel<data.length; pixel+=4) if (data[pixel] < 32) transparent++;
            finish(transparent / (32 * 32) > .04);
          } catch { finish(false); }
        };
        logo.src = address;
      }));
    }
    return logoChecks.get(address);
  }
  function read(show) {
    if (!cached.has(show.id)) cached.set(show.id,readLocal(storageKey(show)));
    return cached.get(show.id);
  }
  function save(show,values) {
    const data = Object.assign(read(show),values);
    writeLocal(storageKey(show),data);
  }
  function imdbRating(show) {
    const record = show.imdb;
    if (!validImdb(record?.id)) return record;
    const curated = imdbScore(record.score);
    if (curated != null) return {...record,score:curated};
    const cached = read(show).imdbRating;
    const score = cached?.id === record.id ? imdbScore(cached.score) : undefined;
    return score == null ? record : {...record,score};
  }
  function rememberImdbRating(show,score) {
    if (validImdb(show.imdb?.id)) {
      save(show,{imdbRating:{id:show.imdb.id,score:imdbScore(score),checkedAt:Date.now()}});
    }
  }
  async function loadImdbRating(show,signal,onChange) {
    const id = show.imdb?.id;
    if (!validImdb(id) || imdbScore(show.imdb.score) != null) return;
    const cached = read(show).imdbRating;
    if (cached?.id === id && fresh(cached.checkedAt)) return;
    const score = await loadCinemetaRating(id,signal);
    if (signal.aborted) return;
    if (score != null || imdbRating(show)?.score == null) rememberImdbRating(show,score);
    if (score != null) onChange();
  }
  function text(value,max=4000) {
    return typeof value === 'string' ? value.trim().slice(0,max) : '';
  }
  function plain(value) {
    return text(new DOMParser().parseFromString(text(value),'text/html').body.textContent);
  }
  function image(value) {
    const address = mediaAddress(text(value),1,1);
    if (!address) return '';
    const {hostname} = new URL(address);
    return ['avatars.mds.yandex.net','avatars.yandex.net','st.kp.yandex.net','kinopoiskapiunofficial.tech',
      'commons.wikimedia.org','upload.wikimedia.org','thumb.wikimedia.org'].includes(hostname) ? address : '';
  }
  const fresh = time => Date.now() - time < maxAge;
  async function json(url,options) {
    const response = await fetch(url,{credentials:'omit',...options});
    if (response.status === 401 || response.status === 403) throw Error('Кинопоиск не принял ключ. Проверь его в настройках.');
    if (response.status === 429) throw Error('Лимит запросов к источнику исчерпан.');
    if (!response.ok) throw Error('Источник метаданных недоступен.');
    return response.json();
  }
  function keyLookupOptions(signal,key) {
    return {signal,headers:{'X-API-KEY':key},redirect:'error'};
  }
  async function wikidataRows(query,signal) {
    const url = new URL('https://query.wikidata.org/sparql');
    url.searchParams.set('format','json');
    url.searchParams.set('query',query);
    const data = await json(url,{signal});
    return data.results?.bindings || [];
  }
  async function searchTitles(shows,signal,onTitle) {
    const missing = shows.filter(show => Number.isInteger(show.mazeId) &&
      !/\p{Script=Cyrillic}/u.test(details(show).title)).slice(0,12);
    if (!missing.length) return;
    const labels = await wikidataRows('SELECT ?id ?name WHERE { VALUES ?id { ' +
      missing.map(show => '"' + show.mazeId + '"').join(' ') +
      ' } ?show wdt:P8600 ?id ; rdfs:label ?name . FILTER(LANG(?name) = "ru") }',signal);
    if (signal.aborted) return;
    const localized = new Map();
    for (const row of labels) {
      const title = text(row.name?.value,230);
      if (!/\p{Script=Cyrillic}/u.test(title)) continue;
      const id = Number(row.id?.value);
      if (!localized.has(id)) localized.set(id,new Set());
      localized.get(id).add(title);
    }
    for (const show of missing) {
      const names = localized.get(show.mazeId);
      if (names?.size !== 1) continue;
      save(show,{searchRuTitle:[...names][0]});
      onTitle(show);
    }
  }
  async function catalogSearch(query,signal) {
    const language = /\p{Script=Cyrillic}/u.test(query) ? 'ru' : 'en';
    const url = new URL('https://www.wikidata.org/w/api.php');
    url.search = new URLSearchParams({action:'wbsearchentities',format:'json',origin:'*',search:query,
      language,uselang:language,type:'item',limit:'12'});
    const data = await json(url,{signal});
    const items = (data.search || []).filter(item => /^Q\d+$/.test(item.id) && item.label);
    if (!items.length) return [];
    url.search = new URLSearchParams({action:'wbgetentities',format:'json',origin:'*',
      ids:items.map(item => item.id).join('|'),props:'claims|labels',languages:'ru|en'});
    const {entities} = await json(url,{signal});
    return items.flatMap(item => {
      const entity = entities?.[item.id];
      const value = property => entity?.claims?.[property]?.find(claim =>
        claim.rank !== 'deprecated' && claim.mainsnak?.datavalue?.value)?.mainsnak.datavalue.value;
      const id = value('P8600');
      if (!/^[1-9]\d{0,8}$/.test(id || '')) return [];
      return [{id:Number(id),name:text(entity.labels?.en?.value || item.label,230),
        localized:text(entity.labels?.ru?.value,230),externals:{imdb:value('P345')}}];
    }).slice(0,6);
  }
  async function wikidata(show,signal) {
    const imdb = show.imdb?.id;
    if (!/^tt\d{5,12}$/.test(imdb || '')) return {};
    const url = new URL('https://query.wikidata.org/sparql');
    url.searchParams.set('format','json');
    url.searchParams.set('query','SELECT DISTINCT ?id ?logo ?ruTitle ?wikiTitle ?enWikiTitle WHERE { ?s wdt:P345 "' + imdb +
      '" . OPTIONAL { ?s wdt:P2603 ?id } OPTIONAL { ?s wdt:P154 ?logo } ' +
      'OPTIONAL { ?s rdfs:label ?ruTitle . FILTER(LANG(?ruTitle) = "ru") } ' +
      'OPTIONAL { ?article schema:about ?s ; schema:isPartOf <https://ru.wikipedia.org/> ; schema:name ?wikiTitle } OPTIONAL { ?en schema:about ?s ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?enWikiTitle } } LIMIT 12');
    const {results} = await json(url,{signal});
    const rows = results?.bindings || [];
    const ids = [...new Set(rows.map(row => row.id?.value).filter(value => /^[1-9]\d{1,9}$/.test(value || '')))];
    return {
      kpId:ids.length === 1 ? Number(ids[0]) : undefined,
      commonsLogos:[...new Set(rows.map(row => image(row.logo?.value?.replace(/^http:/,'https:'))).filter(Boolean))],
      enWikiTitle:text(rows[0]?.enWikiTitle?.value,230),
      wikiTitle:text(rows[0]?.wikiTitle?.value,230),ruTitle:text(rows[0]?.ruTitle?.value,230)
    };
  }
  async function wikiEpisodeArticle(show,signal) {
    const cachedTitle = read(show).enWikiTitle;
    if (cachedTitle) return cachedTitle;
    const imdb = show.imdb?.id;
    const property = /^tt\d{5,12}$/.test(imdb || '') ? 'P345' : 'P8600';
    const id = property === 'P345' ? imdb : Number.isInteger(show.mazeId) && String(show.mazeId);
    if (!id) return '';
    async function byId() {
      const rows = await wikidataRows('SELECT DISTINCT ?title WHERE { ?show wdt:' + property + ' "' + id +
        '" . ?page schema:about ?show ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?title . } LIMIT 2',signal);
      const article = rows.length === 1 && text(rows[0].title?.value,230);
      if (!article) throw Error('Статья сериала не найдена.');
      return article;
    }
    async function byTitle() {
      const title = show.original || show.title;
      const language = /\p{Script=Cyrillic}/u.test(title) ? 'ru' : 'en';
      const url = new URL('https://www.wikidata.org/w/api.php');
      const request = parameters => {
        url.search = new URLSearchParams({format:'json',origin:'*',...parameters});
        return json(url,{signal});
      };
      const {search} = await request({action:'wbsearchentities',search:title,language,type:'item',limit:'10'});
      const ids = (search || []).map(item => item.id).filter(value => /^Q\d+$/.test(value));
      if (!ids.length) throw Error('Статья сериала не найдена.');
      const {entities} = await request({action:'wbgetentities',ids:ids.join('|'),props:'claims|sitelinks',sitefilter:'enwiki'});
      const matches = Object.values(entities || {}).filter(entity => entity.claims?.[property]?.some(claim =>
        claim.rank !== 'deprecated' && claim.mainsnak?.datavalue?.value === id)).map(entity => entity.sitelinks?.enwiki?.title).filter(Boolean);
      if (matches.length !== 1) throw Error('Статья сериала не найдена.');
      return text(matches[0],230);
    }
    return Promise.any([byId(),byTitle()]);
  }
  async function kinopoiskId(show,signal) {
    const known = seriesIdentity(show)?.kinopoiskId || read(show).kpId;
    if (known) return known;
    const metadata = await wikidata(show,signal);
    if (!signal.aborted && metadata.kpId) save(show,{...metadata,wikiCheckedAt:Date.now()});
    return metadata.kpId || null;
  }
  async function lookupKpId(show,key,signal) {
    if (!/^tt\d{5,12}$/.test(show.imdb?.id || '')) return null;
    const query = new URL('https://kinopoiskapiunofficial.tech/api/v2.2/films');
    query.searchParams.set('keyword',show.original || show.title);
    query.searchParams.set('type','TV_SERIES');
    const result = await json(query,keyLookupOptions(signal,key));
    const candidates = (result.items || []).slice(0,20).filter(item =>
      [show.original,show.title].some(name => name && [item.nameOriginal,item.nameEn,item.nameRu].some(candidate =>
        typeof candidate === 'string' && candidate.toLowerCase() === name.toLowerCase())));
    for (const candidate of candidates.slice(0,3)) {
      if (!Number.isInteger(candidate.kinopoiskId)) continue;
      const detail = await kpRequest(candidate.kinopoiskId,'',key,signal);
      if (detail.imdbId === show.imdb.id) return detail;
    }
    return null;
  }
  const kpRequest = (id,suffix,key,signal) => json('https://kinopoiskapiunofficial.tech/api/v2.2/films/' + id + suffix,
    keyLookupOptions(signal,key));

  async function wikiIntro(title,signal) {
    const query = new URL('https://ru.wikipedia.org/w/api.php');
    for (const [key,value] of Object.entries({action:'query',prop:'extracts',exintro:'1',explaintext:'1',
      exsentences:'3',redirects:'1',format:'json',formatversion:'2',origin:'*',titles:title})) query.searchParams.set(key,value);
    const data = await json(query,{signal});
    const entry = data.query?.pages?.[0];
    if (!entry?.extract || entry.missing) return {};
    return {wikiDescription:text(entry.extract,800),
      wikiSource:'https://ru.wikipedia.org/wiki/' + encodeURIComponent(entry.title.replaceAll(' ','_'))};
  }
  async function commonsThumbnails(addresses,signal) {
    const files = addresses.flatMap(address => {
      try {
        const url = new URL(address);
        const match = /^\/wiki\/Special:FilePath\/(.+)$/i.exec(url.pathname);
        return url.hostname === 'commons.wikimedia.org' && match ? ['File:' + decodeURIComponent(match[1])] : [];
      } catch { return []; }
    });
    if (!files.length) return [];
    const query = new URL('https://commons.wikimedia.org/w/api.php');
    query.search = new URLSearchParams({action:'query',format:'json',formatversion:'2',origin:'*',
      prop:'imageinfo',iiprop:'url',iiurlwidth:'500',titles:files.join('|')});
    const result = await json(query,{signal});
    return (result.query?.pages || []).map(file => image(file.imageinfo?.[0]?.thumburl || file.imageinfo?.[0]?.url)).filter(Boolean);
  }
  async function articleLogos(show,title,language,signal) {
    if (!title) return [];
    const url = new URL('https://' + language + '.wikipedia.org/w/api.php');
    const common = {action:'query',format:'json',formatversion:'2',origin:'*'};
    for (const [key,value] of Object.entries({...common,prop:'images',imlimit:'50',titles:title})) url.searchParams.set(key,value);
    const data = await json(url,{signal});
    const comparable = value => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
    const names = [show.original,show.title,title.replace(/\s*\([^)]*\)/g,'')].filter(Boolean).map(comparable)
      .filter(name => name.length >= 4);
    const files = (data.query?.pages?.[0]?.images || []).map(entry => entry.title).filter(name => {
      if (!/(logo|wordmark|логотип)/iu.test(name) || !/\.(png|svg|webp)$/i.test(name)) return false;
      return names.some(title => comparable(name).includes(title));
    }).slice(0,5);
    if (!files.length) return [];
    url.search = new URLSearchParams({...common,prop:'imageinfo',iiprop:'url',iiurlwidth:'430',titles:files.join('|')});
    const result = await json(url,{signal});
    return (result.query?.pages || []).map(file => image(file.imageinfo?.[0]?.thumburl || file.imageinfo?.[0]?.url)).filter(Boolean);
  }
  async function load(show,signal,onChange) {
    const data = read(show);
    const key = apiKey();
    const jobs = [];
    const logoAddress = integrationSettings.logoEndpoint;
    if (logoAddress && /^tt\d{5,12}$/.test(show.imdb?.id || '') && !fresh(data.operatorLogosCheckedAt)) {
      jobs.push((async () => {
        const address = mediaAddress(logoAddress,1,1);
        if (!address) return;
        const query = new URL(address);
        query.searchParams.set('imdb',show.imdb.id);
        const result = await json(query,{signal});
        if (signal.aborted) return;
        const logos = (Array.isArray(result.logos) ? result.logos : []).slice(0,8)
          .map(value => typeof value === 'string' && mediaAddress(value,1,1)).filter(Boolean);
        save(show,{operatorLogos:logos,operatorLogosCheckedAt:Date.now()});
        onChange();
      })());
    }
    const token = tmdbToken();
    const editorialAge = editorialAgeRating(show);
    if (token && !editorialAge && !data.kpAgeRating && !fresh(data.tmdbAgeCheckedAt)) {
      jobs.push(loadTmdbAgeRating(show,signal,token,onChange).catch(() => {}));
    }
    if (token && !fresh(data.tmdbCheckedAt)) {
      jobs.push((async () => {
        const logos = await tmdbImages(show,signal,token);
        if (signal.aborted) return;
        save(show,{tmdbLogos:logos,tmdbCheckedAt:Date.now()});
        onChange();
      })());
    }
    if ((!fresh(data.mazeCheckedAt) || !data.mazeIds) && show.mazeId && show.episodes && show.id !== 'interns') {
      jobs.push((async () => {
        const rows = await json('https://api.tvmaze.com/shows/' + show.mazeId + '/episodes',{signal});
        if (signal.aborted) return;
        const summaries = {};
        const mazeIds = {};
        for (const row of rows) {
          if (Number.isInteger(row.season) && Number.isInteger(row.number)) {
            const key = row.season + ':' + row.number;
            if (row.summary) summaries[key] = plain(row.summary);
            if (Number.isInteger(row.id)) mazeIds[key] = row.id;
          }
        }
        save(show,{maze:summaries,mazeIds,mazeCheckedAt:Date.now()});
        onChange();
      })());
    }
    if (!fresh(data.wikiCheckedAt) || !fresh(data.wikiArtCheckedAt)) {
      jobs.push((async () => {
        const wiki = await wikidata(show,signal);
        if (signal.aborted) return;
        save(show,{...wiki,wikiCheckedAt:Date.now()});
        onChange();
        const logoJob = Promise.allSettled([
          commonsThumbnails(wiki.commonsLogos || [],signal),
          articleLogos(show,wiki.wikiTitle,'ru',signal),
          articleLogos(show,wiki.enWikiTitle,'en',signal)
        ]).then(outcomes => {
          if (signal.aborted) return;
          const logos = outcomes.flatMap(result => result.status === 'fulfilled' ? result.value : []);
          if (outcomes.some(result => result.status === 'fulfilled')) {
            save(show,{wikiLogos:logos,wikiArtCheckedAt:Date.now()});
            if (logos.length) onChange();
          }
        });
        if (wiki.wikiTitle && !/\p{Script=Cyrillic}/u.test(show.description || '')) {
          const intro = await wikiIntro(wiki.wikiTitle,signal);
          if (signal.aborted) return;
          save(show,intro);
          onChange();
        }
        await logoJob;
      })());
    }
    if (key && (!fresh(data.kpCheckedAt) || !Object.hasOwn(data,'kpDescription') ||
        (!editorialAge && !Object.hasOwn(data,'kpAgeRating')))) {
      jobs.push((async () => {
        const id = await kinopoiskId(show,signal).catch(() => null);
        if (signal.aborted) return;
        const detail = id ? await kpRequest(id,'',key,signal) : await lookupKpId(show,key,signal);
        if (!detail || !Number.isInteger(detail.kinopoiskId) ||
            (detail.imdbId && show.imdb?.id && detail.imdbId !== show.imdb.id)) {
          throw Error('Точное совпадение с Кинопоиском не найдено.');
        }
        const kpId = detail.kinopoiskId;
        if (signal.aborted) return;
        const kpAgeRating = russianAgeRating(detail.ratingAgeLimits);
        save(show,{kpAgeRating});
        if (kpAgeRating) onChange();
        const result = await kpRequest(kpId,'/seasons',key,signal);
        if (signal.aborted) return;
        const episodes = {};
        for (const season of result.items || []) {
          for (const ep of season.episodes || []) {
            if (!Number.isInteger(ep.seasonNumber) || !Number.isInteger(ep.episodeNumber)) continue;
            episodes[ep.seasonNumber + ':' + ep.episodeNumber] = {
              title:text(ep.nameRu,300),original:text(ep.nameEn,300),description:plain(ep.synopsis)
            };
          }
        }
        save(show,{kpId,kpTitle:text(detail.nameRu,200),kpDescription:plain(detail.shortDescription || detail.description),
          kpLogo:image(detail.logoUrl),kp:episodes,kpCheckedAt:Date.now()});
        onChange();
      })());
    }
    const results = await Promise.allSettled(jobs);
    const failure = results.find(result => result.status === 'rejected');
    if (failure && !signal.aborted) throw failure.reason;
  }

  const episodeJobs = new WeakMap();
  async function loadEpisodeTitles(show,items,signal,onChange) {
    if (!items?.length || signal.aborted || show.language === 'Russian') return;
    const data = read(show);
    const jobs = episodeJobs.get(signal) || new Set();
    episodeJobs.set(signal,jobs);
    const pending = items.filter(item => !episode(show,item).translated);
    const wikiPending = pending.map(item => [itemKey(item),item.mazeId || data.mazeIds?.[itemKey(item)]])
      .filter(([key,id]) => Number.isInteger(id) && !fresh(data.wikiEpisodeChecked?.[key]) && !jobs.has('wiki:' + key));
    for (const [key] of wikiPending) jobs.add('wiki:' + key);
    const wiki = async () => {
      for (let start=0; start<wikiPending.length && !signal.aborted; start+=40) {
        const batch = wikiPending.slice(start,start+40);
        const ids = [...new Set(batch.map(([,id]) => id))].map(id => '"' + id + '"').join(' ');
        const rows = await wikidataRows('SELECT ?id ?name WHERE { VALUES ?id { ' + ids +
          ' } ?episode wdt:P11294 ?id ; rdfs:label ?name . FILTER(LANG(?name) = "ru") }',signal);
        if (signal.aborted) return;
        const names = new Map();
        for (const row of rows) {
          const id = Number(row.id?.value);
          const title = text(row.name?.value,300);
          if (!/\p{Script=Cyrillic}/u.test(title)) continue;
          if (!names.has(id)) names.set(id,new Set());
          names.get(id).add(title);
        }
        const titles = {...data.wikiEpisodeTitles};
        const checked = {...data.wikiEpisodeChecked};
        let changed = false;
        for (const [key,id] of batch) {
          checked[key] = Date.now();
          if (names.get(id)?.size === 1) {
            titles[key] = [...names.get(id)][0];
            changed = true;
          }
        }
        save(show,{wikiEpisodeTitles:titles,wikiEpisodeChecked:checked});
        if (changed) onChange();
      }
    };
    const tmdb = async () => {
      const token = tmdbToken();
      if (!token) return;
      const seasons = [...new Set(pending.map(item => item.season))]
        .filter(season => !fresh(data.tmdbEpisodeChecked?.[season]) && !jobs.has('tmdb:' + season));
      if (!seasons.length || seriesIdentity(show)?.seasonLengths) return;
      for (const season of seasons) jobs.add('tmdb:' + season);
      const id = await tmdbSeriesId(show,signal,token);
      if (!id) return;
      for (const season of seasons) {
        if (signal.aborted) return;
        const response = await tmdbRequest('tv/' + id + '/season/' + season + '?language=ru-RU',signal,token);
        if (signal.aborted) return;
        const titles = {...data.tmdbEpisodeTitles};
        for (const row of response.episodes || []) {
          const item = (show.episodes || items).find(item => item.season === season && item.episode === row.episode_number);
          const title = text(row.name,300);
          if (item && /\p{Script=Cyrillic}/u.test(title) &&
              (!item.airdate || !row.air_date || item.airdate === row.air_date)) titles[itemKey(item)] = title;
        }
        save(show,{tmdbEpisodeTitles:titles,tmdbEpisodeChecked:{...data.tmdbEpisodeChecked,[season]:Date.now()}});
        onChange();
      }
    };
    await Promise.allSettled([wiki(),tmdb()]);
  }
  const normalize = value => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu,'').replace(/^bojackhorseman/,'');
  function episode(show,item) {
    const data = read(show);
    const id = itemKey(item);
    let kpId = id;
    if (seriesIdentity(show)?.seasonLengths) {
      try { kpId = itemKey(canonicalEpisode(show,item)); } catch { kpId = ''; }
    }
    const kp = data.kp?.[kpId];
    const match = kp && (!kp.original || !item.title || /^Серия \d+$/.test(item.title) || normalize(kp.original) === normalize(item.title)) ? kp : null;
    const official = typeof seriesEditorial === 'undefined' ? null : seriesEditorial[show.mazeId]?.episodes?.[id];
    const localTitle = localizedSeriesTitle(show,item);
    const translatedTitle = match?.title || official?.title || (localTitle !== item.title ? localTitle : '') ||
      data.tmdbEpisodeTitles?.[id] || data.wikiEpisodeTitles?.[id] || data.translated?.[id]?.title;
    const synopsisSource = data.maze?.[id] ? 'TVmaze' : item.synopsisSource || 'TVmaze';
    return {
      title:translatedTitle || item.title,
      description:match?.description || official?.description || data.translated?.[id]?.description || data.maze?.[id] || item.synopsis || '',
      source:match?.description ? 'Кинопоиск' : official?.description ? official.source : data.translated?.[id]?.description ?
        'Машинный перевод · ' + synopsisSource : synopsisSource,
      translated:!!translatedTitle || /\p{Script=Cyrillic}/u.test(item.title || '')
    };
  }

  function details(show) {
    const data = read(show);
    const editorial = typeof seriesEditorial === 'undefined' ? null : seriesEditorial[show.mazeId];
    const description = data.kpDescription ? {text:data.kpDescription,source:'https://www.kinopoisk.ru/series/' + data.kpId + '/',label:'Кинопоиск'} :
      editorial?.description ? {text:editorial.description,source:editorial.source,label:editorial.label} :
      /\p{Script=Cyrillic}/u.test(show.description || '') ? {text:show.description} :
      data.wikiDescription ? {text:data.wikiDescription,source:data.wikiSource,label:'Википедия'} :
      data.translatedShow?.description ? {text:data.translatedShow.description,label:'Машинный перевод'} : {text:show.description || ''};
    const ageRating = editorialAgeRating(show) || data.kpAgeRating || data.tmdbAgeRating || '';
    return {title:data.kpTitle || editorial?.title || data.ruTitle || data.searchRuTitle || data.translatedShow?.title || show.title,description,ageRating};
  }
  async function translateShow(show,signal,onChange) {
    const original = details(show);
    const translator = await globalThis.Translator.create({sourceLanguage:languages[show.language] || 'en',targetLanguage:'ru',signal});
    try {
      const output = {};
      if (!/\p{Script=Cyrillic}/u.test(original.title)) output.title = text(await translator.translate(show.title,{signal}),230);
      if (show.description && !/\p{Script=Cyrillic}/u.test(original.description.text)) {
        output.description = text(await translator.translate(show.description,{signal}),800);
      }
      if (!signal.aborted) {
        save(show,{translatedShow:{...read(show).translatedShow,...output}});
        onChange();
      }
    } finally { translator.destroy(); }
  }
  function canTranslate(show) {
    return typeof globalThis.Translator?.create === 'function' && show.language !== 'Russian';
  }
  async function translateIfReady(show,items,signal,onChange,titlesOnly=false) {
    if (!canTranslate(show) || typeof globalThis.Translator.availability !== 'function') return;
    const options = {sourceLanguage:languages[show.language] || 'en',targetLanguage:'ru'};
    try {
      if (await globalThis.Translator.availability(options) !== 'available' || signal.aborted) return;
      if (items?.length) await translate(show,items,signal,onChange,titlesOnly);
      else await translateShow(show,signal,onChange);
    } catch {}
  }
  async function translate(show,items,signal,onChange,titlesOnly=false) {
    const sourceLanguage = languages[show.language] || 'en';
    const translator = await globalThis.Translator.create({sourceLanguage,targetLanguage:'ru',signal});
    const data = read(show);
    let changed = false;
    try {
      for (const item of items) {
        if (signal.aborted) return;
        const id = itemKey(item);
        const info = episode(show,item);
        const next = {...data.translated?.[id]};
        if (!info.translated && item.title) {
          next.title = text(await translator.translate(item.title,{signal}),300);
          changed = true;
        }
        const summary = data.maze?.[id] || item.synopsis;
        if (!titlesOnly && summary && ['TVmaze','Cinemeta'].includes(info.source) && !/\p{Script=Cyrillic}/u.test(summary)) {
          next.description = text(await translator.translate(summary,{signal}));
          changed = true;
        }
        if (next.title || next.description) {
          data.translated ||= {};
          data.translated[id] = next;
        }
      }
      if (!signal.aborted && changed) {
        save(show,{translated:data.translated});
        onChange();
      }
    } finally { translator.destroy(); }
  }

  return {loadEpisodeTitles,searchTitles,catalogSearch,wikiEpisodeArticle,imdbRating,loadImdbRating,rememberImdbRating,rememberSearchTitle:(show,title) => save(show,{searchRuTitle:title}),translateIfReady,apiKey,setApiKey,tmdbToken,setTmdbToken,transparentLogo,read,load,episode,kinopoiskId,details,translateShow,canTranslate,translate,plain};
})();

export {seriesMetadata};
