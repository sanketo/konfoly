import {validImdb} from './cinemeta.js';

const tvmazeImages = 'https://static.tvmaze.com';
const metahubPosters = 'https://images.metahub.space/poster/';

function tvmazePoster(image) {
  return [image?.original,image?.medium].find(address =>
    typeof address === 'string' && address.startsWith(tvmazeImages + '/uploads/images/')) || '';
}

function posterSources(address,imdb,{thumbnail=false}={}) {
  const source = typeof address === 'string' ? address : '';
  const tvmaze = /^https:\/\/static\.tvmaze\.com\/uploads\/images\/(?:medium_portrait|original_untouched)\/(\d+\/\d+\.(?:jpe?g|png|webp))$/i.exec(source);
  const metahub = /^https:\/\/images\.metahub\.space\/poster\/(small|medium|large|original)\/(tt\d{5,12})\/img$/.exec(source);
  const images = [];
  if (tvmaze) {
    const original = tvmazeImages + '/uploads/images/original_untouched/' + tvmaze[1];
    const medium = tvmazeImages + '/uploads/images/medium_portrait/' + tvmaze[1];
    images.push(...(thumbnail ? [medium,original] : [original,medium]));
  } else if (metahub) {
    const [,size,id] = metahub;
    const sizes = thumbnail ? ['medium','small','large'] : size === 'original' ? ['original','large','medium'] : ['large','medium'];
    images.push(...sizes.map(size => metahubPosters + size + '/' + id + '/img'),source);
  } else if (source) images.push(source);
  if (validImdb(imdb)) {
    const sizes = thumbnail ? ['medium','small','large'] : ['large','medium'];
    images.push(...sizes.map(size => metahubPosters + size + '/' + imdb + '/img'));
  }
  return [...new Set(images)];
}

export {posterSources, tvmazePoster};
