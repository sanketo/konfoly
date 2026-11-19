import {seriesTitlesRu} from './series-titles-ru.js';
import {readLocal,writeLocal} from './storage.js';

const seasonEpisodes = (seasons,dates=[]) => seasons.flatMap((titles,index) =>
  titles.map((title,number) => ({season:index+1,episode:number+1,title,airdate:dates[index]})));

const snapshots = {
  // https://www.tvmaze.com/shows/184/bojack-horseman/episodes
  184:seasonEpisodes(seriesTitlesRu[184]),
  // https://www.tvmaze.com/shows/38753/avatar-the-last-airbender/episodes
  38753:seasonEpisodes([
    ['Аанг','Воины','Омашу','Во тьму','Унесённые духами','Маски','Север','Легенды'],
    ['В безопасном месте','Начатый бой','Город стен и тайн','Воды отступают, камни поднимаются',
      'Десять тысяч вещей','Притча о двух драконах','Что-то сломалось']
  ],['2024-02-22','2026-06-25'])
};

const cacheKey = 'konfoly-episode-lists-v1';

function cachedEpisodes(mazeId) {
  const stored = readLocal(cacheKey)[mazeId];
  if (Array.isArray(stored?.episodes) && stored.episodes.length >= (snapshots[mazeId]?.length || 1) &&
      stored.episodes.every(item => Number.isInteger(item?.season) && Number.isInteger(item.episode) &&
        typeof item.title === 'string')) return stored;
  return {episodes:snapshots[mazeId],savedAt:0};
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
