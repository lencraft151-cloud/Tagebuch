/**
 * Schlanker GitHub-REST-Client für den Admin-Bereich.
 *
 * Authentifizierung über ein Fine-grained Personal Access Token, das der
 * Admin zur Laufzeit eingibt. Das Token liegt ausschließlich im Browser
 * (localStorage) und steht nie im ausgelieferten Code.
 */

const API = 'https://api.github.com';
const TOKEN_KEY = 'tagebuch:gh-token';

export class GitHubError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
    this.body = body;
  }
}

/* ------------------------------------------------------------ Base64 ---- */

export function encodeText(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function decodeText(base64) {
  const binary = atob(String(base64 || '').replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeBytes(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/* ------------------------------------------------------------- Client --- */

export class GitHub {
  constructor({ owner, name, branch = 'main' }) {
    this.owner = owner;
    this.repo = name;
    this.branch = branch;
    this.token = '';
    this.user = null;
    this.repoInfo = null;
  }

  get repoPath() {
    return `${this.owner}/${this.repo}`;
  }

  loadToken() {
    try {
      this.token = localStorage.getItem(TOKEN_KEY) || '';
    } catch {
      this.token = '';
    }
    return this.token;
  }

  saveToken(token) {
    this.token = String(token || '').trim();
    try {
      if (this.token) localStorage.setItem(TOKEN_KEY, this.token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch { /* privater Modus: Token gilt nur für diese Sitzung */ }
  }

  clearToken() {
    this.token = '';
    this.user = null;
    this.repoInfo = null;
    try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignorieren */ }
  }

  async request(path, options = {}) {
    const url = path.startsWith('http') ? path : `${API}${path}`;
    const headers = {
      Accept: options.raw ? 'application/vnd.github.raw' : 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.headers || {})
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (options.body) headers['Content-Type'] = 'application/json';

    let response;
    try {
      response = await fetch(url, {
        method: options.method || 'GET',
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined
      });
    } catch (error) {
      throw new GitHubError('Keine Verbindung zu GitHub. Netzwerk prüfen.', 0, null);
    }

    if (response.status === 204) return null;

    if (!response.ok) {
      let body = null;
      let message = `${response.status} ${response.statusText}`;
      try {
        body = await response.json();
        if (body?.message) message = body.message;
      } catch { /* keine JSON-Antwort */ }

      if (response.status === 401) message = 'Token ungültig oder abgelaufen.';
      if (response.status === 403 && /rate limit/i.test(message)) {
        message = 'GitHub-Anfragelimit erreicht. Bitte kurz warten.';
      } else if (response.status === 403) {
        message = 'Keine Berechtigung. Hat das Token Schreibrechte auf "Contents"?';
      }
      if (response.status === 409) message = 'Konflikt: Die Datei wurde zwischenzeitlich geändert. Bitte neu laden.';

      throw new GitHubError(message, response.status, body);
    }

    if (options.raw) return response.arrayBuffer();
    return response.json();
  }

  /* ------------------------------------------------------ Anmeldung --- */

  async signIn(token) {
    this.saveToken(token);
    this.user = await this.request('/user');
    this.repoInfo = await this.request(`/repos/${this.repoPath}`);
    if (!this.repoInfo?.permissions?.push) {
      throw new GitHubError(
        `Das Token darf in ${this.repoPath} nicht schreiben. Bitte "Contents: Read and write" erlauben.`,
        403,
        null
      );
    }
    if (this.repoInfo.default_branch && !this.branch) this.branch = this.repoInfo.default_branch;
    return this.user;
  }

  /* -------------------------------------------------------- Dateien --- */

  async listDir(dir) {
    try {
      const items = await this.request(`/repos/${this.repoPath}/contents/${encodeURI(dir)}?ref=${encodeURIComponent(this.branch)}`);
      return Array.isArray(items) ? items : [];
    } catch (error) {
      if (error.status === 404) return [];
      throw error;
    }
  }

  async getFile(path) {
    const data = await this.request(`/repos/${this.repoPath}/contents/${encodeURI(path)}?ref=${encodeURIComponent(this.branch)}`);
    return { sha: data.sha, text: decodeText(data.content), size: data.size };
  }

  async getBlob(path) {
    return this.request(`/repos/${this.repoPath}/contents/${encodeURI(path)}?ref=${encodeURIComponent(this.branch)}`, { raw: true });
  }

  async putFile({ path, contentBase64, message, sha }) {
    const body = { message, content: contentBase64, branch: this.branch };
    if (sha) body.sha = sha;
    const result = await this.request(`/repos/${this.repoPath}/contents/${encodeURI(path)}`, { method: 'PUT', body });
    return { sha: result.content.sha, commit: result.commit };
  }

  async deleteFile({ path, sha, message }) {
    return this.request(`/repos/${this.repoPath}/contents/${encodeURI(path)}`, {
      method: 'DELETE',
      body: { message, sha, branch: this.branch }
    });
  }

  /* -------------------------------------------------------- Deploys --- */

  async latestRun() {
    try {
      const data = await this.request(`/repos/${this.repoPath}/actions/runs?per_page=1&branch=${encodeURIComponent(this.branch)}`);
      return data?.workflow_runs?.[0] || null;
    } catch {
      return null;
    }
  }

  /** Öffentliche Roh-URL – nur bei öffentlichen Repositories nutzbar. */
  rawUrl(path) {
    return `https://raw.githubusercontent.com/${this.repoPath}/${encodeURIComponent(this.branch)}/${encodeURI(path)}`;
  }

  get isPrivate() {
    return Boolean(this.repoInfo?.private);
  }
}
