const appleRatingsOrigin = 'https://itunes.apple.com';
const stores = [
  {id:'us',country:'USA',label:'США',ratings:['TV-Y','TV-Y7','TV-Y7-FV','TV-G','TV-PG','TV-14','TV-MA']},
  {id:'gb',country:'GBR',label:'Великобритания',ratings:['U','PG','12','12A','15','18']}
];

// Keep the service's own classification and region.
const publishedRatings = [
  [118,'tt0412142','TV-14 (США)','https://www.hulu.com/series/house-ef39603f-eb90-4248-8237-f6168d7c1be1'],
  [123,'tt0411008','TV-14 (США)','https://www.hulu.com/series/466b3994-b574-44f1-88bc-63707507a6cb'],
  [44933,'tt11280740','TV-MA (США)','https://tv.apple.com/us/show/severance/umc.cmc.1srk2goyh2q2zdxcx605w8vtx'],
  [54198,'tt14452776','TV-MA (США)','https://www.hulu.com/hub/originals/collections/142'],
  [30386,'tt1312171','TV-MA (США)','https://www.netflix.com/title/80186863'],
  [396,'tt1865718','TV-Y7 (США)','https://www.disneyplus.com/whats-on/entity-9995dda1-d70a-4d15-98ba-72f1d10fa406'],
  [1871,'tt4158110','TV-MA (США)','https://tv.apple.com/us/show/mr-robot/umc.cmc.306sepo05euzg2r68zzsa02up'],
  [19,'tt0460681','TV-14 (США)','https://tv.apple.com/us/show/supernatural/umc.cmc.2boiv12as9p2daeuh3x279a3p'],
  [216,'tt2861424','TV-MA (США)','https://tv.apple.com/us/show/rick-and-morty/umc.cmc.12dp30hnvyq5fbm9716puu8zc'],
  [2071,'tt1355642','TV-14 (США)','https://www.netflix.com/title/70204981'],
  [48450,'tt12343534','TV-MA (США)','https://www.netflix.com/title/81278456'],
  [4201,'tt4508902','TV-MA (США)','https://www.hulu.com/series/54a25fcf-a472-4d40-9968-13e2957e5abf'],
  [15299,'tt1190634','TV-MA (США)','https://www.primevideo.com/region/na/detail/0S1FYJ3LY9KTL9C7WFFAGA9F6F'],
  [46562,'tt3581920','TV-MA (США)','https://tv.apple.com/us/show/the-last-of-us/umc.cmc.43thr5tsmnra1kr4edwimsqvp'],
  [44458,'tt10986410','TV-MA (США)','https://tv.apple.com/us/show/ted-lasso/umc.cmc.vtoh0mn0xn7t3c643xqonfzy'],
  [49,'tt2467372','TV-14 (США)','https://www.peacocktv.com/watch-online/tv/brooklyn-nine-nine/5265505461484962112/seasons/2'],
  [73,'tt1520211','TV-MA (США)','https://www.netflix.com/title/70177057'],
  [48830,'tt11691774','TV-MA (США)','https://www.hulu.com/series/only-murders-in-the-building-ef31c7e1-cd0f-4e07-848d-1cbfedb50ddf'],
  [36795,'tt7767422','TV-MA (США)','https://www.netflix.com/tudum/sex-education'],
  [28276,'tt5180504','TV-MA (США)','https://www.netflix.com/title/80189685'],
  [53647,'tt13443470','TV-14 (США)','https://www.netflix.com/tudum/wednesday'],
  [40,'tt0877057','TV-14 (США)','https://www.netflix.com/title/70204970'],
  [919,'tt2560140','16 (Бразилия)','https://help.crunchyroll.com/article/brazil-content-ratings-maturity-restrictions'],
  [41469,'tt9335498','TV-MA (США)','https://www.netflix.com/title/81091393'],
  [495,'tt0409591','14 (Бразилия)','https://help.crunchyroll.com/article/brazil-content-ratings-maturity-restrictions'],
  [1905,'tt0434665','TV-14 (США)','https://www.hulu.com/series/bleach-0c265948-3450-40ad-89b4-883af457f36d'],
  [48945,'tt12590266','TV-MA (США)','https://www.netflix.com/title/81054853'],
  [63451,'tt13616990','16 (Бразилия)','https://help.crunchyroll.com/article/brazil-content-ratings-maturity-restrictions'],
  [5193,'tt3398540','14 (Бразилия)','https://help.crunchyroll.com/article/brazil-content-ratings-maturity-restrictions']
];
const ratingByIdentity = new Map(publishedRatings.flatMap(([mazeId,imdbId,label,source]) => {
  const record = {label,source};
  return [[mazeId,record],[imdbId,record]];
}));

function publishedAgeRating(show) {
  return ratingByIdentity.get(show.mazeId) || ratingByIdentity.get(show.imdb?.id);
}

function normalizedTitle(value) {
  return typeof value === 'string' ? value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'') : '';
}

async function loadAppleAgeRating(title,years,signal) {
  const name = normalizedTitle(title);
  const [start,end=start] = (years?.match(/\b(?:19|20)\d{2}\b/g) || []).map(Number);
  if (!name || !start || signal.aborted) return '';
  for (const store of stores) {
    const address = new URL('/search',appleRatingsOrigin);
    address.search = new URLSearchParams({
      term:title,country:store.id,media:'tvShow',entity:'tvSeason',attribute:'showTerm',limit:'12'
    });
    const response = await fetch(address,{signal,credentials:'omit',redirect:'error'});
    if (!response.ok) throw Error('Каталог Apple временно недоступен.');
    const {results} = await response.json();
    if (!Array.isArray(results)) throw Error('Некорректный ответ каталога Apple.');
    let highest = -1;
    for (const entry of results) {
      if (entry?.collectionType !== 'TV Season' || entry.country !== store.country ||
          normalizedTitle(entry.artistName) !== name) continue;
      const year = Number(/^\d{4}(?=-)/.exec(entry.releaseDate)?.[0]);
      if (year >= start && year <= end) highest = Math.max(highest,store.ratings.indexOf(entry.contentAdvisoryRating));
    }
    if (highest >= 0) return store.ratings[highest] + ' (' + store.label + ')';
  }
  return '';
}

export {appleRatingsOrigin, loadAppleAgeRating, publishedAgeRating};
