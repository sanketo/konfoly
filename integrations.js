// Deployment settings. Only public HTTPS addresses belong in this file.
// Keep provider API credentials on the server behind these endpoints.
const integrationSettings = Object.freeze({
  native: {address:'https://plapi.cdnvideohub.com/api/v1/player/sv/',publisher:10428,mediaDomain:'okcdn.ru'},
  episodeEndpoint: '',
  stremioManifest: '',
  logoEndpoint: '',
  seriesSources: {
    'imdb-tt5622316': {
      officialEpisodes: {
        '1:1':{youtube:'0E-8-NcL7tc',publisher:'https://www.youtube.com/@TheChosenSeries',
          title:'The Chosen: Season One, Episodes 1 & 2',verifiedOn:'2026-11-20'}
      }
    }
  },
  embeds: {
    namy: {
      title:'Namy / Collaps',detail:'Запасной встроенный плеер.',
      address:'https://api.namy.ws/embed/movie/454?season={season}&episode={episode}',
      episodeOverrides:{'7:12':'12-13','7:13':'12-13'}
    }
  },
  connectOrigins: [],
  mediaOrigins: [],
  imageOrigins: [],
  embedOrigins: []
});

const telegramSdk = 'https://telegram.org/js/telegram-web-app.js?65';

function integrationOrigins(settings) {
  const origins = urls => [...new Set(urls.filter(Boolean).map(value => {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) throw Error('Expected a public HTTPS integration URL');
    return url.origin;
  }))];
  const series = Object.values(settings.seriesSources);
  const domain = settings.native?.mediaDomain;
  if (domain && !/^[a-z0-9.-]+\.[a-z]+$/i.test(domain)) throw Error('Invalid native media domain');
  const nativeMedia = domain ? ['https://' + domain,'https://*.' + domain] : [];
  const media = [...origins([...settings.mediaOrigins,...series.map(source => source.video)]),...nativeMedia];
  return {
    media,
    connect:[...new Set([...origins([settings.native?.address,settings.episodeEndpoint,
      settings.stremioManifest?.replace(/^stremio:/i,'https:'),settings.logoEndpoint,
      ...settings.connectOrigins,...series.map(source => source.manifest)]),...media])],
    frame:origins([...settings.embedOrigins,...Object.values(settings.embeds).map(embed => embed.address),
      ...series.map(source => source.alloha),
      ...series.filter(source => Object.keys(source.officialEpisodes || {}).length)
        .map(() => 'https://www.youtube-nocookie.com')]),
    image:origins(settings.imageOrigins)
  };
}

const allowedOrigins = integrationOrigins(integrationSettings);

function matchesIntegrationOrigin(address,entries) {
  if (!address) return false;
  const url = new URL(address);
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  return entries.some(origin => origin === url.origin || (origin.startsWith('https://*.') &&
    !url.port && url.hostname.endsWith(origin.slice('https://*'.length))));
}

export {integrationSettings, telegramSdk, integrationOrigins, allowedOrigins, matchesIntegrationOrigin};
