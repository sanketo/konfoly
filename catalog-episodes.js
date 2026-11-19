import {readLocal,writeLocal} from './storage.js';

const cacheKey = 'konfoly-episode-lists-v1';

function cachedEpisodes(mazeId) {
  const stored = readLocal(cacheKey)[mazeId];
  if (Array.isArray(stored?.episodes) && stored.episodes.length &&
      stored.episodes.every(item => Number.isInteger(item?.season) && Number.isInteger(item.episode) &&
        typeof item.title === 'string')) return stored;
  return {episodes:undefined,savedAt:0};
}

function rememberEpisodes(mazeId,episodes) {
  const cache = readLocal(cacheKey);
  if (episodes.length < (cachedEpisodes(mazeId).episodes?.length || 0)) return;
  const compact = episodes.map(({season,episode,title,mazeId,airdate,image,runtime}) =>
    ({season,episode,title,mazeId,airdate,image,runtime}));
  if (JSON.stringify(compact).length > 75000) return;
  const others = Object.entries(cache).filter(([id]) => id !== String(mazeId))
    .sort((a,b) => b[1]?.savedAt - a[1]?.savedAt).slice(0,7);
  writeLocal(cacheKey,Object.fromEntries([[String(mazeId),{episodes:compact,savedAt:Date.now()}],...others]));
}

export {cachedEpisodes,rememberEpisodes};
