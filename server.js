const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, 'public');
const PORT = process.env.PORT || 3000;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.jpg': 'image/jpeg',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.ico': 'image/x-icon'
};
const HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'"
};

function createServer() {
  return http.createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end('ok');
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      return res.end();
    }
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname); }
    catch { res.writeHead(400); return res.end(); }
    if (pathname.endsWith('/')) pathname += 'index.html';
    const file = path.join(ROOT, pathname);
    if (file !== ROOT && !file.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      const ok = !err;
      const body = ok ? data : fs.readFileSync(path.join(ROOT, '404.html'));
      const type = ok ? TYPES[path.extname(file)] || 'application/octet-stream' : TYPES['.html'];
      res.writeHead(ok ? 200 : 404, {
        ...HEADERS, 'Content-Type': type,
        'Cache-Control': ok && type.startsWith('image') ? 'public, max-age=86400' : 'no-cache'
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    });
  });
}

if (require.main === module) {
  createServer().listen(PORT, '0.0.0.0', () => console.log(`SVBT site listening on ${PORT}`));
}
module.exports = { createServer };
