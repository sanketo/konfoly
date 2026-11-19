const fs = require('node:fs');
const path = require('node:path');

module.exports = name => fs.readFileSync(path.join(__dirname,'..',name),'utf8')
  .replace(/^import .*;\n/gm,'')
  .replace(/^export \{.*\};\n/gm,'');
