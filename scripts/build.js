'use strict';
const fs = require('fs');
const path = require('path');
const { pages, render } = require('../src/site');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
fs.cpSync(path.join(root, 'public'), dist, { recursive: true });

for (const page of pages) {
  const out = path.join(dist, page.file);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, render(page));
}
fs.writeFileSync(
  path.join(dist, 'sitemap.xml'),
  '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    pages.filter((p) => !p.hidden).map((p) => `  <url><loc>${process.env.SITE_URL || ''}${p.path}</loc></url>`).join('\n') +
    '\n</urlset>\n'
);
fs.writeFileSync(path.join(dist, 'robots.txt'), 'User-agent: *\nAllow: /\n');
console.log(`Built ${pages.length} pages into dist/`);
