async function mediaWiki(parameters,signal) {
  const url = new URL('https://en.wikipedia.org/w/api.php');
  url.search = new URLSearchParams({format:'json',formatversion:'2',origin:'*',...parameters});
  async function request() {
    if (signal.aborted) throw signal.reason;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort',abort,{once:true});
    const timer = setTimeout(abort,4500);
    try {
      const response = await fetch(url,{signal:controller.signal,credentials:'omit'});
      if (!response.ok) throw Error('Википедия не ответила.');
      return await response.json();
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort',abort);
    }
  }
  const result = await request().catch(request);
  if (result.error) throw Error('Страница эпизодов недоступна.');
  return result;
}

async function guidePage(article,signal) {
  const name = article.replace(/\s+\([^()]+\)$/,'');
  const candidates = [...new Set([name,article].map(title => 'List of ' + title + ' episodes'))];
  const {query} = await mediaWiki({action:'query',titles:article,redirects:'1',prop:'links',
    pltitles:candidates.join('|')},signal);
  const linkedGuide = query?.pages?.[0]?.links?.[0]?.title;
  const {parse} = await mediaWiki({action:'parse',page:linkedGuide || article,redirects:'1',prop:'sections'},signal);
  const sections = new Map();
  for (const section of parse.sections) {
    const match = /^Season\s+(\d+)(?:\s|$)/i.exec(section.line);
    if (match && Number(match[1]) > 0 && /^\d+$/.test(section.index)) sections.set(Number(match[1]),section.index);
  }
  if (!sections.size) {
    const section = parse.sections.find(item => /^Episodes$/i.test(item.line) && /^\d+$/.test(item.index));
    if (section) sections.set(1,section.index);
  }
  if (!sections.size || sections.size > 100) throw Error('На странице нет списка сезонов.');
  return {page:parse.title,sections};
}

function readSeason(markup,season,source,singleSeason) {
  const document = new DOMParser().parseFromString(markup,'text/html');
  const episodes = new Map();
  for (const table of document.querySelectorAll('table.wikiepisodetable')) {
    const headers = [...table.querySelectorAll('tr:first-child > th')];
    const column = headers.findIndex(header => /No\.\s*in\s*season/i.test(header.textContent));
    const numberColumn = column < 0 && singleSeason ? headers.findIndex(header => /^No\./i.test(header.textContent.trim())) : column;
    if (numberColumn < 0) continue;
    for (const row of table.querySelectorAll('tr.vevent')) {
      const number = row.cells[numberColumn]?.textContent.trim();
      const summary = row.querySelector('.summary');
      summary?.querySelectorAll('sup.reference').forEach(node => node.remove());
      const title = summary?.textContent.trim().replace(/^"|"$/g,'');
      if (!/^[1-9]\d*$/.test(number || '') || !title) continue;
      const episode = Number(number);
      const airdate = row.querySelector('.dtstart')?.textContent.trim();
      episodes.set(episode,{season,episode,title,airdate,source});
    }
  }
  if (!episodes.size || [...episodes.keys()].some(number => number > episodes.size)) {
    throw Error('Не удалось сверить нумерацию эпизодов.');
  }
  return [...episodes.values()];
}

async function loadWikiEpisodes(article,signal,onSeasons,preferredSeason) {
  const {page,sections} = await guidePage(article,signal);
  onSeasons(0,sections.size);
  const source = 'https://en.wikipedia.org/wiki/' + encodeURIComponent(page.replaceAll(' ','_'));
  const pending = [...sections].sort(([a],[b]) => Number(b === preferredSeason) - Number(a === preferredSeason));
  const episodes = [];
  let completed = 0;
  async function loadSections() {
    while (pending.length && !signal.aborted) {
      const [season,section] = pending.shift();
      const {parse} = await mediaWiki({action:'parse',page,section,prop:'text',disableeditsection:'1'},signal);
      episodes.push(...readSeason(parse.text,season,source,sections.size === 1));
      onSeasons(++completed,sections.size);
    }
  }
  await Promise.all(Array.from({length:Math.min(5,sections.size)},loadSections));
  if (signal.aborted) throw signal.reason;
  return episodes;
}

export {loadWikiEpisodes};
