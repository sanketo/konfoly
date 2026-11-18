const showRatingKey = 'mentalist';

function ratingText(score) {
  return score.toLocaleString('ru-RU',{minimumFractionDigits:1,maximumFractionDigits:1});
}

function seasonRating(season) {
  const episodes = episodeCatalog.filter(episode => episode.season === season);
  const scores = episodes.map(episode => externalRatingData.episodes[key(episode)]?.score)
    .filter(Number.isFinite);
  return scores.length ? {
    score:scores.reduce((sum,value) => sum + value,0) / scores.length,
    count:scores.length,total:episodes.length
  } : null;
}

function ratingBadge(label,record,url) {
  if (!record) return null;
  const badge = make(url ? 'a' : 'span','rating-chip');
  badge.append(make('span','rating-source',label),make('strong',null,ratingText(record.score)));
  if (url) {
    badge.href = url;
    badge.target = '_blank';
    badge.rel = 'noopener noreferrer';
  }
  if (record.votes) {
    const votes = record.votes.toLocaleString('ru-RU');
    badge.setAttribute('aria-label',label + ' ' + ratingText(record.score) + ' из 10, число голосов ' + votes);
    if (url) badge.append(make('small','rating-votes',votes + ' оценок'));
  }
  return badge;
}

function ratingSeasonLabel(season) {
  return 'Сезон ' + season;
}

function episodeRatingTarget(episode) {
  return {id:'episode:' + key(episode),label:'Сезон ' + episode.season + ' · Серия ' + episode.episode};
}

function setPersonalRatingButton(button,target) {
  const score = readLocal(showRatingKey + '-ratings-v1')[target.id];
  button.textContent = Number.isInteger(score) ? 'Моя оценка · ' + score + '/10' : 'Моя оценка';
  button.onclick = () => openPersonalRating(target,button);
}

function openPersonalRating(target,opener) {
  const storageKey = showRatingKey + '-ratings-v1';
  const stored = readLocal(storageKey);
  const selected = stored[target.id];
  $('rating-target').textContent = target.label;
  const save = score => {
    const values = readLocal(storageKey);
    if (score === null) delete values[target.id];
    else values[target.id] = score;
    writeLocal(storageKey,values);
    $('rating-dialog').close();
    setPersonalRatingButton(opener,target);
  };
  const slider = $('rating-slider');
  function preview() {
    const score = Number(slider.value);
    slider.style.setProperty('--rating-progress',((score - 1) / 9 * 100) + '%');
    slider.setAttribute('aria-valuetext',score + ' из 10');
    $('rating-current').textContent = score + ' из 10';
  }
  slider.value = Number.isInteger(selected) && selected >= 1 && selected <= 10 ? String(selected) : '5';
  slider.oninput = preview;
  $('rating-form').onsubmit = event => {
    event.preventDefault();
    const score = Number(slider.value);
    if (Number.isInteger(score) && score >= 1 && score <= 10) save(score);
  };
  preview();
  $('rating-clear').hidden = !Number.isInteger(selected);
  $('rating-clear').onclick = () => save(null);
  openSheet('rating-dialog');
}

function renderSeriesRatings() {
  const {imdb,kinopoisk} = externalRatingData.series;
  $('series-ratings').replaceChildren(
    ...[
      ratingBadge('IMDb',imdb,imdb && 'https://www.imdb.com/title/' + imdb.id + '/ratings/'),
      ratingBadge('Кинопоиск',kinopoisk,kinopoisk && 'https://www.kinopoisk.ru/series/' + kinopoisk.id + '/')
    ].filter(Boolean)
  );
  setPersonalRatingButton($('rate-show'),{id:'series',label:'Менталист'});
}

function renderSeasonRatings(season) {
  $('season-rating-row').hidden = !season;
  const target = $('season-rating');
  if (!season) {
    target.replaceChildren();
    return;
  }
  const summary = seasonRating(season);
  const badge = ratingBadge('IMDb',summary,summary && 'https://www.imdb.com/title/' + externalRatingData.series.imdb.id + '/episodes/?season=' + season);
  target.replaceChildren();
  if (badge) {
    badge.append(make('small','rating-votes','Среднее по сериям · ' + summary.count + ' из ' + summary.total));
    target.append(badge);
  }
  setPersonalRatingButton($('rate-season'),{id:'season:' + season,label:ratingSeasonLabel(season)});
}

function renderEpisodeRatings(episode) {
  const rating = externalRatingData.episodes[key(episode)];
  const badge = ratingBadge('IMDb',rating,rating && 'https://www.imdb.com/title/' + rating.id + '/ratings/');
  $('episode-ratings').replaceChildren(...(badge ? [badge] : []));
  setPersonalRatingButton($('rate-episode'),episodeRatingTarget(episode));
}
