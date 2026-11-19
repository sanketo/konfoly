const mentalistCatalog = {
  id:'mentalist',mazeId:116,title:'Менталист',original:'The Mentalist',years:'2008–2015',
  image:'assets/mentalist-poster.webp',kinopoiskId:412344,episodeCount:151,seasonCount:7,
  defaultVoice:'ТВ3',chroma:.15,hue:22,
  spoilerTitles:['6:8'],
  combinedEpisodes:[{season:3,first:23,last:24,voice:'ТВ3',completionTime:4800}]
};

const seriesIdentities = [
  mentalistCatalog,
  {mazeId:169,imdbId:'tt0903747',kinopoiskId:404900},
  {mazeId:184,imdbId:'tt3398228',kinopoiskId:818185,title:'Конь БоДжек'},
  {mazeId:3391,imdbId:'tt1647423',kinopoiskId:501998,canonicalId:'interns',seasonLengths:[60,60,61,98]},
  {imdbId:'tt3032476',kinopoiskId:796660},
  {imdbId:'tt1475582',kinopoiskId:502838},
  {mazeId:44776,hue:151}
];

function seriesIdentity(show) {
  return seriesIdentities.find(identity => identity.mazeId != null && identity.mazeId === show.mazeId ||
    identity.imdbId && identity.imdbId === show.imdb?.id);
}

function combinedEpisodeRule(kinopoiskId,season,episode,voice) {
  const rules = seriesIdentities.find(identity => identity.kinopoiskId === kinopoiskId)?.combinedEpisodes || [];
  return rules.find(rule => rule.season === season && episode >= rule.first && episode <= rule.last &&
    (voice == null || rule.voice === voice));
}

function canonicalEpisode(show,item) {
  const identity = seriesIdentity(show);
  if (!identity?.seasonLengths || show.id === identity.canonicalId) return item;
  let number = Number(/^Серия\s+(\d+)$/iu.exec(item.title || '')?.[1]);
  for (const [index,length] of identity.seasonLengths.entries()) {
    if (number > 0 && number <= length) return {...item,season:index+1,episode:number};
    number -= length;
  }
  throw Error('Номер этой серии не удалось сопоставить с источником.');
}

export {mentalistCatalog, seriesIdentities, seriesIdentity, combinedEpisodeRule, canonicalEpisode};
