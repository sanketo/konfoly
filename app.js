const $ = id => document.getElementById(id);
const counts = [23,23,24,24,22,22,13];
const settingsKey = 'mentalist-personal-v1';
const historyKey = 'mentalist-history-v2';
const saved = readLocal(settingsKey);
const viewing = readLocal(historyKey);
const previousView = readPlaybackMemory().last;
if (previousView && !viewing[episodeId(previousView.season, previousView.episode)]) {
  viewing[episodeId(previousView.season, previousView.episode)] = previousView;
}
const episodeById = new Map(episodeCatalog.map(item => [episodeId(item.season,item.episode),item]));
let current = episodeById.get(episodeId(saved.season,saved.episode)) || episodeCatalog[0];
let catalogSeason = current.season;
let page = 'home';
let telegramSync;
let media, releaseMedia, fileUrl, request, pendingPosition = 0, editEpisode;
const preferences = {
  theme:['auto','dark','light'].includes(saved.theme) ? saved.theme : 'auto',
  newYear: saved.newYear === true,
  spoilers: saved.spoilers === true,
  hideImportance: saved.hideImportance === true,
  sources:saved.sources || {},
  template:saved.template || null,
  alloha:typeof saved.alloha === 'string' ? saved.alloha : '',
  importance:saved.importance || {},
  selected:mediaProviders.some(provider => provider.id === saved.selected) ? saved.selected : 'native',
  voice:['ТВ3','Universal Russia','TVShows'].includes(saved.voice) ? saved.voice : 'ТВ3',
  quality:saved.quality === 'hd' ? 'hd' : 'fullhd',
  rate:[.75,1,1.25,1.5,1.75,2].includes(saved.rate) ? saved.rate : 1,
  volume:typeof saved.volume === 'number' && saved.volume >= 0 && saved.volume <= 1 ? saved.volume : 1
};

