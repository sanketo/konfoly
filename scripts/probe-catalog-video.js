import {mediaAddress} from '../urls.js';

function allowedAddress(address,origins) {
  const url = new URL(address);
  if (url.protocol !== 'https:' || url.username || url.password || !origins.includes(url.origin)) {
    throw Error('Media origin is outside the authorized allowlist');
  }
  return url;
}

async function get(address,origins,{fetcher=fetch,site,range=false}={}) {
  const url = allowedAddress(address,origins);
  const headers = site ? {Origin:site} : {};
  if (range) headers.Range = 'bytes=0-1023';
  const response = await fetcher(url,{headers,redirect:'error',signal:AbortSignal.timeout(7000)});
  if (![200,206].includes(response.status)) {
    await response.body?.cancel();
    if ([404,410].includes(response.status)) return null;
    throw Error('HTTP ' + response.status);
  }
  return response;
}

async function peek(response,limit) {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const pieces = [];
  let size = 0;
  try {
    while (size < limit) {
      const {value,done} = await reader.read();
      if (done) break;
      pieces.push(Buffer.from(value.subarray(0,limit-size)));
      size += pieces.at(-1).length;
    }
    return Buffer.concat(pieces);
  } finally {
    await reader.cancel().catch(() => {});
  }
}

async function probeMedia(address,origins,options,depth=0,hls=false) {
  const response = await get(address,origins,options);
  if (!response) return false;
  const header = response.headers.get('content-type') || '';
  const isPlaylist = /mpegurl/i.test(header) || /\.m3u8(?:[?#]|$)/i.test(address);
  if (options.site && (hls || isPlaylist)) {
    const cors = response.headers.get('access-control-allow-origin');
    if (cors !== '*' && cors !== options.site) {
      await response.body?.cancel();
      throw Error('HLS response does not permit the site origin');
    }
  }
  const bytes = await peek(response,isPlaylist ? 65536 : 1024);
  if (isPlaylist) {
    const list = bytes.toString('utf8').trim();
    if (!list.startsWith('#EXTM3U') || bytes.length >= 65536 || depth > 2 || /^#EXT-X-(?:SESSION-)?KEY:.*METHOD=(?!NONE(?:,|$))/mi.test(list)) return false;
    const asset = list.split(/\r?\n/).find(line => line.trim() && !line.startsWith('#'));
    return !!asset && probeMedia(new URL(asset.trim(),address).href,origins,options,depth+1,true);
  }
  return bytes.subarray(4,8).toString() === 'ftyp' ||
    bytes.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3])) ||
    (hls && bytes[0] === 0x47 && bytes[188] === 0x47);
}

async function sourceManifest(source,origins,options) {
  if (!source?.manifest) return null;
  const response = await get(source.manifest,origins,options);
  if (!response) return null;
  const cors = response.headers.get('access-control-allow-origin');
  if (options.site && cors !== '*' && cors !== options.site && new URL(source.manifest).origin !== options.site) {
    await response.body?.cancel();
    throw Error('Manifest does not permit the site origin');
  }
  const payload = JSON.parse((await peek(response,1_048_576)).toString('utf8'));
  if (!payload.episodes || typeof payload.episodes !== 'object') throw Error('Invalid episode manifest');
  return payload.episodes;
}

async function auditSource({source,episodes,origins,site,limit=12,fetcher=fetch}) {
  if (typeof source?.authorization !== 'string' || !source.authorization.trim() || !(source.video || source.manifest)) return {confirmed:[],confirmedProviders:{},uncertain:!!source};
  const options = {site,fetcher};
  const manifest = await sourceManifest(source,origins,options).catch(() => undefined);
  let uncertain = manifest === undefined;
  const keys = episodes.length ? episodes : Object.keys(manifest || {});
  const confirmedProviders = {};
  for (const key of keys.slice(0,limit)) {
    const [season,episode] = key.split(':').map(Number);
    if (season < 1 || episode < 1 || !Number.isInteger(season) || !Number.isInteger(episode)) continue;
    const addresses = {video:mediaAddress(source.video || '',season,episode),manifest:manifest?.[key]};
    for (const [provider,address] of Object.entries(addresses)) {
      if (!address) continue;
      try {
        if (await probeMedia(address,origins,options)) (confirmedProviders[key] ||= []).push(provider);
      } catch { uncertain = true; }
    }
  }
  return {confirmed:Object.keys(confirmedProviders),confirmedProviders,uncertain};
}

export {auditSource,probeMedia};
