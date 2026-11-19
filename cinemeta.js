const cinemetaOrigin = 'https://v3-cinemeta.strem.io';
const cinemetaImages = ['https://images.metahub.space','https://episodes.metahub.space'];
const validImdb = id => typeof id === 'string' && /^tt\d{5,12}$/.test(id);

function imdbScore(value) {
  const score = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(score) && score >= 1 && score <= 10 ? score : undefined;
}

function catalogImage(value) {
  try {
    const url = new URL(value);
    return !url.username && !url.password && cinemetaImages.includes(url.origin) ? url.href : '';
  } catch { return ''; }
}

async function request(path,signal) {
  const response = await fetch(cinemetaOrigin + path,{signal,credentials:'omit',redirect:'error'});
  if (!response.ok) throw Error('Cinemeta ' + response.status);
  return response.json();
}

async function searchCinemeta(query,signal) {
  const {metas} = await request('/catalog/series/top/search=' + encodeURIComponent(query) + '.json',signal);
  if (!Array.isArray(metas)) throw Error('Некорректный ответ Cinemeta.');
  return metas.filter(item => item?.type === 'series' && validImdb(item.id) && typeof item.name === 'string')
    .slice(0,12).map(item => ({externals:{imdb:item.id},name:item.name,years:item.releaseInfo,imdbScore:imdbScore(item.imdbRating),
      poster:catalogImage(item.poster),summary:item.description,genres:item.genres || item.genre}));
}

async function seriesMeta(id,signal) {
  if (!validImdb(id)) throw Error('Некорректный IMDb ID.');
  const {meta} = await request('/meta/series/' + id + '.json',signal);
  if (meta?.id !== id || meta.type !== 'series') throw Error('Сериал недоступен в Cinemeta.');
  return meta;
}

async function loadCinemetaRating(id,signal) {
  return imdbScore((await seriesMeta(id,signal)).imdbRating);
}

async function loadCinemetaGenres(id,signal) {
  const meta = await seriesMeta(id,signal);
  return meta.genres || meta.genre;
}

async function loadCinemetaSeries(id,signal) {
  const meta = await seriesMeta(id,signal);
  if (!Array.isArray(meta.videos)) throw Error('В Cinemeta нет списка серий.');
  const episodes = new Map();
  for (const video of meta.videos) {
    const {season,episode,name} = video || {};
    if (!Number.isInteger(season) || season < 1 || !Number.isInteger(episode) || episode < 1 ||
        video.id !== id + ':' + season + ':' + episode || typeof name !== 'string') continue;
    episodes.set(video.id,{season,episode,title:name,airdate:video.released?.slice(0,10),
      image:catalogImage(video.thumbnail),synopsis:video.overview || video.description || '',synopsisSource:'Cinemeta'});
  }
  if (!episodes.size) throw Error('В Cinemeta нет пронумерованных серий.');
  return {episodes:[...episodes.values()],poster:catalogImage(meta.poster),name:meta.name,
    description:meta.description,years:meta.releaseInfo,imdbScore:imdbScore(meta.imdbRating)};
}

export {cinemetaOrigin,cinemetaImages,validImdb,imdbScore,searchCinemeta,loadCinemetaRating,loadCinemetaGenres,loadCinemetaSeries};
