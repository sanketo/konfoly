import {canonicalEpisode, mentalistCatalog, seriesIdentity} from './series-config.js';
import {breakingBad, interns, seriesEditorial} from './series-data.js';
import {cachedEpisodes,rememberEpisodes} from './catalog-episodes.js';
import {loadCinemetaSeries,searchCinemeta,validImdb} from './cinemeta.js';
import {loadWikiEpisodes} from './wiki-episodes.js';
import {seriesMetadata} from './series-metadata.js';
import {readLocal, writeLocal} from './storage.js';
import {$, make} from './dom.js';
import {bindPlaybackMemory, playbackTime, readPlaybackMemory, watchPlaybackHealth} from './video-progress.js';
import {ratingBadge, setPersonalRatingButton} from './ratings.js';
import {seriesImportance} from './series-importance.js';
import {importanceLabels} from './importance.js';
import {platform} from './platform.js';
import {canResolveSeriesNative, canUseStremio, createExternalVideoFrame, episodeEndpoint, indexEpisodeFiles, integrationEditorAvailable, isIntegrationUrl, localEpisodeFolders, openVideoStream, previewEpisodeVoices, renderStreamChoices, resolveEpisodeEndpoint, resolveNative, resolveSeriesSource, resolveStremio, seriesNativeId, seriesSource, stremioSource} from './providers.js';
import {mediaAddress} from './urls.js';
import {bindVideoKeys, isMobileCinema, requestCinemaFullscreen} from './video-controls.js';
import {createCinemaPlayer} from './player-ui.js';