function readLocal(key) {
  try { return JSON.parse(localStorage.getItem(key)) || {}; } catch { return {}; }
}
function writeLocal(key,value) {
  try { localStorage.setItem(key,JSON.stringify(value)); } catch {}
}
function episodeId(season,episode) { return season + ':' + episode; }
function key(item) { return episodeId(item.season,item.episode); }
function episodeHash(item) { return '#watch/' + item.season + '/' + item.episode; }
function persist() {
  writeLocal(settingsKey,{...saved,...preferences,season:current.season,episode:current.episode});
}
function saveViewing(entry) {
  entry = { ...entry, updatedAt:entry.updatedAt || Date.now() };
  Object.assign(viewing,readLocal(historyKey));
  viewing[episodeId(entry.season, entry.episode)] = entry;
  writeLocal(historyKey,viewing);
  telegramSync?.queue(entry);
}
function historyFor(item) { return viewing[key(item)] || {}; }
function latestView() {
  const last = readPlaybackMemory().last;
  if (last && !last.completed && episodeById.has(episodeId(last.season,last.episode))) return last;
  if (!last) return null;
  const completed = episodeById.get(episodeId(last.season,last.episode));
  const combinedFinale = last.season === 3 && last.episode === 23 && last.source === 'native' && last.voice === 'ТВ3';
  const next = completed && episodeCatalog[episodeCatalog.indexOf(completed) + (combinedFinale ? 2 : 1)];
  return next ? {...next,time:0} : null;
}
function setSelectValue(id,value) {
  $(id).value = value;
  window.refreshKinosalSelect?.(id);
}
function make(tag, className, content) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content !== undefined) element.textContent = content;
  return element;
}
function chooseRoute() {
  const hash = location.hash.slice(1);
  const match = /^watch\/(\d+)\/(\d+)$/.exec(hash);
  const start = /^s(\d+)e(\d+)$/.exec(platform.start || '');
  const route = match || (hash.startsWith('tgWebApp') || !hash ? start : null);
  const item = route && episodeById.get(episodeId(route[1],route[2]));
  return { page:item || hash === 'watch' ? 'watch' : ['catalog','settings'].includes(hash) ? hash : 'home', item };
}
function route() {
  const next = chooseRoute();
  const switchedPage = next.page !== page;
  const changedEpisode = next.item && key(next.item) !== key(current);
  if (next.page !== page || changedEpisode) clearMedia();
  if (next.page !== 'watch' && document.fullscreenElement === $('screen')) document.exitFullscreen().catch(()=>{});
  if (changedEpisode) pendingPosition = 0;
  if (next.item) current = next.item;
  page = next.page;
  window.konfolyMetricaPage?.(page);
  for (const panel of document.querySelectorAll('.page')) {
    panel.hidden = panel.id !== page;
    if (switchedPage && !panel.hidden) panel.animate?.(
      [{opacity:.55,transform:'translateY(9px)'},{opacity:1,transform:'translateY(-1px)',offset:.75},{opacity:1,transform:'none'}],
      {duration:matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 330,easing:'cubic-bezier(.22,1,.36,1)'});
  }
  for (const link of document.querySelectorAll('.navigation a')) {
    if (link.hash === '#' + page) link.setAttribute('aria-current','page');
    else link.removeAttribute('aria-current');
  }
  platform.showBack(page !== 'home');
  if (page === 'catalog') renderCatalog();
  if (page === 'watch') renderWatch();

  refreshHome();
  persist();
  window.scrollTo(0,0);
}
function openEpisode(item, time = 0) {
  clearMedia();
  current = item;
  pendingPosition = time;
  history.pushState(null,'',episodeHash(item));
  route();

}
function refreshHome() {
  const last = latestView();
  $('continue-button').textContent = last ? '▶ Продолжить просмотр' : '▶ Открыть плеер';
  $('continue-info').textContent = last
    ? 'Сезон ' + last.season + ' · Серия ' + last.episode + ' · ' + playbackTime(last.time)
    : '7 сезонов · 151 серия';
  for (const id of ['watch-continue','catalog-continue']) {
    $(id).hidden = !last;
    if (last) $(id).textContent = 'Продолжить просмотр · ' + last.season + '×' + last.episode + ' · ' + playbackTime(last.time);
  }
}
function continueViewing() {
  const last = latestView();
  if (last && ['native','file','custom'].includes(last.source)) preferences.selected = last.source;
  if (last && ['ТВ3','Universal Russia','TVShows'].includes(last.voice)) preferences.voice = last.voice;
  openEpisode(last ? episodeById.get(episodeId(last.season,last.episode)) : current,last?.time || 0);
  if (last && preferences.selected !== 'file') startPlayback();
}
$('continue-button').onclick = continueViewing;
$('watch-continue').onclick = continueViewing;
$('catalog-continue').onclick = continueViewing;
function seasonButtons() {
  const tiles = counts.map((count,index) => {
    const button = make('button','season-tile');
    button.append(make('strong',null,String(index + 1).padStart(2,'0')),make('small',null,'Сезон · ' + count));
    button.onclick = () => { catalogSeason = index + 1; location.hash = 'catalog'; platform.tap(); };
    return button;
  });
  $('home-seasons').replaceChildren(...tiles);
}
function classification(item) {
  const base = importanceCatalog[key(item)];
  const override = preferences.importance[key(item)];
  return {
    importance:override || base?.importance || 'unconfirmed',
    importanceReason:base?.importanceReason,
    source:base?.source,
    confidence:override ? 'manual' : base?.confidence || 'unknown'
  };
}
function renderCatalog() {
  const oldScroll = $('seasons').scrollLeft;
  $('seasons').replaceChildren(...Array.from({length:8},(_,season) => {
    const button = make('button',null,season ? season + ' сезон' : 'Все');
    button.setAttribute('aria-pressed',season === catalogSeason);
    button.onclick = () => { catalogSeason = season; renderCatalog(); platform.tap(); };
    return button;
  }));
  $('seasons').scrollLeft = oldScroll;
  renderSeasonRatings(catalogSeason);
  $('toggle-important').setAttribute('aria-pressed',preferences.hideImportance);
  $('toggle-important').textContent = preferences.hideImportance ? 'Показать пометки' : 'Скрыть пометки';
  const normalizeSearch = value => String(value).toLocaleLowerCase('ru-RU').replaceAll('ё','е');
  const search = normalizeSearch($('search').value.trim());
  const importantOnly = $('important-filter').checked;
  const unwatchedOnly = $('unwatched-filter').checked;
  const rows = episodeCatalog.filter(item => {
    const searchable = [item.episode,item.season + 'x' + item.episode,item.season + '×' + item.episode,'серия ' + item.episode];
    const title = visibleTitle(item);
    searchable.push(title,title && item.title,item.description);
    return (!catalogSeason || item.season === catalogSeason) &&
      (!search || searchable.some(value => normalizeSearch(value).includes(search))) &&
      (!importantOnly || ['key','important'].includes(classification(item).importance)) &&
      (!unwatchedOnly || !historyFor(item).completed);
  });
  $('results').textContent = rows.length + ' из ' + (counts[catalogSeason-1] || episodeCatalog.length);
  $('episodes').replaceChildren(...(rows.length ? rows.map(episodeCard) : [make('p','empty','Серии не найдены. Измени поиск или фильтры.')]));
}
function visibleTitle(item) {
  if (!preferences.spoilers && key(item) === '6:8') return '';
  return episodeTitlesRu[item.season - 1]?.[item.episode - 1] || item.title;
}
function episodeCard(item) {
  const card = make('article','episode-card');
  const link = make('a','episode-open');
  link.href = episodeHash(item);
  link.setAttribute('aria-label','Открыть сезон ' + item.season + ', серия ' + item.episode);
  if (key(item) === key(current)) link.setAttribute('aria-current','true');
  const image = make('img','episode-image');
  image.src = item.image;
  image.alt = '';
  image.loading = 'lazy';
  image.decoding = 'async';
  image.onerror = () => image.replaceWith(make('div','episode-placeholder',String(item.episode).padStart(2,'0')));
  link.append(image);
  const copy = make('div','episode-copy');
  const record = historyFor(item);
  copy.append(make('strong',null,'С' + item.season + ' · Серия ' + item.episode));
  const name = visibleTitle(item);
  copy.append(make('h2','episode-name',name || 'Название скрыто'));
  if (item.description) copy.append(make('p','episode-summary',item.description));
  const time = record.duration > 0 ? Math.round(record.duration/60) + ' мин' : '≈ 43 мин';
  copy.append(make('p','episode-duration',time + (record.completed ? ' · Просмотрено' : record.time > 0 ? ' · ' + playbackTime(record.time) : '')));
  if (record.duration > 0 && (record.time > 0 || record.completed)) {
    const progress = make('progress');
    progress.max = record.duration;
    progress.value = record.completed ? record.duration : record.time;
    progress.setAttribute('aria-label','Прогресс серии');
    copy.append(progress);
  }
  link.append(copy);
  const meta = make('div','episode-meta');
  const importance = classification(item).importance;
  const button = make('button','importance-button ' + importance,['key','important'].includes(importance) ? importanceLabels[importance] : 'О серии');
  button.onclick = () => showImportance(item);
  if (!preferences.hideImportance) meta.append(button);
  const rating = ratingBadge('IMDb',externalRatingData.episodes[key(item)]);
  if (rating) meta.append(rating);
  card.append(link,meta);
  return card;
}
$('toggle-important').onclick = () => {
  preferences.hideImportance = !preferences.hideImportance;
  persist();
  renderCatalog();
};
for (const id of ['search','important-filter','unwatched-filter']) $(id).addEventListener('input',renderCatalog);
function showImportance(item) {
  editEpisode = item;
  setSelectValue('importance-override',preferences.importance[key(item)] || '');
  renderImportance(preferences.spoilers);
  openSheet('details-dialog');
}
function renderImportance(reveal) {
  const info = classification(editEpisode);
  const details = $('importance-details');
  const confidence = {high:'Высокая',medium:'Средняя',unknown:'Недостаточно данных',manual:'Ручная отметка'};
  details.replaceChildren(make('strong',null,importanceLabels[info.importance]),make('p','muted','Уверенность · ' + confidence[info.confidence]));
  if (reveal && info.importanceReason) {
    const source = make('a',null,'Синопсис в TVmaze ↗');
    source.href = info.source;
    source.target = '_blank';
    source.rel = 'noopener noreferrer';
    details.append(make('p',null,info.importanceReason),source);
  }
  $('reveal-details').hidden = reveal || !info.importanceReason;
}
$('reveal-details').onclick = () => renderImportance(true);
$('importance-override').onchange = event => {
  const value = event.target.value;
  if (value) preferences.importance[key(editEpisode)] = value;
  else delete preferences.importance[key(editEpisode)];
  persist();
  renderImportance(preferences.spoilers);
  renderCatalog();
};

