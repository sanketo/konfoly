import {canonicalEpisode, mentalistCatalog, seriesIdentity} from './series-config.js';
import {breakingBad, interns, seriesEditorial} from './series-data.js';
import {cachedEpisodes,rememberEpisodes} from './catalog-episodes.js';
import {loadCinemetaSeries,searchCinemeta,validImdb} from './cinemeta.js';
import {posterSources,tvmazePoster} from './series-posters.js';
import {loadWikiEpisodes} from './wiki-episodes.js';
import {seriesMetadata} from './series-metadata.js';
import {readLocal, writeLocal} from './storage.js';
import {$, make} from './dom.js';
import {bindPlaybackMemory, playbackTime, readPlaybackMemory, watchPlaybackHealth} from './video-progress.js';
import {ratingBadge, setPersonalRatingButton} from './ratings.js';
import {externalRatingData} from './ratings-data.js';
import {integrationSettings} from './integrations.js';
import {seriesImportance} from './series-importance.js';
import {importanceLabels} from './importance.js';
import {platform} from './platform.js';
import {canResolveSeriesNative, canUseStremio, createExternalVideoFrame, episodeEndpoint, indexEpisodeFiles, integrationEditorAvailable, isIntegrationUrl, localEpisodeFolders, openVideoStream, previewEpisodeVoices, renderStreamChoices, resolveEpisodeEndpoint, resolveNative, resolveSeriesSource, resolveStremio, seriesNativeId, seriesSource, stremioSource} from './providers.js';
import {mediaAddress} from './urls.js';
import {bindVideoKeys, isMobileCinema, requestCinemaFullscreen} from './video-controls.js';
import {createCinemaPlayer} from './player-ui.js';
import {metricaPage,metricaGoal} from './metrica.js';
import popularCatalog from './data/popular-series.json' with {type:'json'};
import {availabilityLabels,catalogRecordId,episodeAvailability,findCatalogShow,sourceRevision} from './catalog-model.js';