function createSeriesLibrary({preferences,persist,episodeCard,cloneWatchLayout,applyTheme,renderCurrentRoute}) {
  const mentalist = mentalistCatalog;
  const libraryKey = 'konfoly-library-v1';
  const pinnedKey = 'konfoly-pinned-series-v1';
  const imported = readImports();
  const isInterns = show => show.mazeId === interns.mazeId || show.imdb?.id === interns.imdb.id;
  const importedInterns = imported.find(isInterns);
  if (importedInterns) Object.assign(importedInterns,{
    official:interns.official,tmdbId:interns.tmdbId,hue:interns.hue
  });
  const indexedShows = Object.entries(seriesEditorial).flatMap(([id,entry]) => {
    const {title,original,years,image,description,source,imdb,seasonCount,episodeCount} = entry;
    const show = {id:'tvmaze-' + id,mazeId:Number(id),title,original,years,image,description,source,imdb,seasonCount,episodeCount};
    const existing = imported.find(item => item.mazeId === show.mazeId);
    if (!existing) return [show];
    for (const [key,value] of Object.entries(show)) if (value != null && !existing[key]) existing[key] = value;
    if (image?.startsWith('assets/')) existing.image = image;
    return [];
  });
  const libraryShows = () => [mentalist,breakingBad,importedInterns || interns,...imported.filter(show => !isInterns(show)),...indexedShows];
  const shows = new Map([mentalist,breakingBad,interns,...indexedShows,...imported].map(show => [show.id,show]));
  const showPath = show => show === mentalist ? '#home' : '#series/' + show.id;
  const seasonPath = (show,season) => showPath(show) + '/season/' + (season || 'all');
  const watchPath = (show,item) => showPath(show) + '/' + item.season + '/' + item.episode;
  const progressKey = show => 'konfoly-progress:' + show.id;
  const historyKeyFor = show => 'konfoly-history:' + show.id;
  const episodeKey = item => item.season + ':' + item.episode;
  const catalogKey = show => show.id.startsWith('imdb-') ? show.imdb.id : show.mazeId || show.imdb?.id;
  const formatEpisode = item => 'Сезон ' + item.season + ' · Серия ' + item.episode;
  const selectedEpisodes = new Map();
  const seriesDisplayTitle = show => {
    const title = seriesMetadata.details(show).title;
    return title === show.title ? seriesIdentity(show)?.title || title : title;
  };
  const activeKey = 'konfoly-active-series-v1';
  let active;
  let openSourcesFor;
  let selectedShow;
  let selectedEpisode;
  let selectedSeason;
  let cleanup;
  let metadataSession;
  let episodeDetails;
  const refreshEpisodeLists = new WeakSet();

  function compactImport(show) {
    const {id,mazeId,title,language,years,image,description,source,imdb} = show;
    return {id,mazeId,title,language,years,image,description,source,imdb,
      episodeCount:show.episodes?.length ?? show.episodeCount,
      seasonCount:show.episodes ? new Set(show.episodes.map(item => item.season)).size : show.seasonCount};
  }
  function persistImports(catalog) {
    const compact = catalog.map(compactImport);
    // Keep catalog metadata bounded independently of the episode lists.
    return JSON.stringify(compact).length <= 384000 && writeLocal(libraryKey,compact);
  }
  function readImports() {
    const entries = readLocal(libraryKey);
    if (!Array.isArray(entries)) return [];
    const catalog = entries.filter(show => typeof show?.title === 'string' &&
      ((Number.isInteger(show.mazeId) && show.id === 'tvmaze-' + show.mazeId) ||
        (validImdb(show.imdb?.id) && show.id === 'imdb-' + show.imdb.id)));
    if (catalog.some(show => Array.isArray(show.episodes))) persistImports(catalog);
    return catalog;
  }
  function link(label,path,className) {
    const element = make('a',className,label);
    element.href = path;
    return element;
  }
  function external(label,path) {
    const element = link(label,path);
    element.target = '_blank';
    element.rel = 'noopener noreferrer';
    return element;
  }
  function poster(show) {
    const element = make('div','library-poster');
    if (!show.image) { element.textContent = show.title; return element; }
    const image = make('img');
    image.src = show.image;
    image.alt = '';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.onerror = () => { element.textContent = show.title; };
    element.append(image);
    return element;
  }
  function findEpisode(show,season,episode) {
    return show.episodes?.find(item => item.season === Number(season) && item.episode === Number(episode));
  }
  function resume(show) {
    const last = readPlaybackMemory(progressKey(show)).last;
    const item = last && findEpisode(show,last.season,last.episode);
    if (!item) return null;
    if (!last.completed) return {...item,time:last.time};
    const next = show.episodes[show.episodes.indexOf(item) + 1];
    return next ? {...next,time:0} : null;
  }
  function match(hash,start) {
    const boot = !hash || hash.startsWith('tgWebApp');
    const deepLink = boot && /^series-([a-z0-9-]+)-s(\d+)e(\d+)$/.exec(start || '');
    if (deepLink) hash = 'series/' + deepLink.slice(1).join('/');
    else if ((boot && !start) || hash === 'library' || hash === 'library/search') return {page:'library',focusSearch:hash === 'library/search'};
    const parts = /^series\/([a-z0-9-]+)(?:\/season\/(all|\d+)|\/(\d+)\/(\d+))?$/.exec(hash);
    const show = parts && shows.get(parts[1]);
    if (!show || show === mentalist) return parts ? {page:'library'} : null;
    if (!show.episodes) {
      const cached = cachedEpisodes(catalogKey(show));
      if (cached.episodes) {
        show.episodes = cached.episodes;
        if (Date.now() - cached.savedAt > 86400000) refreshEpisodeLists.add(show);
      }
    }
    if (!Array.isArray(show.episodes)) return {page:'series',show,loadEpisodes:true,overview:!parts[2] && !parts[3],
      requestedSeason:Number(parts[2] || parts[3]) || undefined};
    if (parts[2] === 'all') return {page:'series',show,season:0};
    const season = Number(parts[2]);
    if (season && show.episodes.some(item => item.season === season)) return {page:'series',show,season};
    return {page:'series',show,episode:findEpisode(show,parts[3],parts[4])};
  }
  function selectRoute(route) {
    if (!active) active = readLocal(activeKey);
    const show = route.show ?? (['home','catalog','watch'].includes(route.page) ? mentalist : null);
    if (!show) return;
    const previous = active.id === show.id ? active : {};
    active = {
      id:show.id,
      season:route.season ?? route.episode?.season ?? previous.season,
      episodeSeason:route.episode?.season ?? previous.episodeSeason,
      episode:route.episode?.episode ?? previous.episode
    };
    writeLocal(activeKey,active);
  }
  function activeSeries() {
    const show = shows.get(active?.id);
    return show === mentalist ? null : show;
  }
  function activeEpisode(show) {
    if (!show.episodes) {
      const last = readPlaybackMemory(progressKey(show)).last;
      return {season:active?.season || active?.episodeSeason || last?.season || 1,
        episode:active?.episode || last?.episode || 1};
    }
    const validSeason = item => item && (!active?.season || item.season === active.season);
    const item = findEpisode(show,active?.episodeSeason,active?.episode);
    if (validSeason(item)) return item;
    const last = resume(show);
    if (validSeason(last)) return last;
    return show.episodes.find(episode => episode.season === active?.season) || show.episodes[0];
  }
  function navigation(element,route) {
    const show = activeSeries();
    if (element.hasAttribute('data-library-nav')) return ['home','library'].includes(route.page) || !!(route.show && route.season == null && !route.episode);
    if (element.hasAttribute('data-catalog-nav')) {
      const season = route.episode?.season ?? route.season ?? active?.season ?? (show && activeEpisode(show).season);
      element.href = show ? seasonPath(show,season) : '#catalog';
      return route.page === 'catalog' || route.season != null;
    }
    if (element.hasAttribute('data-watch-nav')) {
      const item = route.episode || (show && activeEpisode(show));
      element.href = show && item ? watchPath(show,item) : '#watch';
      return route.page === 'watch' || !!route.episode;
    }
    return null;
  }
  function openActiveSources() {
    const show = activeSeries();
    if (!show) return false;
    openSourcesFor = watchPath(show,activeEpisode(show));
    location.hash = openSourcesFor;
    return true;
  }
  function back(page) {
    if (page === 'series') {
      if (selectedEpisode) return seasonPath(selectedShow,selectedEpisode.season);
      return selectedSeason != null ? showPath(selectedShow) : '#library';
    }
    if (page === 'settings' && activeSeries()) return showPath(activeSeries());
    if (page === 'home') return '#library';
    return null;
  }
  function showYears(show) { return seriesEditorial[show.mazeId]?.years || show.years; }
  function caption(show,includeYears=true) {
    const count = show.episodes?.length ?? show.episodeCount;
    const seasons = show.episodes ? new Set(show.episodes.map(item => item.season)).size : show.seasonCount;
    return [includeYears && showYears(show),seasons && 'Сезонов ' + seasons,count && 'Серий ' + count].filter(Boolean).join(' · ');
  }
  function showHue(show) {
    if (show === mentalist) return 22;
    if (Number.isFinite(show.hue)) return show.hue;
    if (Number.isFinite(seriesIdentity(show)?.hue)) return seriesIdentity(show).hue;
    return [...show.id].reduce((value,char) => (value * 31 + char.charCodeAt(0)) % 360,0);
  }
  function showCard(show,add) {
    const tile = add ? make('button','library-tile') : link(undefined,showPath(show),'library-tile');
    if (add) {
      tile.type = 'button';
      tile.onclick = () => add(tile);
    }
    const copy = make('span','library-tile-copy');
    const facts = show.preview ? showYears(show) : caption(show);
    const name = seriesDisplayTitle(show);
    copy.append(make('strong',null,name));
    if (show.preview && name !== show.title) copy.append(make('span','library-tile-original',show.title));
    if (facts) copy.append(make('span','muted',facts));
    if (add) copy.append(make('span','library-tile-action','Добавить в каталог'));
    tile.style.setProperty('--tile-hue',showHue(show));
    if (show.hue == null && !Number.isFinite(seriesIdentity(show)?.hue) && show.image) void posterHue(show.image).then(hue => {
      if (hue != null) tile.style.setProperty('--tile-hue',hue);
    });
    tile.append(poster(show),copy);
    return tile;
  }
  async function tvmaze(path,signal) {
    const response = await fetch('https://api.tvmaze.com/' + path,{signal});
    if (!response.ok) throw new Error('TVmaze ' + response.status);
    return response.json();
  }
  function plainText(markup) {
    return new DOMParser().parseFromString(markup || '', 'text/html').body.textContent.trim();
  }
  function mazeImage(image) {
    return /^https:\/\/static\.tvmaze\.com\//.test(image?.medium || '') ? image.medium : '';
  }
  async function fetchMazeEpisodes(mazeId,signal) {
    const episodes = (await tvmaze('shows/' + mazeId + '/episodes',signal))
      .filter(item => Number.isInteger(item.season) && Number.isInteger(item.number))
      .map(item => ({season:item.season,episode:item.number,title:item.name,mazeId:item.id,airdate:item.airdate,
        image:mazeImage(item.image),runtime:item.runtime,synopsis:seriesMetadata.plain(item.summary)}));
    if (!episodes.length) throw Error('Нет пронумерованных серий');
    return episodes;
  }
  async function fetchEpisodes(show,signal,{onSeasons,preferredSeason}={}) {
    const jobs = [];
    if (show.mazeId) jobs.push(fetchMazeEpisodes(show.mazeId,signal).then(episodes => ({episodes})));
    if (show.imdb?.id) jobs.push(loadCinemetaSeries(show.imdb.id,signal));
    if (onSeasons) jobs.push((async () => {
      await new Promise(resolve => setTimeout(resolve,1000));
      if (signal.aborted) throw signal.reason;
      const article = await seriesMetadata.wikiEpisodeArticle(show,signal);
      if (!article) throw Error('Подтверждённая страница сериала не найдена.');
      const episodes = await loadWikiEpisodes(article,signal,onSeasons,preferredSeason);
      if (show.episodeCount && episodes.length < show.episodeCount) throw Error('Список эпизодов неполный.');
      return {episodes};
    })());
    const {episodes,poster,description,years} = await Promise.any(jobs);
    episodes.sort((a,b) => a.season - b.season || a.episode - b.episode);
    if (!signal.aborted) {
      show.image ||= poster;
      show.description ||= plainText(description);
      show.years ||= years;
      rememberEpisodes(catalogKey(show),episodes);
    }
    return episodes;
  }
  function matchesCatalog(show,raw) {
    return (Number.isInteger(raw.id) && show.mazeId === raw.id) ||
      (validImdb(raw.externals?.imdb) && show.imdb?.id === raw.externals.imdb);
  }
  function importShow(raw,id) {
    const known = libraryShows().find(show => matchesCatalog(show,raw));
    if (known) return known;
    const years = [raw.premiered?.slice(0,4),raw.ended?.slice(0,4)].filter(Boolean);
    const show = {
      id,mazeId:raw.id,title:raw.name,language:raw.language,years:[...new Set(years)].join('–') || raw.years,
      image:mazeImage(raw.image) || raw.poster,description:plainText(raw.summary),
      source:raw.id ? 'https://www.tvmaze.com/shows/' + raw.id : '',
      imdb:validImdb(raw.externals?.imdb) ? {id:raw.externals.imdb} : null
    };
    const next = [...imported,show];
    show.sessionOnly = !persistImports(next);
    imported.push(show);
    shows.set(show.id,show);
    return show;
  }
  function renderLibrary(focusSearch) {
    const grid = $('library-grid');
    for (const card of grid.querySelectorAll('[data-imported]')) card.remove();
    const pinned = readLocal(pinnedKey);
    const savedShows = libraryShows().filter(show => pinned[show.id] || imported.includes(show) ||
      (show === mentalist ? !!readPlaybackMemory().last : !!readPlaybackMemory(progressKey(show)).last));
    grid.hidden = savedShows.length === 0;
    grid.append(...savedShows.map(show => {
      const card = showCard(show);
      card.dataset.imported = '';
      return card;
    }));
    function searchCard(show) {
      if (savedShows.includes(show)) return showCard(show);
      return showCard(show,() => {
        writeLocal(pinnedKey,{...readLocal(pinnedKey),[show.id]:true});
        location.hash = showPath(show);
      });
    }
    const form = $('library-add-form');
    const input = form.querySelector('input');
    const status = $('library-add-status');
    const results = $('library-add-results');
    status.textContent = '';
    results.replaceChildren();
    if (focusSearch) input.focus({preventScroll:true});
    const session = new AbortController();
    let operation, debounce;
    async function run(action,onFailure,timeout=8000) {
      operation?.abort();
      const controller = new AbortController();
      operation = controller;
      const {signal} = controller;
      let timer;
      const deadline = new Promise((_resolve,reject) => {
        timer = setTimeout(() => {
          reject(Error('timeout'));
          controller.abort();
        },timeout);
      });
      try { await Promise.race([action(signal),deadline]); }
      catch { if (!session.signal.aborted && operation === controller) onFailure(); }
      finally { clearTimeout(timer); }
    }
    function search() {
      clearTimeout(debounce);
      operation?.abort();
      operation = null;
      const query = input.value.trim();
      results.replaceChildren();
      status.textContent = '';
      if (query.length < 2) return;
      const normalizedTitle = title => title.toLocaleLowerCase('ru').replaceAll('ё','е');
      const normalized = normalizedTitle(query);
      const local = libraryShows().filter(show =>
        [seriesDisplayTitle(show),show.title,show.original].some(title => title && normalizedTitle(title).includes(normalized)));
      const cards = new Map(local.map(show => [show.id,searchCard(show)]));
      results.append(...cards.values());
      status.textContent = local.length ? 'Результаты поиска' : 'Ищем сериалы…';
      void run(async signal => {
        const seen = new Set(local.map(show => show.id));
        const previews = [...local];
        const rawMatches = new Map();
        function addResult(show,localized) {
          const known = libraryShows().find(item => matchesCatalog(item,show));
          const current = previews.find(item => matchesCatalog(item,show));
          const id = known?.id || current?.id || (Number.isInteger(show.id) ? 'tvmaze-' + show.id : 'imdb-' + show.externals.imdb);
          const previous = rawMatches.get(id) || {};
          const raw = {...previous,...Object.fromEntries(Object.entries(show).filter(([,value]) => value != null && value !== ''))};
          raw.externals = {imdb:[previous.externals?.imdb,show.externals?.imdb].find(validImdb)};
          rawMatches.set(id,raw);
          const preview = known || {id,title:raw.name,years:raw.premiered?.slice(0,4) || raw.years,
            language:raw.language,image:mazeImage(raw.image) || raw.poster,mazeId:raw.id,
            imdb:raw.externals.imdb ? {id:raw.externals.imdb} : null,preview:true};
          if (localized) seriesMetadata.rememberSearchTitle(preview,localized);
          if (indexedShows.includes(known)) {
            const image = preview.image || mazeImage(raw.image) || raw.poster;
            const cardPoster = cards.get(id)?.querySelector('.library-poster');
            const imageChanged = image && image !== known.image;
            known.image ||= image;
            known.language ||= show.language;
            known.description ||= plainText(show.summary);
            if (!known.imdb && raw.externals.imdb) known.imdb = {id:raw.externals.imdb};
            if (imageChanged && cardPoster && !cardPoster.firstElementChild) cardPoster.replaceWith(poster(known));
          }
          if (seen.has(id)) {
            if (!known && current) {
              Object.assign(current,preview);
              const card = cards.get(id);
              if (preview.image) card.querySelector('.library-poster')?.replaceWith(poster(preview));
              const copy = card.querySelector('.library-tile-copy');
              const facts = copy?.querySelector('.muted');
              if (facts) facts.textContent = preview.years || '';
              else if (preview.years) copy?.querySelector('.library-tile-action')?.before(make('span','muted',preview.years));
            }
            updateTitle(preview);
            return;
          }
          seen.add(id);
          previews.push(preview);
          if (known) {
            const card = searchCard(known);
            cards.set(id,card);
            results.append(card);
            return;
          }
          const card = showCard(preview,() => {
            const added = importShow(rawMatches.get(id),id);
            location.hash = showPath(added);
          });
          cards.set(id,card);
          results.append(card);
        }
        function updateTitle(show) {
          const card = cards.get(show.id);
          if (!card) return;
          const title = card.querySelector('strong');
          const name = seriesDisplayTitle(show);
          title.textContent = name;
          if (name !== show.title && !card.querySelector('.library-tile-original')) {
            title.after(make('span','library-tile-original',show.title));
          }
        }
        async function loadMatches() {
          const matches = await tvmaze('search/shows?q=' + encodeURIComponent(query),signal);
          if (signal.aborted) return;
          const matchName = show => normalizedTitle(seriesDisplayTitle({
            id:'tvmaze-' + show.id,mazeId:show.id,title:show.name
          })).includes(normalized);
          const sorted = [...matches].sort((a,b) => Number(matchName(b.show)) - Number(matchName(a.show)));
          for (const {show} of sorted.slice(0,12)) addResult(show);
          if (seen.size) status.textContent = 'Результаты поиска';
          await seriesMetadata.searchTitles(previews,signal,updateTitle).catch(() => {});
          if (signal.aborted) return;
          const missing = previews.filter(show => show.mazeId && !/\p{Script=Cyrillic}/u.test(seriesDisplayTitle(show))).slice(0,6);
          await Promise.allSettled(missing.map(async show => {
            const names = await tvmaze('shows/' + show.mazeId + '/akas',signal);
            const russian = names.filter(item => /\p{Script=Cyrillic}/u.test(item.name || ''));
            const alias = russian.find(item => item.country?.code === 'RU') || russian.find(item => item.country == null);
            if (!signal.aborted && alias && !/\p{Script=Cyrillic}/u.test(seriesDisplayTitle(show))) {
              seriesMetadata.rememberSearchTitle(show,alias.name);
              updateTitle(show);
            }
          }));
        }
        async function loadLocalizedMatches() {
          const entries = await seriesMetadata.catalogSearch(query,signal);
          if (signal.aborted) return;
          for (const entry of entries) addResult(entry,entry.localized);
          if (seen.size) status.textContent = 'Результаты поиска';
        }
        async function loadCinemetaMatches() {
          const entries = await searchCinemeta(query,signal);
          if (signal.aborted) return;
          for (const entry of entries) addResult(entry);
          if (seen.size) status.textContent = 'Результаты поиска';
        }
        const outcomes = await Promise.allSettled([loadMatches(),loadLocalizedMatches(),loadCinemetaMatches()]);
        if (signal.aborted) return;
        status.textContent = seen.size ? 'Результаты поиска' : outcomes.every(item => item.status === 'rejected')
          ? 'Источники поиска недоступны. Попробуй ещё раз.' : 'Сериал не найден';
      },() => {
        status.textContent = results.childElementCount ? 'Результаты поиска' : 'Источники поиска не ответили. Попробуй ещё раз.';
      });
    }
    form.onsubmit = event => {
      event.preventDefault();
      search();
    };
    function scheduleSearch(event) {
      clearTimeout(debounce);
      operation?.abort();
      operation = null;
      results.replaceChildren();
      status.textContent = '';
      if (!event.isComposing && input.value.trim().length >= 2) debounce = setTimeout(search,300);
    }
    input.oninput = input.oncompositionend = scheduleSearch;
    cleanup = () => { clearTimeout(debounce); session.abort(); operation?.abort(); };
  }
  function imdbLink(record,suffix='ratings/') {
    return 'https://www.imdb.com/title/' + record.id + '/' + suffix;
  }
  function ratings(show,record,id,label) {
    const row = make('div','rating-row');
    if (Number.isFinite(record?.score)) row.append(ratingBadge('IMDb',record,imdbLink(record,record.suffix)));
    else if (record?.id) row.append(external('IMDb ↗',imdbLink(record)));
    const rate = make('button','rating-action');
    setPersonalRatingButton(rate,{id,label:show.title + ' · ' + label},show.id);
    row.append(rate);
    return row;
  }
  function settings() {
    const form = $('kinopoisk-key-form');
    if (!form) return;
    const input = $('kinopoisk-key');
    const status = $('kinopoisk-key-status');
    input.value = seriesMetadata.apiKey();
    form.onsubmit = event => {
      event.preventDefault();
      const key = input.value.trim();
      const stored = seriesMetadata.setApiKey(key);
      status.textContent = !stored ? 'Браузер запретил сохранение ключа.' :
        key ? 'Ключ сохранён для этой вкладки. Открой сериал для загрузки метаданных.' : 'Новые запросы к Кинопоиску отключены.';
    };
    $('tmdb-token').value = seriesMetadata.tmdbToken();
    $('tmdb-token-form').onsubmit = event => {
      event.preventDefault();
      const token = $('tmdb-token').value.trim();
      const valid = !token || /^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+){2}$/.test(token);
      $('tmdb-token-status').textContent = !valid ? 'Вставь токен чтения TMDB из настроек API.' :
        !seriesMetadata.setTmdbToken(token) ? 'Не удалось сохранить токен в этой вкладке.' :
        token ? 'Токен сохранён для этой вкладки.' : 'Новые запросы к TMDB отключены.';
    };
  }
  function hydrate(show,update,status,items) {
    const signal = metadataSession.signal;
    const timer = setTimeout(() => {
      if (!signal.aborted && status) status.textContent = 'Источник метаданных отвечает дольше обычного.';
    },12000);
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort',abort,{once:true});
    const timeout = setTimeout(abort,18000);
    const titleJobs = [];
    const refresh = () => { if (!controller.signal.aborted) update(); };
    const requestTitles = () => titleJobs.push(seriesMetadata.loadEpisodeTitles(show,items,controller.signal,refresh));
    if (items) requestTitles();
    void seriesMetadata.load(show,controller.signal,() => {
      if (controller.signal.aborted) return;
      refresh();
      if (items) requestTitles();
    }).catch(error => {
      if (status && !signal.aborted) status.textContent = error.message;
    }).finally(async () => {
      await Promise.allSettled(titleJobs);
      clearTimeout(timer);
      clearTimeout(timeout);
      signal.removeEventListener('abort',abort);
    });
  }
  function translateButton(show,items,update,status,titlesOnly=false) {
    if (!items.length || !seriesMetadata.canTranslate(show)) return null;
    const button = make('button','tonal',titlesOnly ? 'Перевести названия серий' : 'Перевести на русский');
    button.onclick = async () => {
      const signal = metadataSession.signal;
      button.disabled = true;
      status.textContent = 'Готовим перевод…';
      try {
        await seriesMetadata.translate(show,items,signal,update,titlesOnly);
        if (!signal.aborted) status.textContent = 'Перевод сохранён в этом браузере.';
      } catch {
        if (!signal.aborted) status.textContent = 'Перевод в браузере сейчас недоступен.';
      } finally {
        button.disabled = false;
      }
    };
    return button;
  }
  function importance(show,item) {
    const editorial = seriesImportance[show.mazeId]?.[episodeKey(item)];
    const override = readLocal('konfoly-importance:' + show.id)[episodeKey(item)];
    return {
      importance:override || editorial?.importance || 'unconfirmed',
      importanceReason:editorial?.reason,
      description:editorial?.description,
      source:editorial && show.source || (editorial && 'https://www.tvmaze.com/shows/' + show.mazeId),
      confidence:override ? 'manual' : editorial ? 'high' : 'unknown'
    };
  }
  function showEpisodeDetails(show,item,update) {
    episodeDetails?.close();
    const dialog = make('dialog','sheet');
    episodeDetails = dialog;
    dialog.setAttribute('aria-label','О серии');
    const heading = make('div','sheet-heading');
    const close = make('button','icon-button','×');
    close.setAttribute('aria-label','Закрыть');
    close.onclick = () => dialog.close();
    heading.append(make('h2',null,'О серии'),close);
    const progress = make('p','muted');
    progress.setAttribute('role','status');
    const content = make('div','series-episode-details');
    const label = make('label','series-importance-select','Сюжетная значимость');
    const select = make('select');
    const kinds = [['','По каталогу'],['key','Ключевая'],['important','Важная'],['regular','Обычная'],['unconfirmed','Не подтверждена']];
    for (const [value,name] of kinds) {
      const option = make('option',null,name);
      option.value = value;
      select.append(option);
    }
    const key = 'konfoly-importance:' + show.id;
    select.value = readLocal(key)[episodeKey(item)] || '';
    select.onchange = () => {
      const data = readLocal(key);
      if (select.value) data[episodeKey(item)] = select.value;
      else delete data[episodeKey(item)];
      writeLocal(key,data);
      renderDetails();
      update();
    };
    label.append(select);
    function renderDetails() {
      const info = importance(show,item);
      const text = seriesMetadata.episode(show,item);
      const synopsisOpen = content.querySelector('details')?.open;
      content.replaceChildren(make('h3',null,text.title),
        make('p','muted',importanceLabels[info.importance] + (info.confidence === 'manual' ? ' · личная отметка' : '')));
      if (info.description) content.append(make('p',null,info.description));
      if (text.description) {
        const synopsis = make('details');
        synopsis.open = synopsisOpen ?? preferences.spoilers;
        const russian = /\p{Script=Cyrillic}/u.test(text.description);
        if (!russian && synopsisOpen == null) synopsis.open = false;
        synopsis.append(make('summary',null,russian ? 'Описание от источника · возможны спойлеры' : 'Описание на языке оригинала'),make('p',null,text.description),
          make('p','muted',text.source));
        content.append(synopsis);
      } else if (!info.description) content.append(make('p','muted','Описание этой серии отсутствует.'));
      if (info.importanceReason) {
        const reason = make('details');
        reason.append(make('summary',null,'Почему серия важна · возможны спойлеры'),make('p',null,info.importanceReason));
        if (info.source) reason.append(external('Источник · TVmaze',info.source));
        content.append(reason);
      }
    }
    renderDetails();
    const translate = translateButton(show,[item],() => {renderDetails();update();},progress);
    dialog.append(heading,content,label,...(translate ? [translate] : []),progress);
    dialog.onclose = () => {
      if (episodeDetails === dialog) episodeDetails = null;
      dialog.remove();
    };
    $('series').append(dialog);
    dialog.showModal();
    void seriesMetadata.translateIfReady(show,[item],metadataSession.signal,() => {
      if (dialog.open) { renderDetails(); update(); }
    });
  }
  function renderShow(show,episodeStatus) {
    const hero = make('div','hero');
    const copy = make('div','hero-copy');
    const heading = make('div','hero-heading');
    const title = make('h1','page-title',seriesDisplayTitle(show));
    let titleRevision = 0;
    async function renderTitle() {
      const revision = ++titleRevision;
      const data = seriesMetadata.read(show);
      const name = seriesDisplayTitle(show);
      if (!title.firstElementChild) title.textContent = name;
      localizedWordmark.hidden = !title.firstElementChild || !/\p{Script=Cyrillic}/u.test(name);
      localizedWordmark.textContent = name;
      const tmdbLogos = Array.isArray(data.tmdbLogos) ? data.tmdbLogos : [];
      const commons = Array.isArray(data.commonsLogos) ? data.commonsLogos : [];
      const wiki = Array.isArray(data.wikiLogos) ? data.wikiLogos : [];
      const operator = Array.isArray(data.operatorLogos) ? data.operatorLogos : [];
      const addresses = [...new Set([seriesEditorial[show.mazeId]?.logo,show.logo,...operator,data.kpLogo,...tmdbLogos,...wiki,...commons,data.commonsLogo]
        .filter(address => typeof address === 'string' && address))];
      const checks = addresses.map(address => seriesMetadata.transparentLogo(address));
      for (const [index,address] of addresses.entries()) {
        if (!(await checks[index])) continue;
        if (revision !== titleRevision) return;
        if (title.firstElementChild?.getAttribute('src') === address) {
          title.firstElementChild.alt = name;
          return;
        }
        const logo = make('img');
        logo.src = address;
        logo.alt = name;
        logo.width = 369;
        logo.height = 220;
        title.className = 'show-wordmark show-wordmark-stacked';
        title.replaceChildren(logo);
        localizedWordmark.hidden = !/\p{Script=Cyrillic}/u.test(name);
        return;
      }
      if (revision === titleRevision) {
        title.className = 'page-title';
        title.textContent = name;
        localizedWordmark.hidden = true;
      }
    }
    const localizedWordmark = make('p','hero-russian-title');
    heading.append(title,localizedWordmark);
    if (show.original || show.mazeId === 184) heading.append(make('p','show-title',show.original || show.title));
    heading.append(make('p','eyebrow hero-facts',[showYears(show),show.genre].filter(Boolean).join(' · ')));
    const rating = ratings(show,show.imdb,'series','Сериал');
    rating.classList.add('hero-ratings');
    const actions = make('div','hero-actions');
    const last = resume(show);
    const first = show.episodes?.[0];
    if (first) actions.append(link(last ? '▶ Продолжить просмотр' : '▶ Открыть первую серию',
      watchPath(show,last || first),'filled'),
      link('Все эпизоды',seasonPath(show,last?.season || first.season),'tonal'));
    if (episodeStatus) actions.append(episodeStatus);
    copy.append(heading,rating);
    const synopsis = make('p','synopsis');
    const attribution = make('p','muted synopsis-source');
    const originalSynopsis = make('details','synopsis-original');
    const originalText = make('p','muted');
    originalSynopsis.append(make('summary',null,'Описание на языке оригинала'),originalText);
    copy.append(synopsis,attribution,originalSynopsis);
    copy.append(actions,make('p','muted hero-resume',last ? formatEpisode(last) + ' · ' + playbackTime(last.time) : caption(show,false)));
    const artwork = make('div','hero-poster');
    if (show.image) {
      const image = make('img','poster');
      image.src = show.image;
      image.alt = 'Постер сериала «' + show.title + '»';
      image.width = 620;
      image.height = 930;
      image.fetchPriority = 'high';
      artwork.style.setProperty('--poster-art','url(' + JSON.stringify(show.image) + ')');
      artwork.append(image);
    } else artwork.append(poster(show));
    hero.append(copy,artwork);

    const section = make('section','home-library');
    const sectionTitle = make('div','section-title');
    sectionTitle.append(make('h2',null,'Выбрать сезон'));
    const tiles = make('div','season-tiles');
    for (const season of first ? seasonsFor(show) : []) {
      const tile = link(undefined,seasonPath(show,season),'season-tile');
      const count = show.episodes.filter(item => item.season === season).length;
      tile.setAttribute('aria-label','Сезон ' + season + ' · ' + count + ' серий');
      tile.append(make('strong',null,String(season).padStart(2,'0')),make('small',null,'Сезон · ' + count));
      tiles.append(tile);
    }
    section.append(sectionTitle,tiles);
    const status = make('p','muted',show.sessionOnly ? 'Сериал добавлен до закрытия вкладки. Браузер не сохранил каталог.' : '');
    status.setAttribute('role','status');
    function updateShowDetails() {
      renderTitle();
      const details = seriesMetadata.details(show);
      const hasOriginal = !!details.description.text && !/\p{Script=Cyrillic}/u.test(details.description.text);
      synopsis.textContent = hasOriginal ? '' : details.description.text;
      synopsis.hidden = !synopsis.textContent;
      originalSynopsis.hidden = !hasOriginal;
      originalText.textContent = hasOriginal ? details.description.text : '';
      attribution.replaceChildren();
      if (details.description.source) attribution.append(external(details.description.label,details.description.source));
      else if (details.description.label) attribution.textContent = details.description.label;
      attribution.hidden = !attribution.textContent;
    }
    if (seriesMetadata.canTranslate(show) && !/\p{Script=Cyrillic}/u.test(show.description || '')) {
      const translateShow = make('button','tonal','Перевести описание');
      translateShow.onclick = async () => {
        const signal = metadataSession.signal;
        translateShow.disabled = true;
        try { await seriesMetadata.translateShow(show,signal,updateShowDetails); }
        catch { if (!signal.aborted) status.textContent = 'Перевод в этом браузере недоступен.'; }
        finally { translateShow.disabled = false; }
      };
      actions.append(translateShow);
    }
    updateShowDetails();
    $('series').replaceChildren(hero,...(first ? [section] : []),status);
    hydrate(show,updateShowDetails,status);
    void seriesMetadata.translateIfReady(show,null,metadataSession.signal,updateShowDetails);
  }
  function seasonsFor(show) {
    return [...new Set(show.episodes.map(item => item.season))];
  }
  function renderSeason(show,season) {
    const section = make('section','library-catalog');
    const seriesLink = link(seriesDisplayTitle(show),showPath(show),'muted series-back');
    const tabs = make('div','segments library-season-tabs');
    tabs.setAttribute('aria-label','Выбор сезона');
    for (const number of [0,...seasonsFor(show)]) {
      const tab = link(number ? number + ' сезон' : 'Все',seasonPath(show,number),'tonal');
      if (number === season) tab.setAttribute('aria-current','page');
      tabs.append(tab);
    }
    const episodes = season ? show.episodes.filter(item => item.season === season) : show.episodes;
    section.append(seriesLink,make('h1','page-title','Эпизоды'),make('p','eyebrow catalog-facts',caption(show,false)));
    const last = resume(show);
    if (last) section.append(link('Продолжить просмотр · ' + last.season + '×' + last.episode + ' · ' + playbackTime(last.time),
      watchPath(show,last),'resume-action tonal'));
    if (season) {
      const scores = episodes.map(item => item.imdb?.score).filter(Number.isFinite);
      const average = scores.length ? {id:show.imdb.id,score:scores.reduce((a,b) => a + b,0) / scores.length,suffix:'episodes/?season=' + season} : null;
      const rating = ratings(show,average,'season:' + season,'Сезон ' + season);
      rating.classList.add('season-rating-row');
      if (average) rating.querySelector('.rating-chip')?.append(make('small','rating-votes','Среднее по сериям · ' + scores.length + ' из ' + episodes.length));
      section.append(rating);
    }
    const toolbar = make('div','catalog-toolbar');
    const filters = make('div','filters');
    const search = make('label','search');
    const searchIcon = make('span','search-icon');
    searchIcon.setAttribute('aria-hidden','true');
    const query = make('input');
    query.type = 'search';
    query.placeholder = 'Номер или название';
    query.setAttribute('aria-label','Поиск эпизодов');
    search.append(searchIcon,query);
    const unread = make('input');
    unread.type = 'checkbox';
    const unreadLabel = make('label','chip');
    unreadLabel.append(unread,' Непросмотренные');
    const important = make('input');
    important.type = 'checkbox';
    const importantLabel = make('label','chip');
    importantLabel.append(important,' Сюжетно важные');
    const toggleMarks = make('button','chip importance-toggle');
    toggleMarks.onclick = () => { preferences.hideImportance = !preferences.hideImportance; persist(); update(); };
    filters.append(search,importantLabel,unreadLabel,toggleMarks);
    toolbar.append(tabs,filters);
    const count = make('p','muted');
    count.setAttribute('role','status');
    const list = make('div','episodes');
    const viewed = readLocal(historyKeyFor(show));
    const status = make('p','muted');
    status.setAttribute('role','status');
    const translate = translateButton(show,episodes,() => update(),status,true);
    const normalize = value => String(value).toLocaleLowerCase('ru-RU').replaceAll('ё','е');
    const update = () => {
      const term = normalize(query.value.trim());
      seriesLink.textContent = seriesDisplayTitle(show);
      if (translate) translate.hidden = episodes.every(item => seriesMetadata.episode(show,item).translated);
      toggleMarks.textContent = preferences.hideImportance ? 'Показать пометки' : 'Скрыть пометки';
      toggleMarks.setAttribute('aria-pressed',preferences.hideImportance);
      const rows = episodes.filter(item => {
        const record = viewed[episodeKey(item)];
        const text = [item.episode,item.season+'×'+item.episode,item.season+'x'+item.episode,item.title,seriesMetadata.episode(show,item).title];
        return (!unread.checked || !record?.completed) && (!important.checked || ['key','important'].includes(importance(show,item).importance)) &&
          (!term || text.some(value => normalize(value).includes(term)));
      });
      count.textContent = rows.length + ' из ' + episodes.length;
      list.replaceChildren(...(rows.length ? rows.map(item => {
        const info = importance(show,item);
        const metadata = seriesMetadata.episode(show,item);
        return episodeCard({...item,description:info.description || (preferences.spoilers ? metadata.description : '')},{
          href:watchPath(show,item),title:metadata.title,record:viewed[episodeKey(item)] || {},
          current:selectedEpisodes.get(show.id) === episodeKey(item),importance:info.importance,
          onDetails:() => showEpisodeDetails(show,item,update)
        });
      }) : [make('p','empty','Серии не найдены. Измени поиск или фильтры.')]));
    };
    query.oninput = update;
    unread.onchange = update;
    important.onchange = update;
    update();
    section.append(toolbar,count,...(translate ? [translate] : []),status,list);
    const episodeSource = episodes.find(item => item.source?.startsWith('https://en.wikipedia.org/wiki/'))?.source;
    if (episodeSource) section.append(external('Список эпизодов · Википедия',episodeSource));
    $('series').replaceChildren(section);
    hydrate(show,update,status,episodes);
    void seriesMetadata.translateIfReady(show,episodes,metadataSession.signal,update,true);
  }
  function renderEpisode(show,item) {
    const panel = $('series');
    const {fragment,get} = cloneWatchLayout();
    const episodeName = get('episode-title');
    const original = get('episode-title-original');
    original.textContent = item.title;
    get('episode-number').textContent = formatEpisode(item).toLocaleUpperCase('ru-RU');
    const sources = get('open-sources');
    const last = resume(show);
    const continueButton = get('watch-continue');
    if (last) {
      continueButton.hidden = false;
      continueButton.textContent = 'Продолжить просмотр · ' + last.season + '×' + last.episode + ' · ' + playbackTime(last.time);
      continueButton.onclick = () => {
        if (episodeKey(last) === episodeKey(item)) startAutomatic(last.time);
        else location.hash = watchPath(show,last);
      };
    }
    const screen = get('screen');
    const status = get('source-status');
    const quality = get('quality-status');
    const dub = get('watch-dub');
    const audio = get('watch-audio');
    const sourceBox = make('dialog','sheet library-source');
    sourceBox.setAttribute('aria-label','Источники');
    const sourceHeading = make('div','sheet-heading');
    const closeSources = make('button','icon-button','×');
    closeSources.setAttribute('aria-label','Закрыть');
    closeSources.onclick = () => sourceBox.close();
    sourceHeading.append(make('h2',null,'Источники'),closeSources);
    const sourceFeedback = make('p','muted');
    sourceFeedback.setAttribute('role','status');
    function showSources() {
      if (!sourceBox.open) sourceBox.showModal();
      platform.showBack(true);
    }
    sourceBox.onclose = () => platform.showBack(true);
    sources.onclick = showSources;
    const sourceKey = 'konfoly-source:' + show.id;
    const saved = readLocal(sourceKey);
    const itemId = episodeKey(item);
    const nativeAvailable = canResolveSeriesNative(show);
    const attachedFile = () => localEpisodeFolders.get(show.id)?.get(itemId);
    const fileInput = make('input');
    fileInput.type = 'file';
    fileInput.accept = 'video/*,.mp4,.webm';
    fileInput.hidden = true;
    const folderInput = make('input');
    folderInput.type = 'file';
    folderInput.hidden = true;
    const supportsFolder = 'webkitdirectory' in folderInput;
    folderInput.setAttribute('webkitdirectory','');
    let release;
    let pending;
    let preselectedVoice;
    const preview = new AbortController();
    const preflight = get('watch-preflight');

    function setSource(kind,value) {
      const template = /{season}|{episode}/.test(value);
      if (kind === 'manifest') saved.manifest = value;
      else if (kind === 'video') {
        if (template) delete saved[itemId];
        saved[template ? 'template' : itemId] = value;
      } else if (template) {
        delete saved.allohaEpisodes?.[itemId];
        saved.allohaTemplate = value;
      } else {
        saved.allohaEpisodes ||= {};
        saved.allohaEpisodes[itemId] = value;
      }
      writeLocal(sourceKey,saved);
      updateControls();
    }
    function sourceField(label,description,kind,value) {
      const section = make('div','library-source-field');
      const form = make('form','library-add');
      const input = make('input');
      input.type = 'text';
      input.inputMode = 'url';
      input.required = true;
      input.placeholder = 'https://…';
      input.value = value || '';
      input.setAttribute('aria-label',label);
      form.append(input,make('button','tonal','Подключить'));
      form.onsubmit = event => {
        event.preventDefault();
        const value = input.value.trim();
        const address = mediaAddress(value,item.season,item.episode);
        if (!address) {
          sourceFeedback.textContent = 'Нужен действительный HTTPS-адрес.';
          input.focus();
          return;
        }
        const policy = {manifest:'connect',alloha:'frame',video:'media'};
        if (!isIntegrationUrl(address,policy[kind])) {
          sourceFeedback.textContent = 'Домен источника не разрешён в этой сборке Konfoly.';
          return;
        }
        setSource(kind,value);
        const explicit = kind === 'manifest' ? {manifest:value} : {address};
        void openProvider(kind === 'alloha' ? 'alloha' : 'video',explicit);
      };
      section.append(make('strong',null,label),make('p','muted',description),form);
      return section;
    }
    const videoField = sourceField('Прямая ссылка на видео',
      'Вставь ссылку на серию или шаблон с {season} и {episode} для всего сериала.',
      'video',saved[itemId] || saved.template);
    const manifestField = sourceField('Каталог видео в JSON',
      'Один адрес на весь сериал. В объекте episodes ключи имеют вид «1:2», а значения — прямые ссылки на видео.',
      'manifest',saved.manifest);
    const allohaField = sourceField('Ссылка для вставки Alloha',
      'Вставь адрес iframe для серии или шаблон провайдера с {season} и {episode}. Возможна реклама.',
      'alloha',saved.allohaEpisodes?.[itemId] || saved.allohaTemplate);
    sourceBox.append(sourceHeading,sourceFeedback,fileInput,folderInput);
    if (integrationEditorAvailable()) sourceBox.append(videoField,manifestField,allohaField);

    function storeEpisodeProgress(entry) {
      const entries = readLocal(historyKeyFor(show));
      entries[itemId] = entry;
      writeLocal(historyKeyFor(show),entries);
      updateWatched();
    }
    function play(address,revoke,source,resumeTime,format,{next,retry=false,alternatives=[],label='',dubbing}={}) {
      release?.();
      const video = make('video');
      video.playsInline = true;
      video.preload = 'metadata';
      if (sourceBox.open) sourceBox.close();
      screen.replaceChildren(video);
      if (isMobileCinema() && !document.fullscreenElement) void requestCinemaFullscreen(screen);
      quality.textContent = '';
      const reportResolution = () => {
        if (video.videoWidth) quality.textContent = video.videoWidth + ' × ' + video.videoHeight;
      };
      video.addEventListener('loadedmetadata',reportResolution);
      video.addEventListener('resize',reportResolution);
      const player = createCinemaPlayer(video,{title:formatEpisode(item),rate:preferences.rate,volume:preferences.volume});
      const stopKeys = bindVideoKeys(video,document,active => player.setBoost(active));
      const viewed = readLocal(historyKeyFor(show))[episodeKey(item)];
      const stopMemory = bindPlaybackMemory(video,{...item,source},message => { status.textContent = [label,message].filter(Boolean).join(' · '); },{
        storeKey:progressKey(show),resumeTime:resumeTime ?? viewed?.time ?? 0,
        completionTime:Infinity,onSave:storeEpisodeProgress
      });
      let failed = false;
      function handleFailure(failure,code) {
        if (failed || !video.isConnected || pending) return;
        failed = true;
        const position = video.currentTime > 0 ? video.currentTime : resumeTime ?? viewed?.time;
        if (!retry && (failure === 'stall' || code === 2) && ['video','endpoint','native','stremio'].includes(source)) {
          void openProvider(source,undefined,position,{next,retry:true});
          return;
        }
        const [stream,...rest] = alternatives;
        if (stream) {
          play(stream.url,null,source,position,stream.format,{next,retry:true,alternatives:rest,label:stream.label,dubbing:stream.choice != null ? {...dubbing,selected:stream.choice} : dubbing});
          return;
        }
        if (next) {
          next(position);
          return;
        }
        playbackUnavailable(failure === 'stall' ? 'Видео перестало загружаться. Попробуй другой источник.' :
          'Видео не загрузилось. Выбери другой источник или файл.');
      }
      const stopHealth = watchPlaybackHealth(video,handleFailure);
      renderStreamChoices(audio,'Аудиодорожка');
      renderStreamChoices(dub,source === 'stremio' ? 'Поток дополнения' : 'Озвучка',dubbing?.items,dubbing?.selected,choice => {
        const position = video.currentTime > 0 ? video.currentTime : resumeTime;
        if (source === 'native') {
          saved.nativeVoice = choice;
          writeLocal(sourceKey,saved);
        }
        void openProvider(source,undefined,position,{choice});
      });
      status.textContent = 'Загружаем видео…';
      const stopStream = openVideoStream(video,address,{format,onError:code => handleFailure('error',code),
        onBlocked:() => {status.textContent = 'Нажми ▶ для воспроизведения.'},
        onAudioTracks:(tracks,selected,select) => renderStreamChoices(audio,'Аудиодорожка',tracks,selected,select)});
      release = () => {
        video.removeEventListener('loadedmetadata',reportResolution);
        video.removeEventListener('resize',reportResolution);
        stopMemory();
        stopKeys();
        stopHealth();
        player.destroy();
        stopStream();
        video.pause();
        video.removeAttribute('src');
        video.load();
        revoke?.();
      };
    }
    const empty = make('div','screen-empty library-empty-player');
    const preferred = make('button','filled','▶ Смотреть');
    const restart = make('button','tonal','С начала');
    function candidateSources() {
      const list = [];
      if (attachedFile()) list.push('folder');
      if (seriesSource(show,item,saved,'video')) list.push('video');
      if (nativeAvailable) list.push('native');
      if (stremioSource() && canUseStremio(show)) list.push('stremio');
      if (episodeEndpoint()) list.push('endpoint');
      if (seriesSource(show,item,saved,'alloha')) list.push('alloha');
      return list;
    }
    function playbackUnavailable(message) {
      release?.();
      release = null;
      quality.textContent = '';
      screen.replaceChildren(empty);
      if (preflight.childElementCount) preflight.hidden = false;
      status.textContent = sourceFeedback.textContent = message;
      updateControls();
      showSources();
    }
    function playFile(file,time,next) {
      pending?.abort();
      pending = null;
      const address = URL.createObjectURL(file);
      play(address,() => URL.revokeObjectURL(address),'file',time,undefined,{next});
    }
    function openAutomatic(candidates,time) {
      const [id,...rest] = candidates;
      if (!id) {
        playbackUnavailable('Видео для этой серии пока недоступно.');
        return;
      }
      const next = rest.length ? position => openAutomatic(rest,position ?? time) : undefined;
      if (id === 'folder') {
        const file = attachedFile();
        if (file) playFile(file,time,next);
        else openAutomatic(rest,time);
        return;
      }
      void openProvider(id,undefined,time,{next});
    }
    function updateControls() {
      const viewed = readLocal(historyKeyFor(show))[itemId];
      restart.hidden = viewed?.completed || !(viewed?.time > 0);
      preferred.textContent = !restart.hidden ? 'Продолжить с ' + playbackTime(viewed.time) : '▶ Смотреть';
      endpointButton.hidden = !episodeEndpoint();
      stremioButton.hidden = !stremioSource() || !canUseStremio(show);
      defaultNativeButton.hidden = !nativeAvailable;
      connectedFolder.hidden = !attachedFile();
      for (const [id,control] of [['video',nativeButton],['alloha',allohaButton]]) {
        control.hidden = !seriesSource(show,item,saved,id);
      }
    }
    async function openProvider(id,override,resumeTime,{next,retry=false,choice}={}) {
      pending?.abort();
      const controller = new AbortController();
      pending = controller;
      preflight.hidden = true;
      sourceFeedback.textContent = '';
      const timer = setTimeout(() => controller.abort(),12000);
      try {
        const source = override || (id === 'video' && saved.preferred === 'manifest' &&
          isIntegrationUrl(mediaAddress(saved.manifest,item.season,item.episode),'connect') ?
          {manifest:saved.manifest} : seriesSource(show,item,saved,id));
        status.textContent = 'Подключаем видео…';
        if (id === 'alloha') {
          if (!source?.address) throw Error('Укажи ссылку Alloha для этой серии.');
          release?.();
          release = null;
          if (sourceBox.open) sourceBox.close();
          screen.replaceChildren(createExternalVideoFrame(source.address,'Alloha'));
          status.textContent = 'Alloha · внешний плеер. Возможна реклама.';
        } else {
          let result;
          if (id === 'native') {
            const kinopoiskId = seriesNativeId(show) || await seriesMetadata.kinopoiskId(show,controller.signal);
            if (!kinopoiskId) throw Error('Для этого сериала не найден ID каталога видео.');
            const voice = choice ?? saved.nativeVoice;
            try { result = await resolveNative({...canonicalEpisode(show,item),kinopoiskId,voice,quality:preferences.quality},controller.signal); }
            catch (error) {
              if (choice || !voice || controller.signal.aborted) throw error;
              result = await resolveNative({...canonicalEpisode(show,item),kinopoiskId,quality:preferences.quality},controller.signal);
            }
          } else if (id === 'endpoint') {
            result = await resolveEpisodeEndpoint(show,item,controller.signal,choice);
          } else if (id === 'stremio') {
            result = await resolveStremio(show,item,controller.signal,choice);
          } else {
            result = {url:await resolveSeriesSource(source,item,controller.signal)};
          }
          if (controller.signal.aborted || pending !== controller) return;
          pending = null;
          if (result.kind === 'embed') {
            release?.();
            release = null;
            if (sourceBox.open) sourceBox.close();
            screen.replaceChildren(createExternalVideoFrame(result.url,result.provider || 'Встроенный плеер'));
            status.textContent = result.provider || 'Встроенный плеер';
            return;
          }
          const fallback = result.embedFallback || null;
          const onFailure = fallback ? position => void openProvider('endpoint',undefined,position,{choice:fallback.choice,next}) : next;
          play(result.url,null,id,resumeTime,result.format,{next:onFailure,retry,alternatives:result.alternatives,label:result.label,dubbing:{items:result.voices,selected:result.voice}});
        }
        saved.preferred = id === 'video' && source?.manifest && saved.manifest === source.manifest ? 'manifest' : id;
        writeLocal(sourceKey,saved);
        updateControls();
      } catch (error) {
        if (pending !== controller) return;
        if (next) {
          pending = null;
          next(resumeTime);
          return;
        }
        const message = controller.signal.aborted ? 'Источник не ответил за 12 секунд.' :
          (error instanceof TypeError ? 'Источник недоступен. Проверь сеть и настройки доступа.' : error.message);
        if (id === 'alloha') {
          sourceFeedback.textContent = message;
          showSources();
        } else playbackUnavailable(message);
      } finally {
        clearTimeout(timer);
        if (pending === controller) pending = null;
      }
    }
    function startAutomatic(time) {
      pending?.abort();
      pending = null;
      if (preselectedVoice) {
        const [source,...parts] = preselectedVoice.split(':');
        void openProvider(source,undefined,time,{choice:parts.join(':')});
      } else openAutomatic(candidateSources(),time);
    }
    preferred.onclick = () => startAutomatic();
    restart.onclick = () => startAutomatic(0);
    empty.append(preferred,restart);
    screen.append(empty);
    status.textContent = 'Наш плеер';
    const nativeButton = make('button','tonal','Моё видео');
    const defaultNativeButton = make('button','tonal','Наш плеер');
    const allohaButton = make('button','tonal','Alloha');
    const endpointButton = make('button','tonal','Общий источник');
    const stremioButton = make('button','tonal','Stremio');
    const chooseFile = make('button','tonal','Выбрать файл');
    const chooseFolder = make('button','tonal','Подключить папку');
    chooseFolder.hidden = !supportsFolder;
    const connectedFolder = make('button','tonal','Открыть серию из папки');
    const sourceActions = make('div','source-form library-source-actions');
    nativeButton.onclick = () => { void openProvider('video'); };
    defaultNativeButton.onclick = () => { void openProvider('native'); };
    allohaButton.onclick = () => { void openProvider('alloha'); };
    endpointButton.onclick = () => { void openProvider('endpoint'); };
    stremioButton.onclick = () => { void openProvider('stremio'); };
    chooseFile.onclick = () => fileInput.click();
    chooseFolder.onclick = () => folderInput.click();
    connectedFolder.onclick = () => {
      const file = attachedFile();
      if (file) playFile(file);
    };
    sourceActions.append(defaultNativeButton,nativeButton,endpointButton,stremioButton,chooseFile,chooseFolder,connectedFolder,allohaButton);
    sourceHeading.after(sourceActions);
    updateControls();
    fileInput.onchange = () => {
      const file = fileInput.files[0];
      if (!file) return;
      fileInput.value = '';
      playFile(file);
    };
    folderInput.onchange = () => {
      const files = indexEpisodeFiles(folderInput.files,show.episodes);
      folderInput.value = '';
      if (!files.size) {
        sourceFeedback.textContent = 'Эпизоды не найдены. Используй имена вида S01E02.mp4 и выбирай папку одного сериала.';
        return;
      }
      localEpisodeFolders.set(show.id,files);
      updateControls();
      sourceFeedback.textContent = 'В этой вкладке подключено серий: ' + files.size + '.';
      const file = attachedFile();
      if (file) playFile(file);
    };
    const index = show.episodes.indexOf(item);
    for (const [offset,id] of [[-1,'previous'],[1,'next']]) {
      const button = get(id);
      const next = show.episodes[index + offset];
      button.disabled = !next;
      if (next) button.onclick = () => { location.hash = watchPath(show,next); };
    }
    const description = fragment.querySelector('.watch-description');
    const actions = fragment.querySelector('.watch-actions');
    const share = get('share-link');
    share.href = watchPath(show,item);
    share.onclick = async event => {
      if (!navigator.clipboard?.writeText) return;
      event.preventDefault();
      try {
        await navigator.clipboard.writeText(share.href);
        status.textContent = 'Ссылка на серию скопирована';
      } catch { status.textContent = 'Ссылку можно скопировать из адресной строки'; }
    };
    const watched = get('mark-watched');
    function updateWatched() {
      const completed = !!readLocal(historyKeyFor(show))[itemId]?.completed;
      watched.textContent = completed ? '✓ Просмотрено' : 'Отметить просмотренной';
      watched.setAttribute('aria-pressed',completed);
    }
    watched.onclick = () => {
      const savedEntry = readLocal(historyKeyFor(show))[itemId] || {};
      storeEpisodeProgress({...savedEntry,season:item.season,episode:item.episode,completed:!savedEntry.completed,updatedAt:Date.now()});
    };
    updateWatched();

    const metadataStatus = make('p','muted');
    metadataStatus.setAttribute('role','status');
    const textBlock = get('episode-description');
    const plot = get('episode-plot');
    plot.open = preferences.spoilers;
    const plotContent = get('plot-content');
    const detailsButton = make('button','tonal','О серии');
    detailsButton.onclick = () => showEpisodeDetails(show,item,updateMetadata);
    actions.append(detailsButton);
    const translate = translateButton(show,[item],updateMetadata,metadataStatus);
    function updateMetadata() {
      const info = importance(show,item);
      const metadata = seriesMetadata.episode(show,item);
      episodeName.textContent = metadata.title;
      original.hidden = metadata.title === item.title;
      textBlock.textContent = info.description || '';
      textBlock.hidden = !info.description;
      const russian = /\p{Script=Cyrillic}/u.test(metadata.description);
      if (russian !== plot.classList.contains('localized-plot') || plot.hidden) plot.open = russian && preferences.spoilers;
      plot.classList.toggle('localized-plot',russian);
      plot.hidden = !metadata.description;
      plot.querySelector('summary').firstChild.textContent = russian ? 'Сюжет и развязка ' : 'Описание на языке оригинала ';
      plotContent.replaceChildren();
      if (metadata.description) plotContent.append(make('p',null,metadata.description),make('p','muted',metadata.source));
      const marked = !preferences.hideImportance && ['key','important'].includes(info.importance);
      detailsButton.textContent = marked ? importanceLabels[info.importance] : 'О серии';
    }
    updateMetadata();
    const rating = item.imdb && ratingBadge('IMDb',item.imdb,imdbLink(item.imdb));
    if (rating) get('episode-ratings').append(rating);
    setPersonalRatingButton(get('rate-episode'),{id:'episode:' + itemId,label:show.title + ' · ' + formatEpisode(item)},show.id);
    if (translate) description.append(translate);
    description.append(metadataStatus);
    panel.replaceChildren(fragment,sourceBox);
    const previewTimer = setTimeout(() => preview.abort(),9000);
    previewEpisodeVoices(show,item,preview.signal,items => {
      if (pending || screen.querySelector('video,iframe')) return;
      const selected = preselectedVoice || 'native:' + (saved.nativeVoice || '');
      renderStreamChoices(preflight,'Озвучка',items,selected,value => { preselectedVoice = value; },true);
    });
    hydrate(show,updateMetadata,metadataStatus,[item]);
    void seriesMetadata.translateIfReady(show,[item],metadataSession.signal,updateMetadata);
    if (openSourcesFor === watchPath(show,item)) {
      openSourcesFor = null;
      showSources();
    }

    cleanup = () => {
      clearTimeout(previewTimer);
      preview.abort();
      const previousRequest = pending;
      pending = null;
      previousRequest?.abort();
      release?.();
      if (sourceBox.open) sourceBox.close();
      screen.replaceChildren();
    };
  }
  const posterColors = new Map();
  function posterHue(url) {
    if (posterColors.has(url)) return posterColors.get(url);
    const sample = new Promise(resolve => {
      const image = new Image();
      const timer = setTimeout(() => resolve(null),6000);
      function done(hue) { clearTimeout(timer); resolve(hue); }
      image.crossOrigin = 'anonymous';
      image.onerror = () => done(null);
      image.onload = () => {
        try {
          const canvas = make('canvas');
          canvas.width = canvas.height = 20;
          const context = canvas.getContext('2d',{willReadFrequently:true});
          context.drawImage(image,0,0,20,20);
          const pixels = context.getImageData(0,0,20,20).data;
          const weights = new Array(12).fill(0);
          for (let i=0; i<pixels.length; i+=4) {
            const [r,g,b] = pixels.subarray(i,i+3);
            const max = Math.max(r,g,b);
            const min = Math.min(r,g,b);
            const delta = max - min;
            if (pixels[i+3] < 200 || delta < 26 || max < 58) continue;
            const sector = max === r ? (g-b)/delta : max === g ? (b-r)/delta + 2 : (r-g)/delta + 4;
            const bin = Math.round(sector * 2 + 12) % 12;
            weights[bin] += delta ** 2.4 * (255 - min) / 255;
          }
          const best = Math.max(...weights);
          done(best ? [28,58,91,120,142,164,191,219,255,280,326,353][weights.indexOf(best)] : null);
        } catch { done(null); }
      };
      image.src = url;
    });
    posterColors.set(url,sample);
    return sample;
  }
  function palette(route) {
    const root = document.documentElement;
    const show = route.show || (['home','catalog','watch'].includes(route.page) ? mentalist : null);
    if (root.dataset.series === show?.id) return;
    if (!show) {
      delete root.dataset.series;
    } else {
      root.style.setProperty('--show-hue',String(showHue(show)));
      root.style.setProperty('--show-chroma',String(show.chroma ?? .11));
      root.dataset.series = show.id;
      if (show !== mentalist && show.hue == null && !Number.isFinite(seriesIdentity(show)?.hue) && /^https:\/\/static\.tvmaze\.com\//.test(show.image || '')) {
        void posterHue(show.image).then(hue => {
          if (hue == null || root.dataset.series !== show.id) return;
          root.style.setProperty('--show-hue',String(hue));
          applyTheme();
        });
      }
    }
    applyTheme();
  }
  function render(route) {
    palette(route);
    $('series').classList.toggle('watch-page',!!route.episode);
    metadataSession?.abort();
    metadataSession = new AbortController();
    episodeDetails?.close();
    cleanup?.();
    cleanup = undefined;
    if (route.page === 'settings') settings();
    if (route.page === 'library') renderLibrary(route.focusSearch);
    if (!route.show) return;
    selectedShow = route.show;
    selectedEpisode = route.episode;
    selectedSeason = route.season;
    if (route.loadEpisodes) {
      const panel = $('series');
      const loading = make('p','muted','Загружаем эпизоды…');
      loading.setAttribute('role','status');
      if (route.overview) renderShow(route.show,loading);
      else panel.replaceChildren(make('h1','page-title',seriesDisplayTitle(route.show)),loading);
      const signal = metadataSession.signal;
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal.addEventListener('abort',abort,{once:true});
      let failed = false;
      function showFailure() {
        if (signal.aborted || failed) return;
        failed = true;
        loading.textContent = 'Не удалось загрузить эпизоды. Попробуй ещё раз.';
        const retry = make('button','tonal episode-load-retry','Повторить');
        retry.onclick = renderCurrentRoute;
        loading.after(retry);
      }
      const timer = setTimeout(() => { abort(); showFailure(); },20000);
      void fetchEpisodes(route.show,controller.signal,{
        preferredSeason:route.requestedSeason,
        onSeasons:(loaded,total) => {
          if (!controller.signal.aborted) loading.textContent = 'Загружаем сезоны · ' + loaded + ' из ' + total;
        }
      }).then(episodes => {
        if (controller.signal.aborted) return;
        route.show.episodes = episodes;
        if (imported.includes(route.show)) persistImports(imported);
        renderCurrentRoute();
      }).catch(showFailure).finally(() => {
        clearTimeout(timer);
        signal.removeEventListener('abort',abort);
      });
      return;
    }
    if (route.episode) {
      selectedEpisodes.set(route.show.id,episodeKey(route.episode));
      renderEpisode(route.show,route.episode);
    }
    else if (route.season != null) renderSeason(route.show,route.season);
    else {
      renderShow(route.show);
      if (refreshEpisodeLists.delete(route.show)) {
        const signal = metadataSession.signal;
        void fetchEpisodes(route.show,signal).then(episodes => {
          if (signal.aborted || episodes.length < route.show.episodes.length) return;
          route.show.episodes = episodes;
          renderCurrentRoute();
        }).catch(() => {});
      }
    }
  }
  return {match,selectRoute,navigation,back,render,openActiveSources};
}

export {createSeriesLibrary};
