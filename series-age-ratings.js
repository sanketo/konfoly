const appleRatingsOrigin = 'https://itunes.apple.com';
const stores = [
  {id:'us',country:'USA',label:'США',ratings:['TV-Y','TV-Y7','TV-Y7-FV','TV-G','TV-PG','TV-14','TV-MA']},
  {id:'gb',country:'GBR',label:'Великобритания',ratings:['U','PG','12','12A','15','18']}
];

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

export {appleRatingsOrigin, loadAppleAgeRating};
