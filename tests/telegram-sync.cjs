const source=require('./load-source.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

async function run() {
  const cloud = new Map();
  let writes = 0;
  const storage = {
    getKeys: callback => callback(null,[...cloud.keys()]),
    getItems: (keys,callback) => callback(null,Object.fromEntries(keys.map(key => [key,cloud.get(key)]))),
    getItem: (key,callback) => callback(null,cloud.get(key) || ''),
    setItem: (key,value,callback) => { writes++;cloud.set(key,value);callback(null,true); }
  };
  const context = vm.createContext({setTimeout,clearTimeout});
  vm.runInContext(source('telegram-sync.js'),context);
  const merged = [];
  const sync = context.createTelegramSync(storage,{onMerge: entries => merged.push(...entries),onStatus(){}});
  const local = {season:4,episode:11,time:100,duration:2500,updatedAt:1000,voice:'ТВ3',url:'excluded'};
  sync.queue(local);
  await sync.flush();
  const key = 'mentalist_episode_4_11';
  assert.equal(JSON.parse(cloud.get(key)).time,100);
  assert.equal(JSON.parse(cloud.get(key)).url,undefined);
  cloud.set(key,JSON.stringify({...local,time:220,updatedAt:2000}));
  sync.queue(local);
  await sync.flush();
  assert.equal(writes,1);
  assert.equal(merged.at(-1).time,220);
  cloud.set('mentalist_episode_7_24',JSON.stringify(local));
  cloud.set('unrelated_key',JSON.stringify(local));
  await sync.pull();
  assert.equal(merged.length,2);
  assert.equal(merged.at(-1).episode,11);
  console.log('PASS Telegram CloudStorage: progress sync, newer remote wins, no URLs, invalid keys ignored');
}
run().catch(error => {console.error(error);process.exitCode = 1;});
