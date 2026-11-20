const legacyEpisode = /^\/mentalist\/season\/(\d+)\/episode\/(\d+)\/?$/.exec(location.pathname);
if (legacyEpisode) {
  const [,season,episode] = legacyEpisode;
  if (episodeCatalog.some(item => item.season === Number(season) && item.episode === Number(episode))) {
    const target = new URL(mentalistPages.path(Number(season),Number(episode)),location.origin);
    for (const [key,value] of new URLSearchParams(location.search)) {
      if (key !== 'episode') target.searchParams.append(key,value);
    }
    location.replace(target);
  }
}
