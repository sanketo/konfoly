function mediaAddress(template, season, episode) {
  try {
    const url = new URL(template.replaceAll('{season}', season).replaceAll('{episode}', episode));
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export {mediaAddress};
