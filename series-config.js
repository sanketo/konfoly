const mentalistCatalog = {
  id:'mentalist',mazeId:116,title:'Менталист',original:'The Mentalist',years:'2008–2015',
  image:'assets/mentalist-poster.webp',imdbId:'tt1196946',kinopoiskId:412344,episodeCount:151,seasonCount:7,ageRating:'18+',
  defaultVoice:'ТВ3',chroma:.15,hue:22,
  spoilerTitles:['6:8'],
  combinedEpisodes:[{season:3,first:23,last:24,voice:'ТВ3',completionTime:4800}]
};

const seriesIdentities = [
  mentalistCatalog,
  {mazeId:169,imdbId:'tt0903747',kinopoiskId:404900,ageRating:'18+'},
  {mazeId:184,imdbId:'tt3398228',kinopoiskId:818185,title:'Конь БоДжек',ageRating:'18+',hue:290,chroma:.12},
  {mazeId:3391,imdbId:'tt1647423',kinopoiskId:501998,canonicalId:'interns',seasonLengths:[60,60,61,98],ageRating:'18+'},
  {mazeId:618,imdbId:'tt3032476',kinopoiskId:796660,ageRating:'18+'},
  {mazeId:335,imdbId:'tt1475582',kinopoiskId:502838,ageRating:'12+'},
  {mazeId:1505,imdbId:'tt0388629',kinopoiskId:382731,ageRating:'18+',hue:221,chroma:.19},
  {mazeId:541,imdbId:'tt0455275',kinopoiskId:258048,ageRating:'18+',hue:255,chroma:.15},
  // The Novelist, rated TV-MA on IMDb.
  {mazeId:38134,imdbId:'tt8807496',ageRating:'TV-MA (США)'},
  {mazeId:526,imdbId:'tt0386676',kinopoiskId:253245,ageRating:'18+'},
  {mazeId:161,imdbId:'tt0773262',kinopoiskId:277537,ageRating:'18+',hue:28,chroma:.19},
  {mazeId:172,imdbId:'tt1632701',kinopoiskId:557806,ageRating:'18+'},
  {mazeId:82,imdbId:'tt0944947',kinopoiskId:464963,ageRating:'18+'},
  {mazeId:2993,imdbId:'tt4574334',kinopoiskId:915196,ageRating:'16+',hue:352,chroma:.20},
  {mazeId:431,imdbId:'tt0108778',kinopoiskId:77044,ageRating:'18+'},
  {mazeId:532,imdbId:'tt0285403',kinopoiskId:251568,ageRating:'18+'},
  {mazeId:30770,imdbId:'tt7366338',kinopoiskId:1227803,ageRating:'18+'},
  // Netflix's US classifications.
  {mazeId:17861,imdbId:'tt5753856',kinopoiskId:1032606,ageRating:'TV-MA (США)'},
  {mazeId:27436,imdbId:'tt6468322',ageRating:'TV-MA (США)'},
  {mazeId:44776,hue:151,chroma:.17},
  {mazeId:8,imdbId:'tt3107288',hue:54,chroma:.18}
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
