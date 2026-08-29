/**
 * Schreibzugriff auf das Repository - für das Ein-Klick-Veröffentlichen.
 *
 * Alle Änderungen gehen als EIN Commit raus (Git-Data-API: Blobs → Baum →
 * Commit → Referenz). Das hält die Historie sauber: ein Eintrag je
 * Veröffentlichung statt einer Zeile pro Datei.
 *
 * Der Token kommt aus dem Tresor (vault.mjs) und wird mit der PIN
 * entschlüsselt. Im ausgelieferten Code steht er nie.
 */

const API = 'https://api.github.com';

export class WriteError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'WriteError';
    this.status = status;
  }
}

function toBase64(bytes) {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export class GitHubWriter {
  constructor({ owner, name, branch }) {
    this.owner = owner;
    this.name = name;
    this.branch = branch;
    this.token = '';
    this.user = null;
  }

  get repoPath() {
    return `${this.owner}/${this.name}`;
  }

  get ready() {
    return Boolean(this.token);
  }

  setToken(token) {
    this.token = String(token || '').trim();
  }

  clear() {
    this.token = '';
    this.user = null;
  }

  async request(path, { method = 'GET', body } = {}) {
    let response;
    try {
      response = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
        method,
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          Authorization: `Bearer ${this.token}`,
          ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        body: body ? JSON.stringify(body) : undefined
      });
    } catch {
      throw new WriteError('Keine Verbindung zu GitHub. Netzwerk prüfen.', 0);
    }

    if (response.status === 204) return null;
    if (!response.ok) {
      let message = `${response.status} ${response.statusText}`;
      try {
        const data = await response.json();
        if (data?.message) message = data.message;
      } catch { /* keine JSON-Antwort */ }

      if (response.status === 401) message = 'Der Zugang ist abgelaufen oder wurde zurückgezogen.';
      else if (response.status === 403 && /rate limit/i.test(message)) message = 'GitHub-Anfragelimit erreicht. Bitte kurz warten.';
      else if (response.status === 403) message = 'Dem Zugang fehlen Schreibrechte auf dieses Repository.';
      else if (response.status === 409 || response.status === 422) {
        message = 'Das Repository wurde zwischenzeitlich geändert. Bitte neu laden und erneut veröffentlichen.';
      }
      throw new WriteError(message, response.status);
    }
    return response.json();
  }

  /** Token prüfen und die Schreibrechte bestätigen. */
  async verify() {
    this.user = await this.request('/user');
    const repo = await this.request(`/repos/${this.repoPath}`);
    if (!repo?.permissions?.push) {
      throw new WriteError(`Dieser Zugang darf in ${this.repoPath} nicht schreiben.`, 403);
    }
    if (!this.branch) this.branch = repo.default_branch;
    return this.user;
  }

  /**
   * Änderungen als ein Commit veröffentlichen.
   *
   * @param {{path: string, bytes?: Uint8Array, text?: string}[]} files zu schreiben
   * @param {string[]} deletions Pfade, die verschwinden sollen
   * @param {string} message Commit-Nachricht
   * @param {(schritt: string, anteil: number) => void} [onProgress]
   */
  async publish({ files = [], deletions = [], message, onProgress }) {
    if (!files.length && !deletions.length) throw new WriteError('Nichts zu veröffentlichen.', 0);
    const report = (label, done, total) => onProgress?.(label, total ? done / total : 0);

    report('Stand wird geprüft …', 0, 1);
    const ref = await this.request(`/repos/${this.repoPath}/git/ref/heads/${encodeURIComponent(this.branch)}`);
    const baseCommit = await this.request(`/repos/${this.repoPath}/git/commits/${ref.object.sha}`);

    // Dateien einzeln als Blob hochladen. Base64, damit auch Bilder gehen.
    const tree = [];
    let done = 0;
    for (const file of files) {
      report(`Datei ${done + 1} von ${files.length} …`, done, files.length);
      const blob = await this.request(`/repos/${this.repoPath}/git/blobs`, {
        method: 'POST',
        body: file.bytes
          ? { content: toBase64(file.bytes), encoding: 'base64' }
          : { content: file.text, encoding: 'utf-8' }
      });
      tree.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha });
      done += 1;
    }

    // Löschen heißt in der Baum-API: Pfad mit sha null überschreiben.
    for (const path of deletions) {
      tree.push({ path, mode: '100644', type: 'blob', sha: null });
    }

    report('Änderungen werden zusammengefasst …', done, files.length);
    const newTree = await this.request(`/repos/${this.repoPath}/git/trees`, {
      method: 'POST',
      body: { base_tree: baseCommit.tree.sha, tree }
    });

    const commit = await this.request(`/repos/${this.repoPath}/git/commits`, {
      method: 'POST',
      body: { message, tree: newTree.sha, parents: [ref.object.sha] }
    });

    report('Wird übertragen …', files.length, files.length);
    await this.request(`/repos/${this.repoPath}/git/refs/heads/${encodeURIComponent(this.branch)}`, {
      method: 'PATCH',
      body: { sha: commit.sha, force: false }
    });

    return { sha: commit.sha, url: `https://github.com/${this.repoPath}/commit/${commit.sha}` };
  }

  /** Läuft der Website-Build gerade? Nur zur Anzeige. */
  async latestRun() {
    try {
      const data = await this.request(`/repos/${this.repoPath}/actions/runs?per_page=1&branch=${encodeURIComponent(this.branch)}`);
      return data?.workflow_runs?.[0] || null;
    } catch {
      return null;
    }
  }
}

/**
 * Link auf die Token-Erstellung bei GitHub, mit vorausgewähltem Umfang.
 * Spart dem Nutzer das Suchen in den Einstellungen.
 */
export function tokenSetupUrl(repoName) {
  const params = new URLSearchParams({
    scopes: 'repo',
    description: `Reisearchiv – ${repoName}`
  });
  return `https://github.com/settings/tokens/new?${params}`;
}

export function fineGrainedUrl() {
  return 'https://github.com/settings/personal-access-tokens/new';
}
