import assert from 'node:assert/strict';
import {test} from 'node:test';
import {canonicalEpisode,combinedEpisodeRule,mentalistCatalog,seriesIdentity} from '../series-config.js';
import {readLocal,writeLocal} from '../storage.js';
import {integrationOrigins,integrationSettings,matchesIntegrationOrigin} from '../integrations.js';
import {seriesMetadata} from '../series-metadata.js';
import {cachedEpisodes,rememberEpisodes} from '../catalog-episodes.js';
import {loadCinemetaSeries,searchCinemeta} from '../cinemeta.js';

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

test('deployment source addresses produce narrowly scoped CSP origins', () => {
  const policy = integrationOrigins({...integrationSettings,
    episodeEndpoint:'https://catalog.example/api',stremioManifest:'stremio://addon.example/manifest.json',
    mediaOrigins:['https://streams.example','https://segments.example'],
    seriesSources:{demo:{video:'https://video.example/{episode}.mp4',manifest:'https://json.example/list',
      alloha:'https://iframe.example/{season}/{episode}'}}
  });
  for (const host of ['catalog','addon','json','streams','segments','video']) assert.ok(policy.connect.includes('https://' + host + '.example'));
  assert.ok(!policy.media.includes('https://addon.example'));
  assert.ok(policy.frame.includes('https://iframe.example'));
  assert.ok(policy.frame.includes('https://api.namy.ws'));
  assert.ok(!policy.connect.includes('https://iframe.example'));
  assert.ok(matchesIntegrationOrigin('https://video.okcdn.ru/movie.mp4',policy.media));
  assert.ok(!matchesIntegrationOrigin('https://video.okcdn.ru.evil.example/movie.mp4',policy.media));
  assert.throws(() => integrationOrigins({...integrationSettings,episodeEndpoint:'http://catalog.example/api'}),/HTTPS/);
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

test('the catalog bounds the cache for previously loaded series', (context) => {
  const saved = new Map();
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{
    getItem:key => saved.get(key),setItem:(key,value) => saved.set(key,value)
  }});
  context.after(() => { delete globalThis.localStorage; });
  assert.equal(cachedEpisodes(38753).episodes,undefined);
  for (let id=100;id<110;id++) rememberEpisodes(id,[{season:1,episode:1,title:'Pilot',synopsis:'Large synopsis'}]);
  assert.equal(cachedEpisodes(109).episodes[0].title,'Pilot');
  assert.equal(cachedEpisodes(109).episodes[0].synopsis,undefined);
  assert.equal(Object.keys(JSON.parse(saved.get('konfoly-episode-lists-v1'))).length,8);
});

test('secondary catalog searches English and accepts only entries with a TVmaze show ID', async (context) => {
  const claim = value => [{rank:'normal',mainsnak:{datavalue:{value}}}];
  context.mock.method(globalThis,'fetch',async url => {
    assert.equal(url.hostname,'www.wikidata.org');
    if (url.searchParams.get('action') === 'wbsearchentities') {
      assert.equal(url.searchParams.get('language'),'en');
      return Response.json({search:[{id:'Q1',label:'Example'},{id:'Q2',label:'Other'}]});
    }
    return Response.json({entities:{Q1:{claims:{P8600:claim('38201'),P345:claim('tt1029384')},
      labels:{en:{value:'Example'},ru:{value:'Пример'}}},Q2:{claims:{P345:claim('tt1999999')}}}});
  });
  const matches = await seriesMetadata.catalogSearch('example',new AbortController().signal);
  assert.deepEqual(matches,[{id:38201,name:'Example',localized:'Пример',externals:{imdb:'tt1029384'}}]);
});

test('independent catalog searches series and accepts only correctly numbered episodes', async (context) => {
  const imdb = 'tt12121212';
  context.mock.method(globalThis,'fetch',async address => {
    const url = new URL(address);
    assert.equal(url.hostname,'v3-cinemeta.strem.io');
    if (url.pathname.startsWith('/catalog/')) {
      assert.equal(decodeURIComponent(url.pathname),'/catalog/series/top/search=Название & продолжение.json');
      return Response.json({metas:[{id:imdb,type:'series',name:'Example'},{id:'tt55555555',type:'movie',name:'Film'}]});
    }
    return Response.json({meta:{id:imdb,type:'series',videos:[
      {id:imdb+':0:1',season:0,episode:1,name:'Trailer'},
      {id:'tt55555555:1:1',season:1,episode:1,name:'Different series'},
      {id:imdb+':1:1',season:1,episode:1,name:'Pilot',thumbnail:'https://episodes.metahub.space/pilot.jpg'}
    ]}});
  });
  const signal = new AbortController().signal;
  const found = await searchCinemeta('Название & продолжение',signal);
  assert.deepEqual(found.map(show => show.externals.imdb),[imdb]);
  const {episodes} = await loadCinemetaSeries(imdb,signal);
  assert.deepEqual(episodes.map(episode => episode.title),['Pilot']);
  assert.equal(episodes[0].image,'https://episodes.metahub.space/pilot.jpg');
});
