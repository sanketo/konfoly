const translationOrigin = 'https://api.mymemory.translated.net';

function descriptionLanguage(description) {
  for (const [script,language] of [
    [/\p{Script=Hiragana}|\p{Script=Katakana}/u,'ja'],[/\p{Script=Hangul}/u,'ko'],
    [/\p{Script=Han}/u,'zh'],[/\p{Script=Arabic}/u,'ar'],[/\p{Script=Hebrew}/u,'he']
  ]) {
    if (script.test(description)) return language;
  }
  return 'en';
}

function translationSegments(description) {
  const encoder = new TextEncoder();
  const segments = [];
  let segment = '';
  let bytes = 0;
  for (const word of description.match(/\S+\s*/gu) || []) {
    const units = encoder.encode(word).length <= 500 ? [word] : [...word];
    for (const unit of units) {
      const size = encoder.encode(unit).length;
      if (bytes + size > 500) {
        if (segment.trim()) segments.push(segment.trim());
        segment = '';
        bytes = 0;
      }
      segment += unit;
      bytes += size;
    }
  }
  if (segment.trim()) segments.push(segment.trim());
  return segments;
}

async function translatePublicDescription(description,sourceLanguage,signal,targetLanguage='ru') {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal.aborted) throw signal.reason;
  signal.addEventListener('abort',abort,{once:true});
  const timer = setTimeout(abort,15000);
  try {
    const translations = await Promise.all(translationSegments(description).map(async segment => {
      const url = new URL('/get',translationOrigin);
      url.search = new URLSearchParams({q:segment,langpair:sourceLanguage + '|' + targetLanguage});
      const response = await fetch(url,{signal:controller.signal,credentials:'omit',redirect:'error'});
      if (!response.ok) throw Error('Сервис перевода недоступен.');
      const result = await response.json();
      const translated = result.responseData?.translatedText;
      const expectedScript = targetLanguage === 'ru' ? /\p{Script=Cyrillic}/u : /\p{Script=Latin}/u;
      if (Number(result.responseStatus) !== 200 || typeof translated !== 'string' ||
          !expectedScript.test(translated) || translated.trim() === segment) {
        throw Error('Сервис не вернул перевод.');
      }
      return translated.trim();
    }));
    return translations.join(' ');
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort',abort);
    controller.abort();
  }
}

export {descriptionLanguage, translatePublicDescription, translationOrigin};
