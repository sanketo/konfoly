import assert from 'node:assert/strict';
import {test} from 'node:test';
import {canonicalEpisode,combinedEpisodeRule,mentalistCatalog,seriesIdentity} from '../series-config.js';
import {readLocal,writeLocal} from '../storage.js';
import {integrationOrigins,integrationSettings,matchesIntegrationOrigin} from '../integrations.js';
import {seriesMetadata} from '../series-metadata.js';
import {cachedEpisodes,rememberEpisodes} from '../catalog-episodes.js';
import {loadCinemetaSeries,searchCinemeta} from '../cinemeta.js';
import {loadAppleAgeRating} from '../series-age-ratings.js';
import {seekTimeAtPointer} from '../video-controls.js';
import {posterSources,tvmazePoster} from '../series-posters.js';

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

test('episode guide resolves an exact IMDb match when Wikidata Query Service fails', async (context) => {
  context.mock.method(globalThis,'fetch',async address => {
    const url = new URL(address);
    if (url.hostname === 'query.wikidata.org') throw Error('Network unavailable');
    if (url.searchParams.get('action') === 'wbsearchentities') {
      return Response.json({search:[{id:'Q1'},{id:'Q2'}]});
    }
    const entity = (id,title) => ({claims:{P345:[{rank:'normal',mainsnak:{datavalue:{value:id}}}]},
      sitelinks:{enwiki:{title}}});
    return Response.json({entities:{Q1:entity('tt11111111','Example (film)'),Q2:entity('tt22222222','Example (TV series)')}});
  });
  const show = {id:'imdb-tt22222222',title:'Example',imdb:{id:'tt22222222'}};
  assert.equal(await seriesMetadata.wikiEpisodeArticle(show,new AbortController().signal),'Example (TV series)');
});

test('IMDb series rating is loaded without episodes, validated and cached by title ID', async (context) => {
  const show = {id:'imdb-tt98989898',imdb:{id:'tt98989898'}};
  const update = context.mock.fn();
  const fetchMock = context.mock.method(globalThis,'fetch',async address => {
    assert.equal(new URL(address).pathname,'/meta/series/tt98989898.json');
    return Response.json({meta:{type:'series',id:show.imdb.id,imdbRating:'7.0'}});
  });
  const signal = new AbortController().signal;
  await seriesMetadata.loadImdbRating(show,signal,update);
  await seriesMetadata.loadImdbRating(show,signal,update);
  assert.equal(seriesMetadata.imdbRating(show).score,7);
  assert.equal(seriesMetadata.imdbRating({...show,imdb:{id:'tt56565656'}}).score,undefined);
  assert.equal(update.mock.callCount(),1);
  assert.equal(fetchMock.mock.callCount(),1);
});

test('series pages prefer a short premise and resolve ratings by either identity', () => {
  const prisonBreak = {id:'imdb-tt0455275',imdb:{id:'tt0455275'},description:'Prison Break was created by Paul Scheuring.'};
  const details = seriesMetadata.details(prisonBreak);
  assert.match(details.description.text,/Майкл Скофилд.*Линкольна Берроуза/u);
  assert.equal(details.ageRating,'18+');
  assert.equal(seriesMetadata.ageRating({id:'tvmaze-1505',mazeId:1505}),'18+');
  assert.equal(seriesMetadata.ageRating({id:'tvmaze-38134',mazeId:38134}),'TV-MA (США)');
  assert.equal(seriesMetadata.ageRating({id:'tvmaze-48450',mazeId:48450}),'TV-MA (США)');
  const anime = seriesMetadata.details({id:'imdb-tt12343534',imdb:{id:'tt12343534'},title:'Jujutsu Kaisen'});
  assert.equal(anime.ageRating,'TV-MA (США)');
  assert.equal(anime.ageRatingSource,'https://www.netflix.com/title/81278456');
});

test('show descriptions default to Russian and keep English in the selected language', async (context) => {
  const show = {id:'tvmaze-91918',title:'Test Show',language:'Japanese',
    description:'A Japanese television series created by Test Studio. Mina searches for a missing friend. An old letter gives her a lead.'};
  const premise = 'Mina searches for a missing friend. An old letter gives her a lead.';
  const translated = 'Мина ищет пропавшего друга. Старое письмо даёт ей зацепку.';
  seriesMetadata.read(show).wikiPlotCheckedAt = Date.now();
  context.mock.method(globalThis,'fetch',async (url,options) => {
    assert.equal(url.origin,'https://api.mymemory.translated.net');
    assert.equal(url.searchParams.get('q'),premise);
    assert.equal(url.searchParams.get('langpair'),'en|ru');
    assert.equal(options.credentials,'omit');
    return Response.json({responseStatus:200,responseData:{translatedText:translated}});
  });
  assert.equal(seriesMetadata.details(show).description.text,'');
  assert.equal(seriesMetadata.details(show,'en').description.text,premise);
  const refresh = context.mock.fn();
  await seriesMetadata.loadSynopsis(show,'ru',new AbortController().signal,refresh);
  assert.equal(refresh.mock.callCount(),1);
  assert.equal(seriesMetadata.details(show).description.text,translated);
  assert.equal(seriesMetadata.details(show,'en').description.text,premise);
  const flash = {id:'imdb-tt3107288',imdb:{id:'tt3107288'},title:'The Flash'};
  assert.match(seriesMetadata.details(flash).description.text,/Барри Аллен/u);
  assert.match(seriesMetadata.details(flash,'en').description.text,/Barry Allen/);
});

