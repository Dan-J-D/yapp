// Per-OS steps for trusting the Yapp local CA. Shared by the plain-HTTP landing page
// (server/http.mjs) and Settings › Devices in the HTTPS app.

/** @typedef {{ id: string, label: string, download: 'crt'|'mobileconfig', steps: string[] }} OsGuide */

/** @type {OsGuide[]} */
export const CERT_GUIDES = [
  {
    id: 'android',
    label: 'Android',
    download: 'crt',
    steps: [
      'Tap “Download CA” below.',
      'Open Settings › Security (or Security & privacy) › More security settings › Encryption & credentials › Install a certificate › CA certificate.',
      'Tap “Install anyway”, then pick yapp-ca.crt from Downloads.',
      'Come back here and tap “Continue to HTTPS”.',
      'Firefox for Android: Settings › About Firefox, tap the logo 5× to unlock the secret settings, then turn on “Use third party CA certificates”.',
    ],
  },
  {
    id: 'ios',
    label: 'iPhone / iPad',
    download: 'mobileconfig',
    steps: [
      'Open this page in Safari (other browsers can’t install profiles) and tap “Download CA”, then “Allow”.',
      'Open Settings › General › VPN & Device Management (or the “Profile Downloaded” banner at the top of Settings) and install “Yapp Local CA”.',
      'Then go to Settings › General › About › Certificate Trust Settings and turn on full trust for “Yapp Local CA”.',
      'Come back to Safari and tap “Continue to HTTPS”.',
    ],
  },
  {
    id: 'windows',
    label: 'Windows',
    download: 'crt',
    steps: [
      'Download the CA, then in an Administrator terminal run:  certutil -addstore Root %USERPROFILE%\\Downloads\\yapp-ca.crt',
      'Or double-click yapp-ca.crt › Install Certificate › Local Machine › “Trusted Root Certification Authorities”.',
      'Restart the browser. Firefox: set security.enterprise_roots.enabled = true in about:config (default on recent versions).',
    ],
  },
  {
    id: 'macos',
    label: 'macOS',
    download: 'crt',
    steps: [
      'Download the CA and double-click it to add it to the System keychain in Keychain Access.',
      'Double-click “Yapp Local CA” › Trust › “When using this certificate: Always Trust”, then close and enter your password.',
      'Or in Terminal:  sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ~/Downloads/yapp-ca.crt',
      'Firefox: set security.enterprise_roots.enabled = true in about:config.',
    ],
  },
  {
    id: 'linux',
    label: 'Linux',
    download: 'crt',
    steps: [
      'System store (Debian/Ubuntu):  sudo cp yapp-ca.crt /usr/local/share/ca-certificates/yapp-ca.crt && sudo update-ca-certificates',
      'Fedora/Arch:  sudo trust anchor --store yapp-ca.crt',
      'Chrome/Chromium use their own NSS store:  certutil -d sql:$HOME/.pki/nssdb -A -t "C,," -n "Yapp Local CA" -i yapp-ca.crt  (package libnss3-tools)',
      'Firefox: Settings › Privacy & Security › Certificates › View Certificates › Authorities › Import, tick “Trust this CA to identify websites”.',
    ],
  },
];

/** Pick a guide id from a User-Agent string. */
export function guessOs(ua = '') {
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && /mobile/i.test(ua))) return 'ios';
  if (/windows/i.test(ua)) return 'windows';
  if (/mac os x|macintosh/i.test(ua)) return 'macos';
  if (/linux|x11|cros/i.test(ua)) return 'linux';
  return 'android';
}
