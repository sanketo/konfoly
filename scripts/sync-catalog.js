import {readFile,writeFile,rename} from 'node:fs/promises';
import {resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {integrationSettings,allowedOrigins} from '../integrations.js';
import {catalogRecordId,findCatalogShow,sourceRevision} from '../catalog-model.js';
import {seriesIdentity} from '../series-config.js';
import {baseCatalog} from './catalog-base.js';
import {auditSource} from './probe-catalog-video.js';
import {loadCinemetaSeries} from '../cinemeta.js';

const {values} = parseArgs({options:{
  'cinemeta-pages':{type:'string'},
  output:{type:'string',default:'data/popular-series.json'},
  site:{type:'string',default:'https://sanketo.github.io'},
  'oembed-dir':{type:'string'},
  'wikidata-pages':{type:'string'},
  'probe-limit':{type:'string',default:'12'}
}});
const limit = Number(values['probe-limit']);
if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw Error('Probe limit must be from 1 to 100');
const site = new URL(values.site).origin;
const base = baseCatalog();
const genresExcluded = /^(documentary|reality[ -]?tv|talk[ -]?show|game[ -]?show|news)$/i;
const documentaryDescription = /^(?:an? |the )?(?:(?:true crime|nature|travel|sports) )?(?:documentary(?: series|miniseries)?|docu(?:mentary)?[- ]?series)\b/i;
const imdbId = value => /^tt\d{5,12}$/.test(value || '') ? value : null;
const year = date => Number(/^\d{4}/.exec(date || '')?.[0]) || null;
const clean = text => (text || '').replace(/<[^>]*>/g,' ').trim();
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));

async function request(url,headers) {
  for (let attempt=0; attempt<3; attempt++) {
    try {
      const response = await fetch(url,{headers,signal:AbortSignal.timeout(12000)});
      if (response.ok) return response;
      await response.body?.cancel();
      if (response.status !== 429 && response.status < 500) throw Object.assign(Error('HTTP ' + response.status),{permanent:true});
      if (attempt === 2) throw Error('HTTP ' + response.status);
      const retry = Number(response.headers.get('retry-after'));
      if (retry > 0) await sleep(Math.min(retry,20)*1000);
    } catch (error) {
      if (error.permanent || attempt === 2) throw error;
    }
    await sleep(550*(attempt+1));
  }
}

function episodeKeys(videos,id) {
  return [...new Set((videos || []).filter(item => Number.isInteger(item.season) && item.season > 0 &&
    Number.isInteger(item.episode) && item.episode > 0 && item.id === id + ':' + item.season + ':' + item.episode)
    .map(item => item.season + ':' + item.episode))];
}

function adjustRecord(row,sourceRank) {
  const id = imdbId(row.imdb ?? row.id);
  const tmdbId = Number.isInteger(row.moviedb_id) && row.moviedb_id > 0 ? row.moviedb_id : null;
  const genres = row.genres || row.genre || [];
  const overview = clean(row.description);
  if (row.type !== 'series' || !(id || tmdbId) || !genres.length || genres.some(genre => genresExcluded.test(genre)) ||
      documentaryDescription.test(overview) || !row.name || !row.released || row.released.slice(0,10) > new Date().toISOString().slice(0,10) ||
      !Number.isFinite(row.popularity)) return null;
  const keys = episodeKeys(row.videos,id);
  const rating = Number(row.imdbRating);
  return {imdbId:id,tmdbId,title:row.name,originalTitle:row.original_name || row.original_title || null,
    year:year(row.released),years:row.releaseInfo || String(year(row.released)),genres,popularity:row.popularity,sourceRank,
    ...(rating > 0 && rating <= 10 ? {imdbScore:rating} : {}),
    sampledEpisodes:keys.length,sampledSeasons:new Set(keys.map(key => key.split(':')[0])).size,keys};
}

// The catalog response can contain thousands of video records. Only read the requested leading titles.
async function cinePage(skip,count) {
  const url = 'https://v3-cinemeta.strem.io/catalog/series/top/skip=' + skip + '.json';
  const response = await request(url);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const rows = [];
  let started = false,depth = 0,quoted = false,escaped = false,record = '';
  try {
    while (rows.length < count) {
      const {value,done} = await reader.read();
      if (done) break;
      for (const char of decoder.decode(value,{stream:true})) {
        if (!started) {
          if (char === '[') started = true;
          continue;
        }
        if (!depth && char !== '{') continue;
        record += char;
        if (escaped) escaped = false;
        else if (quoted && char === '\\') escaped = true;
        else if (char === '"') quoted = !quoted;
        else if (!quoted && char === '{') depth++;
        else if (!quoted && char === '}' && --depth === 0) {
          rows.push(JSON.parse(record));
          if (rows.length === count) break;
          record = '';
        }
      }
    }
    return rows;
  } finally { await reader.cancel().catch(() => {}); }
}

