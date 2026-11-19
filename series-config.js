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
  {mazeId:118,imdbId:'tt0412142',kinopoiskId:178710,hue:260,chroma:.12},
  {mazeId:123,imdbId:'tt0411008',kinopoiskId:104122,hue:155,chroma:.14},
  {mazeId:44933,imdbId:'tt11280740',kinopoiskId:1343318,hue:212,chroma:.11},
  {mazeId:54198,imdbId:'tt14452776',kinopoiskId:4481731,hue:245,chroma:.13},
  {mazeId:30386,imdbId:'tt1312171',kinopoiskId:463401,hue:325,chroma:.13},
  {mazeId:396,imdbId:'tt1865718',kinopoiskId:591929,hue:90,chroma:.16},
  {mazeId:1871,imdbId:'tt4158110',kinopoiskId:859908,hue:26,chroma:.17},
  {mazeId:19,imdbId:'tt0460681',kinopoiskId:178707,hue:55,chroma:.10},
  {mazeId:216,imdbId:'tt2861424',kinopoiskId:685246,hue:140,chroma:.19},
  {mazeId:2071,imdbId:'tt1355642',kinopoiskId:452838,hue:35,chroma:.19},
  {mazeId:48450,imdbId:'tt12343534',kinopoiskId:1381125,hue:282,chroma:.19},
  {mazeId:4201,imdbId:'tt4508902',kinopoiskId:942544,hue:78,chroma:.18},
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
