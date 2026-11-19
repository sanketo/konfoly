const seriesMetadata = (() => {
  const keyName = 'konfoly-kinopoisk-api-key';
  const tmdbKeyName = 'konfoly-tmdb-read-token';
  const maxAge = 14 * 86400000;
  const cached = new Map();
  const knownIds = {116:412344,169:404900,184:818185};
  const knownImdb = {tt1647423:501998};
  const languages = {English:'en',Japanese:'ja',Korean:'ko',French:'fr',German:'de',Spanish:'es',
    Italian:'it',Portuguese:'pt',Dutch:'nl',Turkish:'tr',Chinese:'zh',Hindi:'hi',Polish:'pl',Ukrainian:'uk',Russian:'ru'};
  const itemKey = item => item.season + ':' + item.episode;
  const storageKey = show => 'konfoly-show-metadata:' + show.id;

  function apiKey() {
    try { return sessionStorage.getItem(keyName) || ''; } catch { return ''; }
  }
  function setApiKey(value) {
    try {
      if (value) sessionStorage.setItem(keyName,value);
      else sessionStorage.removeItem(keyName);
      for (const data of cached.values()) delete data.kpCheckedAt;
      return true;
    } catch { return false; }
  }
  function tmdbToken() {
    try { return sessionStorage.getItem(tmdbKeyName) || ''; } catch { return ''; }
  }
  function setTmdbToken(value) {
    try {
      if (value) sessionStorage.setItem(tmdbKeyName,value);
      else sessionStorage.removeItem(tmdbKeyName);
      for (const data of cached.values()) delete data.tmdbCheckedAt;
      return true;
    } catch { return false; }
  }
  async function tmdbImages(show,signal,token) {
    const request = async path => {
      const response = await fetch('https://api.themoviedb.org/3/' + path,{
        signal,credentials:'omit',redirect:'error',headers:{Authorization:'Bearer ' + token}
      });
      if (!response.ok) throw Error('TMDB не загрузил логотипы.');
      return response.json();
    };
    let id = show.tmdbId;
    if (!id && /^tt\d{5,12}$/.test(show.imdb?.id || '')) {
      const data = await request('find/' + show.imdb.id + '?external_source=imdb_id');
      if (data.tv_results?.length === 1) id = data.tv_results[0].id;
    }
    if (!Number.isInteger(id)) return [];
    const data = await request('tv/' + id + '/images?include_image_language=ru,en,null');
    const rank = {ru:0,en:1,null:2};
    return (Array.isArray(data.logos) ? data.logos : [])
      .filter(logo => /^\/[a-zA-Z0-9]+\.(png|svg)$/i.test(logo.file_path))
      .sort((a,b) => (rank[a.iso_639_1] ?? 3) - (rank[b.iso_639_1] ?? 3) || b.vote_count - a.vote_count)
      .slice(0,6).map(logo => 'https://image.tmdb.org/t/p/original' + logo.file_path);
  }
  const logoChecks = new Map();
  function transparentLogo(address) {
    if (address.startsWith('assets/')) return Promise.resolve(true);
    if (!logoChecks.has(address)) {
      logoChecks.set(address,new Promise(resolve => {
        const logo = new Image();
        const timer = setTimeout(() => resolve(false),5500);
        function finish(result) { clearTimeout(timer); resolve(result); }
        logo.crossOrigin = 'anonymous';
        logo.onerror = () => finish(false);
        logo.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 32;
            const context = canvas.getContext('2d',{willReadFrequently:true});
            context.drawImage(logo,0,0,32,32);
            const {data} = context.getImageData(0,0,32,32);
            let transparent = 0;
            for (let pixel=3; pixel<data.length; pixel+=4) if (data[pixel] < 32) transparent++;
            finish(transparent / (32 * 32) > .04);
          } catch { finish(false); }
        };
        logo.src = address;
      }));
    }
    return logoChecks.get(address);
  }
  function read(show) {
    if (!cached.has(show.id)) cached.set(show.id,readLocal(storageKey(show)));
    return cached.get(show.id);
  }
  function save(show,values) {
    const data = Object.assign(read(show),values);
    writeLocal(storageKey(show),data);
  }
  function text(value,max=4000) {
    return typeof value === 'string' ? value.trim().slice(0,max) : '';
  }
  function plain(value) {
    return text(new DOMParser().parseFromString(text(value),'text/html').body.textContent);
  }
  function image(value) {
    const address = mediaAddress(text(value),1,1);
    if (!address) return '';
    const {hostname} = new URL(address);
    return ['avatars.mds.yandex.net','avatars.yandex.net','st.kp.yandex.net','kinopoiskapiunofficial.tech',
      'commons.wikimedia.org','upload.wikimedia.org'].includes(hostname) ? address : '';
  }
  const fresh = time => Date.now() - time < maxAge;
  async function json(url,options) {
    const response = await fetch(url,{credentials:'omit',...options});
    if (response.status === 401 || response.status === 403) throw Error('Кинопоиск не принял ключ. Проверь его в настройках.');
    if (response.status === 429) throw Error('Лимит запросов к источнику исчерпан.');
    if (!response.ok) throw Error('Источник метаданных недоступен.');
    return response.json();
  }
  function keyLookupOptions(signal,key) {
    return {signal,headers:{'X-API-KEY':key},redirect:'error'};
  }
  async function wikidata(show,signal) {
    const imdb = show.imdb?.id;
    if (!/^tt\d{5,12}$/.test(imdb || '')) return {};
    const url = new URL('https://query.wikidata.org/sparql');
    url.searchParams.set('format','json');
    url.searchParams.set('query','SELECT DISTINCT ?id ?logo ?ruTitle ?wikiTitle ?enWikiTitle WHERE { ?s wdt:P345 "' + imdb +
      '" . OPTIONAL { ?s wdt:P2603 ?id } OPTIONAL { ?s wdt:P154 ?logo } ' +
      'OPTIONAL { ?s rdfs:label ?ruTitle . FILTER(LANG(?ruTitle) = "ru") } ' +
      'OPTIONAL { ?article schema:about ?s ; schema:isPartOf <https://ru.wikipedia.org/> ; schema:name ?wikiTitle } OPTIONAL { ?en schema:about ?s ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?enWikiTitle } } LIMIT 12');
    const {results} = await json(url,{signal});
    const rows = results?.bindings || [];
    const ids = [...new Set(rows.map(row => row.id?.value).filter(value => /^[1-9]\d{1,9}$/.test(value || '')))];
    return {
      kpId:ids.length === 1 ? Number(ids[0]) : undefined,
      commonsLogos:[...new Set(rows.map(row => image(row.logo?.value?.replace(/^http:/,'https:'))).filter(Boolean))],
      enWikiTitle:text(rows[0]?.enWikiTitle?.value,230),
      wikiTitle:text(rows[0]?.wikiTitle?.value,230),ruTitle:text(rows[0]?.ruTitle?.value,230)
    };
  }
  async function kinopoiskId(show,signal) {
    const known = knownIds[show.mazeId] || knownImdb[show.imdb?.id] || read(show).kpId;
    if (known) return known;
    const metadata = await wikidata(show,signal);
    if (!signal.aborted && metadata.kpId) save(show,{...metadata,wikiCheckedAt:Date.now()});
    return metadata.kpId || null;
  }
  async function lookupKpId(show,key,signal) {
    if (!/^tt\d{5,12}$/.test(show.imdb?.id || '')) return null;
    const query = new URL('https://kinopoiskapiunofficial.tech/api/v2.2/films');
    query.searchParams.set('keyword',show.original || show.title);
    query.searchParams.set('type','TV_SERIES');
    const result = await json(query,keyLookupOptions(signal,key));
    const candidates = (result.items || []).slice(0,20).filter(item =>
      [show.original,show.title].some(name => name && [item.nameOriginal,item.nameEn,item.nameRu].some(candidate =>
        typeof candidate === 'string' && candidate.toLowerCase() === name.toLowerCase())));
    for (const candidate of candidates.slice(0,3)) {
      if (!Number.isInteger(candidate.kinopoiskId)) continue;
      const detail = await kpRequest(candidate.kinopoiskId,'',key,signal);
      if (detail.imdbId === show.imdb.id) return detail;
    }
    return null;
  }
  const kpRequest = (id,suffix,key,signal) => json('https://kinopoiskapiunofficial.tech/api/v2.2/films/' + id + suffix,
    keyLookupOptions(signal,key));

  async function wikiIntro(title,signal) {
    const query = new URL('https://ru.wikipedia.org/w/api.php');
    for (const [key,value] of Object.entries({action:'query',prop:'extracts',exintro:'1',explaintext:'1',
      exsentences:'3',redirects:'1',format:'json',formatversion:'2',origin:'*',titles:title})) query.searchParams.set(key,value);
    const data = await json(query,{signal});
    const entry = data.query?.pages?.[0];
    if (!entry?.extract || entry.missing) return {};
    return {wikiDescription:text(entry.extract,800),
      wikiSource:'https://ru.wikipedia.org/wiki/' + encodeURIComponent(entry.title.replaceAll(' ','_'))};
  }
  async function articleLogos(show,title,language,signal) {
    if (!title) return [];
    const url = new URL('https://' + language + '.wikipedia.org/w/api.php');
    const common = {action:'query',format:'json',formatversion:'2',origin:'*'};
    for (const [key,value] of Object.entries({...common,prop:'images',imlimit:'50',titles:title})) url.searchParams.set(key,value);
    const data = await json(url,{signal});
    const comparable = value => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
    const names = [show.original,show.title,title.replace(/\s*\([^)]*\)/g,'')].filter(Boolean).map(comparable)
      .filter(name => name.length >= 4);
    const files = (data.query?.pages?.[0]?.images || []).map(entry => entry.title).filter(name => {
      if (!/(logo|wordmark|логотип)/iu.test(name) || !/\.(png|svg|webp)$/i.test(name)) return false;
      return names.some(title => comparable(name).includes(title));
    }).slice(0,5);
    if (!files.length) return [];
    url.search = new URLSearchParams({...common,prop:'imageinfo',iiprop:'url',iiurlwidth:'430',titles:files.join('|')});
    const result = await json(url,{signal});
    return (result.query?.pages || []).map(file => image(file.imageinfo?.[0]?.thumburl || file.imageinfo?.[0]?.url)).filter(Boolean);
  }
  async function load(show,signal,onChange) {
    const data = read(show);
    const key = apiKey();
    const jobs = [];
    const logoAddress = window.konfolyIntegrations?.logoEndpoint;
    if (logoAddress && /^tt\d{5,12}$/.test(show.imdb?.id || '') && !fresh(data.operatorLogosCheckedAt)) {
      jobs.push((async () => {
        const address = mediaAddress(logoAddress,1,1);
        if (!address) return;
        const query = new URL(address);
        query.searchParams.set('imdb',show.imdb.id);
        const result = await json(query,{signal});
        if (signal.aborted) return;
        const logos = (Array.isArray(result.logos) ? result.logos : []).slice(0,8)
          .map(value => typeof value === 'string' && mediaAddress(value,1,1)).filter(Boolean);
        save(show,{operatorLogos:logos,operatorLogosCheckedAt:Date.now()});
        onChange();
      })());
    }
    const token = tmdbToken();
    if (token && !fresh(data.tmdbCheckedAt)) {
      jobs.push((async () => {
        const logos = await tmdbImages(show,signal,token);
        if (signal.aborted) return;
        save(show,{tmdbLogos:logos,tmdbCheckedAt:Date.now()});
        onChange();
      })());
    }
    if (!fresh(data.mazeCheckedAt) && show.mazeId && show.episodes && show.id !== 'interns') {
      jobs.push((async () => {
        const rows = await json('https://api.tvmaze.com/shows/' + show.mazeId + '/episodes',{signal});
        if (signal.aborted) return;
        const summaries = {};
        for (const row of rows) {
          if (Number.isInteger(row.season) && Number.isInteger(row.number) && row.summary) {
            summaries[row.season + ':' + row.number] = plain(row.summary);
          }
        }
        save(show,{maze:summaries,mazeCheckedAt:Date.now()});
        onChange();
      })());
    }
    if (!fresh(data.wikiCheckedAt) || !Object.hasOwn(data,'commonsLogos')) {
      jobs.push((async () => {
        const wiki = await wikidata(show,signal);
        if (signal.aborted) return;
        save(show,{...wiki,wikiCheckedAt:Date.now()});
        onChange();
        const logoJob = Promise.allSettled([
          articleLogos(show,wiki.wikiTitle,'ru',signal),
          articleLogos(show,wiki.enWikiTitle,'en',signal)
        ]).then(outcomes => {
          if (signal.aborted) return;
          const logos = outcomes.flatMap(result => result.status === 'fulfilled' ? result.value : []);
          if (logos.length) { save(show,{wikiLogos:logos}); onChange(); }
        });
        if (wiki.wikiTitle && !/\p{Script=Cyrillic}/u.test(show.description || '')) {
          const intro = await wikiIntro(wiki.wikiTitle,signal);
          if (signal.aborted) return;
          save(show,intro);
          onChange();
        }
        await logoJob;
      })());
    }
    if (key && (!fresh(data.kpCheckedAt) || !Object.hasOwn(data,'kpDescription'))) {
      jobs.push((async () => {
        const id = await kinopoiskId(show,signal).catch(() => null);
        if (signal.aborted) return;
        const detail = id ? await kpRequest(id,'',key,signal) : await lookupKpId(show,key,signal);
        if (!detail || !Number.isInteger(detail.kinopoiskId) ||
            (detail.imdbId && show.imdb?.id && detail.imdbId !== show.imdb.id)) {
          throw Error('Точное совпадение с Кинопоиском не найдено.');
        }
        const kpId = detail.kinopoiskId;
        const result = await kpRequest(kpId,'/seasons',key,signal);
        if (signal.aborted) return;
        const episodes = {};
        for (const season of result.items || []) {
          for (const ep of season.episodes || []) {
            if (!Number.isInteger(ep.seasonNumber) || !Number.isInteger(ep.episodeNumber)) continue;
            episodes[ep.seasonNumber + ':' + ep.episodeNumber] = {
              title:text(ep.nameRu,300),original:text(ep.nameEn,300),description:plain(ep.synopsis)
            };
          }
        }
        save(show,{kpId,kpTitle:text(detail.nameRu,200),kpDescription:plain(detail.shortDescription || detail.description),
          kpLogo:image(detail.logoUrl),kp:episodes,kpCheckedAt:Date.now()});
        onChange();
      })());
    }
    const results = await Promise.allSettled(jobs);
    const failure = results.find(result => result.status === 'rejected');
    if (failure && !signal.aborted) throw failure.reason;
  }

  const normalize = value => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu,'').replace(/^bojackhorseman/,'');
  function episode(show,item) {
    const data = read(show);
    const id = itemKey(item);
    let kpId = id;
    if (show.mazeId === 3391 && show.id !== 'interns') {
      try { kpId = itemKey(providerEpisode(show,item)); } catch { kpId = ''; }
    }
    const kp = data.kp?.[kpId];
    const match = kp && (!kp.original || !item.title || /^Серия \d+$/.test(item.title) || normalize(kp.original) === normalize(item.title)) ? kp : null;
    const localTitle = localizedSeriesTitle(show,item);
    return {
      title:match?.title || (localTitle !== item.title ? localTitle : '') || data.translated?.[id]?.title || item.title,
      description:match?.description || data.translated?.[id]?.description || data.maze?.[id] || item.synopsis || '',
      source:match?.description ? 'Кинопоиск' : data.translated?.[id]?.description ? 'Машинный перевод · TVmaze' : 'TVmaze',
      translated:!!(match?.title || localTitle !== item.title || data.translated?.[id]?.title)
    };
  }

  function details(show) {
    const data = read(show);
    const description = data.kpDescription ? {text:data.kpDescription,source:'https://www.kinopoisk.ru/series/' + data.kpId + '/',label:'Кинопоиск'} :
      /\p{Script=Cyrillic}/u.test(show.description || '') ? {text:show.description} :
      data.wikiDescription ? {text:data.wikiDescription,source:data.wikiSource,label:'Википедия'} :
      data.translatedShow?.description ? {text:data.translatedShow.description,label:'Машинный перевод'} : {text:show.description || ''};
    return {title:data.kpTitle || data.ruTitle || data.translatedShow?.title || show.title,description};
  }
  async function translateShow(show,signal,onChange) {
    const original = details(show);
    const translator = await globalThis.Translator.create({sourceLanguage:languages[show.language] || 'en',targetLanguage:'ru',signal});
    try {
      const output = {};
      if (!/\p{Script=Cyrillic}/u.test(original.title)) output.title = text(await translator.translate(show.title,{signal}),230);
      if (show.description && !/\p{Script=Cyrillic}/u.test(original.description.text)) {
        output.description = text(await translator.translate(show.description,{signal}),800);
      }
      if (!signal.aborted) {
        save(show,{translatedShow:{...read(show).translatedShow,...output}});
        onChange();
      }
    } finally { translator.destroy(); }
  }
  function canTranslate(show) {
    return typeof globalThis.Translator?.create === 'function' && show.language !== 'Russian';
  }
  async function translate(show,items,signal,onChange) {
    const sourceLanguage = languages[show.language] || 'en';
    const translator = await globalThis.Translator.create({sourceLanguage,targetLanguage:'ru',signal});
    const data = read(show);
    const translated = {...data.translated};
    try {
      for (const item of items) {
        if (signal.aborted) return;
        const id = itemKey(item);
        const info = episode(show,item);
        const next = {...translated[id]};
        if (!info.translated && item.title) next.title = text(await translator.translate(item.title,{signal}),300);
        const summary = data.maze?.[id] || item.synopsis;
        if (summary && info.source === 'TVmaze') next.description = text(await translator.translate(summary,{signal}));
        if (next.title || next.description) translated[id] = next;
      }
      if (!signal.aborted) {
        save(show,{translated});
        onChange();
      }
    } finally { translator.destroy(); }
  }

  return {apiKey,setApiKey,tmdbToken,setTmdbToken,transparentLogo,read,load,episode,kinopoiskId,details,translateShow,canTranslate,translate,plain};
})();
