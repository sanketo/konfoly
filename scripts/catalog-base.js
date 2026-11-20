import {mentalistCatalog,seriesIdentity} from '../series-config.js';
import {breakingBad,interns,seriesEditorial} from '../series-data.js';

function baseCatalog() {
  return [mentalistCatalog,breakingBad,interns,...Object.entries(seriesEditorial)
    .map(([id,show]) => ({...show,id:'tvmaze-' + id,mazeId:Number(id)}))]
    .map(show => ({...show,imdbId:show.imdb?.id || seriesIdentity(show)?.imdbId}));
}

export {baseCatalog};