function createSeriesLibrary({preferences,persist,episodeCard,cloneWatchLayout,applyTheme,renderCurrentRoute}) {
  const mentalist = mentalistCatalog;
  const libraryKey = 'konfoly-library-v1';
  const pinnedKey = 'konfoly-pinned-series-v1';
  const catalogStateKey = 'konfoly-library-state-v1';
  let unsavedCatalogChanges = {};
  const imported = readImports();
  const isInterns = show => show.mazeId === interns.mazeId || show.imdb?.id === interns.imdb.id;
  const importedInterns = imported.find(isInterns);
  if (importedInterns) Object.assign(importedInterns,{
    official:interns.official,tmdbId:interns.tmdbId,hue:interns.hue,imdb:importedInterns.imdb || interns.imdb
  });
  const indexedShows = Object.entries(seriesEditorial).flatMap(([id,entry]) => {
    const {title,original,years,image,description,source,imdb,seasonCount,episodeCount,genres} = entry;
    const show = {id:'tvmaze-' + id,mazeId:Number(id),title,original,years,image,description,source,imdb,seasonCount,episodeCount,genres};
    const existing = imported.find(item => matchesCatalog(item,{id:show.mazeId,externals:{imdb:imdb?.id}}));
    if (!existing) return [show];
    for (const [key,value] of Object.entries(show)) if (value != null && !existing[key]) existing[key] = value;
    if (image?.startsWith('assets/')) existing.image = image;
    return [];
  });
  const rankedShows = new Map();
  const rankedRecords = new Map();
  const alreadyInLibrary = new Set();
  const libraryShows = () => [mentalist,breakingBad,importedInterns || interns,...imported.filter(show => !isInterns(show)),
    ...indexedShows,...rankedShows.values()];
  const shows = new Map([mentalist,breakingBad,interns,...indexedShows,...imported].map(show => [show.id,show]));
  const knownShows = libraryShows().map(show => ({...show,imdbId:show.imdb?.id || seriesIdentity(show)?.imdbId}));
  const popularShows = popularCatalog.shows.map(entry => {
    const existing = findCatalogShow(knownShows,entry);
    const id = existing?.id || entry.showId;
    const show = shows.get(id) || {id,title:entry.title};
    const {years,genres,tmdbId,imdbId,imdbScore,image,episodeCount,seasonCount} = entry;
    const fields = {years,genres,tmdbId,image,episodeCount,seasonCount,
      original:entry.originalTitle !== show.title ? entry.originalTitle : undefined,
      imdb:imdbId ? {id:imdbId,score:imdbScore} : undefined};
    for (const [name,value] of Object.entries(fields)) if (!show[name] && value != null) show[name] = value;
    const configured = integrationSettings.seriesSources[id] || integrationSettings.seriesSources[catalogRecordId(entry)];
    const verified = !entry.confirmed?.length || entry.sourceRevision === sourceRevision(configured);
    rankedRecords.set(id,verified ? entry : {...entry,availability:'UNVERIFIED',confirmed:[],confirmedProviders:{}});
    if (existing) alreadyInLibrary.add(id);
    else rankedShows.set(id,show);
    shows.set(id,show);
    if (!shows.has(catalogRecordId(entry))) shows.set(catalogRecordId(entry),show);
    return show;
  });
  const searchPreviews = new Map();
  let lastSearch;
  let visibleCatalogCount = 30;
  const showPath = show => '#series/' + show.id;
  const seasonPath = (show,season) => showPath(show) + '/season/' + (season || 'all');
  const watchPath = (show,item) => showPath(show) + '/' + item.season + '/' + item.episode;
  const progressKey = show => 'konfoly-progress:' + show.id;
  const historyKeyFor = show => 'konfoly-history:' + show.id;
  const episodeKey = item => item.season + ':' + item.episode;
  const catalogKey = show => show.id.startsWith('imdb-') ? show.imdb.id : show.mazeId || show.imdb?.id || show.id;
  const formatEpisode = item => 'Сезон ' + item.season + ' · Серия ' + item.episode;
  const selectedEpisodes = new Map();
  const countPlural = new Intl.PluralRules('ru');
  const seasonNouns = {one:'сезон',few:'сезона',many:'сезонов'};
  const episodeNouns = {one:'серия',few:'серии',many:'серий'};
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
  const seasonIndexes = new Map();
  const mazeSeasonIds = new Map();
  const partialSeasons = new WeakMap();
  const directoryCatalogs = new WeakSet();

  function compactImport(show) {
    const {id,mazeId,title,language,years,image,description,source,imdb,genres} = show;
    return {id,mazeId,title,language,years,image,description,source,imdb,genres,
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
  function catalogStates() {
    return {...readLocal(catalogStateKey),...unsavedCatalogChanges};
  }
  function saveCatalogState(show,state) {
    const saved = writeLocal(catalogStateKey,{...catalogStates(),[show.id]:state});
    if (saved) unsavedCatalogChanges = {};
    else unsavedCatalogChanges[show.id] = state;
    return saved;
  }
  function playbackFor(show) {
    return readPlaybackMemory(show === mentalist ? undefined : progressKey(show)).last;
  }
  function isSaved(show,state,pinned,last=playbackFor(show)) {
    if (state?.removed) return false;
    return !!(state || pinned[show.id] || imported.includes(show) || last);
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
  function showPosterSources(show,thumbnail=false) {
    const identity = seriesIdentity(show);
    const editorial = seriesEditorial[show.mazeId ?? identity?.mazeId];
    const image = show.image || editorial?.image;
    const original = editorial?.posterOriginal;
    const options = {thumbnail};
    const artwork = thumbnail ? [image,original] : [original,image];
    return [...new Set([
      ...artwork.flatMap(address => posterSources(address,undefined,options)),
      ...posterSources('',show.imdb?.id || identity?.imdbId,options)
    ])];
  }
  function loadPoster(image,addresses,onMissing) {
    let index = 0;
    function next() {
      const address = addresses[index++];
      if (address) image.src = address;
      else onMissing();
    }
    image.addEventListener('error',next);
    next();
  }
  function poster(show,eager=false) {
    const element = make('div','library-poster');
    const image = make('img');
    image.alt = '';
    image.loading = eager ? 'eager' : 'lazy';
    if (eager) image.fetchPriority = 'high';
    image.decoding = 'async';
    element.append(image);
    loadPoster(image,showPosterSources(show,true),() => { element.textContent = show.title; });
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
    const show = parts && (shows.get(parts[1]) || searchPreviews.get(parts[1]));
    if (show === mentalist && !parts[2] && !parts[3]) return {page:'home'};
    if (!show || show === mentalist) return parts ? {page:'library'} : null;
    if (!show.episodes) {
      const cached = cachedEpisodes(catalogKey(show));
      if (cached.episodes) {
        show.episodes = cached.episodes;
        if (Date.now() - cached.savedAt > 86400000) refreshEpisodeLists.add(show);
      }
    }
    if (!Array.isArray(show.episodes)) {
      const requestedSeason = Number(parts[2] || parts[3]) || undefined;
      if (!parts[2] && !parts[3] && directoryCatalogs.has(show)) return {page:'series',show};
      if (parts[2] === 'all' && directoryCatalogs.has(show)) {
        const loaded = partialSeasons.get(show);
        const episodes = [];
        // Keep later seasons out of the list until every earlier season is available.
        for (const number of seasonsFor(show)) {
          const season = loaded?.get(number);
          if (!season) break;
          episodes.push(...season);
        }
        return {page:'series',show:{...show,episodes,partialCatalog:true},season:0};
      }
      const savedSeason = requestedSeason ? cachedEpisodes(catalogKey(show) + ':season:' + requestedSeason) : {};
      if (!seasonIndexes.has(show.id) && Array.isArray(savedSeason.seasons)) {
        seasonIndexes.set(show.id,savedSeason.seasons.filter(number => Number.isInteger(number) && number > 0));
      }
      const available = partialSeasons.get(show)?.get(requestedSeason) || savedSeason.episodes;
      if (!available) return {page:'series',show,loadEpisodes:true,overview:!parts[2] && !parts[3],
        allSeasons:parts[2] === 'all',requestedSeason,season:parts[2] ? requestedSeason || 0 : undefined};
      const view = {...show,episodes:available,partialCatalog:true};
      return parts[2] ? {page:'series',show:view,season:requestedSeason} :
        {page:'series',show:view,episode:findEpisode(view,requestedSeason,parts[4])};
    }
    if (parts[2] === 'all') return {page:'series',show,season:0};
    const season = Number(parts[2]);
    if (season && show.episodes.some(item => item.season === season)) return {page:'series',show,season};
    return {page:'series',show,episode:findEpisode(show,parts[3],parts[4])};
  }
  function selectRoute(route) {
    if (!active) active = readLocal(activeKey);
    const show = route.show ?? (['home','catalog','watch'].includes(route.page) ? mentalist : null);
    if (!show) return;
    const overview = route.page === 'home' || route.overview ||
      (route.page === 'series' && !route.loadEpisodes && route.season == null && !route.episode);
    const state = catalogStates()[show.id];
    if (overview && show.preview) saveToCatalog(show);
    if ((overview || route.episode || route.season != null || route.page === 'watch' || route.page === 'catalog') &&
        !show.preview && (!state?.removed || overview)) {
      saveCatalogState(show,{...state,removed:false,openedAt:Date.now()});
    }
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
    return shows.get(active?.id) || searchPreviews.get(active?.id);
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
      const season = route.episode?.season ?? route.season ?? active?.season ?? (show && show !== mentalist && activeEpisode(show)?.season);
      element.href = show === mentalist ? '#catalog' : show ? seasonPath(show,season) : '#library/search';
      return route.page === 'catalog' || route.season != null;
    }
    if (element.hasAttribute('data-watch-nav')) {
      const item = route.episode || (show && show !== mentalist && activeEpisode(show));
      element.href = show === mentalist ? '#watch' : item ? watchPath(show,item) : '#library/search';
      return route.page === 'watch' || !!route.episode;
    }
    return null;
  }
  function openActiveSources() {
    const show = activeSeries();
    if (!show || show === mentalist) return false;
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
  function episodeCounts(show) {
    const count = show.partialCatalog ? show.episodeCount : show.episodes?.length ?? show.episodeCount;
    const seasons = seasonsFor(show).length || show.seasonCount;
    return {seasons,count};
  }
  function caption(show,includeYears=true) {
    const {seasons,count} = episodeCounts(show);
    return [includeYears && showYears(show),seasons && 'Сезонов ' + seasons,count && 'Серий ' + count].filter(Boolean).join(' · ');
  }
  function savedCardFacts(show) {
    const {seasons,count} = episodeCounts(show);
    const age = seriesMetadata.ageRating(show);
    const facts = make('span','library-card-facts');
    const countWithNoun = (value,nouns) => value && value + ' ' + nouns[countPlural.select(value)];
    for (const values of [
      [showYears(show),age?.replace(/ \([^)]*\)$/,'')],
      [countWithNoun(seasons,seasonNouns),countWithNoun(count,episodeNouns)]
    ]) {
      const fields = values.filter(Boolean);
      if (!fields.length) continue;
      const row = make('span','library-card-fact');
      row.append(...fields.map(value => make('span',null,value)));
      facts.append(row);
    }
    if (age) facts.firstElementChild.lastElementChild.title = age;
    return facts;
  }
  function applyShowPalette(show,update) {
    const identity = seriesIdentity(show);
    const hue = show.hue ?? identity?.hue;
    const chroma = show.chroma ?? identity?.chroma;
    const hash = [...show.id].reduce((value,char) => Math.imul(value ^ char.charCodeAt(0),16777619),2166136261) >>> 0;
    update(hue ?? hash % 360,chroma ?? .10 + (hash % 7) * .01);
    if (hue == null && show.image) void posterPalette(show.image).then(sample => {
      if (sample) update(sample.hue,chroma ?? sample.chroma);
    });
  }
  function setShowPalette(element,hue,chroma) {
    element.style.setProperty('--show-hue',hue);
    element.style.setProperty('--show-chroma',chroma);
  }
  function colorCard(show,card) {
    const image = show.image;
    applyShowPalette(show,(hue,chroma) => {
      if (show.image === image) setShowPalette(card,hue,chroma);
    });
  }
  function showCard(show,themeElement,{compact=false,eager=false}={}) {
    const tile = link(undefined,showPath(show),'library-tile');
    const copy = make('span','library-tile-copy');
    const name = seriesDisplayTitle(show);
    const title = make('strong',null,name);
    if (compact) title.title = name;
    copy.append(title);
    if (show.preview && name !== show.title) copy.append(make('span','library-tile-original',show.title));
    if (compact) {
      const metadata = savedCardFacts(show);
      if (metadata.childElementCount) copy.append(metadata);
    } else {
      const facts = [show.preview ? showYears(show) : caption(show),seriesMetadata.ageRating(show)].filter(Boolean).join(' · ');
      if (facts) copy.append(make('span','muted',facts));
    }
    const availability = availabilityLabels[episodeAvailability(rankedRecords.get(show.id))];
    if (availability) copy.append(make('span','muted library-availability',availability));
    colorCard(show,themeElement || tile);
    tile.append(poster(show,eager),copy);
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
  async function fetchMazeEpisodes(path,signal) {
    const episodes = (await tvmaze(path,signal))
      .filter(item => Number.isInteger(item.season) && Number.isInteger(item.number))
      .map(item => ({season:item.season,episode:item.number,title:item.name,mazeId:item.id,airdate:item.airdate,
        image:mazeImage(item.image),runtime:item.runtime,synopsis:seriesMetadata.plain(item.summary)}));
    if (!episodes.length) throw Error('Нет пронумерованных серий');
    return episodes;
  }
  async function fetchEpisodes(show,signal,{onSeasons,preferredSeason,directoryOnly,seasonOnly}={}) {
    const jobs = [];
    const knownDirectory = directoryCatalogs.has(show);
    let fullCatalogTimer;
    // Give season endpoints a head start before falling back to full catalogs.
    const fullCatalogDelay = !seasonOnly && preferredSeason && knownDirectory
      ? new Promise(resolve => { fullCatalogTimer = setTimeout(resolve,4000); }) : Promise.resolve();
    function fullCatalog(load) {
      return fullCatalogDelay.then(() => {
        if (signal.aborted) throw signal.reason;
        return load();
      });
    }
    if (!seasonOnly && show.mazeId) jobs.push(fullCatalog(async () =>
      ({episodes:await fetchMazeEpisodes('shows/' + show.mazeId + '/episodes',signal)})));
    if (!seasonOnly && show.imdb?.id) jobs.push(fullCatalog(() => loadCinemetaSeries(show.imdb.id,signal)));
    if (onSeasons && show.mazeId) {
      const seasonRequest = (async () => {
        let seasons = mazeSeasonIds.get(show.mazeId);
        if (!seasons) {
          const rows = await tvmaze('shows/' + show.mazeId + '/seasons',signal);
          seasons = new Map(rows.filter(item => Number.isInteger(item.number) && item.number > 0 && Number.isInteger(item.id))
            .map(item => [item.number,item.id]));
          if (!signal.aborted && seasons.size) mazeSeasonIds.set(show.mazeId,seasons);
        }
        if (signal.aborted) throw signal.reason;
        if (seasons.size) onSeasons(0,0,[...seasons.keys()]);
        const selected = seasons.get(preferredSeason);
        if (!selected) throw Error('Сезон отсутствует в списке TVmaze.');
        const episodes = await fetchMazeEpisodes('seasons/' + selected + '/episodes',signal);
        return {episodes,partialSeason:preferredSeason};
      })();
      if (preferredSeason) jobs.push(seasonRequest);
      else void seasonRequest.catch(() => {});
    }
    if (onSeasons) jobs.push((async () => {
      if (!knownDirectory) await new Promise(resolve => setTimeout(resolve,1000));
      if (signal.aborted) throw signal.reason;
      const article = await seriesMetadata.wikiEpisodeArticle(show,signal);
      if (!article) throw Error('Подтверждённая страница сериала не найдена.');
      const episodes = await loadWikiEpisodes(article,signal,onSeasons,preferredSeason,{directoryOnly});
      if (!episodes.length && directoryOnly) return {episodes,directoryOnly:true};
      if (!preferredSeason && show.episodeCount && episodes.length < show.episodeCount) throw Error('Список эпизодов неполный.');
      return {episodes,partialSeason:preferredSeason};
    })());
    const {episodes,poster,description,years,partialSeason,imdbScore,directoryOnly:directoryLoaded} = await Promise.any(jobs.map(async job => {
      const result = await job;
      if (preferredSeason && !result.episodes.some(item => item.season === preferredSeason)) {
        throw Error('В источнике нет выбранного сезона.');
      }
      return result;
    })).finally(() => clearTimeout(fullCatalogTimer));
    episodes.sort((a,b) => a.season - b.season || a.episode - b.episode);
    if (!signal.aborted) {
      show.image ||= poster;
      show.description ||= plainText(description);
      show.years ||= years;
      if (imdbScore != null) seriesMetadata.rememberImdbRating(show,imdbScore);
      if (!partialSeason && !directoryLoaded) rememberEpisodes(catalogKey(show),episodes);
    }
    return {episodes,partialSeason,directoryLoaded};
  }
  function rememberSeason(show,season,episodes) {
    if (!partialSeasons.has(show)) partialSeasons.set(show,new Map());
    partialSeasons.get(show).set(season,episodes);
    rememberEpisodes(catalogKey(show) + ':season:' + season,episodes,seasonIndexes.get(show.id));
  }
  function matchesCatalog(show,raw) {
    const imdb = show.imdb?.id || seriesIdentity(show)?.imdbId;
    return (Number.isInteger(raw.id) && show.mazeId === raw.id) ||
      (validImdb(raw.externals?.imdb) && imdb === raw.externals.imdb);
  }
  function searchPreview(raw,id) {
    const years = [raw.premiered?.slice(0,4),raw.ended?.slice(0,4)].filter(Boolean);
    return {
      id,mazeId:raw.id,title:raw.name,language:raw.language,years:[...new Set(years)].join('–') || raw.years,
      image:tvmazePoster(raw.image) || raw.poster,description:plainText(raw.summary),
      genres:Array.isArray(raw.genres) ? raw.genres.filter(genre => typeof genre === 'string').slice(0,8) : undefined,
      source:raw.id ? 'https://www.tvmaze.com/shows/' + raw.id : '',
      imdb:validImdb(raw.externals?.imdb) ? {id:raw.externals.imdb} : null,preview:true
    };
  }
  function saveToCatalog(show) {
    if (!show.preview) return saveCatalogState(show,{});
    show.preview = false;
    const next = [...imported,show];
    show.sessionOnly = !persistImports(next);
    imported.push(show);
    shows.set(show.id,show);
    searchPreviews.delete(show.id);
    return !show.sessionOnly;
  }
  function renderLibrary(focusSearch) {
    const grid = $('library-grid');
    const session = new AbortController();
    const requestedRatings = new Map();
    const cardRatings = new WeakMap();
    const ratingObserver = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        ratingObserver.unobserve(entry.target);
        cardRatings.get(entry.target)?.();
      }
    }) : null;
    function cardScore(show,card) {
      const source = show.imdb?.id ? show : {...show,imdb:{id:seriesIdentity(show)?.imdbId}};
      const rating = make('span','library-card-rating');
      const value = make('strong');
      rating.append(make('span',null,'IMDb'),value);
      const getRating = () => show === mentalist ? externalRatingData.series.imdb : seriesMetadata.imdbRating(source);
      const update = () => {
        const score = getRating()?.score;
        const formatted = score == null ? '' : score.toFixed(1).replace('.',',');
        value.textContent = formatted;
        rating.hidden = score == null;
        rating.title = formatted ? 'IMDb ' + formatted + ' из 10' : '';
      };
      update();
      if (getRating()?.score != null || !validImdb(source.imdb?.id)) return rating;
      const load = () => {
        if (!requestedRatings.has(show.id)) {
          requestedRatings.set(show.id,seriesMetadata.loadImdbRating(source,session.signal,update).catch(() => {}));
        }
        void requestedRatings.get(show.id).then(update);
      };
      if (ratingObserver) {
        cardRatings.set(card,load);
        ratingObserver.observe(card);
      } else load();
      return rating;
    }
    const feedback = $('library-status');
    const undo = $('library-undo');
    feedback.textContent = '';
    undo.hidden = true;
    undo.onclick = null;
    const more = $('library-more');
    function sortedRecentlyOpened() {
      const states = catalogStates();
      const pinned = readLocal(pinnedKey);
      return libraryShows().flatMap(show => {
        const state = states[show.id];
        const last = playbackFor(show);
        if (!isSaved(show,state,pinned,last || null)) return [];
        return [{show,state,openedAt:Math.max(state?.openedAt || 0,last?.updatedAt || 0)}];
      }).sort((first,second) => !!second.state?.favoriteAt - !!first.state?.favoriteAt ||
        second.openedAt - first.openedAt);
    }
    function renderSavedGrid(focusId,append=false) {
      if (!append) ratingObserver?.disconnect();
      const offset = append ? grid.childElementCount : 0;
      let focusButton;
      const recent = sortedRecentlyOpened();
      const states = catalogStates();
      const seen = new Set(recent.map(item => item.show.id));
      const entries = [...recent];
      for (const show of [...popularShows,...libraryShows()]) {
        if (seen.has(show.id) || states[show.id]?.removed && !rankedRecords.has(show.id)) continue;
        seen.add(show.id);
        entries.push({show,state:states[show.id]});
      }
      const titles = new Map();
      const cards = entries.slice(offset,visibleCatalogCount).map(({show,state},index) => {
        const card = make('div','library-saved-card');
        const name = seriesDisplayTitle(show);
        const selected = state?.favoriteAt > 0;
        const favorite = make('button','library-card-button library-favorite');
        const star = document.createElementNS('http://www.w3.org/2000/svg','svg');
        star.classList.add('library-favorite-star');
        star.setAttribute('aria-hidden','true');
        star.setAttribute('viewBox','0 0 20 20');
        const shape = document.createElementNS(star.namespaceURI,'path');
        shape.setAttribute('d','M10 1.8 12.6 7.1 18.5 8 14.2 12.1 15.2 18 10 15.2 4.8 18 5.8 12.1 1.5 8 7.4 7.1Z');
        star.append(shape);
        favorite.append(star);
        const remove = make('button','library-card-button library-remove');
        favorite.type = remove.type = 'button';
        favorite.title = selected ? 'Убрать из избранного' : 'Добавить в избранное';
        favorite.setAttribute('aria-label',favorite.title + ': ' + name);
        favorite.setAttribute('aria-pressed',String(selected));
        remove.title = rankedRecords.has(show.id) ? 'Убрать из недавних' : 'Удалить из каталога';
        remove.hidden = !recent.some(item => item.show === show);
        remove.setAttribute('aria-label',remove.title + ': ' + name);
        favorite.onclick = () => {
          const saved = saveCatalogState(show,{...state,favoriteAt:selected ? 0 : Date.now()});
          announce(name + (selected ? ' — убрано из избранного.' : ' — в избранном.'),saved);
          renderSavedGrid(show.id);
        };
        remove.onclick = () => {
          const saved = saveCatalogState(show,{removed:true});
          announce(name + (rankedRecords.has(show.id) ? ' — убрано из недавних.' : ' — удалено из каталога.'),saved);
          undo.hidden = false;
          undo.onclick = () => {
            announce(name + ' — возвращено в каталог.',saveCatalogState(show,state || {}));
            renderSavedGrid(show.id);
            if (input.value.trim().length >= 2) search();
          };
          renderSavedGrid();
          if (input.value.trim().length >= 2) search();
          undo.focus();
        };
        if (show.id === focusId) focusButton = favorite;
        const actions = make('div','library-card-actions');
        actions.append(cardScore(show,card),favorite,remove);
        const tile = showCard(show,card,{compact:true,eager:offset + index < 4});
        titles.set(show,tile.querySelector('strong'));
        card.append(tile,actions);
        return card;
      });
      if (append) grid.append(...cards);
      else grid.replaceChildren(...cards);
      grid.hidden = !grid.childElementCount;
      more.hidden = grid.childElementCount >= entries.length;
      void seriesMetadata.searchTitles([...titles.keys()].slice(Math.max(0,titles.size - 30)),session.signal,show => {
        const title = titles.get(show);
        if (title) title.title = title.textContent = seriesDisplayTitle(show);
      },{byImdb:true}).catch(() => {});
      focusButton?.focus();
    }
    function announce(message,saved) {
      feedback.textContent = message + (saved ? '' : ' Изменение действует до закрытия вкладки.');
      undo.hidden = true;
      undo.onclick = null;
    }
    more.onclick = () => {
      visibleCatalogCount += 30;
      renderSavedGrid(undefined,true);
    };
    renderSavedGrid();
    function searchCard(show) {
      const card = make('div','library-collection-card');
      const add = make('button','library-tile-action tonal','Добавить в каталог');
      add.type = 'button';
      const markSaved = () => {
        add.textContent = 'В каталоге';
        add.disabled = true;
      };
      if (rankedRecords.has(show.id) || isSaved(show,catalogStates()[show.id],readLocal(pinnedKey))) markSaved();
      add.onclick = () => {
        const saved = saveToCatalog(show);
        markSaved();
        announce(seriesDisplayTitle(show) + ' — добавлено в каталог.',saved);
        renderSavedGrid();
      };
      card.append(showCard(show,card),add);
      return card;
    }
    const form = $('library-add-form');
    const input = form.querySelector('input');
    const status = $('library-add-status');
    const results = $('library-add-results');
    status.textContent = '';
    results.replaceChildren();
    if (focusSearch) input.focus({preventScroll:true});
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
    function search({restore=false}={}) {
      clearTimeout(debounce);
      operation?.abort();
      operation = null;
      const query = input.value.trim();
      searchPreviews.clear();
      results.replaceChildren();
      status.textContent = '';
      if (query.length < 2) return;
      const cachedSearch = restore && lastSearch?.query === query ? lastSearch : null;
      const rawMatches = new Map();
      const snapshot = {query,rawMatches,complete:false};
      lastSearch = snapshot;
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
        function addResult(show,localized) {
          const known = libraryShows().find(item => matchesCatalog(item,show));
          const current = previews.find(item => matchesCatalog(item,show));
          const id = known?.id || current?.id || (Number.isInteger(show.id) ? 'tvmaze-' + show.id : 'imdb-' + show.externals.imdb);
          const previous = rawMatches.get(id) || {};
          const raw = {...previous,...Object.fromEntries(Object.entries(show).filter(([,value]) =>
            value != null && value !== '' && (!Array.isArray(value) || value.length)))};
          raw.externals = {imdb:[previous.externals?.imdb,show.externals?.imdb].find(validImdb)};
          rawMatches.set(id,raw);
          const preview = known || searchPreview(raw,id);
          if (raw.imdbScore != null && seriesMetadata.imdbRating(preview)?.score == null) {
            seriesMetadata.rememberImdbRating(preview,raw.imdbScore);
          }
          if (localized) seriesMetadata.rememberSearchTitle(preview,localized);
          if (indexedShows.includes(known)) {
            const image = preview.image || tvmazePoster(raw.image) || raw.poster;
            const cardPoster = cards.get(id)?.querySelector('.library-poster');
            const imageChanged = image && image !== known.image;
            known.image ||= image;
            known.language ||= show.language;
            known.description ||= plainText(show.summary);
            if (!known.imdb && raw.externals.imdb) known.imdb = {id:raw.externals.imdb};
            if (imageChanged && cardPoster && !cardPoster.firstElementChild) {
              cardPoster.replaceWith(poster(known));
              colorCard(known,cards.get(id));
            }
          }
          if (known && !known.genres?.length && Array.isArray(raw.genres)) known.genres = raw.genres.slice(0,8);
          if (seen.has(id)) {
            if (!known && current) {
              const imageChanged = preview.image !== current.image;
              Object.assign(current,preview);
              const card = cards.get(id);
              if (imageChanged) {
                card.querySelector('.library-poster')?.replaceWith(poster(current));
                colorCard(current,card);
              }
              const copy = card.querySelector('.library-tile-copy');
              const facts = copy?.querySelector('.muted');
              const previewFacts = [preview.years,seriesMetadata.ageRating(preview)].filter(Boolean).join(' · ');
              if (facts) facts.textContent = previewFacts;
              else if (previewFacts) copy?.append(make('span','muted',previewFacts));
            }
            updateTitle(preview);
            return;
          }
          seen.add(id);
          previews.push(preview);
          if (!known) searchPreviews.set(id,preview);
          const card = searchCard(preview);
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
        if (cachedSearch) {
          for (const entry of cachedSearch.rawMatches.values()) addResult(entry,entry.localized);
          if (seen.size) status.textContent = 'Результаты поиска';
          if (cachedSearch.complete) {
            snapshot.complete = true;
            if (!seen.size) status.textContent = 'Сериал не найден';
            return;
          }
        }
        const outcomes = await Promise.allSettled([loadMatches(),loadLocalizedMatches(),loadCinemetaMatches()]);
        if (signal.aborted) return;
        snapshot.complete = outcomes.every(item => item.status === 'fulfilled');
        const failed = outcomes.every(item => item.status === 'rejected');
        status.textContent = seen.size ? 'Результаты поиска' : failed ? 'Источники поиска недоступны. Попробуй ещё раз.' : 'Сериал не найден';
        metricaGoal(seen.size ? 'search_results' : failed ? 'search_error' : 'search_empty');
      },() => {
        status.textContent = results.childElementCount ? 'Результаты поиска' : 'Источники поиска не ответили. Попробуй ещё раз.';
        metricaGoal(results.childElementCount ? 'search_results' : 'search_error');
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
    cleanup = () => { clearTimeout(debounce); ratingObserver?.disconnect(); session.abort(); operation?.abort(); };
    if (input.value.trim().length >= 2) search({restore:true});
  }
  function imdbLink(record,suffix='ratings/') {
    return 'https://www.imdb.com/title/' + record.id + '/' + suffix;
  }
  function setPublicRating(row,record) {
    const badge = Number.isFinite(record?.score) ? ratingBadge('IMDb',record,imdbLink(record,record.suffix)) :
      record?.id ? external('IMDb ↗',imdbLink(record)) : null;
    const current = row.querySelector('[data-public-rating]');
    if (!badge) { current?.remove(); return; }
    badge.dataset.publicRating = '';
    if (!current) row.prepend(badge);
    else if (current.textContent !== badge.textContent) current.replaceWith(badge);
  }
  function ratings(show,record,id,label) {
    const row = make('div','rating-row');
    setPublicRating(row,record);
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
    const mazeId = show.mazeId ?? seriesIdentity(show)?.mazeId;
    const editorial = seriesImportance[mazeId]?.[episodeKey(item)];
    const override = readLocal('konfoly-importance:' + show.id)[episodeKey(item)];
    return {
      importance:override || editorial?.importance || 'unconfirmed',
      importanceReason:editorial?.reason,
      description:editorial?.description,
      source:editorial && (item.mazeId ? 'https://www.tvmaze.com/episodes/' + item.mazeId : 'https://api.tvmaze.com/shows/' + mazeId + '/episodes'),
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
        synopsis.append(make('summary',null,'Описание серии · возможны спойлеры'),make('p',null,text.description),
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
    const facts = make('p','eyebrow hero-facts');
    heading.append(facts);
    const rating = ratings(show,seriesMetadata.imdbRating(show),'series','Сериал');
    rating.classList.add('hero-ratings');
    const actions = make('div','hero-actions');
    const watchLink = link(undefined,'#','filled');
    const episodesLink = link('Все эпизоды','#','tonal');
    actions.append(watchLink,episodesLink);
    if (episodeStatus) actions.append(episodeStatus);
    copy.append(heading,rating);
    const description = make('div','hero-description');
    const synopsis = make('p','synopsis');
    const synopsisLanguage = preferences.synopsisLanguage;
    synopsis.lang = synopsisLanguage;
    const attribution = make('p','muted synopsis-source');
    description.append(synopsis,attribution);
    copy.append(description);
    const resumeInfo = make('p','muted hero-resume');
    copy.append(actions,resumeInfo);
    const artwork = make('div','hero-poster');
    let renderedImage;
    function updateArtwork() {
      const addresses = showPosterSources(show);
      const signature = addresses.join('\n');
      if (signature === renderedImage) return;
      renderedImage = signature;
      artwork.style.removeProperty('--poster-art');
      const image = make('img','poster');
      image.alt = 'Постер сериала «' + show.title + '»';
      image.width = 620;
      image.height = 930;
      image.fetchPriority = 'high';
      artwork.replaceChildren(image);
      image.onload = () => {
        if (artwork.firstElementChild === image) {
          artwork.style.setProperty('--poster-art','url(' + JSON.stringify(image.currentSrc || image.src) + ')');
        }
      };
      loadPoster(image,addresses,() => {
        if (artwork.firstElementChild === image) artwork.replaceChildren(make('div','library-poster',show.title));
      });
    }
    hero.append(copy,artwork);

    const section = make('section','home-library');
    const sectionTitle = make('div','section-title');
    sectionTitle.append(make('h2',null,'Выбрать сезон'));
    const tiles = make('div','season-tiles');
    function updateOverview() {
      const first = show.episodes?.[0];
      const last = resume(show);
      const firstSeason = first?.season || seasonsFor(show)[0];
      const opening = last || first || {season:firstSeason,episode:1};
      const availability = episodeAvailability(rankedRecords.get(show.id),opening);
      episodesLink.hidden = !firstSeason;
      watchLink.hidden = !firstSeason || availability && availability !== 'AVAILABLE';
      if (firstSeason) {
        watchLink.textContent = last ? '▶ Продолжить просмотр' : '▶ Открыть первую серию';
        watchLink.href = watchPath(show,last || first || {season:firstSeason,episode:1});
        episodesLink.href = seasonPath(show,last?.season || firstSeason);
      }
      resumeInfo.textContent = last ? formatEpisode(last) + ' · ' + playbackTime(last.time) : caption(show,false);
      updateArtwork();
      updateShowDetails();
      tiles.replaceChildren(...seasonsFor(show).map(season => {
        const tile = link(undefined,seasonPath(show,season),'season-tile');
        const count = show.episodes?.filter(item => item.season === season).length;
        tile.setAttribute('aria-label','Сезон ' + season + (count ? ' · ' + count + ' серий' : ''));
        tile.append(make('strong',null,String(season).padStart(2,'0')),make('small',null,count ? 'Сезон · ' + count : 'Сезон'));
        return tile;
      }));
      section.hidden = !tiles.childElementCount;
    }
    section.append(sectionTitle,tiles);
    const status = make('p','muted',show.sessionOnly ? 'Сериал добавлен до закрытия вкладки. Браузер не сохранил каталог.' : '');
    status.setAttribute('role','status');
    function updateShowDetails() {
      renderTitle();
      const details = seriesMetadata.details(show,synopsisLanguage);
      const ageText = 'Возрастной рейтинг ' + (details.ageRating || 'не указан');
      const age = details.ageRatingSource ? external(ageText,details.ageRatingSource) : ageText;
      const info = [showYears(show),details.genres.join(', ')].filter(Boolean).join(' · ');
      facts.replaceChildren(...(info ? [info,' · '] : []),age);
      synopsis.textContent = details.description.text || (synopsisLanguage === 'en'
        ? 'Synopsis unavailable.' : 'Сюжетное описание пока недоступно.');
      attribution.replaceChildren();
      if (details.description.source) attribution.append(external(details.description.label,details.description.source));
      else if (details.description.label) attribution.textContent = details.description.label;
      attribution.hidden = !attribution.textContent;
      return details.description.text;
    }
    let descriptionRequest;
    let descriptionRequested = false;
    function refreshSynopsis() {
      const currentSynopsis = updateShowDetails();
      if (descriptionRequest || (descriptionRequested && currentSynopsis)) return;
      descriptionRequested = true;
      descriptionRequest = seriesMetadata.loadSynopsis(show,synopsisLanguage,metadataSession.signal,updateShowDetails)
        .catch(() => {}).finally(() => { descriptionRequest = null; });
    }
    updateOverview();
    $('series').replaceChildren(hero,section,status);
    hydrate(show,refreshSynopsis,status);
    refreshSynopsis();
    void seriesMetadata.loadImdbRating(show,metadataSession.signal,() => {
      setPublicRating(rating,seriesMetadata.imdbRating(show));
    }).catch(() => {});
    return updateOverview;
  }
  function seasonsFor(show) {
    const loaded = (show.episodes || []).map(item => item.season);
    const available = !show.episodes || show.partialCatalog ? seasonIndexes.get(show.id) || [] : [];
    return [...new Set([...loaded,...available])].sort((a,b) => a-b);
  }
  function renderSeason(show,season,loading) {
    const section = make('section','library-catalog');
    const seriesLink = link(seriesDisplayTitle(show),showPath(show),'muted series-back');
    const tabs = make('div','segments library-season-tabs');
    tabs.setAttribute('aria-label','Выбор сезона');
    function updateTabs() {
      const numbers = [...new Set([0,season,...seasonsFor(show)])].sort((a,b) => a-b);
      tabs.replaceChildren(...numbers.map(number => {
        const tab = link(number ? number + ' сезон' : 'Все',seasonPath(show,number),'tonal');
        if (number === season) tab.setAttribute('aria-current','page');
        return tab;
      }));
      const selected = tabs.querySelector('[aria-current]').getBoundingClientRect();
      const viewport = tabs.getBoundingClientRect();
      tabs.scrollLeft += Math.max(0,selected.right - viewport.right) + Math.min(0,selected.left - viewport.left);
    }
    const available = show.episodes || [];
    const episodes = season ? available.filter(item => item.season === season) : available;
    section.append(seriesLink,make('h1','page-title','Эпизоды'),make('p','eyebrow catalog-facts',caption(show,false)));
    const last = available.length && resume(show);
    if (last) section.append(link('Продолжить просмотр · ' + last.season + '×' + last.episode + ' · ' + playbackTime(last.time),
      watchPath(show,last),'resume-action tonal'));
    if (season) {
      const scores = episodes.map(item => item.imdb?.score).filter(Number.isFinite);
      const average = scores.length && show.imdb?.id ? {id:show.imdb.id,score:scores.reduce((a,b) => a + b,0) / scores.length,suffix:'episodes/?season=' + season} : null;
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
    const query = make('input','ym-disable-keys');
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
    toggleMarks.textContent = preferences.hideImportance ? 'Показать пометки' : 'Скрыть пометки';
    filters.append(search,importantLabel,unreadLabel,toggleMarks);
    toolbar.append(tabs,filters);
    if (loading) {
      query.disabled = important.disabled = unread.disabled = toggleMarks.disabled = true;
      section.append(toolbar,loading);
      $('series').replaceChildren(section);
      updateTabs();
      return updateTabs;
    }
    toggleMarks.onclick = () => { preferences.hideImportance = !preferences.hideImportance; persist(); update(); };
    const count = make('p','muted');
    count.setAttribute('role','status');
    const list = make('div','episodes');
    const pageSize = 48;
    let visibleLimit = pageSize;
    const more = make('button','tonal episode-list-more','Показать ещё серии');
    const nextSeason = make('button','tonal episode-season-more','Загрузить следующий сезон');
    const nextSeasonStatus = make('p','muted');
    nextSeasonStatus.setAttribute('role','status');
    const progressive = !season && show.partialCatalog;
    let seasonLoadFailed = false;
    const unloadedSeason = () => {
      const loaded = new Set(episodes.map(item => item.season));
      return seasonsFor(show).find(number => !loaded.has(number));
    };
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
        return (!unread.checked || !record?.completed) && (!important.checked || ['key','important'].includes(importance(show,item).importance)) &&
          (!term || [item.episode,item.season+'×'+item.episode,item.season+'x'+item.episode,item.title,
            seriesMetadata.episode(show,item).title].some(value => normalize(value).includes(term)));
      });
      const visible = rows.slice(0,visibleLimit);
      more.hidden = rows.length <= visible.length;
      count.textContent = more.hidden ? rows.length + ' из ' + episodes.length : 'Показано ' + visible.length + ' из ' + rows.length;
      list.replaceChildren(...(visible.length ? visible.map(item => {
        const info = importance(show,item);
        const metadata = seriesMetadata.episode(show,item);
        return episodeCard({...item,description:info.description || (preferences.spoilers ? metadata.description : '')},{
          href:watchPath(show,item),title:metadata.title,record:viewed[episodeKey(item)] || {},
          current:selectedEpisodes.get(show.id) === episodeKey(item),importance:info.importance,
          onDetails:() => showEpisodeDetails(show,item,update)
        });
      }) : episodes.length ? [make('p','empty','Серии не найдены. Измени поиск или фильтры.')] : []));
      return visible;
    };
    const runFilter = () => { visibleLimit = pageSize; update(); };
    query.oninput = runFilter;
    unread.onchange = runFilter;
    important.onchange = runFilter;
    more.onclick = () => {
      const previousLimit = visibleLimit;
      visibleLimit += pageSize;
      const added = update().slice(previousLimit);
      void seriesMetadata.loadEpisodeTitles(show,added,metadataSession.signal,update).catch(() => {});
    };
    async function loadNextSeason() {
      const number = unloadedSeason();
      if (!number || nextSeason.disabled) return;
      const original = shows.get(show.id) || searchPreviews.get(show.id);
      const signal = metadataSession.signal;
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal.addEventListener('abort',abort,{once:true});
      const timer = setTimeout(abort,15000);
      nextSeason.disabled = true;
      let fetched = false;
      nextSeasonStatus.textContent = 'Загружаем сезон ' + number + '…';
      try {
        const stored = partialSeasons.get(original)?.get(number) ||
          cachedEpisodes(catalogKey(original) + ':season:' + number).episodes;
        fetched = !stored;
        const added = stored || (await fetchEpisodes(original,controller.signal,{
          preferredSeason:number,seasonOnly:true,onSeasons:() => {}
        })).episodes;
        if (signal.aborted) return;
        if (fetched) metricaGoal('season_load_success');
        seasonLoadFailed = false;
        rememberSeason(original,number,added);
        visibleLimit += pageSize;
        episodes.push(...added);
        episodes.sort((a,b) => a.season - b.season || a.episode - b.episode);
        if (episodes.length === added.length) visibleLimit = pageSize;
        const visible = update().filter(item => item.season === number);
        void seriesMetadata.loadEpisodeTitles(show,visible,signal,update).catch(() => {});
        nextSeason.hidden = !unloadedSeason();
        nextSeasonStatus.textContent = 'Загружено сезонов · ' + new Set(episodes.map(item => item.season)).size + ' из ' + seasonsFor(show).length;
      } catch {
        if (!signal.aborted) {
          if (fetched) metricaGoal('season_load_error');
          seasonLoadFailed = true;
          nextSeasonStatus.textContent = 'Не удалось загрузить сезон ' + number + '. Можно повторить или выбрать другой сезон.';
        }
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort',abort);
        nextSeason.disabled = false;
      }
    }
    update();
    section.append(toolbar,count,...(translate ? [translate] : []),status,list,more);
    if (progressive) {
      nextSeason.hidden = !unloadedSeason();
      nextSeason.onclick = loadNextSeason;
      section.append(nextSeason,nextSeasonStatus);
      if (!episodes.length) void loadNextSeason();
    }
    const episodeSource = episodes.find(item => item.source?.startsWith('https://en.wikipedia.org/wiki/'))?.source;
    if (episodeSource) section.append(external('Список эпизодов · Википедия',episodeSource));
    $('series').replaceChildren(section);
    updateTabs();
    if (!season) {
      let previousY = window.scrollY;
      window.addEventListener('scroll',() => {
        const y = window.scrollY;
        const movedDown = y > previousY;
        previousY = y;
        const viewport = document.scrollingElement;
        if (!movedDown || !viewport || y + viewport.clientHeight < viewport.scrollHeight - 2) return;
        if (!more.hidden) more.click();
        else if (progressive && !seasonLoadFailed && !nextSeason.hidden) nextSeason.click();
      },{passive:true,signal:metadataSession.signal});
    }
    const initial = episodes.slice(0,pageSize);
    hydrate(show,update,status,initial);
    void seriesMetadata.translateIfReady(show,initial,metadataSession.signal,update,true);
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
    const sourceBox = make('dialog','sheet library-source ym-hide-content');
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
    const catalogRecord = rankedRecords.get(show.id);
    const legacySources = !catalogRecord || alreadyInLibrary.has(show.id);
    const nativeAvailable = legacySources && canResolveSeriesNative(show);
    function verifiedSources() {
      const configured = integrationSettings.seriesSources[show.id] ||
        (catalogRecord && integrationSettings.seriesSources[catalogRecordId(catalogRecord)]);
      if (!configured) return {};
      const verified = catalogRecord?.confirmedProviders?.[itemId] || [];
      const address = mediaAddress(configured.video,item.season,item.episode);
      const official = configured.officialEpisodes?.[itemId];
      const embed = verified.includes('official') && /^[a-zA-Z0-9_-]{11}$/.test(official?.youtube || '')
        ? 'https://www.youtube-nocookie.com/embed/' + official.youtube : '';
      return {
        ...(embed && isIntegrationUrl(embed,'frame') ? {'verified-official':{embed}} : {}),
        ...(configured.authorization && verified.includes('video') && isIntegrationUrl(address,'media') ? {'verified-video':{address}} : {}),
        ...(configured.authorization && verified.includes('manifest') && configured.manifest ? {'verified-manifest':{manifest:configured.manifest}} : {})
      };
    }
    const attachedFile = () => localEpisodeFolders.get(show.id)?.get(itemId);
    const fileInput = make('input','ym-disable-keys');
    fileInput.type = 'file';
    fileInput.accept = 'video/*,.mp4,.webm';
    fileInput.hidden = true;
    const folderInput = make('input','ym-disable-keys');
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
      const input = make('input','ym-disable-keys');
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
      const player = createCinemaPlayer(video,{
        title:formatEpisode(item),rate:preferences.rate,volume:preferences.volume,
        onRate(value) { preferences.rate = value; persist(); }
      });
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
      list.push(...Object.keys(verifiedSources()));
      if (legacySources && seriesSource(show,item,saved,'video')) list.push('video');
      if (nativeAvailable) list.push('native');
      if (legacySources && stremioSource() && canUseStremio(show)) list.push('stremio');
      if (legacySources && episodeEndpoint()) list.push('endpoint');
      if (legacySources && seriesSource(show,item,saved,'alloha')) list.push('alloha');
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
      const verified = verifiedSources()[id];
      if (verified?.embed) {
        openOfficial(verified.embed,time,next);
        return;
      }
      void openProvider(verified ? 'video' : id,verified,time,{next});
    }
    function openOfficial(address,time,next) {
      pending?.abort();
      pending = null;
      release?.();
      if (sourceBox.open) sourceBox.close();
      const url = new URL(address);
      url.search = new URLSearchParams({enablejsapi:'1',autoplay:'1',origin:location.origin});
      if (Number.isFinite(time) && time > 0) url.searchParams.set('start',String(Math.floor(time)));
      const frame = createExternalVideoFrame(url.href,'Официальный плеер YouTube');
      let closed = false;
      const receive = event => {
        if (event.origin !== url.origin || event.source !== frame.contentWindow) return;
        let message;
        try { message = JSON.parse(event.data); } catch { return; }
        if (message.event === 'onError') {
          fail();
          return;
        }
        if (message.event === 'onReady' || Number.isFinite(message.info?.playerState)) {
          clearTimeout(timer);
          clearInterval(connectTimer);
        }
      };
      const timer = setTimeout(fail,15000);
      const subscribe = () => {
        frame.contentWindow?.postMessage(JSON.stringify({event:'listening',id:1,channel:'widget'}),url.origin);
        frame.contentWindow?.postMessage(JSON.stringify({event:'command',func:'addEventListener',args:['onError']}),url.origin);
      };
      const connectTimer = setInterval(subscribe,500);
      function fail() {
        if (closed) return;
        release?.();
        release = null;
        if (next) next(time);
        else playbackUnavailable('Официальный плеер не ответил.');
      }
      release = () => {
        closed = true;
        clearTimeout(timer);
        clearInterval(connectTimer);
        window.removeEventListener('message',receive);
        frame.remove();
      };
      frame.addEventListener('load',subscribe,{once:true});
      frame.addEventListener('error',fail,{once:true});
      window.addEventListener('message',receive);
      status.textContent = 'Официальная публикация · YouTube';
      screen.replaceChildren(frame);
    }
    function updateControls() {
      const viewed = readLocal(historyKeyFor(show))[itemId];
      restart.hidden = viewed?.completed || !(viewed?.time > 0);
      const canPlay = candidateSources().length > 0;
      preferred.hidden = !canPlay;
      restart.hidden ||= !canPlay;
      if (!canPlay && catalogRecord && !status.textContent) status.textContent =
        availabilityLabels[episodeAvailability(catalogRecord,item)] || 'Видео для этой серии пока недоступно.';
      const known = !catalogRecord || episodeAvailability(catalogRecord,item) === 'AVAILABLE' || attachedFile();
      preferred.textContent = !known ? 'Проверить источник' :
        !restart.hidden ? 'Продолжить с ' + playbackTime(viewed.time) : '▶ Смотреть';
      endpointButton.hidden = !legacySources || !episodeEndpoint();
      stremioButton.hidden = !legacySources || !stremioSource() || !canUseStremio(show);
      defaultNativeButton.hidden = !nativeAvailable;
      connectedFolder.hidden = !attachedFile();
      for (const [id,control] of [['video',nativeButton],['alloha',allohaButton]]) {
        control.hidden = !(legacySources && seriesSource(show,item,saved,id) ||
          id === 'video' && Object.keys(verifiedSources()).length);
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
    status.textContent = availabilityLabels[episodeAvailability(catalogRecord,item)] || 'Наш плеер';
    const nativeButton = make('button','tonal',verifiedSources()['verified-official'] ? 'Официальный плеер' : 'Моё видео');
    const defaultNativeButton = make('button','tonal','Наш плеер');
    const allohaButton = make('button','tonal','Alloha');
    const endpointButton = make('button','tonal','Общий источник');
    const stremioButton = make('button','tonal','Stremio');
    const chooseFile = make('button','tonal','Выбрать файл');
    const chooseFolder = make('button','tonal','Подключить папку');
    chooseFolder.hidden = !supportsFolder;
    const connectedFolder = make('button','tonal','Открыть серию из папки');
    const sourceActions = make('div','source-form library-source-actions');
    nativeButton.onclick = () => {
      const verified = Object.keys(verifiedSources());
      if (verified.length) openAutomatic(verified);
      else if (legacySources) void openProvider('video');
    };
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
      let next = show.episodes[index + offset];
      if (!next && offset === 1 && show.partialCatalog && seasonsFor(show).includes(item.season + 1)) {
        next = {season:item.season+1,episode:1};
      }
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
      plot.querySelector('summary').firstChild.textContent = russian ? 'Сюжет и развязка ' : 'Описание серии ';
      plotContent.replaceChildren();
      if (metadata.description) plotContent.append(make('p',null,metadata.description),make('p','muted',metadata.source));
      const marked = !preferences.hideImportance && ['key','important'].includes(info.importance);
      detailsButton.textContent = marked ? importanceLabels[info.importance] : 'О серии';
      detailsButton.className = marked ? 'importance-button ' + info.importance : 'tonal';
    }
    updateMetadata();
    const rating = item.imdb && ratingBadge('IMDb',item.imdb,imdbLink(item.imdb));
    if (rating) get('episode-ratings').append(rating);
    setPersonalRatingButton(get('rate-episode'),{id:'episode:' + itemId,label:show.title + ' · ' + formatEpisode(item)},show.id);
    if (translate) description.append(translate);
    description.append(metadataStatus);
    panel.replaceChildren(fragment,sourceBox);
    const previewTimer = setTimeout(() => preview.abort(),9000);
    if (legacySources) previewEpisodeVoices(show,item,preview.signal,items => {
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
  function posterPalette(url) {
    // Remote artwork can display without granting canvas access.
    if (typeof url !== 'string' || !url.startsWith('assets/')) return Promise.resolve(null);
    if (posterColors.has(url)) return posterColors.get(url);
    const sample = new Promise(resolve => {
      const image = new Image();
      const timer = setTimeout(() => resolve(null),6000);
      function done(palette) { clearTimeout(timer); resolve(palette); }
      image.onerror = () => done(null);
      image.onload = () => {
        try {
          const canvas = make('canvas');
          canvas.width = canvas.height = 20;
          const context = canvas.getContext('2d',{willReadFrequently:true});
          context.drawImage(image,0,0,20,20);
          const pixels = context.getImageData(0,0,20,20).data;
          const weights = new Array(12).fill(0);
          const saturation = new Array(12).fill(0);
          for (let i=0; i<pixels.length; i+=4) {
            const [r,g,b] = pixels.subarray(i,i+3);
            const max = Math.max(r,g,b);
            const min = Math.min(r,g,b);
            const delta = max - min;
            if (pixels[i+3] < 200 || delta < 26 || max < 58) continue;
            const sector = max === r ? (g-b)/delta : max === g ? (b-r)/delta + 2 : (r-g)/delta + 4;
            const bin = Math.round(sector * 2 + 12) % 12;
            const weight = delta ** 2.4 * (255 - min) / 255;
            weights[bin] += weight;
            saturation[bin] += weight * delta / 255;
          }
          const best = Math.max(...weights);
          const bin = weights.indexOf(best);
          done(best ? {hue:[28,58,91,120,142,164,191,219,255,280,326,353][bin],
            chroma:.08 + .12 * saturation[bin] / best} : null);
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
      applyTheme();
    } else {
      root.dataset.series = show.id;
      applyShowPalette(show,(hue,chroma) => {
        if (root.dataset.series !== show.id) return;
        setShowPalette(root,hue,chroma);
        applyTheme();
      });
    }
  }
  function render(route) {
    metricaPage(route);
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
      let updateOverview;
      let updateTabs;
      if (route.overview) updateOverview = renderShow(route.show,loading);
      else if (route.season != null) updateTabs = renderSeason(route.show,route.season,loading);
      else panel.replaceChildren(make('h1','page-title',seriesDisplayTitle(route.show)),loading);
      const signal = metadataSession.signal;
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal.addEventListener('abort',abort,{once:true});
      let failed = false;
      function showFailure() {
        if (signal.aborted || failed) return;
        failed = true;
        if (route.season != null) metricaGoal('season_load_error');
        loading.textContent = 'Не удалось загрузить эпизоды. Попробуй ещё раз.';
        const retry = make('button','tonal episode-load-retry','Повторить');
        retry.onclick = renderCurrentRoute;
        loading.after(retry);
      }
      const timer = setTimeout(() => { abort(); showFailure(); },20000);
      void fetchEpisodes(route.show,controller.signal,{
        preferredSeason:route.requestedSeason,
        directoryOnly:route.overview || route.allSeasons,
        onSeasons:(loaded,total,seasons) => {
          if (controller.signal.aborted) return;
          const previous = seasonIndexes.get(route.show.id) || [];
          const numbered = seasons.some(number => number < 1900);
          const merged = [...new Set([...previous,...seasons])].filter(number =>
            !(numbered || previous.some(item => item < 1900)) || number < 1900);
          seasonIndexes.set(route.show.id,merged);
          if (merged.join() !== previous.join()) {
            updateOverview?.();
            updateTabs?.();
          }
          if (total > 1) loading.textContent = 'Загружаем сезоны · ' + loaded + ' из ' + total;
        }
      }).then(({episodes,partialSeason,directoryLoaded}) => {
        if (controller.signal.aborted) return;
        if (route.requestedSeason && route.season != null) metricaGoal('season_load_success');
        if (directoryLoaded) {
          directoryCatalogs.add(route.show);
          loading.hidden = true;
          updateOverview?.();
          abort();
          if (route.allSeasons) renderCurrentRoute();
          return;
        }
        if (partialSeason) {
          rememberSeason(route.show,partialSeason,episodes);
        } else {
          route.show.episodes = episodes;
          if (imported.includes(route.show)) persistImports(imported);
        }
        if (updateOverview) {
          loading.hidden = true;
          updateOverview();
          for (const link of document.querySelectorAll('.navigation a')) navigation(link,route);
        } else renderCurrentRoute();
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
      const updateOverview = renderShow(route.show);
      if (refreshEpisodeLists.delete(route.show)) {
        const signal = metadataSession.signal;
        void fetchEpisodes(route.show,signal).then(({episodes}) => {
          if (signal.aborted || episodes.length < route.show.episodes.length) return;
          route.show.episodes = episodes;
          updateOverview();
          for (const link of document.querySelectorAll('.navigation a')) navigation(link,route);
        }).catch(() => {});
      }
    }
  }
  return {match,selectRoute,navigation,back,render,openActiveSources};
}

export {createSeriesLibrary};
