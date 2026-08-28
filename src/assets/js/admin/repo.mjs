/**
 * Liest die Inhalte des Repositories - ohne jede Anmeldung.
 *
 * Möglich ist das, weil GitHub die Rohdateien öffentlicher Repositories über
 * raw.githubusercontent.com mit "Access-Control-Allow-Origin: *" ausliefert.
 * Der Browser darf sie also direkt laden. Geschrieben wird hier nichts -
 * dafür gibt es den Export (siehe publish.mjs).
 *
 * Welche Dateien es gibt, verrät data/manifest.json vom eigenen Server. Der
 * Build erzeugt es aus dem Quellverzeichnis, damit auch Entwürfe auftauchen,
 * die selbst nicht mit veröffentlicht werden.
 */

const RAW = 'https://raw.githubusercontent.com';

export class RepoError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'RepoError';
    this.cause = cause;
  }
}

export class Repo {
  constructor({ owner, name, branch = 'main', contentDir = 'content/trips', mediaDir = 'content/media', base = '/' }) {
    this.owner = owner;
    this.name = name;
    this.branch = branch;
    this.contentDir = contentDir;
    this.mediaDir = mediaDir;
    this.base = base;
    this.manifest = null;
  }

  get path() {
    return `${this.owner}/${this.name}`;
  }

  rawUrl(repoPath, bust = true) {
    const url = `${RAW}/${this.path}/${encodeURIComponent(this.branch)}/${repoPath.split('/').map(encodeURIComponent).join('/')}`;
    // raw.githubusercontent liegt hinter einem CDN. Ohne Parameter sieht man
    // nach einem Commit bis zu fünf Minuten lang den alten Stand.
    return bust ? `${url}?t=${Date.now()}` : url;
  }

  /** Verweise für die Bedienung auf GitHub (Hochladen, Löschen, Ansehen). */
  uploadUrl(dir = '') {
    return `https://github.com/${this.path}/upload/${this.branch}${dir ? `/${dir}` : ''}`;
  }

  deleteUrl(repoPath) {
    return `https://github.com/${this.path}/delete/${this.branch}/${repoPath}`;
  }

  fileUrl(repoPath) {
    return `https://github.com/${this.path}/blob/${this.branch}/${repoPath}`;
  }

  async loadManifest() {
    const url = `${this.base}data/manifest.json?t=${Date.now()}`;
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      this.manifest = await response.json();
    } catch (error) {
      throw new RepoError(
        'Das Inhaltsverzeichnis der Website konnte nicht geladen werden. Läuft der Build schon?',
        error
      );
    }
    return this.manifest;
  }

  /** Eine Reise im Original aus dem Repository laden. */
  async loadTrip(file) {
    const repoPath = `${this.contentDir}/${file}`;
    try {
      const response = await fetch(this.rawUrl(repoPath), { cache: 'no-store' });
      if (response.ok) return await response.json();
      if (response.status !== 404) throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      // Weiter zum Ausweichweg
    }

    // Ausweich: die vom Build erzeugte Fassung derselben Reise. Sie fehlt nur
    // bei Entwürfen, die noch nie veröffentlicht wurden.
    const slug = file.replace(/\.json$/, '');
    const response = await fetch(`${this.base}data/reisen/${encodeURIComponent(slug)}.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new RepoError(`„${file}" konnte nicht geladen werden.`);
    return response.json();
  }

  /**
   * Bildadresse zum Anzeigen. Bereits veröffentlichte Bilder liegen auf dem
   * eigenen Server - das ist schneller und braucht kein CORS.
   */
  imageUrl(src) {
    if (!src) return '';
    if (/^(https?:)?\/\//i.test(src) || src.startsWith('data:')) return src;
    return `${this.base}${String(src).replace(/^\/+/, '')}`;
  }

  /** Ausweichadresse, falls das Bild noch nicht gebaut wurde. */
  imageRawUrl(src) {
    if (!src || /^(https?:)?\/\//i.test(src) || src.startsWith('data:')) return '';
    return this.rawUrl(`${this.mediaDir}/${String(src).replace(/^media\//, '')}`, false);
  }
}
