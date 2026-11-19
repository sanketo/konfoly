// Deployment settings. Only public HTTPS addresses belong in this file.
// Keep provider API credentials on the server behind these endpoints.
const integrationSettings = Object.freeze({
  native: {address:'https://plapi.cdnvideohub.com/api/v1/player/sv/',publisher:10428,mediaDomain:'okcdn.ru'},
  episodeEndpoint: '',
  stremioManifest: '',
  logoEndpoint: '',
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

export {integrationSettings};
