const availabilityLabels = {
  PARTIAL:'Доступна часть серий',
  MISSING_PLAYER:'Источник видео не найден',
  UNVERIFIED:'Источник видео не проверен'
};

const normalizeTitle = title => (title || '').normalize('NFKC').toLowerCase().replaceAll('ё','е')
  .replace(/[^\p{L}\p{N}]/gu,'');
const yearOf = show => String(show.year ?? show.years ?? '').match(/^\d{4}/)?.[0];
const imdbOf = show => show.imdb?.id || show.imdbId;

function findCatalogShow(shows,entry) {
  const imdb = imdbOf(entry);
  const tmdb = entry.tmdbId;
  const exact = imdb && shows.find(show => imdbOf(show) === imdb) ||
    tmdb && shows.find(show => show.tmdbId === tmdb && !(imdb && imdbOf(show) && imdbOf(show) !== imdb));
  if (exact) return exact;
  const year = yearOf(entry);
  if (!year) return undefined;
  const names = [entry.title,entry.original,entry.originalTitle].map(normalizeTitle).filter(Boolean);
  const matches = shows.filter(show => yearOf(show) === year && !(imdb && imdbOf(show) && imdbOf(show) !== imdb) &&
    !(tmdb && show.tmdbId && show.tmdbId !== tmdb) &&
    [show.title,show.original,show.originalTitle].some(title => names.includes(normalizeTitle(title))));
  return matches.length === 1 ? matches[0] : undefined;
}

function catalogRecordId(entry) {
  return entry.imdbId ? 'imdb-' + entry.imdbId : 'tmdb-' + entry.tmdbId;
}

function episodeAvailability(record,episode,{directOnly=false}={}) {
  if (!record) return null;
  if (directOnly && record.confirmed?.length) {
    const direct = key => record.confirmedProviders?.[key]?.some(provider => provider === 'video' || provider === 'manifest');
    if (episode) return direct(episode.season + ':' + episode.episode) ? 'AVAILABLE' : 'MISSING_PLAYER';
    const count = record.confirmed.filter(direct).length;
    if (!count) return 'MISSING_PLAYER';
    return count === record.confirmed.length && record.availability === 'AVAILABLE' ? 'AVAILABLE' : 'PARTIAL';
  }
  if (!episode) return record.availability;
  if (record.confirmed?.includes(episode.season + ':' + episode.episode)) return 'AVAILABLE';
  return record.availability === 'UNVERIFIED' ? 'UNVERIFIED' : 'MISSING_PLAYER';
}

function sourceRevision(source) {
  if (!source) return null;
  const addresses = JSON.stringify([source.video,source.manifest,source.authorization,source.officialEpisodes]);
  let fingerprint = 2166136261;
  for (const char of addresses) fingerprint = Math.imul(fingerprint ^ char.codePointAt(0),16777619);
  return (fingerprint >>> 0).toString(16);
}

export {availabilityLabels, catalogRecordId, episodeAvailability, findCatalogShow, sourceRevision};
