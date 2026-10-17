const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', 'public');
const required = ['index.html', '404.html', 'styles.css', 'app.js', 'assets/hero.jpg'];
const missing = required.filter((f) => !fs.existsSync(path.join(root, f)));
if (missing.length) { console.error('Missing files: ' + missing.join(', ')); process.exit(1); }
console.log('Static site verified: ' + required.length + ' files present.');