test('an imported show can use a regional TMDB certificate when a Russian rating is missing', async (context) => {
  const show = {id:'imdb-tt65432741',tmdbId:78451,title:'Test Show'};
  const now = Date.now();
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{
    getItem:() => JSON.stringify({wikiCheckedAt:now,wikiArtCheckedAt:now,mazePlotCheckedAt:now,tmdbCheckedAt:now}),
    setItem() {}
  }});
  Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{
    getItem:key => key === 'konfoly-tmdb-read-token' ? 'fixture-token' : null
  }});
  context.after(() => { delete globalThis.localStorage; delete globalThis.sessionStorage; });
  context.mock.method(globalThis,'fetch',async address => {
    assert.equal(new URL(address).pathname,'/3/tv/78451/content_ratings');
    return Response.json({results:[{iso_3166_1:'RU',rating:''},{iso_3166_1:'GB',rating:'15'},{iso_3166_1:'AU',rating:'M'}]});
  });
  const refresh = context.mock.fn();
  await seriesMetadata.load(show,new AbortController().signal,refresh);
  assert.equal(seriesMetadata.ageRating(show),'15 (Великобритания)');
  assert.equal(refresh.mock.callCount(),1);
});

test('the public rating lookup verifies the show and release years before using a store result', async (context) => {
  const season = (artistName,releaseDate,contentAdvisoryRating,country='USA') =>
    ({collectionType:'TV Season',artistName,releaseDate,contentAdvisoryRating,country});
  const fetchMock = context.mock.method(globalThis,'fetch',async address => {
    assert.equal(address.origin,'https://itunes.apple.com');
    assert.equal(address.searchParams.get('term'),'Sample Show');
    return Response.json({results:address.searchParams.get('country') === 'us' ? [
      season('Sample Show','1982-09-27','TV-MA'),
      season('Sample Show: The Remake','2012-09-27','TV-MA')
    ] : [season('Sample Show','2016-05-03','15','GBR')]});
  });
  assert.equal(await loadAppleAgeRating('Sample Show','2011–2016',new AbortController().signal),'15 (Великобритания)');
  assert.equal(fetchMock.mock.callCount(),2);
});

test('the timeline hover uses the slider travel and clamps to the episode bounds', () => {
  assert.equal(seekTimeAtPointer(2526,0,1012),0);
  assert.equal(seekTimeAtPointer(2526,506,1012),1263);
  assert.equal(seekTimeAtPointer(2526,1012,1012),2526);
  assert.equal(seekTimeAtPointer(Infinity,50,1012),null);
});

test('poster URLs prefer originals and upgrade artwork saved by older versions', () => {
  const medium = 'https://static.tvmaze.com/uploads/images/medium_portrait/501/1253519.jpg';
  const original = 'https://static.tvmaze.com/uploads/images/original_untouched/501/1253519.jpg';
  const small = 'https://images.metahub.space/poster/small/tt0434665/img';
  const large = 'https://images.metahub.space/poster/large/tt0434665/img';
  const fallback = 'https://images.metahub.space/poster/medium/tt0434665/img';
  assert.equal(tvmazePoster({original,medium}),original);
  assert.equal(tvmazePoster({medium}),medium);
  assert.deepEqual(posterSources(medium),[original,medium]);
  assert.deepEqual(posterSources(small,'tt0434665'),[large,fallback,small]);
  assert.deepEqual(posterSources('assets/mentalist-poster.webp'),['assets/mentalist-poster.webp']);
  assert.deepEqual(posterSources('', 'unknown'),[]);
});

test('catalog thumbnails try smaller artwork before the original', () => {
  const medium = 'https://static.tvmaze.com/uploads/images/medium_portrait/501/1253519.jpg';
  const original = 'https://static.tvmaze.com/uploads/images/original_untouched/501/1253519.jpg';
  const metahub = 'https://images.metahub.space/poster/';
  const sizes = ['medium','small','large'].map(size => metahub + size + '/tt0434665/img');
  const options = {thumbnail:true};
  assert.deepEqual(posterSources(original,undefined,options),[medium,original]);
  assert.deepEqual(posterSources(sizes[2],'tt0434665',options),sizes);
  assert.deepEqual(posterSources('', 'tt0434665',options),sizes);
});
