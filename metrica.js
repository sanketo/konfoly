(() => {
  const counter = 114391998;
  const screens = {home:'home',catalog:'episodes',watch:'player',settings:'settings'};
  let lastRoute;
  let initialized = false;

  window.konfolyMetricaPage = (page,publicPath) => {
    const screen = screens[page];
    if (!screen || /(?:tgWebAppData=|tgWebAppVersion=|miniapp=1)/.test(location.search + location.hash) ||
        window.Telegram?.WebApp?.initData) return;
    const route = publicPath || '/#' + page;
    if (route === lastRoute) return;
    lastRoute = route;
    try {
      if (!initialized) {
        const queue = function() { queue.a.push(arguments); };
        queue.a = [];
        queue.l = Date.now();
        window.ym ||= queue;
        window.ym(counter,'init',{defer:true,accurateTrackBounce:true,webvisor:true,clickmap:true,trackLinks:true});
        const script = document.createElement('script');
        script.async = true;
        script.src = 'https://mc.yandex.ru/metrika/tag.js?id=' + counter;
        document.head.append(script);
        initialized = true;
      }
      window.ym(counter,'hit',location.origin + route,{params:{screen}});
    } catch {}
  };
})();
