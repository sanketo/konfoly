// Telegram owns access to CloudStorage. Store progress only, never credentials or source URLs.
function createTelegramSync(storage, {onMerge, onStatus}) {
  const prefix = 'mentalist_episode_';
  const matches = /^mentalist_episode_([1-7])_([1-9]|1\d|2[0-4])$/;
  const limits = [23,23,24,24,22,22,13];
  const pending = new Map();
  let timer, writing = false, loading = false, retryDelay = 3500;

  function storageCall(method, ...args) {
    return new Promise((resolve,reject) => {
      storage[method](...args,(error,value) => error ? reject(Error(String(error))) : resolve(value));
    });
  }

  function clean(entry, season, episode) {
    if (episode > (limits[season - 1] || 0) || !entry ||
        !Number.isFinite(entry.updatedAt) || entry.updatedAt < 0 ||
        !Number.isFinite(entry.time) || entry.time < 0 ||
        !Number.isFinite(entry.duration) || entry.duration <= 0 || entry.duration > 86400) return null;
    return {
      season, episode, updatedAt:entry.updatedAt, time:Math.min(entry.time,entry.duration),
      duration:entry.duration, completed:entry.completed === true,
      source:['file','custom'].includes(entry.source) ? entry.source : 'native',
      voice:['ТВ3','Universal Russia','TVShows'].includes(entry.voice) ? entry.voice : null
    };
  }

  function schedule() {
    if (!timer && pending.size) timer = setTimeout(() => {timer = null;void flush()},retryDelay);
  }

  async function pull() {
    if (loading || writing) return;
    loading = true;
    onStatus('Синхронизация с Telegram…');
    try {
      const keys = (await storageCall('getKeys')).filter(key => matches.test(key));
      const values = keys.length ? await storageCall('getItems',keys) : {};
      const entries = [];
      for (const key of keys) {
        const [,season,episode] = matches.exec(key);
        try {
          const entry = clean(JSON.parse(values[key]),Number(season),Number(episode));
          if (entry) entries.push(entry);
        } catch {}
      }
      onMerge(entries);
      onStatus('История синхронизируется через Telegram.');
    } catch {
      onStatus('Облако Telegram недоступно. История сохраняется на этом устройстве.');
    } finally {loading = false;schedule()}
  }

  function queue(entry) {
    const cleaned = clean(entry,entry.season,entry.episode);
    if (!cleaned) return;
    pending.set(prefix + cleaned.season + '_' + cleaned.episode,cleaned);
    schedule();
  }

  async function flush() {
    clearTimeout(timer);
    timer = null;
    if (writing || loading || !pending.size) return;
    writing = true;
    try {
      for (const [key,entry] of [...pending]) {
        let remote;
        try {remote = JSON.parse(await storageCall('getItem',key))} catch (error) {
          if (!(error instanceof SyntaxError)) throw error;
        }
        if (remote?.updatedAt > entry.updatedAt) onMerge([clean(remote,entry.season,entry.episode)].filter(Boolean));
        else await storageCall('setItem',key,JSON.stringify(entry));
        if (pending.get(key) === entry) pending.delete(key);
      }
      retryDelay = 3500;
      onStatus('История синхронизируется через Telegram.');
    } catch {
      retryDelay = Math.min(retryDelay * 2,60000);
      onStatus('История сохранена на устройстве. Синхронизация повторится.');
    } finally {writing = false;schedule()}
  }

  return {pull,queue,flush};
}

export {createTelegramSync};
