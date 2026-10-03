#!/usr/bin/env node
// Local CA + leaf certificate for serving HTTPS without a reverse proxy.
//  - Root CA: created once, persisted in CERT_DIR so devices install it a single time.
//  - Leaf: re-issued on every start so new LAN IPs / hostnames are always covered.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = path.resolve(process.env.CERT_DIR ?? path.join(process.cwd(), '..', 'data', 'certs'));
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
const f = (n) => path.join(dir, n);
const openssl = (...args) => execFileSync('openssl', args, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();

export function detectLanIps() {
  const ips = new Set(['127.0.0.1', '::1']);
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.internal) continue;
      if (a.family === 'IPv4') ips.add(a.address);
      // Skip link-local IPv6; browsers can't use those in URLs without zone ids anyway.
      else if (a.family === 'IPv6' && !a.address.startsWith('fe80')) ips.add(a.address);
    }
  }
  return [...ips];
}

const list = (v) => (v ?? '').split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);

export function ensureCerts() {
  // ---- Root CA (once) ----
  if (!fs.existsSync(f('ca.key')) || !fs.existsSync(f('ca.crt'))) {
    const id = crypto.randomBytes(3).toString('hex');
    fs.writeFileSync(
      f('ca.cnf'),
      [
        '[req]',
        'distinguished_name=dn',
        'prompt=no',
        'x509_extensions=v3_ca',
        '[dn]',
        `CN=Yapp Local CA ${os.hostname()} ${id}`,
        'O=Yapp (self-hosted)',
        '[v3_ca]',
        'basicConstraints=critical,CA:TRUE',
        'keyUsage=critical,keyCertSign,cRLSign',
        'subjectKeyIdentifier=hash',
        '',
      ].join('\n'),
    );
    openssl('genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048', '-out', f('ca.key'));
    fs.chmodSync(f('ca.key'), 0o600);
    openssl('req', '-x509', '-new', '-key', f('ca.key'), '-sha256', '-days', '3650', '-config', f('ca.cnf'), '-out', f('ca.crt'));
    console.log('[certs] created new root CA');
  }

  // ---- Leaf (every start) ----
  const hostnames = [...new Set(['localhost', os.hostname(), ...list(process.env.HOSTNAMES)])];
  const ips = [...new Set([...(list(process.env.LAN_IPS).length ? list(process.env.LAN_IPS) : detectLanIps()), '127.0.0.1'])];
  const san = [...hostnames.map((h) => `DNS:${h}`), ...ips.map((ip) => `IP:${ip}`)].join(',');
  fs.writeFileSync(
    f('leaf.ext'),
    [
      'basicConstraints=critical,CA:FALSE',
      'keyUsage=critical,digitalSignature,keyEncipherment',
      'extendedKeyUsage=serverAuth',
      'subjectKeyIdentifier=hash',
      'authorityKeyIdentifier=keyid,issuer',
      `subjectAltName=${san}`,
      '',
    ].join('\n'),
  );
  openssl('genpkey', '-algorithm', 'EC', '-pkeyopt', 'ec_paramgen_curve:P-256', '-out', f('leaf.key'));
  fs.chmodSync(f('leaf.key'), 0o600);
  openssl('req', '-new', '-key', f('leaf.key'), '-subj', `/CN=${hostnames[0]}/O=Yapp`, '-out', f('leaf.csr'));
  // 397 days: within Apple's 398-day limit for TLS server certs.
  openssl(
    'x509', '-req', '-in', f('leaf.csr'), '-CA', f('ca.crt'), '-CAkey', f('ca.key'),
    '-set_serial', '0x' + crypto.randomBytes(16).toString('hex'),
    '-days', '397', '-sha256', '-extfile', f('leaf.ext'), '-out', f('leaf.crt'),
  );
  fs.writeFileSync(f('fullchain.crt'), fs.readFileSync(f('leaf.crt'), 'utf8') + fs.readFileSync(f('ca.crt'), 'utf8'));
  fs.rmSync(f('leaf.csr'), { force: true });

  // ---- iOS configuration profile wrapping the CA ----
  const der = Buffer.from(
    fs.readFileSync(f('ca.crt'), 'utf8').replace(/-----(BEGIN|END) CERTIFICATE-----|\s/g, ''),
    'base64',
  );
  const fp = crypto.createHash('sha256').update(der).digest('hex');
  const uuid = (seed) => {
    const h = crypto.createHash('sha1').update(seed + fp).digest('hex');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`.toUpperCase();
  };
  fs.writeFileSync(
    f('yapp.mobileconfig'),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>PayloadContent</key><array><dict>
    <key>PayloadCertificateFileName</key><string>yapp-ca.crt</string>
    <key>PayloadContent</key><data>${der.toString('base64')}</data>
    <key>PayloadDisplayName</key><string>Yapp Local CA</string>
    <key>PayloadIdentifier</key><string>local.yapp.ca.${fp.slice(0, 12)}</string>
    <key>PayloadType</key><string>com.apple.security.root</string>
    <key>PayloadUUID</key><string>${uuid('cert')}</string>
    <key>PayloadVersion</key><integer>1</integer>
  </dict></array>
  <key>PayloadDisplayName</key><string>Yapp Local CA</string>
  <key>PayloadIdentifier</key><string>local.yapp.profile.${fp.slice(0, 12)}</string>
  <key>PayloadRemovalDisallowed</key><false/>
  <key>PayloadType</key><string>Configuration</string>
  <key>PayloadUUID</key><string>${uuid('profile')}</string>
  <key>PayloadVersion</key><integer>1</integer>
</dict></plist>
`,
  );
  fs.writeFileSync(f('ca.fingerprint'), fp.match(/../g).join(':').toUpperCase() + '\n');

  console.log(`[certs] leaf SANs: ${san}`);
  console.log(`[certs] root CA SHA-256: ${fs.readFileSync(f('ca.fingerprint'), 'utf8').trim()}`);
  return { dir, cert: f('fullchain.crt'), key: f('leaf.key'), ca: f('ca.crt'), hostnames, ips };
}

if (import.meta.url === `file://${process.argv[1]}`) ensureCerts();
