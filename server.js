'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { validateContact } = require('./src/contact');

const DIST = path.join(__dirname, 'dist');
const PORT = process.env.PORT || 3000;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8', '.json': 'application/json'
};
const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; form-action 'self'; frame-ancestors 'none'"
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY, ...headers });
  res.end(body);
}

function readBody(req, limit = 20000) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > limit) { reject(new Error('too large')); req.destroy(); }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function serveFile(res, file, status = 200, method = 'GET') {
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 500, 'Server error');
    const ext = path.extname(file);
    const cache = ext === '.html' ? 'no-cache' : 'public, max-age=86400';
    send(res, status, method === 'HEAD' ? '' : buf, { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': cache });
  });
}

const server = http.createServer(async (req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch { return send(res, 400, 'Bad request'); }

  if (pathname === '/healthz') return send(res, 200, 'ok', { 'Content-Type': 'text/plain' });

  if (pathname === '/api/contact') {
    if (req.method !== 'POST') return send(res, 405, 'Method not allowed', { Allow: 'POST' });
    let raw;
    try { raw = await readBody(req); } catch { return send(res, 413, 'Too large'); }
    const ct = req.headers['content-type'] || '';
    let fields;
    try {
      fields = ct.includes('application/json') ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw));
    } catch { fields = {}; }
    const { errors, value } = validateContact(fields);
    const wantsJson = (req.headers.accept || '').includes('application/json');
    if (Object.keys(errors).length) {
      return wantsJson
        ? send(res, 400, JSON.stringify({ ok: false, errors }), { 'Content-Type': 'application/json' })
        : send(res, 303, '', { Location: '/contact.html?error=1' });
    }
    console.log('contact-request', JSON.stringify({ topic: value.topic, at: new Date().toISOString() }));
    return wantsJson
      ? send(res, 200, JSON.stringify({ ok: true }), { 'Content-Type': 'application/json' })
      : send(res, 303, '', { Location: '/contact.html?sent=1' });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', { Allow: 'GET, HEAD' });

  const rel = pathname.endsWith('/') ? pathname + 'index.html' : pathname;
  let file = path.join(DIST, path.normalize(rel));
  if (!file.startsWith(DIST + path.sep)) return send(res, 403, 'Forbidden');
  if (!path.extname(file) && fs.existsSync(file + '.html')) file += '.html';
  if (fs.existsSync(file) && fs.statSync(file).isFile()) return serveFile(res, file, 200, req.method);
  serveFile(res, path.join(DIST, '404.html'), 404, req.method);
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`SVBT site listening on ${PORT}`));
}
module.exports = server;
