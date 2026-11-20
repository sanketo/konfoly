import {mkdir, rm, writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {findCatalogShow} from '../catalog-model.js';
import {episodeCatalog} from '../episodes.js';
import {episodeTitlesRu} from '../episode-titles-ru.js';
import {seriesPremises} from '../series-data.js';
import {localizedSeriesTitle,seriesTitlesRu} from '../series-titles-ru.js';
import {publicRoutePath} from '../site-pages.js';
import {baseCatalog} from './catalog-base.js';

const escape = value => String(value).replace(/[&<>"']/g,char => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
})[char]);
const baseUrl = 'https://sanketo.github.io/konfoly-beta/';
const descriptionFor = item => item.description || item.synopsis || '';

function catalogShows(popular) {
  const shows = baseCatalog();
  for (const record of popular.shows) {
    const existing = findCatalogShow(shows,record) || shows.find(show => show.id === record.showId);
    const info = {id:record.showId,title:record.title,original:record.originalTitle,
      years:record.years,genres:record.genres,image:record.image,imdbId:record.imdbId,tmdbId:record.tmdbId};
    if (!existing) shows.push(info);
    else for (const [key,value] of Object.entries(info)) if (!existing[key] && value) existing[key] = value;
  }
  return shows;
}

function knownEpisodes(show) {
  if (show.id === 'mentalist') return episodeCatalog.map(item => ({
    ...item,title:show.spoilerTitles.includes(item.season + ':' + item.episode) ? 'Серия ' + item.episode :
      episodeTitlesRu[item.season-1]?.[item.episode-1] || item.title
  }));
  if (Array.isArray(show.episodes)) return show.episodes.map(item => ({
    ...item,title:localizedSeriesTitle(show,item)
  }));
  const localized = (seriesTitlesRu[show.mazeId] || []).flatMap((season,index) =>
    season.map((title,episode) => ({season:index+1,episode:episode+1,title})));
  const editorial = Object.entries(show.episodes || {}).map(([key,data]) => {
    const [season,episode] = key.split(':').map(Number);
    return {...data,season,episode};
  });
  return [...new Map([...localized,...editorial].map(item => [item.season + ':' + item.episode,item])).values()];
}

function preparePublicPages(popular) {
  const pages = new Map();
  const shows = catalogShows(popular);
  for (const show of shows) {
    const facts = [show.years,...(show.genres || [])].filter(Boolean).join(' · ');
    const synopsis = show.description || seriesPremises[show.mazeId] || '';
    const showName = show.title + (show.years ? ' (' + show.years + ')' : '');
    const route = 'series/' + show.id;
    const episodes = knownEpisodes(show).filter(item => Number.isInteger(item.season) && item.season > 0 &&
      Number.isInteger(item.episode) && item.episode > 0 && item.title);
    const seasons = Map.groupBy(episodes,item => item.season);
    const seasonRoute = season => route + '/season/' + season;
    const episodeRoute = item => route + '/' + item.season + '/' + item.episode;
    const list = (values,prefix) => '<ul>' + values.map(item =>
      `<li><a href="${prefix + publicRoutePath(episodeRoute(item))}">${item.season}×${item.episode} · ${escape(item.title)}</a></li>`
    ).join('') + '</ul>';
    const section = (name,content) => `<h1 class="page-title">${escape(name)}</h1>${content}`;
    const homeLink = prefix => `<p><a href="${prefix + publicRoutePath(route)}">${escape(showName)}</a></p>`;
    const paragraph = value => value ? `<p class="synopsis">${escape(value)}</p>` : '';
    pages.set(route,{
      title:showName + ' | Konfoly',
      description:synopsis || [showName + ' в каталоге Konfoly.', facts].filter(Boolean).join(' '),
      body:prefix => section(showName,paragraph(facts) + paragraph(synopsis) +
        (seasons.size ? `<div class="segments">${['all',...seasons.keys()].map(season =>
          `<a class="tonal" href="${prefix + publicRoutePath(seasonRoute(season))}">${season === 'all' ? 'Все эпизоды' : season + ' сезон'}</a>`
        ).join('')}</div>` : '')
      )
    });
    if (seasons.size) pages.set(seasonRoute('all'),{
      title:showName + ' — все эпизоды | Konfoly',
      description:'Список эпизодов сериала «' + show.title + '» по сезонам.',
      body:prefix => section(show.title + ' · Эпизоды',homeLink(prefix) + list(episodes,prefix))
    });
    for (const [season,items] of seasons) pages.set(seasonRoute(season),{
      title:showName + ' — ' + season + ' сезон | Konfoly',
      description:`Эпизоды ${season}-го сезона сериала «${show.title}».`,
      body:prefix => section(show.title + ' · ' + season + ' сезон',homeLink(prefix) + list(items,prefix))
    });
    for (const item of episodes) {
      const number = `${item.season} сезон, ${item.episode} серия`;
      const heading = `Серия ${item.episode}` === item.title ? number : number + ' · ' + item.title;
      const summary = descriptionFor(item);
      pages.set(episodeRoute(item),{
        title:`${showName} · ${heading} | Konfoly`,
        description:[`${showName} · ${heading}.`,summary].filter(Boolean).join(' '),
        body:prefix => section(heading,homeLink(prefix) + paragraph(summary) +
          (item.airdate ? `<p><time datetime="${escape(item.airdate)}">${escape(item.airdate)}</time></p>` : '') +
          `<p><a href="${prefix + publicRoutePath(seasonRoute(item.season))}">Все серии сезона</a></p>`)
      });
    }
  }
  return {pages,shows};
}

