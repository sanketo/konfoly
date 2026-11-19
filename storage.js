function readLocal(key) {
  try { return JSON.parse(localStorage.getItem(key)) || {}; } catch { return {}; }
}

function writeLocal(key,value) {
  try {
    localStorage.setItem(key,JSON.stringify(value));
    return true;
  } catch { return false; }
}

export {readLocal, writeLocal};
