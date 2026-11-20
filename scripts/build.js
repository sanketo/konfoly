import {cp, mkdir, readFile, readdir, unlink, writeFile} from 'node:fs/promises';
import {basename, dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {allowedOrigins, telegramSdk} from '../integrations.js';
import {cinemetaOrigin, cinemetaImages} from '../cinemeta.js';
import {translationOrigin} from '../description-translation.js';
import {appleRatingsOrigin} from '../series-age-ratings.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)),'..');
const out = resolve(root,'dist');
const sdk = new URL(telegramSdk);
const metricaId = (process.env.KONFOLY_METRICA_ID ?? '114391998').trim();
if (!/^(?:0|[1-9]\d{0,11})$/.test(metricaId)) throw Error('KONFOLY_METRICA_ID must be a numeric counter ID or 0');
const metricaHosts = Number(metricaId) ? ['https://mc.yandex.ru'] : [];
const sourcePolicy = [
  "default-src 'self'", "base-uri 'none'", "object-src 'none'", "form-action 'self'",
  "script-src 'self' " + [sdk.origin + sdk.pathname,...(metricaHosts.length ? [...metricaHosts,'https://yastatic.net'] : [])].join(' '),
  "style-src 'self'",
  "worker-src 'self' blob:",
  "img-src 'self' data: blob: https://static.tvmaze.com https://*.wikimedia.org https://image.tmdb.org https://avatars.mds.yandex.net https://avatars.yandex.net https://st.kp.yandex.net https://kinopoiskapiunofficial.tech " + [...cinemetaImages,...allowedOrigins.image,...metricaHosts].join(' '),
  "media-src 'self' blob: " + allowedOrigins.media.join(' '),
  "connect-src 'self' https://api.tvmaze.com https://*.wikidata.org https://*.wikipedia.org https://*.wikimedia.org https://api.themoviedb.org https://kinopoiskapiunofficial.tech " +
    [cinemetaOrigin,translationOrigin,appleRatingsOrigin,...allowedOrigins.connect,...metricaHosts].join(' '),
  'frame-src ' + (allowedOrigins.frame.join(' ') || "'none'")
].map(value => value.trim()).join('; ');

await mkdir(out,{recursive:true});
const entries = {app:'app.js',style:'style.css',boot:'boot.js'};
const result = await build({
  absWorkingDir:root,
  entryPoints:entries,outdir:out,entryNames:'[name]-[hash]',bundle:true,metafile:true,
  format:'esm',write:false,target:['es2022','safari16'],external:['./assets/*'],minify:true,
  define:{'globalThis.KONFOLY_METRICA_ID':JSON.stringify(Number(metricaId) || 0)}
});
const html = await readFile(resolve(root,'index.html'),'utf8');
let index = html.replace('<meta name="konfoly-csp">','<meta http-equiv="Content-Security-Policy" content="' + sourcePolicy + '">');
for (const [path,info] of Object.entries(result.metafile.outputs)) {
  if (info.entryPoint) index = index.replace('"' + info.entryPoint + '"','"' + basename(path) + '"');
}
for (const file of result.outputFiles) await writeFile(file.path,file.contents);
for (const entry of ['assets','vendor']) await cp(resolve(root,entry),resolve(out,entry),{recursive:true});
for (const filename of ['.nojekyll','LICENSE','README.md']) await cp(resolve(root,filename),resolve(out,filename));
await writeFile(resolve(out,'index.html'),index);
const current = new Set(result.outputFiles.map(file => basename(file.path)));
for (const name of await readdir(out)) {
  if (/^(app|boot|style)-[A-Z0-9]+\.(js|css)$/.test(name) && !current.has(name)) await unlink(resolve(out,name));
}
