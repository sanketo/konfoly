const platform = (() => {
  let telegram, onBack, onTheme, onReady;
  const query = new URLSearchParams(location.search);
  const launch = new URLSearchParams(location.hash.slice(1));
  let savedLaunch = false;
  try { savedLaunch = sessionStorage.getItem('mentalist-tg-launch') === '1'; } catch {}
  const inside = query.get('miniapp') === '1' || savedLaunch || launch.has('tgWebAppData') || launch.has('tgWebAppVersion');
  function applyInsets() {
    if (!telegram) return;
    const root = document.documentElement;
    if (telegram.viewportStableHeight > 0) root.style.setProperty('--tg-height',telegram.viewportStableHeight + 'px');
    for (const edge of ['top','right','bottom','left']) {
      const inset = Math.max(telegram.safeAreaInset?.[edge] || 0,telegram.contentSafeAreaInset?.[edge] || 0);
      root.style.setProperty('--tg-' + edge,inset + 'px');
    }
  }
  function connect() {
    telegram = window.Telegram?.WebApp;
    if (!telegram?.initData) {telegram = null;return}
    try {sessionStorage.setItem('mentalist-tg-launch','1')} catch {}
    document.documentElement.dataset.telegram = 'true';
    for (const event of ['viewportChanged','safeAreaChanged','contentSafeAreaChanged']) telegram.onEvent(event,applyInsets);
    telegram.onEvent('themeChanged',() => onTheme?.());
    telegram.BackButton?.onClick(() => onBack?.());
    telegram.ready();
    telegram.expand?.();
    applyInsets();
    onTheme?.();
    onReady?.(telegram);
  }
  if (inside || window.Telegram?.WebApp?.initData) {
    if (window.Telegram?.WebApp) connect();
    else {
      const script = document.createElement('script');
      script.src = 'https://telegram.org/js/telegram-web-app.js?65';
      script.onload = connect;
      document.head.append(script);
    }
  }
  return {
    get theme(){return telegram?.colorScheme},
    // A launch parameter selects an episode, never an identity or permission.
    get start(){return telegram?.initDataUnsafe?.start_param || query.get('tgWebAppStartParam') || launch.get('tgWebAppStartParam')},
    applyChrome(color){
      if (!telegram) return;
      if (color) {
        telegram.setBackgroundColor?.(color);
        if (telegram.isVersionAtLeast?.('6.9')) telegram.setHeaderColor?.(color);
        if (telegram.isVersionAtLeast?.('7.10')) telegram.setBottomBarColor?.(color);
      }
    },
    configure(back,theme,ready){onBack=back;onTheme=theme;onReady=ready;if(telegram)onReady?.(telegram)},
    showBack(value){if(value)telegram?.BackButton?.show();else telegram?.BackButton?.hide()},
    tap(){telegram?.HapticFeedback?.selectionChanged()}
  };
})();

export {platform};
