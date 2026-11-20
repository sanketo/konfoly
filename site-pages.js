const siteBase = typeof document === 'undefined' ? '/' :
  new URL(document.querySelector('meta[name="konfoly-site-root"]')?.content || './',location.href).pathname;
const selectionParams = ['series','season','episode'];

function siteHref(href) {
  if (!href.startsWith('#')) return href;
  if (href === '#library') return siteBase;
  let route = href.slice(1);
  if (route === 'home') route = 'series/mentalist';
  if (/^watch\/\d+\/\d+$/.test(route)) route = 'series/mentalist/' + route.slice(6);
  const parts = /^series\/([a-z0-9-]+)(?:\/season\/(all|[1-9]\d*)|\/([1-9]\d*)\/([1-9]\d*))?$/.exec(route);
  if (!parts) return siteBase + href;
  const [,id,season,episodeSeason,episode] = parts;
  const query = new URLSearchParams({series:id});
  if (season || episodeSeason) query.set('season',season || episodeSeason);
  if (episode) query.set('episode',episode);
  return siteBase + '?' + query;
}

function appRoute() {
  const hash = location.hash.slice(1);
  if (hash && hash !== 'content' && !hash.startsWith('tgWebApp')) return hash;
  const query = new URLSearchParams(location.search);
  const [id,season,episode] = selectionParams.map(key => query.get(key));
  if (!/^[a-z0-9-]+$/.test(id || '')) return hash;
  const route = 'series/' + id;
  if (/^[1-9]\d*$/.test(season || '') && /^[1-9]\d*$/.test(episode || '')) {
    return route + '/' + season + '/' + episode;
  }
  return /^(?:all|[1-9]\d*)$/.test(season || '') ? route + '/season/' + season : route;
}

function assetAddress(address) {
  return /^(?:assets|vendor)\//.test(address) ? siteBase + address : address;
}

export {assetAddress, appRoute, selectionParams, siteBase, siteHref};
