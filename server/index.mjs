import http from 'node:http';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Studio } from './studio.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.webm': 'video/webm', '.wav': 'audio/wav', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml' };
const json = (res, value, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
async function body(req) {
  let size = 0, chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 48 * 1024 * 1024) throw new Error('File is too large (32 MB maximum).'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
async function fileResponse(req, res, filename, download = false) {
  const stat = await fs.stat(filename);
  if (!stat.isFile()) throw new Error('File not found');
  const headers = { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream', 'Content-Length': stat.size, 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff' };
  if (download) headers['Content-Disposition'] = `attachment; filename="${path.basename(filename)}"`;
  const range = req.headers.range;
  let start = 0, end = stat.size - 1, code = 200;
  if (range) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(range);
    if (!match) { res.writeHead(416); res.end(); return; }
    start = Number(match[1]); end = match[2] ? Number(match[2]) : end;
    if (start > end || start >= stat.size || end >= stat.size) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); res.end(); return; }
    code = 206; headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`; headers['Content-Length'] = end - start + 1;
  }
  res.writeHead(code, headers);
  if (req.method === 'HEAD' || !stat.size) return res.end();
  const stream = createReadStream(filename, { start, end });
  stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res);
}
export async function startServer({ port = 4317, dataDir = process.env.TIM_DATA_DIR || path.join(root, 'data'), staticDir = path.join(root, 'dist'), autoSetup = process.env.TIM_AUTO_SETUP !== '0', telemetry = true, libraryRoot } = {}) {
  const studio = new Studio(dataDir); studio.on('error', error => console.error('Studio:', error.message)); await studio.init({ telemetry, libraryRoot });
  const clients = new Set();
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const actualPort = server.address().port;
    const hosts = [`127.0.0.1:${actualPort}`, `localhost:${actualPort}`];
    if (!hosts.includes(req.headers.host)) return json(res, { error: 'Local requests only.' }, 403);
    const url = new URL(req.url, `http://${req.headers.host}`);
    const origin = req.headers.origin;
    const allowed = [`http://127.0.0.1:${actualPort}`, `http://localhost:${actualPort}`];
    if (process.env.TIM_DEV === '1') allowed.push('http://127.0.0.1:5173');
    if (origin && !allowed.includes(origin)) return json(res, { error: 'Invalid origin.' }, 403);
    if (!['GET', 'HEAD'].includes(req.method) && req.headers['x-tim-request'] !== '1') return json(res, { error: 'Invalid request.' }, 403);
    try {
      if (url.pathname === '/api/state') return json(res, studio.snapshot());
      if (url.pathname === '/api/events' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        res.write(`data: ${JSON.stringify(studio.snapshot())}\n\n`); clients.add(res);
        const keep = setInterval(() => res.write(': keepalive\n\n'), 20000);
        req.on('close', () => { clearInterval(keep); clients.delete(res); }); return;
      }
      if (url.pathname === '/api/sessions' && req.method === 'POST') return json(res, await studio.newSession());
      if (url.pathname === '/api/jobs' && req.method === 'POST') return json(res, await studio.enqueue(await body(req)));
      if (url.pathname === '/api/cancel' && req.method === 'POST') { await studio.cancel((await body(req)).id); return json(res, { ok: true }); }
      if (url.pathname === '/api/settings' && req.method === 'POST') { await studio.updateSettings(await body(req)); return json(res, { ok: true }); }
      if (url.pathname === '/api/rescan' && req.method === 'POST') { await studio.rescan(); return json(res, { ok: true }); }
      if (url.pathname === '/api/setup' && req.method === 'POST') { await studio.setupGuide(); return json(res, { ok: true }); }
      if (url.pathname === '/api/models/download' && req.method === 'POST') return json(res, await studio.downloads.start((await body(req)).id));
      if (url.pathname === '/api/models/cancel' && req.method === 'POST') return json(res, await studio.downloads.cancel((await body(req)).id));
      if (url.pathname === '/api/models/load' && req.method === 'POST') { await studio.loadModel((await body(req)).id); return json(res, { ok: true }); }
      if (url.pathname === '/api/models/unload' && req.method === 'POST') { await studio.unloadModel((await body(req)).id); return json(res, { ok: true }); }
      if (url.pathname === '/api/models/default' && req.method === 'POST') return json(res, await studio.setDefaultModel(await body(req)));
      if (url.pathname === '/api/unload' && req.method === 'POST') { await studio.unloadModel(); return json(res, { ok: true }); }
      if (url.pathname === '/api/pipelines/save' && req.method === 'POST') return json(res, await studio.pipelines.save((await body(req)).pipeline));
      if (url.pathname === '/api/pipelines/validate' && req.method === 'POST') return json(res, { valid: true, pipeline: studio.validatePipeline((await body(req)).pipeline) });
      if (url.pathname === '/api/pipelines/delete' && req.method === 'POST') { await studio.pipelines.remove((await body(req)).id); return json(res, { ok: true }); }
      if (url.pathname === '/api/pipelines/run' && req.method === 'POST') return json(res, await studio.runPipeline(await body(req)));
      if (url.pathname === '/api/pipelines/pause' && req.method === 'POST') return json(res, await studio.pausePipeline((await body(req)).id));
      if (url.pathname === '/api/pipelines/resume' && req.method === 'POST') return json(res, await studio.resumePipeline((await body(req)).id));
      if (url.pathname === '/api/pipelines/cancel' && req.method === 'POST') return json(res, await studio.cancelPipeline((await body(req)).id));
      if (url.pathname === '/api/upload' && req.method === 'POST') {
        const input = await body(req);
        const ext = path.extname(String(input.name)).toLowerCase();
        if (!['.png', '.jpg', '.jpeg', '.webp', '.wav', '.txt', '.md', '.js', '.ts', '.py', '.json', '.csv', '.html', '.css'].includes(ext)) throw new Error('Choose an image, WAV recording, text, or code file.');
        if (typeof input.base64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64)) throw new Error('Invalid file encoding');
        const bytes = Buffer.from(input.base64, 'base64');
        if (bytes.length > 32 * 1024 * 1024) throw new Error('File is too large (32 MB maximum).');
        const filename = randomUUID() + ext; await fs.writeFile(path.join(studio.uploadDir, filename), bytes); return json(res, { filename, name: String(input.name), size: bytes.length });
      }
      if (url.pathname === '/api/use-output' && req.method === 'POST') {
        const { filename } = await body(req);
        if (typeof filename !== 'string' || path.basename(filename) !== filename || !/\.(png|jpg|webp)$/.test(filename)) throw new Error('Choose an image output.');
        const uploaded = randomUUID() + path.extname(filename);
        await fs.copyFile(path.join(studio.outputDir, filename), path.join(studio.uploadDir, uploaded));
        return json(res, { filename: uploaded, name: filename });
      }
      if (url.pathname.startsWith('/api/files/')) {
        const name = decodeURIComponent(url.pathname.slice('/api/files/'.length));
        if (path.basename(name) !== name || !/^[a-zA-Z0-9_.-]+$/.test(name)) throw new Error('Invalid file');
        return await fileResponse(req, res, path.join(studio.outputDir, name), url.searchParams.has('download'));
      }
      if (url.pathname.startsWith('/api/')) return json(res, { error: 'Endpoint not found.' }, 404);
      const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
      const target = path.resolve(staticDir, '.' + relative);
      if (!target.startsWith(path.resolve(staticDir) + path.sep)) throw new Error('Invalid file path');
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'");
      return await fileResponse(req, res, target);
    } catch (error) { if (!res.headersSent) json(res, { error: error.code === 'ENOENT' ? 'File not found.' : error.message }, error.code === 'ENOENT' ? 404 : 400); else res.end(); }
  });
  studio.on('state', state => { const payload = `data: ${JSON.stringify(state)}\n\n`; for (const client of clients) client.write(payload); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  if (autoSetup) queueMicrotask(() => studio.startDefaultGuide().catch(error => { studio.guideState = { status: 'error', error: error.message }; studio.changed(); }));
  return { studio, url: `http://127.0.0.1:${server.address().port}`, close: async () => { for (const client of clients) client.end(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await studio.close(); } };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const service = await startServer({ port: Number(process.env.PORT || 4317) });
  console.log(`TIM Studio is running at ${service.url}`);
  let closing = false;
  const close = async () => { if (closing) return; closing = true; await service.close(); process.exit(); };
  process.on('SIGINT', close); process.on('SIGTERM', close);
}
