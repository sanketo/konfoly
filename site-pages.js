function publicRoutePath(route) {
  const parts = /^series\/([a-z0-9-]+)(?:\/season\/(all|[1-9]\d*)|\/([1-9]\d*)\/([1-9]\d*))?$/.exec(route);
  if (!parts) return null;
  const [,id,season,episodeSeason,episode] = parts;
  if (episode) return `series/${id}/season/${episodeSeason}/episode/${episode}/`;
  return `series/${id}/${season ? 'season/' + season + '/' : ''}`;
}

const publicRoutes = new Set(globalThis.KONFOLY_PUBLIC_ROUTES || []);
const siteBase = typeof document === 'undefined' ? '/' :
  new URL(document.querySelector('meta[name="konfoly-site-root"]')?.content || './',location.href).pathname;
const routesByPath = new Map([...publicRoutes].map(route => [publicRoutePath(route),route]));

function siteHref(href) {
  if (!href.startsWith('#')) return href;
  if (href === '#library') return siteBase;
  let route = href.slice(1);
  if (route === 'home') route = 'series/mentalist';
  if (/^watch\/\d+\/\d+$/.test(route)) route = 'series/mentalist/' + route.slice(6);
  return siteBase + (publicRoutes.has(route) ? publicRoutePath(route) : href);
}

function indexedPath() {
  const path = location.pathname.slice(siteBase.length);
  return routesByPath.has(path) ? location.pathname : null;
}

function appRoute() {
  const hash = location.hash.slice(1);
  if (hash && hash !== 'content' && !hash.startsWith('tgWebApp')) return hash;
  const path = location.pathname.slice(siteBase.length).replace(/\/index\.html$/,'/');
  return routesByPath.get(path) || hash;
}

function assetAddress(address) {
  return /^(?:assets|vendor)\//.test(address) ? siteBase + address : address;
}

export {assetAddress, appRoute, indexedPath, publicRoutePath, siteBase, siteHref};
