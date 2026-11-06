// Upload the built installers to Cloudinary and print their public URLs.
// Run from builds/bluebell:  node tools/upload-cloudinary.mjs [file ...]
//
// Credentials come from tools/cloudinary.json (gitignored):
//   { "cloud_name": "...", "api_key": "...", "api_secret": "...", "folder": "blackbox/apps" }
//
// Raw resources keep their filename/extension, so the returned secure_url is a
// plain download link you can drop straight into the sidebar buttons.
import { readFileSync, existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT } from './guard.mjs';

const CFG = join(ROOT, 'tools', 'cloudinary.json');
if (!existsSync(CFG)) {
  console.error('missing tools/cloudinary.json');
  process.exit(1);
}
const cfg = JSON.parse(readFileSync(CFG, 'utf8'));
const cloud = cfg.cloud_name || cfg.cloudName;
const key = cfg.api_key || cfg.apiKey;
const secret = cfg.api_secret || cfg.apiSecret;
const folder = cfg.folder || 'blackbox/apps';
if (!cloud || !key || !secret || /PASTE|YOUR_|changeme|xxx/i.test(`${cloud}${key}${secret}`)) {
  console.error('tools/cloudinary.json is not filled in (cloud_name / api_key / api_secret).');
  process.exit(1);
}

const DEFAULTS = [
  'release/Black-Box-Attendance-1.0.0.apk',
  'release/Black-Box Offline CBT Setup 1.0.4.exe',
];
const files = (process.argv.slice(2).length ? process.argv.slice(2) : DEFAULTS)
  .map((p) => resolve(ROOT, p));
for (const f of files) {
  if (!existsSync(f)) { console.error(`missing ${f}`); process.exit(1); }
}

const results = [];
for (const f of files) {
  const buf = readFileSync(f);
  // Raw public_id: safe characters only, extension preserved for a working download.
  const publicId = basename(f).replace(/[^A-Za-z0-9._-]+/g, '-');
  const timestamp = Math.floor(Date.now() / 1000);
  const params = { folder, public_id: publicId, timestamp };
  const toSign = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&');
  const signature = createHash('sha1').update(toSign + secret).digest('hex');

  const form = new FormData();
  form.append('file', new File([buf], basename(f)));
  form.append('api_key', key);
  form.append('timestamp', String(timestamp));
  form.append('public_id', publicId);
  form.append('folder', folder);
  form.append('signature', signature);

  console.log(`uploading ${basename(f)} (${(buf.length / 1048576).toFixed(1)} MB)...`);
  let json = {};
  let status = 0;
  try {
    const res = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/raw/upload`, { method: 'POST', body: form });
    status = res.status;
    json = await res.json().catch(() => ({}));
  } catch (e) {
    results.push({ name: basename(f), ok: false, error: e.message });
    console.error(`  FAILED: ${e.message}`);
    continue;
  }
  if (!json.secure_url) {
    const msg = json?.error?.message || `HTTP ${status}`;
    results.push({ name: basename(f), ok: false, error: msg });
    console.error(`  FAILED: ${msg}`);
    continue;
  }
  console.log(`  OK ${json.secure_url}`);
  results.push({ name: basename(f), ok: true, url: json.secure_url, bytes: json.bytes });
}

console.log('\n=== URLs ===');
for (const r of results) {
  console.log(r.ok ? `${r.name}\n  ${r.url}` : `${r.name}\n  FAILED: ${r.error}`);
}
if (results.some((r) => !r.ok)) process.exit(1);