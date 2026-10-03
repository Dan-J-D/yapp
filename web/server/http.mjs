// Plain-HTTP side of Yapp: certificate landing page + CA download + redirect to HTTPS.
// Astro's standalone server only listens once (HTTPS), so this tiny server owns the HTTP port.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { CERT_GUIDES, guessOs } from './cert-instructions.mjs';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function landing({ httpsUrl, os, fingerprint }) {
  const tabs = CERT_GUIDES.map(
    (g) => `<button type="button" class="tab" data-os="${g.id}" aria-selected="${g.id === os}">${esc(g.label)}</button>`,
  ).join('');
  const panels = CERT_GUIDES.map(
    (g) => `<div class="panel" data-os="${g.id}" ${g.id === os ? '' : 'hidden'}>
      <a class="btn primary" href="/${g.download === 'mobileconfig' ? 'yapp.mobileconfig' : 'yapp-ca.crt'}" download>Download CA${g.download === 'mobileconfig' ? ' profile' : ''}</a>
      <ol>${g.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></div>`,
  ).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><title>Yapp — secure setup</title>
<style>
:root{--bg:#f6f5f2;--fg:#1d1c1a;--muted:#6b6862;--card:#fff;--line:#e3e0da;--accent:#2f6f5e;--accent-fg:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#141413;--fg:#ecebe8;--muted:#a19e97;--card:#1f1e1c;--line:#34322f;--accent:#5fb39b;--accent-fg:#0e1a16}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif}
main{max-width:640px;margin:0 auto;padding:32px 16px}h1{font-size:1.6rem;margin:0 0 4px}p{color:var(--muted)}
.btn{display:inline-block;padding:10px 16px;border-radius:10px;border:1px solid var(--line);background:var(--card);color:var(--fg);text-decoration:none;font-weight:600;cursor:pointer;font-size:1rem}
.btn.primary{background:var(--accent);color:var(--accent-fg);border-color:transparent}
dialog{border:1px solid var(--line);border-radius:16px;background:var(--card);color:var(--fg);max-width:min(560px,calc(100vw - 32px));padding:20px}
dialog::backdrop{background:rgb(0 0 0/.45)}.tabs{display:flex;flex-wrap:wrap;gap:6px;margin:12px 0}
.tab{border:1px solid var(--line);background:transparent;color:var(--fg);border-radius:999px;padding:4px 12px;cursor:pointer}
.tab[aria-selected=true]{background:var(--fg);color:var(--bg)}ol{padding-left:20px}li{margin:6px 0;overflow-wrap:anywhere}
.row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:16px}code{font-size:.8rem;overflow-wrap:anywhere;color:var(--muted)}
label{display:flex;gap:6px;align-items:center;color:var(--muted);font-size:.9rem}
</style></head><body><main>
<h1>Yapp</h1><p>Your voice trainer runs over HTTPS so the browser allows microphone access and app install.</p>
<div class="row"><a class="btn primary" id="go" href="${esc(httpsUrl)}">Continue to HTTPS</a>
<button class="btn" type="button" id="show">Certificate setup</button></div>
<p><code>Root CA SHA-256: ${esc(fingerprint)}</code></p>
</main>
<dialog id="dlg"><form method="dialog">
<h2 style="margin:0">Install the Yapp certificate for mic and app install</h2>
<p>Do this once per device. The certificate only identifies this Yapp server on your network.</p>
<div class="tabs" role="tablist">${tabs}</div>${panels}
<div class="row"><a class="btn primary" href="${esc(httpsUrl)}">Continue to HTTPS</a><button class="btn" value="close">Close</button>
<label><input type="checkbox" id="never"> Don’t show again</label></div></form></dialog>
<script>
const KEY='yapp-cert-popup-dismissed',dlg=document.getElementById('dlg');
let skip=false;try{skip=localStorage.getItem(KEY)==='1'}catch{}
if(skip){location.replace(${JSON.stringify(httpsUrl)})}else{dlg.showModal()}
document.getElementById('show').onclick=()=>dlg.showModal();
document.getElementById('never').onchange=e=>{try{e.target.checked?localStorage.setItem(KEY,'1'):localStorage.removeItem(KEY)}catch{}};
document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>{document.querySelectorAll('.tab').forEach(x=>x.setAttribute('aria-selected',x===t));
document.querySelectorAll('.panel').forEach(p=>p.hidden=p.dataset.os!==t.dataset.os)});
</script></body></html>`;
}

export function startHttpServer({ port, httpsPort, certDir, hosts = [process.env.HOST ?? '0.0.0.0'] }) {
  const file = (n) => path.join(certDir, n);
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const send = (code, type, body, extra = {}) => {
      res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', ...extra });
      res.end(body);
    };
    try {
      if (url.pathname === '/yapp-ca.crt') {
        return send(200, 'application/x-x509-ca-cert', fs.readFileSync(file('ca.crt')), {
          'content-disposition': 'attachment; filename="yapp-ca.crt"',
        });
      }
      if (url.pathname === '/yapp.mobileconfig') {
        return send(200, 'application/x-apple-aspen-config', fs.readFileSync(file('yapp.mobileconfig')), {
          'content-disposition': 'attachment; filename="yapp.mobileconfig"',
        });
      }
      if (url.pathname === '/healthz') return send(200, 'text/plain', 'ok');
      const host = (req.headers.host ?? 'localhost').replace(/:\d+$/, '');
      const httpsUrl = `https://${host.includes(':') && !host.startsWith('[') ? `[${host}]` : host}${
        Number(httpsPort) === 443 ? '' : `:${httpsPort}`
      }${url.pathname}${url.search}`;
      let fingerprint = '';
      try {
        fingerprint = fs.readFileSync(file('ca.fingerprint'), 'utf8').trim();
      } catch {}
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(308, 'text/plain', '', { location: httpsUrl });
      return send(200, 'text/html; charset=utf-8', landing({ httpsUrl, os: guessOs(req.headers['user-agent']), fingerprint }));
    } catch (e) {
      return send(500, 'text/plain', String(e));
    }
  });
  // one listener per bind address (same request handler)
  const handler = server.listeners('request')[0];
  hosts.forEach((host, i) => {
    const srv = i === 0 ? server : http.createServer(handler);
    srv.on('error', (e) => {
      console.error(`[http] cannot listen on ${host}:${port}: ${e.message}`);
      process.exit(1);
    });
    srv.listen(port, host, () => console.log(`[http] cert landing on http://${host.includes(':') ? `[${host}]` : host}:${port}`));
  });
  return server;
}
