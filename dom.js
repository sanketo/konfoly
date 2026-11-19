import {platform} from './platform.js';

const $ = id => document.getElementById(id);

function make(tag, className, content) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content !== undefined) element.textContent = content;
  return element;
}

function openSheet(id) {
  const sheet = $(id);
  if (!sheet.open) sheet.showModal();
  platform.showBack(true);
}

function episodeId(season,episode) { return season + ':' + episode; }

function key(item) { return episodeId(item.season,item.episode); }

export {$, make, openSheet, episodeId, key};
