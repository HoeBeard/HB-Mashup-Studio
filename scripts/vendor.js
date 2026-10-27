// Copies the MP3 encoder into the app so it works offline on computers and phones.
const fs = require('fs'), path = require('path');
const from = path.join(__dirname, '..', 'node_modules', 'lamejs', 'lame.min.js');
const to = path.join(__dirname, '..', 'src', 'vendor', 'lame.min.js');
if (fs.existsSync(from)) { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); console.log('MP3 encoder ready'); }
else console.warn('lamejs not found — MP3 export will be unavailable');