async function writePublicPages(out,index,{pages,shows}) {
  const directory = shows.map(show =>
    `<li><a href="./${publicRoutePath('series/' + show.id)}">${escape(show.title)}${show.years ? ' · ' + escape(show.years) : ''}</a></li>`
  ).join('');
  const home = index
    .replace('<section id="library" class="page" hidden>', '<section id="library" class="page">')
    .replace('<section id="home" class="page home-page">', '<section id="home" class="page home-page" hidden>')
    .replace('<div id="library-grid" class="library-grid" hidden></div>',
      () => `<div id="library-grid" class="library-grid"><ul>${directory}</ul></div>`);
  await rm(resolve(out,'series'),{recursive:true,force:true});
  await writeFile(resolve(out,'index.html'),home);
  await Promise.all([...pages].map(async ([route,page]) => {
    const path = publicRoutePath(route);
    const prefix = '../'.repeat(path.split('/').length-1);
    const file = resolve(out,path,'index.html');
    const html = index
      .replace('<html lang="ru">','<html lang="ru" data-public-page>')
      .replace('<section id="home" class="page home-page">','<section id="home" class="page home-page" hidden>')
      .replace(/<title>.*?<\/title>/,() => `<title>${escape(page.title)}</title>`)
      .replace(/(<meta name="description" content=")[^"]*/,(_,open) => open + escape(page.description))
      .replace(/(<link rel="canonical" href=")[^"]*/,(_,open) => open + baseUrl + path)
      .replace('<meta name="konfoly-site-root" content="./">',`<meta name="konfoly-site-root" content="${prefix}">`)
      .replace(/((?:src|href)=")(assets\/|(?:app|style|boot)-[A-Z0-9]+\.)/g,(_,open,asset) => open + prefix + asset)
      .replace(/href="#(?!content")(library(?:\/search)?|catalog|settings|watch)"/g,(_,hash) => 'href="' + prefix + '#' + hash + '"')
      .replace('<section id="series" class="page" hidden></section>',
        () => `<section id="series" class="page">${page.body(prefix)}</section>`);
    await mkdir(dirname(file),{recursive:true});
    await writeFile(file,html);
  }));
  const paths = ['',...[...pages.keys()].map(publicRoutePath)];
  const urls = paths.map(path => `  <url><loc>${baseUrl + path}</loc></url>`).join('\n');
  await writeFile(resolve(out,'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
  console.log(`Создано ${paths.length} страниц каталога, сериалов, сезонов и эпизодов.`);
}

export {preparePublicPages,writePublicPages};
