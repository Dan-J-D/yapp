// Container entry: issue certs, start the HTTP landing server, then the Astro app over HTTPS.
// HOST may list several addresses (e.g. "10.8.0.1,127.0.0.1"); we listen on each of them.
import fs from 'node:fs';
import https from 'node:https';
import { ensureCerts } from '../scripts/certs.mjs';
import { startHttpServer } from './http.mjs';

const httpsPort = Number(process.env.PORT ?? 8443);
const httpPort = Number(process.env.HTTP_PORT ?? 8080);
const hosts = (process.env.HOST ?? '0.0.0.0').split(/[,\s]+/).filter(Boolean);
const { cert, key, dir } = ensureCerts();
// Tells the HTTP page which port to send people to (may differ from PORT behind port mapping).
const publicHttpsPort = Number(process.env.HTTPS_PUBLIC_PORT ?? httpsPort);

startHttpServer({ port: httpPort, httpsPort: publicHttpsPort, certDir: dir, hosts });

// Astro's standalone server listens on a single host, so start our own listeners with its handler.
process.env.ASTRO_NODE_AUTOSTART = 'disabled';
const { handler } = await import('../dist/server/entry.mjs');
const tls = { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
for (const host of hosts) {
  https
    .createServer(tls, handler)
    .on('error', (e) => {
      // e.g. EADDRNOTAVAIL while wg0 is still down: exit so Docker restarts us
      console.error(`[https] cannot listen on ${host}:${httpsPort}: ${e.message}`);
      process.exit(1);
    })
    .listen(httpsPort, host, () => console.log(`[https] app on https://${host.includes(':') ? `[${host}]` : host}:${httpsPort}`));
}

// Reach ourselves on a bound address (loopback when bound to all interfaces or to 127.0.0.1).
const selfHost = hosts.find((h) => ['0.0.0.0', '::', '127.0.0.1'].includes(h)) ? '127.0.0.1' : hosts[0];

// Warm up the app so the job queue and push scheduler start without waiting for a visit.
setTimeout(() => {
  https
    .get({ host: selfHost, port: httpsPort, path: '/api/health', rejectUnauthorized: false }, (r) => r.resume())
    .on('error', (e) => console.warn('[start] warm-up failed:', e.message));
}, 1500);
