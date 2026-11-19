import assert from 'node:assert/strict';
import {test} from 'node:test';
import {canonicalEpisode,combinedEpisodeRule,mentalistCatalog,seriesIdentity} from '../series-config.js';
import {readLocal,writeLocal} from '../storage.js';
import {integrationSettings} from '../integrations.js';
import {seriesMetadata} from '../series-metadata.js';

test('imported Interns and the four-season edition map only on provider lookup', () => {
  const item = {season:4,episode:1,title:'Серия 61'};
  assert.deepEqual(canonicalEpisode({id:'tvmaze-3391',mazeId:3391},item),{...item,season:2,episode:1});
  assert.equal(canonicalEpisode({id:'interns',mazeId:3391},item),item);
  assert.equal(canonicalEpisode({mazeId:169},item),item);
  assert.throws(() => canonicalEpisode({mazeId:3391}, {...item,title:'Неизвестно'}));
});

test('only the configured voice and episode range use the combined finale', () => {
  const id = mentalistCatalog.kinopoiskId;
  const rule = combinedEpisodeRule(id,3,24,'ТВ3');
  assert.deepEqual([rule.first,rule.last,rule.completionTime],[23,24,4800]);
  assert.equal(combinedEpisodeRule(id,3,24,'TVShows'),undefined);
  assert.equal(combinedEpisodeRule(id,3,22,'ТВ3'),undefined);
  assert.equal(seriesIdentity({imdb:{id:'tt1647423'}}).kinopoiskId,501998);
  assert.ok(integrationSettings.embeds.namy);
  assert.equal(integrationSettings.embeds.tomion,undefined);
});

test('storage errors are observable and do not abort the session', () => {
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{
    getItem() { throw Error('storage disabled'); },
    setItem() { throw Error('quota exceeded'); }
  }});
  try {
    assert.deepEqual(readLocal('catalog'),{});
    assert.equal(writeLocal('catalog',[]),false);
  } finally { delete globalThis.localStorage; }
});

test('episode localization matches exact external IDs and skips ambiguous labels', async (context) => {
  const show = {id:'tvmaze-99121',mazeId:99121,language:'English'};
  const first = {season:1,episode:1,title:'The Signal',mazeId:812001};
  const second = {season:1,episode:2,title:'The Answer',mazeId:812002};
  const label = (id,name) => ({id:{value:String(id)},name:{value:name}});
  context.mock.method(globalThis,'fetch',async url => {
    assert.match(url.searchParams.get('query'),/"812001" "812002".*wdt:P11294/);
    return Response.json({results:{bindings:[label(812001,'Сигнал'),label(812002,'Ответ'),label(812002,'Разгадка')]}});
  });
  const refresh = context.mock.fn();
  await seriesMetadata.loadEpisodeTitles(show,[first,second],new AbortController().signal,refresh);
  assert.equal(seriesMetadata.episode(show,first).title,'Сигнал');
  assert.equal(seriesMetadata.episode(show,second).title,'The Answer');
  assert.equal(refresh.mock.callCount(),1);
});
