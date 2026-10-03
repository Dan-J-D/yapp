import fs from 'node:fs';
import path from 'node:path';
import { config } from './config';

export function caResponse(kind: 'crt' | 'mobileconfig') {
  const file = path.join(config.certDir, kind === 'crt' ? 'ca.crt' : 'yapp.mobileconfig');
  if (!fs.existsSync(file)) return new Response('CA not generated yet', { status: 404 });
  return new Response(fs.readFileSync(file), {
    headers: {
      'content-type': kind === 'crt' ? 'application/x-x509-ca-cert' : 'application/x-apple-aspen-config',
      'content-disposition': `attachment; filename="${kind === 'crt' ? 'yapp-ca.crt' : 'yapp.mobileconfig'}"`,
      'cache-control': 'no-store',
    },
  });
}

export function caFingerprint() {
  try {
    return fs.readFileSync(path.join(config.certDir, 'ca.fingerprint'), 'utf8').trim();
  } catch {
    return null;
  }
}
