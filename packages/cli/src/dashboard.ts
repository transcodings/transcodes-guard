/**
 * Local web dashboard for token configuration — Serena-style localhost UI.
 *
 * Binds to 127.0.0.1 only. Saves via the same writeTokenToFile / clearTokenFile
 * as `transcodes set` / `reset`.
 */
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  parseMemberAccessToken,
  readTokenFromFile,
  readTokenList,
  readTokenRecords,
  removeTokenFromFile,
  setActiveToken,
  setTokenLabel,
  isTrackerEnabled,
  setTrackerEnabled,
  transcodesConfigFile,
  writeTokenToFile,
} from '@ai-action-tracker/stepup-core';
import { LOGO_DATA_URI } from './logo.js';

const DEFAULT_PORT = 3847;
const HOST = '127.0.0.1';

type TokenEntry = {
  /** Short fingerprint — used as the client-side id so full JWTs need not be
   *  echoed to the browser for select/delete. */
  id: string;
  label?: string;
  projectId?: string;
  organizationId?: string;
  expiresAt?: string;
  warnings?: string[];
  active: boolean;
};

type StatusPayload = {
  configPath: string;
  envOverridesFile: boolean;
  tokens: TokenEntry[];
};

function fingerprint(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 12);
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function buildStatus(): StatusPayload {
  const configPath = transcodesConfigFile();
  const records = readTokenRecords();
  const active = readTokenFromFile();
  const envOverridesFile = Boolean(
    process.env.TRANSCODES_TOKEN?.trim() && active
  );

  const tokens: TokenEntry[] = records.map(({ token, label }) => {
    const entry: TokenEntry = {
      id: fingerprint(token),
      active: token === active,
    };
    if (label) entry.label = label;
    try {
      const parsed = parseMemberAccessToken(token);
      entry.projectId = parsed.claims.projectId;
      entry.organizationId = parsed.claims.organizationId;
      entry.expiresAt = new Date(parsed.claims.exp * 1000).toISOString();
      if (parsed.warnings.length > 0) entry.warnings = [...parsed.warnings];
    } catch (err) {
      entry.warnings = [err instanceof Error ? err.message : String(err)];
    }
    return entry;
  });

  return { configPath, envOverridesFile, tokens };
}

