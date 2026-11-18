const mediaProviders = [
  {id:'native',title:'Наш плеер',detail:'Рекомендуемый · ТВ3, Universal и TVShows при наличии',action:'Смотреть'},
  {id:'namy',title:'Namy / Collaps',detail:'Запасной плеер с рекламой. Настройки и прогресс управляются поставщиком.',action:'Открыть'},
  {id:'alloha',title:'Alloha',detail:'Внешний плеер · возможна реклама. Подключается по готовой ссылке для вставки.',action:'Настроить'},
  {id:'tomion',title:'Tomion',detail:'Резервный источник. Ранее возвращал ошибку доступа.',action:'Проверить'},
  {id:'file',title:'Файл с устройства',detail:'MP4, WebM и другие форматы, которые поддерживает браузер.',action:'Выбрать видео'},
  {id:'custom',title:'Свой источник',detail:'Прямое видео или встраиваемый плеер.',action:'Настроить ссылку'}
];
function mediaAddress(template, season, episode) {
  try {
    const url = new URL(template.replaceAll('{season}', season).replaceAll('{episode}', episode));
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
function embedAddress(id,season,episode) {
  if (id === 'namy') return 'https://api.namy.ws/embed/movie/454?season=' + season + '&episode=' + (season === 7 && episode >= 12 ? '12-13' : episode);
  if (id === 'tomion') return 'https://tomion.org/tvb/412344?episode=' + episode + '&season=' + season + '&skips=1&vonly=true';
  return null;
}
async function resolveNative({season,episode,voice,quality}, signal) {
  const api = 'https://plapi.cdnvideohub.com/api/v1/player/sv';
  const combined = voice === 'ТВ3' && season === 3 && episode >= 23;
  const number = combined ? 23 : episode;
  async function get(path) {
    const response = await fetch(api + path,{signal});
    if (!response.ok) throw Error('Источник недоступен. Повтори попытку.');
    return response.json();
  }
  const list = await get('/playlist?pub=10428&id=412344&aggr=kp&ep=' + number + '&sn=' + season);
  const item = list.items?.find(row => row.season === season && row.episode === number && row.voiceStudio === voice);
  if (!item) throw Error('Для этой серии нет выбранной озвучки. Выбери другую в настройках источника.');
  const media = await get('/video/' + encodeURIComponent(item.vkId));
  const streams = media.sources || {};
  const fallback = quality === 'fullhd' && !streams.mpegFullHdUrl;
  const url = mediaAddress((quality === 'fullhd' && streams.mpegFullHdUrl) || streams.mpegHighUrl || '',season,episode);
  if (!url || !new URL(url).hostname.endsWith('.okcdn.ru')) throw Error('Источник не предоставил MP4 в выбранном качестве.');
  const measured = season === 4 && episode === 11 && voice === 'ТВ3' && quality === 'fullhd' && !fallback;
  return {url,combined,label:voice + (fallback ? ' · Full HD отсутствует, выбран HD' : ''),
    metadata:measured ? 'H.264 · видео 1,86 Мбит/с · AAC 262 кбит/с' : ''};
}