async function cineCandidates() {
  const result = [];
  for (let start=0; start<480 && distinct(result).length < 250; start+=36) {
    const offsets = Array.from({length:6},(_,i) => start + 6*i);
    const pages = await Promise.all(offsets.map(async offset => {
      let rows;
      if (values['cinemeta-pages']) {
        const page = JSON.parse(await readFile(resolve(values['cinemeta-pages'],offset + '.json'),'utf8'));
        rows = (page.metas || page).slice(0,6);
      } else rows = await cinePage(offset,6);
      if (rows.length !== 6) throw Error('Incomplete Cinemeta page at offset ' + offset);
      return rows.map((row,index) => adjustRecord(row,offset+index+1)).filter(Boolean);
    }));
    result.push(...pages.flat());
    console.log('Cinemeta scanned ' + (start + 36) + ' entries, eligible ' + distinct(result).length);
  }
  return result;
}

async function tmdbCandidates(token) {
  const api = async path => (await request('https://api.themoviedb.org/3/' + path,
    {Authorization:'Bearer ' + token,Accept:'application/json'})).json();
  const {genres} = await api('genre/tv/list?language=en-US');
  const names = new Map(genres.map(({id,name})=>[id,name]));
  const excluded = genres.filter(({name})=>genresExcluded.test(name)).map(({id})=>id);
  const results = [];
  for (let page=1; page<=35 && distinct(results).length < 250; page++) {
    const query = new URLSearchParams({sort_by:'popularity.desc',without_genres:excluded.join(','),include_adult:'false',
      'first_air_date.lte':new Date().toISOString().slice(0,10),page});
    const list = await api('discover/tv?' + query);
    if (!list.results.length) break;
    const candidates = list.results.filter(row => row.name && row.genre_ids.length &&
      !row.genre_ids.some(id=>excluded.includes(id)) && !documentaryDescription.test(row.overview || ''));
    for (let index=0; index<candidates.length; index+=4) {
      const batch = await Promise.all(candidates.slice(index,index+4).map(async row => {
        const detail = await api('tv/' + row.id + '?append_to_response=external_ids');
        if (genresExcluded.test(detail.type || '') || detail.type === 'Documentary') return null;
        const id = imdbId(detail.external_ids?.imdb_id);
        return {tmdbId:row.id,imdbId:id,title:row.name,originalTitle:row.original_name,year:year(row.first_air_date),
          years:String(year(row.first_air_date) || ''),genres:row.genre_ids.map(id=>names.get(id)).filter(Boolean),
          popularity:row.popularity,episodeCount:detail.number_of_episodes,seasonCount:detail.number_of_seasons,
          ...(row.poster_path ? {image:'https://image.tmdb.org/t/p/w342' + row.poster_path} : {}),keys:[]};
      }));
      results.push(...batch.filter(Boolean));
    }
    console.log('TMDB page ' + page + ', eligible ' + distinct(results).length);
  }
  return results;
}

function distinct(entries) {
  const imdb = new Set(), tmdb = new Set();
  return entries.filter(entry => {
    if (entry.imdbId && imdb.has(entry.imdbId) || entry.tmdbId && tmdb.has(entry.tmdbId)) return false;
    if (entry.imdbId) imdb.add(entry.imdbId);
    if (entry.tmdbId) tmdb.add(entry.tmdbId);
    return true;
  });
}

