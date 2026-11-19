const fs = require('node:fs');
const path = require('node:path');

module.exports = name => fs.readFileSync(path.join(__dirname,'..',name),'utf8')
  .replace(/\r\n/g,'\n')
  .replace(/^import .*;\n/gm,'')
  .replace(/^export \{.*\};\n/gm,'');
