import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
// Local preview deliberately does not load .env.local or call real external services.
const root = resolve(import.meta.dirname, '..');
const types = { '.html':'text/html; charset=utf-8','.css':'text/css','.js':'application/javascript','.png':'image/png','.jpeg':'image/jpeg','.mp3':'audio/mpeg' };
export function previewServer(port = 4173) {
  const server = createServer(async (req,res) => {
    const path = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if (path.startsWith('/api/')) { res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:{message:'API no conectada en la vista previa local.'}}));return; }
    const file = path === '/' ? '/index.html' : path === '/admin' || path === '/admin/' ? '/admin/index.html' : path === '/privacy/' ? '/privacy/index.html' : path;
    const allowed = ['/index.html','/style.css','/script.js','/lib/interview-validation.js'].includes(file) || /^\/(assets|admin)\/[a-zA-Z0-9_.-]+$/.test(file) || file==='/privacy/index.html';
    if (!allowed || !resolve(root,`.${file}`).startsWith(`${root}/`)) { res.writeHead(404); res.end(); return; }
    try { const data=await readFile(resolve(root,`.${file}`));res.writeHead(200,{'Content-Type':types[extname(file)] ?? 'application/octet-stream'});res.end(data); }
    catch { res.writeHead(404);res.end(); }
  });
  return new Promise(resolve => { server.listen(port,'127.0.0.1',()=>resolve(server)); });
}
if (process.argv[1] === new URL(import.meta.url).pathname) { await previewServer(); console.log('Local: http://127.0.0.1:4173'); }
