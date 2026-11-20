const previous = /^\/konfoly-beta\/series\/([a-z0-9-]+)(?:\/season\/(all|[1-9]\d*)(?:\/episode\/([1-9]\d*))?)?\/?$/.exec(location.pathname);
if (previous) {
  const [,id,season,episode] = previous;
  const target = new URL('/konfoly-beta/',location.origin);
  target.search = location.search;
  target.searchParams.set('series',id);
  target.searchParams.delete('season');
  target.searchParams.delete('episode');
  if (season) target.searchParams.set('season',season);
  if (episode && season !== 'all') target.searchParams.set('episode',episode);
  location.replace(target);
}
