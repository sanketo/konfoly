// Run from the checkout before publishing changes to the page shell or episode data.
import {mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';

const root = fileURLToPath(new URL('../', import.meta.url));
const origin = 'https://konfoly.duckdns.org';
const scripts = await Promise.all(['episodes.js', 'episode-titles-ru.js', 'site-pages.js']
  .map(file => readFile(resolve(root, file), 'utf8')));
const {episodeCatalog, mentalistPages} = runInNewContext(scripts.join('\n') + '\n({episodeCatalog, mentalistPages})');
const seasons = Map.groupBy(episodeCatalog, item => item.season);
const episodePath = item => mentalistPages.path(item.season, item.episode);
const escape = value => String(value).replace(/[&<>"']/g, char => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
})[char]);

const seasonTiles = [...seasons].map(([season, items]) =>
  `<a class="season-tile" href="${mentalistPages.path(season)}" data-local-route><strong>${String(season).padStart(2, '0')}</strong><small>Сезон · ${items.length}</small></a>`
).join('\n');
const home = (await readFile(resolve(root, 'index.html'), 'utf8')).replace(
  /(<div id="home-seasons" class="season-tiles">)[\s\S]*?(<\/div>)/,
  (_, open, close) => open + '\n' + seasonTiles + '\n' + close
);
const shell = home
  .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>\n/, '')
  .replace('fetchpriority="high"', 'loading="lazy"')
  .replace('<section id="home" class="page home-page">', '<section id="home" class="page home-page" hidden>');

function documentFor(path, metadata, page) {
  return shell
    .replace(/<title>.*?<\/title>/, () => `<title>${escape(metadata.title)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*/, (_, open) => open + escape(metadata.description))
    .replace(/(<link rel="canonical" href=")[^"]*/, (_, open) => open + origin + path)
    .replace('class="skip" href="#content"', `class="skip" href="${path}#content"`)
    .replace(`<section id="${page}" class="page" hidden>`, `<section id="${page}" class="page">`)
    .replace(`data-local-route="${page}"`, `data-local-route="${page}" aria-current="page"`);
}

function catalogPage(season, items) {
  const metadata = mentalistPages.metadata(season);
  const tabs = [0, ...seasons.keys()].map(number =>
    `<a class="tonal" href="${mentalistPages.path(number)}" data-local-route${number === season ? ' aria-current="page"' : ''}>${number ? number + ' сезон' : 'Все'}</a>`
  ).join('\n');
  const cards = items.map(item => {
    const {heading} = mentalistPages.metadata(item.season, item);
    return [
      `<article class="episode-card"><a class="episode-open" href="${episodePath(item)}" data-local-route>`,
      `<img class="episode-image" src="${escape(item.image)}" alt="" loading="lazy" decoding="async">`,
      `<div class="episode-copy"><strong>С${item.season} · Серия ${item.episode}</strong>`,
      `<h2 class="episode-name">${escape(heading)}</h2>`,
      item.description ? `<p class="episode-summary">${escape(item.description)}</p>` : '',
      '</div></a></article>'
    ].join('');
  }).join('\n');
  return documentFor(mentalistPages.path(season), metadata, 'catalog')
    .replace('id="catalog-title" class="page-title">Эпизоды', () => `id="catalog-title" class="page-title">${escape(metadata.heading)}`)
    .replace('aria-label="Сезон"></div>', () => `aria-label="Сезон">\n${tabs}\n</div>`)
    .replace('<div id="episodes" class="episodes"></div>', () => `<div id="episodes" class="episodes">\n${cards}\n</div>`);
}

const pages = new Map([['/', home], [mentalistPages.path(), catalogPage(0, episodeCatalog)]]);
for (const [season, items] of seasons) pages.set(mentalistPages.path(season), catalogPage(season, items));

await rm(resolve(root, 'mentalist'), {recursive:true, force:true});
await Promise.all([...pages].map(async ([path, html]) => {
  const output = resolve(root, '.' + path, 'index.html');
  await mkdir(dirname(output), {recursive:true});
  await writeFile(output, html);
}));
const sitemap = [...pages.keys()].map(path => `  <url><loc>${origin}${path}</loc></url>`).join('\n');
await writeFile(resolve(root, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemap}\n</urlset>\n`);
console.log(`Создано ${pages.size} страниц со ссылками на ${episodeCatalog.length} эпизодов.`);
