import {siteBase} from './site-pages.js';

const tagAddress = 'https://mc.yandex.ru/metrika/tag.js';
const counter = globalThis.KONFOLY_METRICA_ID;
let initialized = false;
let page;

function send(method,...args) {
  if (!counter || /(?:tgWebAppData=|tgWebAppVersion=|miniapp=1)/.test(location.search + location.hash) ||
      window.Telegram?.WebApp?.initData) return;
  try {
    if (!initialized) {
      const queue = function() { queue.a.push(arguments); };
      queue.a = [];
      queue.l = Date.now();
      window.ym ||= queue;
      window.ym(counter,'init',{defer:true,accurateTrackBounce:true,webvisor:true,clickmap:true,trackLinks:true});
      const script = document.createElement('script');
      script.async = true;
      script.src = tagAddress + '?id=' + counter;
      document.head.append(script);
      initialized = true;
    }
    window.ym(counter,method,...args);
  } catch {}
}

function metricaPage(route) {
  const screen = route.page === 'series' ? route.episode ? 'player' :
    route.season != null ? 'episodes' : 'show' : route.page;
  const path = siteBase + '#/' + screen;
  const current = path + ':' + location.search + location.hash;
  if (page === current || route.loadEpisodes && !route.overview && route.season == null) return;
  page = current;
  send('hit',location.origin + path,{params:{screen}});
}

function metricaGoal(goal) {
  send('reachGoal',goal);
}

export {metricaPage,metricaGoal};
