const source=require('./load-source.cjs');
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
class Element extends EventTarget{
 constructor(tag='div'){super();this.tagName=tag;this.children=[];this.dataset={};this.queries=new Map();this.value='';this.classList={toggle(){},add(){},remove(){},contains(){return false}};this.style={setProperty(){}};this.paused=true;this.ended=false;this.currentTime=0;this.duration=2500;this.videoWidth=1920;this.videoHeight=1080}
 get firstElementChild(){return this.children[0]||null}
 set innerHTML(v){this.markup=v;this.children=[]}get innerHTML(){return this.markup||''}
 append(...els){this.children.push(...els);for(const e of els)e.parentElement=this}replaceChildren(...els){this.children=[];this.append(...els)}
 querySelector(s){if(s==='video')return this.children.find(e=>e.tagName==='video')||null;if(!this.queries.has(s))this.queries.set(s,new Element());return this.queries.get(s)}
 setAttribute(k,v){this[k]=v}removeAttribute(k){delete this[k]}load(){}focus(){}scrollIntoView(){}showModal(){}close(){}remove(){}
 play(){this.paused=false;this.dispatchEvent(new Event('play'));return Promise.resolve()}pause(){this.paused=true;this.dispatchEvent(new Event('pause'))}
}
(async()=>{
 const ids=new Map(),doc=new EventTarget(),storage=new Map(),requests=[];doc.visibilityState='visible';doc.getElementById=id=>{if(!ids.has(id))ids.set(id,new Element());return ids.get(id)};doc.createElement=t=>new Element(t);doc.querySelectorAll=()=>[];doc.querySelector=()=>new Element();doc.documentElement={dataset:{}};
 const location=new URL('https://test.invalid/');const window=new EventTarget();window.scrollTo=()=>{};
 const platform={configure(){},showBack(){},tap(){},applyChrome(){}};const history={pushState(_state,_title,url){location.href=new URL(url,location.href).href}};
 storage.set('mentalist-personal-v1',JSON.stringify({season:1,episode:1,voice:'ТВ3',selected:'native',playerVersion:3,rate:1.1}));storage.set('mentalist-progress-v1',JSON.stringify({last:{season:4,episode:11,time:850,duration:2500,voice:'ТВ3',source:'native'}}));
 const stalled=new Map();
 const schedule=(callback,ms)=>{if(ms!==14000)return setTimeout(callback,ms);const key=Symbol('stall');stalled.set(key,callback);return key};
 const cancel=key=>{if(typeof key==='symbol')stalled.delete(key);else clearTimeout(key)};
 const triggerStall=()=>{assert.equal(stalled.size,1);const [key,callback]=stalled.entries().next().value;stalled.delete(key);callback()};
 const ctx={document:doc,window,location,history,platform,AbortController,matchMedia:()=>new EventTarget(),getComputedStyle:()=>({getPropertyValue:()=>'#000'}),URL,URLSearchParams,refreshKinosalSelect:()=>{},createSeriesLibrary:()=>({match(){},selectRoute(){},navigation(){},render(){},back(){}}),setTimeout:schedule,clearTimeout:cancel,localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},createCinemaPlayer:()=>({destroy(){},setBoost(){}}),fetch:async url=>{requests.push(url);if(url.includes('/playlist?')){const u=new URL(url);return {ok:true,json:async()=>({items:[{season:Number(u.searchParams.get('sn')),episode:Number(u.searchParams.get('ep')),voiceStudio:'ТВ3',vkId:'fixture'}]})}}return {ok:true,json:async()=>({sources:{mpegFullHdUrl:'https://test.okcdn.ru/video.mp4'}})}}};
 ctx.KONFOLY_PUBLIC_ROUTES=['series/mentalist/season/4','series/mentalist/4/11','series/mentalist/4/1','series/mentalist/3/23'];
 vm.createContext(ctx);for(const f of ['dom.js','storage.js','series-config.js','integrations.js','urls.js','site-pages.js','video-progress.js','video-controls.js','episodes.js','episode-titles-ru.js','importance.js','providers.js','ratings-data.js','ratings.js','app.js'])vm.runInContext(source(f),ctx);
 assert.match(ids.get('continue-info').textContent,/Сезон 4 · Серия 11/);
 assert.equal(ids.get('series-ratings').children.length,2);
 assert.equal(ids.get('home-age-rating').textContent,'18+');
 assert.equal(vm.runInContext('preferences.rate',ctx),1.1);
 const seasonFour=ctx.seasonRating(4);
 assert.equal(seasonFour.count,24);
 assert.equal(seasonFour.total,24);
 const imdbFourteen=vm.runInContext("externalRatingData.episodes['4:11']",ctx);
 assert.ok(/^tt[0-9]+$/.test(imdbFourteen.id)&&imdbFourteen.votes>0);
 assert.equal(vm.runInContext("Object.keys(externalRatingData.episodes).length",ctx),151);
 ids.get('rate-show').onclick();
 assert.equal(ids.get('rating-slider').value,'5');
 ids.get('rating-slider').value='9';
 ids.get('rating-slider').oninput();
 assert.equal(ids.get('rating-current').textContent,'9 из 10');
 assert.equal(storage.has('mentalist-ratings-v1'),false);
 ids.get('rating-form').onsubmit({preventDefault(){}});
 assert.equal(ids.get('rate-show').textContent,'Моя оценка · 9/10');
 assert.equal(JSON.parse(storage.get('mentalist-ratings-v1')).series,9);
 ids.get('rate-show').onclick();
 assert.equal(ids.get('rating-slider').value,'9');
 ids.get('rating-clear').onclick();
 assert.equal(ids.get('rate-show').textContent,'Моя оценка');
 assert.equal(ctx.document.documentElement.dataset.newYear,'false');
 ids.get('new-year').onchange({target:{checked:true}});
 assert.equal(ctx.document.documentElement.dataset.newYear,'true');
 assert.equal(JSON.parse(storage.get('mentalist-personal-v1')).newYear,true);
 assert.equal(ids.get('snow-field').children.length,160);
 ids.get('new-year').onchange({target:{checked:false}});
 assert.equal(ids.get('snow-field').hidden,true);
 assert.equal(ids.get('snow-field').children.length,0);
 ids.get('continue-button').onclick();
 await new Promise(setImmediate);
 assert.equal(location.pathname,'/series/mentalist/season/4/episode/11/');
 assert.equal(location.hash,'');
 assert.equal(ids.get('share-link').href,location.pathname);
 assert.equal(ids.get('episode-title').textContent,'Всегда ставь на красное');
 assert.equal(ids.get('episode-title-original').textContent,'Always Bet on Red');
 assert.equal(ids.get('episode-plot').open,false);
 assert.match(ids.get('plot-content').children[2].textContent,/Колетт/);
 assert.equal(vm.runInContext('episodeTitlesRu.map(season=>season.length).join(",")',ctx),'23,23,24,24,22,22,13');
 let video=ids.get('screen').querySelector('video');
 assert.ok(video);
 video.dispatchEvent(new Event('loadedmetadata'));
 assert.equal(video.currentTime,850);
 video.currentTime=860;
 video.dispatchEvent(new Event('timeupdate'));
 location.hash='#watch/2/7';
 ctx.renderCurrentRoute();
 assert.match(ids.get('continue-info').textContent,/Сезон 4 · Серия 11/);
 await ctx.launch('native');
 video=ids.get('screen').querySelector('video');
 video.dispatchEvent(new Event('loadedmetadata'));
 assert.equal(video.currentTime,0);
 video.currentTime=304;
 video.dispatchEvent(new Event('waiting'));
 triggerStall();
 await new Promise(setImmediate);
 const recovered=ids.get('screen').querySelector('video');
 assert.notEqual(recovered,video);
 recovered.dispatchEvent(new Event('loadedmetadata'));
 assert.equal(recovered.currentTime,304);
 recovered.currentTime=310;
 recovered.dispatchEvent(new Event('waiting'));
 triggerStall();
 assert.equal(ids.get('screen').querySelector('video'),null);
 assert.match(ids.get('source-status').textContent,/Поток перестал отвечать/);
 assert.equal(ids.get('screen').firstElementChild.children[2].textContent,'Выбрать источник');
 location.hash='#watch/3/24';
 ctx.renderCurrentRoute();
 await ctx.launch('native');
 assert.ok(requests.at(-2).includes('ep=23&sn=3'));
 assert.match(ids.get('episode-number').textContent,/23–24/);
 ids.get('next').onclick();
 assert.equal(location.pathname,'/series/mentalist/season/4/episode/1/');
 ids.get('previous').onclick();
 assert.equal(location.pathname,'/series/mentalist/season/3/episode/23/');
 ctx.navigateSite('/series/mentalist/season/4/');
 assert.equal(ids.get('episodes').children.length,24);
 location.hash='#catalog';
 ctx.renderCurrentRoute();
 const full=ids.get('episodes').children.length;
 vm.runInContext('catalogSeason=4',ctx);
 for(const title of ['Всегда ставь на красное','Always Bet on Red']){
   ids.get('search').value=title;
   ctx.renderCatalog();
   assert.equal(ids.get('episodes').children.length,1);
   assert.match(ids.get('results').textContent,/^1 из/);
 }
 ids.get('search').value='';
 ctx.openSources('alloha');
 assert.equal(ids.get('alloha-form').hidden,false);
 ids.get('alloha-url').value='https://video.example/mental/{season}/{episode}';
 ids.get('alloha-form').onsubmit({preventDefault(){}});
 assert.match(ids.get('source-error').textContent,/Домен iframe не разрешён/);
 vm.runInContext("allowedOrigins.frame.push('https://video.example')",ctx);
 ids.get('alloha-form').onsubmit({preventDefault(){}});
 const embedded=ids.get('screen').children[0];
 assert.equal(embedded.tagName,'iframe');
 assert.match(embedded.src,/^https:\/\/video\.example\/mental\/3\/23$/);
 assert.ok(!embedded.sandbox.includes('allow-popups'));
 assert.ok(!embedded.sandbox.includes('allow-top-navigation'));
 location.hash='#catalog';ctx.renderCurrentRoute();
 ids.get('important-filter').checked=true;
 ctx.renderCatalog();
 assert.ok(ids.get('episodes').children.length < full);
 const item=vm.runInContext('episodeCatalog[0]',ctx);
 const safeCard=ctx.episodeCard(item);
 ids.get('toggle-important').onclick();
 assert.equal(ctx.episodeCard(item).children[1].children[0].tagName,'span');
 assert.equal(safeCard.children[0].children[0].tagName,'img');
 vm.runInContext('preferences.spoilers=true',ctx);
 assert.equal(ctx.episodeCard(item).children[0].children[0].tagName,'img');
 const files = ctx.indexEpisodeFiles([
   {name:'Show.S01E01.mp4'}, {name:'Show.1x02.webm'}, {name:'Show.S01E01-alternate.m4v'},
   {name:'Show.S01E03-E04.mp4'}, {name:'Show.S01E03.srt'}, {name:'Other.S99E12.mp4'}
 ],[1,2,3,4].map(episode => ({season:1,episode})));
 assert.deepEqual(Array.from(files.keys()),['1:2']);
 assert.equal(files.get('1:2').name,'Show.1x02.webm');
 const hangingVideo = new Element('video');
 hangingVideo.readyState = 0;
 let startupFailure;
 const detach = ctx.openVideoStream(hangingVideo,'https://test.invalid/video.mp4',{
   startupTimeout:5,onError:code => { startupFailure = code; }
 });
 await new Promise(resolve => setTimeout(resolve,20));
 detach();
 assert.equal(startupFailure,2);
 const addonRequests = [];
 storage.set('konfoly-stremio-source-v1',JSON.stringify({url:'https://addon.invalid/config/manifest.json?profile=test'}));
 assert.equal(ctx.stremioSource(),'');
 vm.runInContext("allowedOrigins.connect.push('https://addon.invalid')",ctx);
 const previousFetch = ctx.fetch;
 ctx.fetch = async (input,options) => {
   const url = new URL(input);
   addonRequests.push(url.pathname + url.search);
   assert.equal(options.credentials,'omit');
   return {
     ok:true,
     json:async () => url.pathname.endsWith('/manifest.json')
       ? {resources:[{name:'stream',types:['series'],idPrefixes:['tt']}]}
       : {streams:[
         {infoHash:'fixture'},
         {url:'https://addon.invalid/needs-headers.mp4',behaviorHints:{notWebReady:true}},
         {url:'https://addon.invalid/stream.mp4'},
         {url:'https://addon.invalid/stream.m3u8'}
       ]}
   };
 };
 assert.equal(ctx.stremioManifestAddress('stremio://addon.invalid/manifest.json'),'https://addon.invalid/manifest.json');
 await assert.rejects(ctx.resolveStremio({imdb:{id:'tt0903747'}},{season:1,episode:3}),/доменов, не разрешённых/);
 addonRequests.pop();
 vm.runInContext("allowedOrigins.media.push('https://addon.invalid')",ctx);
 const firstSource = await ctx.resolveStremio({imdb:{id:'tt0903747'}},{season:1,episode:3});
 assert.equal(firstSource.url,'https://addon.invalid/stream.mp4');
 assert.equal(firstSource.alternatives[0].format,'hls');
 await ctx.resolveStremio({imdb:{id:'tt3032476'}},{season:2,episode:1});
 assert.deepEqual(addonRequests,[
   '/config/manifest.json?profile=test',
   '/config/stream/series/tt0903747:1:3.json?profile=test',
   '/config/stream/series/tt3032476:2:1.json?profile=test'
 ]);
 ctx.fetch = previousFetch;
 console.log('PASS app flow: global continue from another episode, exact resume, recover a 5-minute stall once, offer source switching, combined TV3 finale lookup and navigation, rating sources, personal rating and holiday preference');
})().catch(e=>{console.error(e);process.exitCode=1});
