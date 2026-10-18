// A tiny stand-in for a Skyward server, for testing Skyward Glow locally.
//
//   node test/server.js        then open http://localhost:8790/test/mock-gradebook.html
//
// Static files are served from the repo root. Requests for "*.w" pages act
// like Skyward: they need the session field (encses=mock123) from the
// gradebook page, otherwise they get a login page back.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 8790;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const LOGIN = '<!doctype html><title>Skyward Login</title><form><input name="user"><input type="password" name="pass"></form>';

function send(res, status, body, type = 'text/html') {
  res.writeHead(status, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    if (url.pathname.endsWith('.w')) {
      const params = new URLSearchParams(req.method === 'POST' ? body : url.search);
      if (params.get('encses') !== 'mock123') return send(res, 200, LOGIN);
      const page = path.join(ROOT, 'test', 'pages', path.basename(url.pathname, '.w') + '.html');
      if (!fs.existsSync(page)) return send(res, 404, '<!doctype html><title>404</title><h1>Not found</h1>');
      return send(res, 200, fs.readFileSync(page));
    }
    if (req.method !== 'GET') return send(res, 405, 'Method not allowed', 'text/plain');
    const file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (!file.startsWith(ROOT)) return send(res, 403, 'Forbidden', 'text/plain');
    const target = fs.existsSync(file) && fs.statSync(file).isDirectory() ? path.join(file, 'index.html') : file;
    if (!fs.existsSync(target)) return send(res, 404, '<!doctype html><title>404</title><h1>Not found</h1>');
    send(res, 200, fs.readFileSync(target), TYPES[path.extname(target)] || 'application/octet-stream');
  });
}).listen(PORT, () => console.log('Mock Skyward on http://localhost:' + PORT + '/test/mock-gradebook.html'));
