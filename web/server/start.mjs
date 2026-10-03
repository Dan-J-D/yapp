// Container entry: issue certs, start the HTTP landing server, then the Astro HTTPS server.
import https from 'node:https';
import { ensureCerts } from '../scripts/certs.mjs';
import { startHttpServer } from './http.mjs';

const httpsPort = Number(process.env.PORT ?? 8443);
const httpPort = Number(process.env.HTTP_PORT ?? 8080);
const { cert, key, dir } = ensureCerts();
process.env.SERVER_CERT_PATH = cert;
process.env.SERVER_KEY_PATH = key;
process.env.PORT = String(httpsPort);
// Tells the HTTP page which port to send people to (may differ from PORT behind port mapping).
const publicHttpsPort = Number(process.env.HTTPS_PUBLIC_PORT ?? httpsPort);

startHttpServer({ port: httpPort, httpsPort: publicHttpsPort, certDir: dir });
await import('../dist/server/entry.mjs');

// Warm up the app so the job queue and push scheduler start without waiting for a visit.
setTimeout(() => {
  https
    .get({ host: '127.0.0.1', port: httpsPort, path: '/api/health', rejectUnauthorized: false }, (r) => r.resume())
    .on('error', (e) => console.warn('[start] warm-up failed:', e.message));
}, 1500);
