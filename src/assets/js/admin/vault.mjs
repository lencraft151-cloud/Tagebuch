/**
 * Verschlüsselter Zugangs-Tresor.
 *
 * Der GitHub-Token wird einmalig hinterlegt und mit der PIN verschlüsselt im
 * Browser gespeichert. Danach genügt die PIN zum Anmelden.
 *
 * Wichtig: Die PIN steht nirgends im Quelltext und wird auch nicht mit einem
 * gespeicherten Wert verglichen - sie ist das Schlüsselmaterial. Wer den
 * ausgelieferten Code liest, erfährt nichts; ohne die richtige PIN lässt sich
 * der gespeicherte Token nicht entschlüsseln.
 *
 * Technisch: PBKDF2-SHA256 (250.000 Runden) für die Schlüsselableitung,
 * AES-GCM-256 für die Verschlüsselung. Beides über die Web-Crypto-API, die
 * einen sicheren Kontext braucht (HTTPS oder localhost) - auf GitHub Pages
 * immer gegeben.
 */

const STORAGE_KEY = 'tagebuch:vault';
const LEGACY_KEY = 'tagebuch:gh-token';
const ITERATIONS = 250000;

export class VaultError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'VaultError';
    this.code = code;
  }
}

function toBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value) {
  return Uint8Array.from(atob(String(value || '')), (char) => char.charCodeAt(0));
}

function assertCrypto() {
  if (!globalThis.crypto?.subtle) {
    throw new VaultError(
      'Verschlüsselung nicht verfügbar. Die Seite muss über HTTPS geöffnet werden.',
      'no-crypto'
    );
  }
}

async function deriveKey(pin, salt) {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(String(pin)),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/** Token mit der PIN verschlüsseln und im Browser ablegen. */
export async function createVault(pin, token) {
  assertCrypto();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pin, salt);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(String(token))
  );

  const vault = {
    v: 1,
    salt: toBase64(salt),
    iv: toBase64(iv),
    data: toBase64(new Uint8Array(encrypted)),
    createdAt: new Date().toISOString()
  };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(vault));
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    throw new VaultError('Der Browser erlaubt kein Speichern (privater Modus?).', 'no-storage');
  }
  return vault;
}

/** Token mit der PIN entschlüsseln. Falsche PIN wirft einen Fehler. */
export async function openVault(pin) {
  assertCrypto();
  const vault = readVault();
  if (!vault) throw new VaultError('Es ist noch kein Zugang eingerichtet.', 'empty');

  let decrypted;
  try {
    const key = await deriveKey(pin, fromBase64(vault.salt));
    decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(vault.iv) },
      key,
      fromBase64(vault.data)
    );
  } catch {
    // AES-GCM prüft die Integrität mit: Bei falscher PIN schlägt das
    // Entschlüsseln fehl, ohne dass ein Vergleichswert nötig wäre.
    throw new VaultError('PIN falsch.', 'wrong-pin');
  }
  return new TextDecoder().decode(decrypted);
}

export function readVault() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const vault = JSON.parse(raw);
    return vault?.data && vault?.salt && vault?.iv ? vault : null;
  } catch {
    return null;
  }
}

export function hasVault() {
  return Boolean(readVault());
}

export function clearVault() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LEGACY_KEY);
  } catch { /* nichts zu tun */ }
}

/** Übergangsweise: ein früher im Klartext gespeicherter Token. */
export function legacyToken() {
  try {
    return localStorage.getItem(LEGACY_KEY) || '';
  } catch {
    return '';
  }
}
