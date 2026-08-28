#!/usr/bin/env node
/**
 * Setzt die Admin-PIN in site.config.json.
 *
 *   npm run set-pin -- 151013
 *
 * Gespeichert wird nur ein gesalzener SHA-256-Hash, damit die Ziffernfolge
 * nicht im Klartext im Repository und im ausgelieferten Code steht.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = path.join(ROOT, 'site.config.json');

const pin = (process.argv[2] || '').trim();
if (!/^\d{4,16}$/.test(pin)) {
  console.error('\nAufruf: npm run set-pin -- <4 bis 16 Ziffern>\nBeispiel: npm run set-pin -- 151013\n');
  process.exit(1);
}

export function hashPin(pin, salt) {
  return crypto.createHash('sha256').update(`${salt}:${pin}`).digest('hex');
}

const config = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
const salt = crypto.randomBytes(12).toString('hex');

config.admin = { ...(config.admin || {}), pinSalt: salt, pinHash: hashPin(pin, salt) };
fs.writeFileSync(CONFIG, `${JSON.stringify(config, null, 2)}\n`);

console.log(`\n✓ PIN gesetzt (${pin.length} Ziffern). Änderung committen und pushen, dann gilt sie.\n`);
