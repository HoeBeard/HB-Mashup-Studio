// Copies the MP3 encoder into the app so it works offline on computers and phones.
const fs = require('fs'), path = require('path');
const from = path.join(__dirname, '..', 'node_modules', 'lamejs', 'lame.min.js');
const to = path.join(__dirname, '..', 'src', 'vendor', 'lame.min.js');
if (!fs.existsSync(from)) {
  console.error('lamejs is missing, so MP3 export would not work. Run "npm install" again.');
  process.exit(1);
}
fs.mkdirSync(path.dirname(to), { recursive: true });
fs.copyFileSync(from, to);
console.log('MP3 encoder ready');
