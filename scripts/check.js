// Makes sure everything the app needs is in place before an installer is built.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const need = [
  ['src/vendor/lame.min.js', 'MP3 encoder (run "npm install")'],
  ['src/assets/logo.png', 'app icon'],
  ['src/assets/hb-logo.png', 'header logo'],
  ['src/index.html', 'app page'],
  ['build/installer.nsh', 'Windows installer checks'],
];
const missing = need.filter(([f]) => !fs.existsSync(path.join(root, f)));
for (const [f, what] of missing) console.error(`Missing ${f} — ${what}`);
if (missing.length) process.exit(1);
console.log('Everything the installer needs is here.');
