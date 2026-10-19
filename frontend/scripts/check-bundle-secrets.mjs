#!/usr/bin/env node
// Fails the build if the browser bundle looks like it contains credentials,
// or if a VITE_* variable with a secret-like name is set (VITE_* vars are public).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dist = process.argv[2] ?? 'dist';
const patterns = [
  [/AKIA[0-9A-Z]{16}/, 'AWS access key id'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/\bAAPK[0-9A-Za-z_-]{20,}/, 'ArcGIS API key'],
  [/\bgh[pousr]_[0-9A-Za-z]{30,}/, 'GitHub token'],
  [/\bsk-[A-Za-z0-9]{32,}/, 'secret key'],
  [/POSTGRES_PASSWORD|MOBSIM_[A-Z_]*(SECRET|TOKEN|PASSWORD)/, 'server-side variable name'],
  [/client_secret\s*[:=]\s*["'][^"']+["']/i, 'client secret value'],
];

const bad = Object.keys(process.env).filter(
  (k) => k.startsWith('VITE_') && /SECRET|TOKEN|PASSWORD|PRIVATE|API_KEY/i.test(k),
);
if (bad.length) {
  console.error(`Refusing to build: secret-like public variables set: ${bad.join(', ')}`);
  process.exit(1);
}

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(js|mjs|html|css|json)$/.test(name)) files.push(p);
  }
};
walk(dist);
let failures = 0;
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  for (const [re, label] of patterns) {
    const m = text.match(re);
    if (m) {
      console.error(`${f}: possible ${label}: ${m[0].slice(0, 12)}…`);
      failures++;
    }
  }
}
if (failures) process.exit(1);
console.log(`No secrets found in ${files.length} bundle files.`);