/** Find a stored token by its fingerprint id. */
function tokenById(id: string): string | undefined {
  return readTokenList().find((t) => fingerprint(t) === id);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function dashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Transcodes — Token</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    :root {
      --bg: #f4f4f6;
      --card: #ffffff;
      --line: #ececf0;
      --ink: #16161a;
      --muted: #8a8a94;
      --accent: #5b54e6;
      --accent-soft: #eeedfb;
    }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--ink);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 32px;
      -webkit-font-smoothing: antialiased;
    }
    .card {
      width: 100%;
      max-width: 460px;
      background: var(--card);
      border-radius: 24px;
      padding: 34px;
      box-shadow: 0 1px 2px rgba(16, 16, 26, 0.04), 0 12px 40px rgba(16, 16, 26, 0.06);
    }
    .header {
      display: flex;
      align-items: center;
      gap: 16px;
      padding-bottom: 24px;
      border-bottom: 1px solid var(--line);
    }
    .avatar {
      width: 56px;
      height: 56px;
      border-radius: 14px;
      flex-shrink: 0;
      object-fit: contain;
      background: #f4f4f6;
      padding: 8px;
    }
    .header h1 {
      margin: 0;
      font-size: 21px;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .header p {
      margin: 5px 0 0;
      font-size: 14px;
      color: var(--muted);
    }
    .tabs {
      display: flex;
      gap: 4px;
      margin-top: 22px;
      padding: 4px;
      background: #f4f4f6;
      border-radius: 13px;
    }
    .tab {
      flex: 1;
      padding: 9px 12px;
      font-size: 13.5px;
      font-weight: 600;
      color: var(--muted);
      background: transparent;
      border: none;
      border-radius: 9px;
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
    }
    .tab:hover { color: var(--ink); }
    .tab.active {
      background: #fff;
      color: var(--ink);
      box-shadow: 0 1px 2px rgba(16, 16, 26, 0.08);
    }
    .panel { display: none; padding-top: 26px; }
    .panel.active { display: block; }
    .section-title {
      font-size: 17px;
      font-weight: 700;
      margin: 0 0 4px;
      letter-spacing: -0.01em;
    }
    .section-sub {
      font-size: 14px;
      color: var(--muted);
      margin: 0 0 20px;
    }
    textarea {
      width: 100%;
      min-height: 92px;
      padding: 14px 16px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 12.5px;
      line-height: 1.5;
      color: var(--ink);
      background: #fbfbfc;
      border: 1px solid var(--line);
      border-radius: 14px;
      resize: vertical;
      outline: none;
      transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
    }
    textarea:focus {
      background: #fff;
      border-color: var(--accent);
      box-shadow: 0 0 0 4px rgba(91, 84, 230, 0.12);
    }
    textarea::placeholder { color: #b9b9c2; }
    .label-input {
      width: 100%;
      margin-top: 12px;
      padding: 12px 16px;
      font-size: 13.5px;
      color: var(--ink);
      background: #fbfbfc;
      border: 1px solid var(--line);
      border-radius: 14px;
      outline: none;
      transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
    }
    .label-input:focus {
      background: #fff;
      border-color: var(--accent);
      box-shadow: 0 0 0 4px rgba(91, 84, 230, 0.12);
    }
    .label-input::placeholder { color: #b9b9c2; }
    .actions {
      display: flex;
      gap: 12px;
      margin-top: 18px;
    }
    .actions button {
      flex: 1;
      padding: 13px 18px;
      font-size: 15px;
      font-weight: 600;
      border-radius: 14px;
      border: none;
      cursor: pointer;
      transition: background 0.15s, opacity 0.15s, transform 0.05s;
    }
    .actions button:active:not(:disabled) { transform: translateY(1px); }
    .actions button:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-primary { background: var(--accent); color: #fff; }
    .btn-primary:hover:not(:disabled) { background: #4a43d4; }
    .btn-secondary {
      background: #f4f4f6;
      color: #5a5a64;
    }
    .btn-secondary:hover:not(:disabled) { background: #ececf0; }
    .list-label {
      margin: 26px 0 10px;
      font-size: 13px;
      font-weight: 600;
      color: var(--muted);
      letter-spacing: 0.01em;
    }
    .token-list { display: flex; flex-direction: column; gap: 10px; }
    .token-empty {
      padding: 16px 18px;
      background: #fbfbfc;
      border: 1px dashed var(--line);
      border-radius: 16px;
      font-size: 13.5px;
      color: var(--muted);
      text-align: center;
    }
    .token-row {
      display: flex;
      flex-direction: column;
      gap: 14px;
      padding: 16px;
      background: #fbfbfc;
      border: 1px solid var(--line);
      border-radius: 16px;
      transition: border-color 0.15s, background 0.15s;
    }
    .token-row.active {
      border-color: var(--accent);
      background: var(--accent-soft);
    }
    .token-top { display: flex; align-items: center; gap: 14px; }
    .radio {
      width: 18px;
      height: 18px;
      border-radius: 50%;
      border: 2px solid #d0d0d8;
      flex-shrink: 0;
      position: relative;
      transition: border-color 0.15s;
    }
    .token-row.active .radio { border-color: var(--accent); }
    .token-row.active .radio::after {
      content: "";
      position: absolute;
      inset: 3px;
      border-radius: 50%;
      background: var(--accent);
    }
    .token-info { flex: 1; min-width: 0; line-height: 1.45; }
    .token-info .label {
      font-size: 14.5px;
      font-weight: 700;
      color: var(--ink);
      margin-bottom: 4px;
    }
    .token-info .field { font-size: 13px; color: #4a4a52; }
    .token-info .field .k { color: var(--muted); }
    .token-info .field code {
      font-size: 12px;
      color: var(--ink);
      background: #fff;
      border: 1px solid var(--line);
      padding: 1px 7px;
      border-radius: 6px;
    }
    .token-row.active .token-info .field code { background: #fff; }
    .token-info .warn { font-size: 12px; color: #c0392f; margin-top: 2px; }
    .token-actions {
      display: flex;
      gap: 8px;
      padding-top: 12px;
      border-top: 1px solid var(--line);
    }
    .token-row.active .token-actions { border-top-color: rgba(91, 84, 230, 0.18); }
    .token-actions button {
      flex: 1;
      padding: 9px 12px;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.03em;
      border-radius: 10px;
      border: 1px solid var(--line);
      background: #fff;
      cursor: pointer;
      transition: background 0.15s, color 0.15s, border-color 0.15s, opacity 0.15s;
    }
    .btn-set { color: var(--accent); }
    .btn-set:hover:not(:disabled) { background: var(--accent); color: #fff; border-color: var(--accent); }
    .btn-set:disabled { opacity: 0.45; cursor: default; }
    .btn-del { color: #c0392f; }
    .btn-del:hover { background: #c0392f; color: #fff; border-color: #c0392f; }
    .btn-edit, .btn-cancel { color: #5a5a64; }
    .btn-edit:hover, .btn-cancel:hover { background: #ececf0; color: var(--ink); border-color: #dcdce2; }
    .label-edit {
      width: 100%;
      padding: 9px 12px;
      font-size: 13.5px;
      font-weight: 600;
      color: var(--ink);
      background: #fff;
      border: 1px solid var(--accent);
      border-radius: 9px;
      outline: none;
      box-shadow: 0 0 0 4px rgba(91, 84, 230, 0.12);
    }
    .cmd-list { display: flex; flex-direction: column; gap: 10px; }
    .cmd {
      padding: 14px 16px;
      background: #fbfbfc;
      border: 1px solid var(--line);
      border-radius: 14px;
    }
    .cmd code {
      display: inline-block;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 12.5px;
      color: var(--accent);
      background: var(--accent-soft);
      padding: 3px 9px;
      border-radius: 7px;
    }
    .cmd .cmd-desc {
      display: block;
      margin-top: 8px;
      font-size: 13px;
      color: var(--muted);
      line-height: 1.5;
    }
    .settings-list { display: flex; flex-direction: column; gap: 10px; }
    .setting-row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      padding: 14px 16px;
      background: #fbfbfc;
      border: 1px solid var(--line);
      border-radius: 14px;
    }
    .setting-info { flex: 1; min-width: 0; }
    .setting-label {
      display: block;
      font-size: 14.5px;
      font-weight: 600;
      color: var(--ink);
      letter-spacing: -0.01em;
    }
    .setting-desc {
      margin: 8px 0 0;
      font-size: 13px;
      color: var(--muted);
      line-height: 1.5;
    }
    .toggle {
      position: relative;
      width: 44px;
      height: 26px;
      flex: none;
      flex-shrink: 0;
      margin-top: 2px;
      border: none;
      border-radius: 999px;
      background: #d8d8de;
      cursor: pointer;
      padding: 0;
      transition: background 0.2s;
    }
    .toggle::after {
      content: "";
      position: absolute;
      top: 3px;
      left: 3px;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: #fff;
      box-shadow: 0 1px 3px rgba(16, 16, 26, 0.18);
      transition: transform 0.2s;
    }
    .toggle.on { background: var(--accent); }
    .toggle.on::after { transform: translateX(18px); }
    .toggle:disabled { opacity: 0.5; cursor: not-allowed; }
    .toast {
      margin-top: 14px;
      padding: 12px 16px;
      border-radius: 12px;
      font-size: 13.5px;
      font-weight: 500;
      display: none;
    }
    .toast.show { display: block; }
    .toast.success { background: #effaf2; color: #1a7f45; }
    .toast.error { background: #fdf0f0; color: #c0392f; }
    .hint {
      margin: 18px 0 0;
      font-size: 12.5px;
      color: #b9b9c2;
      text-align: center;
      line-height: 1.6;
    }
    .hint code {
      font-size: 11.5px;
      background: #f4f4f6;
      padding: 2px 7px;
      border-radius: 6px;
      color: #8a8a94;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <img class="avatar" src="${LOGO_DATA_URI}" alt="Transcodes" />
      <div>
        <h1>Transcodes</h1>
        <p>CLI Dashboard</p>
      </div>
    </div>
    <div class="tabs">
      <button type="button" class="tab active" data-tab="tokens">Tokens</button>
      <button type="button" class="tab" data-tab="settings">Settings</button>
      <button type="button" class="tab" data-tab="cli">CLI Commands</button>
    </div>

    <div class="panel active" id="panel-tokens">
      <p class="section-title">MCP Agent Token</p>
      <p class="section-sub">Paste the token from your Transcodes console member detail page</p>
      <textarea id="token" placeholder="eyJhbGciOi…" spellcheck="false" autocomplete="off"></textarea>
      <input type="text" id="label" class="label-input" placeholder="Label (required) — e.g. transcodes-{project_name}-{env}" autocomplete="off" required />
      <div class="actions">
        <button type="button" class="btn-primary" id="save">Save</button>
        <button type="button" class="btn-secondary" id="clear">Clear</button>
      </div>
      <div id="toast" class="toast"></div>
      <p class="list-label">Saved tokens</p>
      <div class="token-list" id="token-list"></div>
      <p class="hint">Saved to <code>{{HOME_DIR}}/.transcodes/config.json</code><br />Press Ctrl+C in the terminal to stop</p>
    </div>

    <div class="panel" id="panel-cli">
      <p class="section-title">CLI Commands</p>
      <p class="section-sub">Run these from your terminal — the dashboard wraps the same actions</p>
      <div class="cmd-list">
        <div class="cmd"><code>transcodes</code><span class="cmd-desc">Open this dashboard (default, same as transcodes dashboard)</span></div>
        <div class="cmd"><code>transcodes set &lt;token&gt; -l &lt;label&gt;</code><span class="cmd-desc">Validate and save a token with a label, then make it active</span></div>
        <div class="cmd"><code>transcodes tokens</code><span class="cmd-desc">List all saved tokens (active one marked with *)</span></div>
        <div class="cmd"><code>transcodes reset</code><span class="cmd-desc">Remove all saved tokens</span></div>
        <div class="cmd"><code>transcodes help</code><span class="cmd-desc">Show the full command list and how to use each one</span></div>
      </div>
    </div>

    <div class="panel" id="panel-settings">
      <p class="section-title">Settings</p>
      <p class="section-sub">Manage your local MCP Agent settings</p>
      <div class="settings-list">
        <div class="setting-row">
          <div class="setting-info">
            <span class="setting-label">Step-up Authentication</span>
            <p class="setting-desc">When off, all features except Transcodes essentials are skipped</p>
          </div>
          <button type="button" class="toggle" id="stepup-toggle" aria-label="Step-up Authentication"></button>
        </div>
      </div>
      <div id="settings-toast" class="toast"></div>
    </div>
  </div>
  <script>
    const tokenEl = document.getElementById("token");
    const labelEl = document.getElementById("label");
    const toastEl = document.getElementById("toast");
    const listEl = document.getElementById("token-list");
    const saveBtn = document.getElementById("save");
    const clearBtn = document.getElementById("clear");

    document.querySelectorAll(".tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        const name = tab.getAttribute("data-tab");
        document.querySelectorAll(".tab").forEach((t) =>
          t.classList.toggle("active", t === tab));
        document.querySelectorAll(".panel").forEach((p) =>
          p.classList.toggle("active", p.id === "panel-" + name));
        if (name === "settings") loadSettings();
      });
    });

    function showToast(msg, kind) {
      toastEl.textContent = msg;
      toastEl.className = "toast show " + (kind || "success");
      setTimeout(() => toastEl.classList.remove("show"), 4000);
    }

    function esc(s) {
      return String(s).replace(/[&<>"]/g, (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    }

    let lastStatus = { tokens: [] };
    let editingId = null;

    function renderTokens(s) {
      if (!s.tokens || s.tokens.length === 0) {
        listEl.innerHTML = '<div class="token-empty">No tokens saved yet — paste one above and press Save</div>';
        return;
      }

      listEl.innerHTML = s.tokens.map((t) => {
        const editing = t.id === editingId;
        const project = t.projectId
          ? '<div class="field"><span class="k">Project Id</span> <code>' + esc(t.projectId) + '</code></div>'
          : '';
        const org = t.organizationId
          ? '<div class="field"><span class="k">Organization Id</span> <code>' + esc(t.organizationId) + '</code></div>'
          : '';
        const warn = t.warnings && t.warnings.length
          ? '<div class="warn">' + esc(t.warnings.join("; ")) + '</div>'
          : '';
        const labelBlock = editing
          ? '<input type="text" class="label-edit" data-edit-input="' + t.id + '" value="' + esc(t.label || "") + '" placeholder="Label" />'
          : (t.label ? '<div class="label">' + esc(t.label) + '</div>' : '');
        const actions = editing
          ? '<button type="button" class="btn-set" data-save-label="' + t.id + '">SAVE</button>' +
            '<button type="button" class="btn-cancel" data-cancel-edit="1">CANCEL</button>'
          : '<button type="button" class="btn-edit" data-edit="' + t.id + '">EDIT</button>' +
            '<button type="button" class="btn-set" data-set="' + t.id + '"' + (t.active ? " disabled" : "") + '>' +
              (t.active ? "DEFAULT" : "SET DEFAULT") +
            '</button>' +
            '<button type="button" class="btn-del" data-del="' + t.id + '">DELETE</button>';
        return (
          '<div class="token-row' + (t.active ? " active" : "") + '" data-id="' + t.id + '">' +
            '<div class="token-top">' +
              '<span class="radio"></span>' +
              '<div class="token-info">' + labelBlock + org + project + warn + '</div>' +
            '</div>' +
            '<div class="token-actions">' + actions + '</div>' +
          '</div>'
        );
      }).join("");

      if (editingId) {
        const el = listEl.querySelector('[data-edit-input="' + editingId + '"]');
        if (el) { el.focus(); el.select(); }
      }
    }

    async function refresh() {
      const res = await fetch("/api/status");
      lastStatus = await res.json();
      renderTokens(lastStatus);
    }

    async function saveLabel(id) {
      const input = listEl.querySelector('[data-edit-input="' + id + '"]');
      const label = input ? input.value.trim() : "";
      if (!label) {
        showToast("Label cannot be empty", "error");
        return;
      }
      try {
        const res = await fetch("/api/label", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, label }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Rename failed");
        editingId = null;
        showToast("Label updated", "success");
        refresh();
      } catch (e) {
        showToast(e.message || "Rename failed", "error");
      }
    }

    async function setDefault(id) {
      try {
        const res = await fetch("/api/select", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Set default failed");
        showToast("Default token updated", "success");
        refresh();
      } catch (e) {
        showToast(e.message || "Set default failed", "error");
      }
    }

    async function removeToken(id) {
      if (!confirm("Delete this token from the saved list?")) return;
      try {
        const res = await fetch("/api/token", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Delete failed");
        showToast("Token deleted", "success");
        refresh();
      } catch (e) {
        showToast(e.message || "Delete failed", "error");
      }
    }

    listEl.addEventListener("click", (e) => {
      const editId = e.target.getAttribute("data-edit");
      if (editId) { editingId = editId; renderTokens(lastStatus); return; }
      const saveId = e.target.getAttribute("data-save-label");
      if (saveId) { saveLabel(saveId); return; }
      if (e.target.getAttribute("data-cancel-edit")) {
        editingId = null; renderTokens(lastStatus); return;
      }
      const setId = e.target.getAttribute("data-set");
      if (setId) { setDefault(setId); return; }
      const delId = e.target.getAttribute("data-del");
      if (delId) { removeToken(delId); return; }
    });

    listEl.addEventListener("keydown", (e) => {
      const input = e.target.closest(".label-edit");
      if (!input) return;
      if (e.key === "Enter") { e.preventDefault(); saveLabel(editingId); }
      else if (e.key === "Escape") { editingId = null; renderTokens(lastStatus); }
    });

    saveBtn.addEventListener("click", async () => {
      const token = tokenEl.value.trim();
      const label = labelEl.value.trim();
      if (!token) {
        showToast("Paste a token first", "error");
        return;
      }
      if (!label) {
        showToast("Add a label first", "error");
        labelEl.focus();
        return;
      }
      saveBtn.disabled = true;
      try {
        const res = await fetch("/api/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, label }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Save failed");
        tokenEl.value = "";
        labelEl.value = "";
        showToast("Token saved", "success");
        refresh();
      } catch (e) {
        showToast(e.message || "Save failed", "error");
      } finally {
        saveBtn.disabled = false;
      }
    });

    clearBtn.addEventListener("click", () => {
      tokenEl.value = "";
      labelEl.value = "";
      tokenEl.focus();
    });

    const stepupToggleEl = document.getElementById("stepup-toggle");
    const settingsToastEl = document.getElementById("settings-toast");

    function showSettingsToast(msg, kind) {
      settingsToastEl.textContent = msg;
      settingsToastEl.className = "toast show " + (kind || "success");
      setTimeout(() => settingsToastEl.classList.remove("show"), 4000);
    }

    function renderStepupToggle(enabled) {
      stepupToggleEl.classList.toggle("on", enabled);
      stepupToggleEl.setAttribute("aria-checked", enabled ? "true" : "false");
    }

    async function loadSettings() {
      const res = await fetch("/api/settings");
      const s = await res.json();
      renderStepupToggle(s.enabled !== false);
    }

    stepupToggleEl.addEventListener("click", async () => {
      const next = !stepupToggleEl.classList.contains("on");
      stepupToggleEl.disabled = true;
      try {
        const res = await fetch("/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: next }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Save failed");
        renderStepupToggle(next);
        showSettingsToast(
          next ? "Step-up Authentication enabled" : "Step-up Authentication disabled",
          "success"
        );
      } catch (e) {
        showSettingsToast(e.message || "Save failed", "error");
      } finally {
        stepupToggleEl.disabled = false;
      }
    });

    refresh();
    loadSettings();
  </script>
</body>
</html>`;
}

function openBrowser(url: string): void {
  const opener =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
      ? 'cmd'
      : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    const child = spawn(opener, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // URL is printed if the browser does not open.
  }
}

function listen(port: number): Promise<ReturnType<typeof createServer>> {
  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const url = req.url ?? '/';
      const method = req.method ?? 'GET';

      // DNS-rebinding guard: a malicious page on another origin can point its
      // DNS at 127.0.0.1 and have the victim's browser POST to this server,
      // but the Host header still carries the attacker's domain. Only accept
      // requests addressed to the loopback names we bind to.
      const hostName = (req.headers.host ?? '').split(':')[0];
      if (hostName !== '127.0.0.1' && hostName !== 'localhost') {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('forbidden host');
        return;
      }

      try {
        if (method === 'GET' && (url === '/' || url === '/index.html')) {
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
          });
          res.end(dashboardHtml());
          return;
        }

        if (method === 'GET' && url === '/api/status') {
          sendJson(res, 200, buildStatus());
          return;
        }

        if (method === 'POST' && url === '/api/token') {
          const body = (await readJsonBody(req)) as {
            token?: unknown;
            label?: unknown;
          };
          const token = typeof body.token === 'string' ? body.token.trim() : '';
          const label = typeof body.label === 'string' ? body.label.trim() : '';
          if (!token) {
            sendJson(res, 400, { error: 'token is required' });
            return;
          }
          if (!label) {
            sendJson(res, 400, { error: 'label is required' });
            return;
          }
          try {
            parseMemberAccessToken(token);
          } catch (err) {
            sendJson(res, 400, {
              error: err instanceof Error ? err.message : String(err),
            });
            return;
          }
          writeTokenToFile(token, label);
          sendJson(res, 200, { ok: true, ...buildStatus() });
          return;
        }

        if (method === 'POST' && url === '/api/label') {
          const body = (await readJsonBody(req)) as {
            id?: unknown;
            label?: unknown;
          };
          const id = typeof body.id === 'string' ? body.id : '';
          const label = typeof body.label === 'string' ? body.label.trim() : '';
          const token = id ? tokenById(id) : undefined;
          if (!token) {
            sendJson(res, 404, { error: 'token not found' });
            return;
          }
          if (!label) {
            sendJson(res, 400, { error: 'label is required' });
            return;
          }
          setTokenLabel(token, label);
          sendJson(res, 200, { ok: true, ...buildStatus() });
          return;
        }

        if (method === 'POST' && url === '/api/select') {
          const body = (await readJsonBody(req)) as { id?: unknown };
          const id = typeof body.id === 'string' ? body.id : '';
          const token = id ? tokenById(id) : undefined;
          if (!token) {
            sendJson(res, 404, { error: 'token not found' });
            return;
          }
          setActiveToken(token);
          sendJson(res, 200, { ok: true, ...buildStatus() });
          return;
        }

        if (method === 'DELETE' && url === '/api/token') {
          const body = (await readJsonBody(req)) as { id?: unknown };
          const id = typeof body.id === 'string' ? body.id : '';
          const token = id ? tokenById(id) : undefined;
          if (!token) {
            sendJson(res, 404, { error: 'token not found' });
            return;
          }
          removeTokenFromFile(token);
          sendJson(res, 200, { ok: true, ...buildStatus() });
          return;
        }

        if (method === 'GET' && url === '/api/settings') {
          sendJson(res, 200, {
            enabled: isTrackerEnabled(),
          });
          return;
        }

        if (method === 'POST' && url === '/api/settings') {
          const body = (await readJsonBody(req)) as {
            enabled?: unknown;
          };
          if (typeof body.enabled !== 'boolean') {
            sendJson(res, 400, {
              error: 'enabled must be a boolean',
            });
            return;
          }
          setTrackerEnabled(body.enabled);
          sendJson(res, 200, {
            ok: true,
            enabled: isTrackerEnabled(),
          });
          return;
        }

        sendJson(res, 404, { error: 'not found' });
      } catch (err) {
        sendJson(res, 500, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

    server.on('error', reject);
    server.listen(port, HOST, () => resolve(server));
  });
}

export async function runDashboard(options: {
  port?: number;
  open?: boolean;
}): Promise<void> {
  const preferred = options.port ?? DEFAULT_PORT;
  let server: ReturnType<typeof createServer> | undefined;
  let port = preferred;

  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      server = await listen(port);
      break;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EADDRINUSE') {
        port += 1;
        continue;
      }
      throw err;
    }
  }

  if (!server) {
    const last = preferred + 9;
    throw new Error(
      `could not find a free port in ${preferred}-${last} (all in use).\n` +
        `  A previous dashboard is probably still running.\n` +
        `  Tip: if you stopped one with Ctrl+Z it is only suspended (still alive) — use Ctrl+C to stop it.\n` +
        `  Free the ports and retry:\n` +
        `    macOS/Linux:  lsof -ti tcp:${preferred}-${last} | xargs kill -9\n` +
        `    any platform: npx kill-port ${preferred} ${
          preferred + 1
        }  # repeat per port\n` +
        `  Or choose another port:  transcodes --port <N>`
    );
  }

  const url = `http://${HOST}:${port}/`;
  process.stdout.write(
    `Transcodes dashboard running at ${url}\n` +
      `  Config file: ${transcodesConfigFile()}\n` +
      `  Press Ctrl+C to stop\n`
  );

  if (options.open !== false) {
    openBrowser(url);
  }

  await new Promise<void>((resolve) => {
    const onSignal = () => {
      server!.close(() => resolve());
    };
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
  });
}