function clearMedia() {
  request?.abort();
  request = null;
  releaseMedia?.();
  releaseMedia = null;
  if (media) {
    media.pause();
    media.removeAttribute('src');
    media.load();
    media = null;
  }
  if (fileUrl) URL.revokeObjectURL(fileUrl);
  fileUrl = null;
  $('screen').replaceChildren();
  $('quality-status').textContent = '';
}
function moveEpisode(direction) {
  let index = episodeCatalog.indexOf(current);
  if (preferences.selected === 'native' && preferences.voice === 'ТВ3' && current.season === 3 && current.episode >= 23) {
    index = episodeCatalog.indexOf(episodeById.get(direction > 0 ? '3:24' : '3:23'));
  }
  let item = episodeCatalog[index + direction];
  if (direction < 0 && preferences.selected === 'native' && preferences.voice === 'ТВ3' && key(current) === '4:1') item = episodeById.get('3:23');
  if (item) openEpisode(item);
}
$('previous').onclick = () => moveEpisode(-1);
$('next').onclick = () => moveEpisode(1);
function updateWatched() {
  const completed = historyFor(current).completed;
  $('mark-watched').textContent = completed ? '✓ Просмотрено' : 'Отметить просмотренной';
  $('mark-watched').setAttribute('aria-pressed',Boolean(completed));
}
$('mark-watched').onclick = () => {
  saveViewing({...historyFor(current),season:current.season,episode:current.episode,completed:!historyFor(current).completed});
  updateWatched();
};
const episodeRecaps = {
  '4:11': {
    source:'https://en.wikipedia.org/wiki/The_Mentalist_season_4#Episodes',
    paragraphs:[
      'Адвокат Олтон Крик обращается к команде после угроз. Когда детективы приходят на встречу, его лодка взрывается. Под подозрение попадают деловой партнёр Крика и люди, связанные с его подпольными покерными играми. Чо обращается за помощью к Саммер, которая знала Крика.',
      'Параллельно агент Дарси расследует убийство Панзера. Джейн получает запись слежки за ней и понимает, что Красный Джон посылает ему предупреждение. Дарси отказывается отступить. Чтобы увести её со следа, Джейн подбрасывает улики и подделывает признание Тома Майера, отца первой жертвы Панзера, который к этому моменту уже погиб.',
      'Дело Крика приводит к его коллеге Колетт. Финансовые улики и её реакция на разговор о Саммер выдают мотив. Колетт убила Крика из ревности, и её арестовывают.'
    ]
  }
};
function renderEpisodePlot(item) {
  const plot = $('episode-plot');
  if (plot.dataset.episode !== key(item)) {
    plot.dataset.episode = key(item);
    plot.open = preferences.spoilers;
  }
  const recap = episodeRecaps[key(item)];
  const rating = externalRatingData.episodes[key(item)];
  const content = $('plot-content');
  content.replaceChildren(...(recap ? recap.paragraphs.map(text => make('p',null,text)) :
    [make('p','muted','Подробного пересказа на Konfoly пока нет.')]));
  if (recap || rating) {
    const link = make('a',null,recap ? 'Источник пересказа ↗' : 'Сюжет эпизода на IMDb ↗');
    link.href = recap?.source || 'https://www.imdb.com/title/' + rating.id + '/plotsummary/';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    content.append(link);
  }
}
function renderWatch() {
  const index = episodeCatalog.indexOf(current);
  $('episode-number').textContent = 'СЕЗОН ' + current.season + ' · СЕРИЯ ' + current.episode;
  const title = visibleTitle(current);
  $('episode-title').textContent = title || 'Серия ' + current.episode;
  const original = $('episode-title-original');
  original.hidden = !title || title === current.title;
  original.textContent = original.hidden ? '' : current.title;
  $('episode-description').textContent = current.description || '';
  renderEpisodeRatings(current);
  renderEpisodePlot(current);
  $('share-link').href = episodeHash(current);
  $('share-link').onclick = async event => {
    if (!navigator.clipboard?.writeText) return;
    event.preventDefault();
    try {
      await navigator.clipboard.writeText(new URL(episodeHash(current),location.href).href);
      $('source-status').textContent = 'Ссылка на серию скопирована';
    } catch { $('source-status').textContent = 'Ссылку можно скопировать из адресной строки'; }
  };
  $('previous').disabled = index === 0;
  $('next').disabled = index === episodeCatalog.length-1;
  updateWatched();
  if (!media && !request && !$('screen').querySelector('iframe')) {
    screenAction(pendingPosition > 0 ? 'Продолжить с ' + playbackTime(pendingPosition) : '▶ Смотреть',startPlayback);
    $('source-status').textContent = mediaProviders.find(provider => provider.id === preferences.selected).title;
  }
}
function startPlayback() {
  const choice = preferences.selected;
  if (isMobileCinema() && !document.fullscreenElement && (choice === 'native' ||
    (choice === 'custom' && configuredSource()?.kind === 'video'))) {
    requestCinemaFullscreen($('screen'));
  }
  launch(choice,pendingPosition);
}
function screenAction(title,action,message) {
  const panel = make('div','screen-empty');
  if (message) panel.append(make('p',null,message));
  if (action) {
    const button = make('button','filled',title);
    button.onclick = action;
    panel.append(button);
  }
  $('screen').replaceChildren(panel);
}
function playbackError(message) {
  $('source-status').textContent = message;
  screenAction('Повторить',() => launch(preferences.selected,pendingPosition),message);
  const sources = make('button','tonal','Выбрать источник');
  sources.onclick = () => openSources();
  $('screen').firstElementChild?.append(sources);
}
function mountVideo(url, label, resumeTime, source, metadata = '', recoveryAttempt = 0, combined = false) {
  const item = current;
  const video = make('video');
  media = video;
  video.playsInline = true;
  video.preload = 'metadata';
  video.playbackRate = preferences.rate;
  $('screen').replaceChildren(video);
  $('source-status').textContent = label;
  const ui = createCinemaPlayer(video,{
    title:'Сезон ' + item.season + ' · Серия ' + item.episode,
    rate:preferences.rate,volume:preferences.volume,
    onRate(value){preferences.rate=value;persist()},
    onVolume(value){preferences.volume=value;persist()}
  });
  const stopMemory = bindPlaybackMemory(video,{season:item.season,episode:item.episode,source,combined,voice:source === 'native' ? preferences.voice : null},
    status => {$('source-status').textContent = label + ' · ' + status},{
      resumeTime,onSave(entry){
        saveViewing(entry);
        if (combined && entry.completed) {
          const other = episodeById.get(episodeId(item.season,item.episode === 23 ? 24 : 23));
          if (other && !historyFor(other).completed) saveViewing({...entry,episode:other.episode});
        }
        refreshHome();
        updateWatched();
      }
    });
  const stopKeys = bindVideoKeys(video,document,active=>ui.setBoost(active));

  function updateQuality() {
    const size = video.videoWidth > 0 ? video.videoWidth + ' × ' + video.videoHeight : '';
    $('quality-status').textContent = [size,metadata].filter(Boolean).join(' · ');
  }
  video.addEventListener('loadedmetadata',updateQuality);
  video.addEventListener('resize',updateQuality);
  const stopHealth = watchPlaybackHealth(video,(failure,code) => {
    if (media !== video) return;
    const time = video.currentTime;
    if (Number.isFinite(time) && time > 0) pendingPosition = time;
    const canRecover = source === 'native' && recoveryAttempt === 0 &&
      (failure === 'stall' || code === 2 || (code === 4 && (time > 0 || resumeTime > 0)));
    if (canRecover) {
      launch(source,pendingPosition,1);
      return;
    }
    clearMedia();
    playbackError(failure === 'stall'
      ? 'Поток перестал отвечать. Можно повторить с места остановки или выбрать другой источник.'
      : 'Видео не загрузилось. Проверь сеть, формат или выбери другой источник.');
  });
  releaseMedia = () => {stopHealth();stopMemory();stopKeys();ui.destroy()};
  video.src = url;
  video.play().catch(() => {});
}
function configuredSource() {
  return preferences.sources[key(current)] || preferences.template;
}
async function launch(id,time = 0,recoveryAttempt = 0) {
  if (id === 'file') { pendingPosition = time; $('file').click(); return; }
  if (id === 'custom' && !configuredSource()) { openSources('custom'); return; }
  if (id === 'alloha' && !preferences.alloha) { openSources('alloha'); return; }
  preferences.selected = id;
  pendingPosition = time;
  persist();
  clearMedia();
  if (id === 'native') {
    const controller = new AbortController();
    request = controller;
    const timeout = setTimeout(() => controller.abort(),15000);
    const loading = recoveryAttempt ? 'Восстанавливаем поток с ' + playbackTime(time) + '…' : 'Подключаем видео…';
    screenAction('',null,loading);
    $('source-status').textContent = loading;
    try {
      const result = await resolveNative({...current,voice:preferences.voice,quality:preferences.quality},controller.signal);
      if (request !== controller) return;
      mountVideo(result.url,result.label,time,id,result.metadata,recoveryAttempt,result.combined);
      if (result.combined) $('episode-number').textContent = 'СЕЗОН 3 · ОБЪЕДИНЁННЫЙ ФИНАЛ 23–24';
    } catch (error) {
      if (request === controller) playbackError(controller.signal.aborted ? 'Источник не ответил за 15 секунд.' : error.message);
    } finally {
      clearTimeout(timeout);
      if (request === controller) request = null;
    }
    return;
  }
  const custom = id === 'custom' ? configuredSource() : null;
  const template = custom?.url || (id === 'alloha' ? preferences.alloha : null);
  const url = template ? mediaAddress(template,current.season,current.episode) : embedAddress(id,current.season,current.episode);
  if (!url) { playbackError('Нужен действительный HTTPS-адрес.'); return; }
  if (custom?.kind === 'video') { mountVideo(url,'Свой источник',time,id); return; }
  const frame = make('iframe');
  frame.title = 'Внешний видеоплеер';
  frame.allow = 'autoplay; fullscreen; picture-in-picture';
  frame.allowFullscreen = true;
  frame.referrerPolicy = 'strict-origin-when-cross-origin';
  // Embedded players cannot open ad popups or redirect the top-level page.
  frame.sandbox = 'allow-scripts allow-forms allow-presentation' +
    (new URL(url).origin === location.origin ? '' : ' allow-same-origin');
  $('screen').replaceChildren(frame);
  frame.src = url;
  $('source-status').textContent = 'Внешний плеер · точная позиция и качество недоступны';
}
function openSheet(id) {
  const sheet = $(id);
  if (!sheet.open) sheet.showModal();
  platform.showBack(true);
}
function showSourceForm(id) {
  $('source-form').hidden = id !== 'custom';
  $('alloha-form').hidden = id !== 'alloha';
  if (id === 'custom') $('source-url').focus();
  if (id === 'alloha') $('alloha-url').focus();
}
function openSources(form = null) {
  $('source-form').hidden = form !== 'custom';
  $('alloha-form').hidden = form !== 'alloha';
  $('alloha-url').value = preferences.alloha;
  $('source-error').textContent = '';
  setSelectValue('voice',preferences.voice);
  setSelectValue('quality',preferences.quality);
  const source = configuredSource();
  setSelectValue('source-kind',source?.kind || 'video');
  $('source-url').value = source?.url || '';
  $('provider-list').replaceChildren(...mediaProviders.map(provider => {
    const row = make('div','provider-item');
    row.append(make('strong',null,provider.title + (provider.id === preferences.selected ? ' · выбрано' : '')),make('p','muted',provider.detail));
    const action = make('button','tonal',provider.id === 'alloha' && preferences.alloha ? 'Открыть' : provider.action);
    action.onclick = () => {
      if (provider.id === 'custom' || (provider.id === 'alloha' && !preferences.alloha)) {
        showSourceForm(provider.id);
        return;
      }
      const time = media?.currentTime ?? pendingPosition;
      $('sources-dialog').close();
      if (page !== 'watch') openEpisode(current);
      launch(provider.id,time);
    };
    row.append(action);
    if (provider.id === 'alloha' && preferences.alloha) {
      const change = make('button','text-action','Сменить ссылку');
      change.onclick = () => showSourceForm('alloha');
      row.append(change);
    }
    return row;
  }));
  openSheet('sources-dialog');
  if (form) showSourceForm(form);
}
$('open-sources').onclick = () => openSources();
$('settings-sources').onclick = () => openSources();
for (const field of ['voice','quality']) $(field).onchange = event => {
  preferences[field] = event.target.value;
  persist();
  if (page === 'watch' && preferences.selected === 'native' && (media || request)) {
    launch('native',media?.currentTime ?? pendingPosition);
  }
};
$('alloha-form').onsubmit = event => {
  event.preventDefault();
  const value = $('alloha-url').value.trim();
  if (!mediaAddress(value,current.season,current.episode)) {
    $('source-error').textContent = 'Введи действительную HTTPS-ссылку для вставки Alloha.';
    return;
  }
  preferences.alloha = value;
  const time = media?.currentTime ?? pendingPosition;
  $('sources-dialog').close();
  if (page !== 'watch') openEpisode(current);
  launch('alloha',time);
};
$('source-form').onsubmit = event => {
  event.preventDefault();
  const url = $('source-url').value.trim();
  if (!mediaAddress(url,current.season,current.episode)) {
    $('source-error').textContent = 'Введи действительный HTTPS-адрес.';
    return;
  }
  const source = {url,kind:$('source-kind').value};
  if (/{season}|{episode}/.test(url)) {
    preferences.template = source;
    delete preferences.sources[key(current)];
  } else preferences.sources[key(current)] = source;
  const time = media?.currentTime ?? pendingPosition;
  $('sources-dialog').close();
  if (page !== 'watch') openEpisode(current);
  launch('custom',time);
};
$('file').onchange = event => {
  const file = event.target.files[0];
  if (!file) return;
  const time = media?.currentTime ?? pendingPosition;
  if (page !== 'watch') openEpisode(current);
  clearMedia();
  preferences.selected = 'file';
  persist();
  fileUrl = URL.createObjectURL(file);
  mountVideo(fileUrl,file.name,time,'file');
  event.target.value = '';
};
function applyTheme() {
  const theme = preferences.theme === 'auto'
    ? platform.theme || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : preferences.theme;
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name=theme-color]').content = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim();
  platform.applyChrome();
}
setSelectValue('theme',preferences.theme);
$('theme').onchange = event => {preferences.theme=event.target.value;persist();applyTheme()};
$('theme-toggle').onclick = () => {
  setSelectValue('theme',document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
  $('theme').onchange({target:$('theme')});
};
function applyNewYear() {
  document.documentElement.dataset.newYear = String(preferences.newYear);
  const field = $('snow-field');
  field.hidden = !preferences.newYear;
  if (!preferences.newYear) {
    field.replaceChildren();
    return;
  }
  field.replaceChildren(...Array.from({length:160},() => {
    const flake = make('span','snowflake');
    const duration = 16 + Math.random() * 20;
    flake.style.setProperty('--snow-x',(Math.random() * 100) + '%');
    flake.style.setProperty('--snow-y',(Math.random() * 100) + '%');
    flake.style.setProperty('--snow-size',(2.3 + Math.random() * 2.4) + 'px');
    flake.style.setProperty('--snow-opacity',.19 + Math.random() * .25);
    flake.style.setProperty('--snow-drift',(Math.random() * 44 - 22) + 'px');
    flake.style.setProperty('--snow-duration',duration + 's');
    flake.style.setProperty('--snow-delay',(-Math.random() * duration) + 's');
    return flake;
  }));
}
$('new-year').checked = preferences.newYear;
$('new-year').onchange = event => {
  preferences.newYear = event.target.checked;
  applyNewYear();
  persist();
};
$('spoilers').checked = preferences.spoilers;
$('spoilers').onchange = event => {preferences.spoilers=event.target.checked;$('episode-plot').open=preferences.spoilers;persist()};
matchMedia('(prefers-color-scheme: light)').addEventListener('change',applyTheme);
for (const sheet of document.querySelectorAll('dialog')) sheet.addEventListener('close',() => platform.showBack(page !== 'home'));
platform.configure(() => {
  const sheet = document.querySelector('dialog[open]');
  if (sheet) sheet.close();
  else location.hash = page === 'watch' ? 'catalog' : 'home';
},applyTheme,telegram => {
  if (!location.hash || location.hash.startsWith('#tgWebApp')) route();
  else platform.showBack(page !== 'home');
  if (!telegram.isVersionAtLeast?.('6.9') || !telegram.CloudStorage) return;
  telegramSync = createTelegramSync(telegram.CloudStorage,{
    onStatus(message){ $('sync-status').textContent = message; },
    onMerge(entries){
      let last = readPlaybackMemory().last;
      for (const entry of entries) {
        const id = episodeId(entry.season,entry.episode);
        if (!episodeById.has(id)) continue;
        if ((viewing[id]?.updatedAt || 0) < entry.updatedAt) viewing[id] = entry;
        if (!last || (last.updatedAt || 0) < entry.updatedAt) last = entry;
      }
      writeLocal(historyKey,viewing);
      if (last) writeLocal(playbackStoreKey,{last});
      refreshHome();
      if (page === 'catalog') renderCatalog();
      if (page === 'watch') updateWatched();
    }
  });
  void telegramSync.pull();
  telegram.onEvent('activated',() => void telegramSync.pull());
  telegram.onEvent('deactivated',() => void telegramSync.flush());
  document.addEventListener('visibilitychange',() => {
    if (document.visibilityState === 'hidden') void telegramSync.flush();
  });
});
document.querySelector('.skip').onclick = event => {event.preventDefault();$('content').focus()};
window.addEventListener('hashchange',route);
applyTheme();
applyNewYear();
renderSeriesRatings();
seasonButtons();
route();