const token = process.env.TMDB_READ_TOKEN;
const mode = token && !values['cinemeta-pages'] ? 'TMDB' : 'Cinemeta';
console.log('Popularity source ' + mode + (values['cinemeta-pages'] ? ' (downloaded source pages)' : ''));
const candidates = distinct(mode === 'TMDB' ? await tmdbCandidates(token) : await cineCandidates());
async function fillOriginalTitles(entries) {
  const pending = entries.filter(entry => !entry.originalTitle && entry.imdbId);
  let resolvedCount = 0;
  for (let start=0; start<pending.length; start+=30) {
    const batch = pending.slice(start,start+30);
    const query = 'SELECT ?id ?title WHERE { VALUES ?id { ' + batch.map(entry=>'"' + entry.imdbId + '"').join(' ') +
      ' } ?series wdt:P345 ?id ; wdt:P1476 ?title . }';
    const url = 'https://query.wikidata.org/sparql?query=' + encodeURIComponent(query) + '&format=json';
    try {
      const {results} = values['wikidata-pages']
        ? JSON.parse(await readFile(resolve(values['wikidata-pages'],start + '.json'),'utf8'))
        : await (await request(url,{'User-Agent':'KonfolyCatalog/1.0 (https://github.com/sanketo/konfoly)'})).json();
      for (const entry of batch) {
        const titles = [...new Set(results.bindings.filter(row=>row.id?.value === entry.imdbId).map(row=>row.title?.value).filter(Boolean))];
        if (titles.length === 1) {
          entry.originalTitle = titles[0];
          resolvedCount++;
        }
      }
    } catch (error) { console.warn('Wikidata title batch unavailable: ' + error.message); }
  }
  console.log('Original titles confirmed through Wikidata: ' + resolvedCount);
}
if (candidates.length < 250) throw Error('Fewer than 250 eligible distinct titles');
await fillOriginalTitles(candidates.slice(0,250));
async function auditOfficialEpisodes(source) {
  const result = {};
  let uncertain = false;
  for (const [key,entry] of Object.entries(source?.officialEpisodes || {})) {
    if (!/^[1-9]\d*:[1-9]\d*$/.test(key) || !/^[a-zA-Z0-9_-]{11}$/.test(entry.youtube) || !entry.verifiedOn) continue;
    try {
      const endpoint = 'https://www.youtube.com/oembed?url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + entry.youtube) + '&format=json';
      const data = values['oembed-dir']
        ? JSON.parse(await readFile(resolve(values['oembed-dir'],entry.youtube + '.json'),'utf8'))
        : await (await request(endpoint)).json();
      const embed = 'https://www.youtube.com/embed/' + entry.youtube;
      if (data.type !== 'video' || data.author_url !== entry.publisher || data.title !== entry.title ||
          !String(data.html).includes('src="' + embed)) {
        uncertain = true;
        continue;
      }
      result[key] = ['official'];
      console.log('Official embed confirmed: ' + key + ' · ' + entry.title);
    } catch {
      uncertain = true;
      console.warn('Official embed could not be rechecked: ' + entry.youtube);
    }
  }
  return {episodes:result,uncertain};
}
const shows = [];
const counts = {matched:0,added:0,available:0,partial:0,missingPlayer:0,unverified:0};
const rightsOrigins = [...allowedOrigins.connect,...allowedOrigins.media].filter(origin => !origin.includes('*'));
for (const entry of candidates.slice(0,250)) {
  const found = findCatalogShow(base,entry);
  const showId = found?.id || catalogRecordId(entry);
  const configured = integrationSettings.seriesSources[showId] || integrationSettings.seriesSources[catalogRecordId(entry)];
  const existingNative = !!seriesIdentity(found || {imdb:{id:entry.imdbId}})?.kinopoiskId;
  const legacy = existingNative || showId === 'mentalist' || !!integrationSettings.episodeEndpoint || !!integrationSettings.stremioManifest;
  const {keys,...record} = entry;
  let episodes = Array.isArray(found?.episodes) ? found.episodes.map(item=>item.season + ':' + item.episode) : keys;
  let declaredTotal = entry.episodeCount || found?.episodeCount || (Array.isArray(found?.episodes) ? episodes.length : 0);
  if (configured?.authorization && entry.imdbId && (!declaredTotal || episodes.length < declaredTotal)) {
    try {
      const loaded = await loadCinemetaSeries(entry.imdbId,AbortSignal.timeout(10000));
      if (loaded.episodes.length >= episodes.length) episodes = loaded.episodes.map(item=>item.season + ':' + item.episode);
    } catch { console.warn('Full episode directory unavailable for ' + showId); }
  }
  const checked = await auditSource({source:configured,episodes,origins:rightsOrigins,site,limit});
  const official = await auditOfficialEpisodes(configured);
  const confirmedProviders = {...checked.confirmedProviders};
  for (const [key,providers] of Object.entries(official.episodes)) {
    confirmedProviders[key] = [...confirmedProviders[key] || [],...providers];
  }
  const confirmed = Object.keys(confirmedProviders);
  const uncertain = official.uncertain || checked.uncertain && !Object.keys(configured?.officialEpisodes || {}).length;
  const full = declaredTotal && confirmed.length >= declaredTotal && episodes.length === declaredTotal;
  const availability = full ? 'AVAILABLE' : confirmed.length ? 'PARTIAL' : legacy || uncertain ? 'UNVERIFIED' : 'MISSING_PLAYER';
  const legacyOriginal = found?.original || null;
  shows.push({...record,originalTitle:record.originalTitle || legacyOriginal,showId,
    priorStatus:found ? availability : 'MISSING_SERIES',availability,
    ...(confirmed.length ? {confirmed,confirmedProviders,sourceRevision:sourceRevision(configured)} : {})});
  counts[found ? 'matched' : 'added']++;
  counts[{AVAILABLE:'available',PARTIAL:'partial',MISSING_PLAYER:'missingPlayer',UNVERIFIED:'unverified'}[availability]]++;
}
console.log(JSON.stringify(counts));
const output = resolve(values.output);
const snapshot = {source:mode,checkedOn:new Date().toISOString().slice(0,10),counts,shows};
const serialized = JSON.stringify(snapshot,null,2) + '\n';
const tmp = output + '.' + process.pid + '.tmp';
if (await readFile(output,'utf8').catch(() => '') !== serialized) {
  await writeFile(tmp,serialized);
  await rename(tmp,output);
  console.log('Updated ' + output);
} else console.log('Catalog already up to date');
