import {validImdb} from './cinemeta.js';

const tvmazeImages = 'https://static.tvmaze.com';
const metahubPosters = 'https://images.metahub.space/poster/';

function tvmazePoster(image) {
  return [image?.original,image?.medium].find(address =>
    typeof address === 'string' && address.startsWith(tvmazeImages + '/uploads/images/')) || '';
}

function posterSources(address,imdb) {
  const source = typeof address === 'string' ? address : '';
  const tvmaze = /^https:\/\/static\.tvmaze\.com\/uploads\/images\/(?:medium_portrait|original_untouched)\/(\d+\/\d+\.(?:jpe?g|png|webp))$/i.exec(source);
  const metahub = /^https:\/\/images\.metahub\.space\/poster\/(small|medium|large|original)\/(tt\d{5,12})\/img$/.exec(source);
  const images = [];
  if (tvmaze) {
    images.push(tvmazeImages + '/uploads/images/original_untouched/' + tvmaze[1]);
    images.push(tvmazeImages + '/uploads/images/medium_portrait/' + tvmaze[1]);
  } else if (metahub) {
    const [,size,id] = metahub;
    if (size === 'original') images.push(source);
    images.push(metahubPosters + 'large/' + id + '/img',metahubPosters + 'medium/' + id + '/img',source);
  } else if (source) images.push(source);
  if (validImdb(imdb)) images.push(metahubPosters + 'large/' + imdb + '/img',metahubPosters + 'medium/' + imdb + '/img');
  return [...new Set(images)];
}

export {posterSources, tvmazePoster};
