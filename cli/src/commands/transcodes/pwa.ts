/**
 * PWA service worker: network-first while the CLI is up; when the local
 * server is stopped, show a cached offline page instead of Chrome's
 * "This site can't be reached".
 */
export const PWA_SERVICE_WORKER = `/* Transcodes dashboard PWA */
const CACHE = 'transcodes-dashboard-offline-v4';
const OFFLINE_URL = '/offline';
const OFFLINE_HTML = \`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="theme-color" content="#16161a" />
  <title>Transcodes — CLI Dashboard</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 40px 24px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: #f4f4f6;
      color: #16161a;
      -webkit-font-smoothing: antialiased;
    }
    .card {
      width: 100%;
      max-width: 520px;
      background: #fff;
      border-radius: 24px;
      padding: 36px 36px 32px;
      box-shadow: 0 1px 2px rgba(16, 16, 26, 0.04), 0 12px 40px rgba(16, 16, 26, 0.06);
    }
    h1 {
      margin: 0 0 8px;
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .lede {
      margin: 0 0 20px;
      font-size: 15px;
      line-height: 1.5;
      color: #8a8a94;
    }
    .tabs {
      display: flex;
      gap: 4px;
      padding: 4px;
      margin-bottom: 20px;
      background: #f4f4f6;
      border-radius: 12px;
    }
    .tab {
      flex: 1;
      border: none;
      border-radius: 9px;
      padding: 10px 12px;
      font-size: 13px;
      font-weight: 600;
      color: #8a8a94;
      background: transparent;
      cursor: pointer;
    }
    .tab[aria-selected="true"] {
      color: #16161a;
      background: #fff;
      box-shadow: 0 1px 2px rgba(16, 16, 26, 0.08);
    }
    .panel[hidden] { display: none !important; }
    ol {
      margin: 0;
      padding-left: 20px;
      font-size: 14px;
      line-height: 1.6;
      color: #5a5a64;
    }
    li + li { margin-top: 8px; }
    kbd {
      font-family: inherit;
      font-size: 12px;
      font-weight: 600;
      color: #16161a;
      background: #f4f4f6;
      border: 1px solid #e2e2e8;
      border-bottom-width: 2px;
      border-radius: 6px;
      padding: 1px 6px;
    }
    .cmd {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-top: 6px;
      background: #16161a;
      border-radius: 10px;
      padding: 10px 12px;
    }
    .cmd code {
      flex: 1;
      min-width: 0;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px;
      color: #fff;
      white-space: nowrap;
      overflow-x: auto;
    }
    .copy {
      flex-shrink: 0;
      border: none;
      border-radius: 7px;
      padding: 5px 10px;
      font-size: 12px;
      font-weight: 600;
      color: #16161a;
      background: #fff;
      cursor: pointer;
    }
    .copy:hover { opacity: 0.88; }
    .note {
      margin: 20px 0 0;
      padding-top: 18px;
      border-top: 1px solid #ececf0;
    }
    .note-title {
      margin: 0 0 6px;
      font-size: 13px;
      font-weight: 700;
      color: #16161a;
    }
    .note-lede {
      margin: 0 0 10px;
      font-size: 13px;
      line-height: 1.55;
      color: #8a8a94;
    }
    .note-hint {
      margin: 10px 0 0;
      font-size: 12px;
      line-height: 1.5;
      color: #8a8a94;
    }
    .note code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px;
      color: #16161a;
      background: #f4f4f6;
      border-radius: 6px;
      padding: 2px 6px;
    }
    .actions {
      margin-top: 22px;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .refresh {
      border: none;
      border-radius: 10px;
      padding: 11px 18px;
      font-size: 14px;
      font-weight: 600;
      color: #fff;
      background: #16161a;
      cursor: pointer;
    }
    .refresh:hover { opacity: 0.92; }
    .status { font-size: 13px; color: #8a8a94; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Control panel is offline</h1>
    <p class="lede">Transcodes isn't running on this computer. Start it from a terminal, then come back here.</p>

    <div class="tabs" role="tablist" aria-label="Operating system">
      <button type="button" class="tab" role="tab" id="tab-unix" aria-controls="panel-unix" aria-selected="true" data-tab="unix">macOS / Linux</button>
      <button type="button" class="tab" role="tab" id="tab-windows" aria-controls="panel-windows" aria-selected="false" data-tab="windows">Windows</button>
    </div>

    <div class="panel" id="panel-unix" role="tabpanel" aria-labelledby="tab-unix">
      <ol>
        <li>Open Terminal — macOS: press <kbd>⌘</kbd> + <kbd>Space</kbd>, type <strong>Terminal</strong>, press <kbd>Enter</kbd>. Linux: press <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>T</kbd>.</li>
        <li>
          Type this and press <kbd>Enter</kbd>:
          <span class="cmd"><code>transcodes</code><button type="button" class="copy" data-copy="transcodes">Copy</button></span>
        </li>
        <li>Leave the terminal open, then click <strong>Refresh</strong> below.</li>
      </ol>
      <div class="note">
        <p class="note-title">Says “command not found”?</p>
        <p class="note-lede">Install first — the script sets up Node.js if needed and runs <code>npm install -g @bigstrider/transcodes-cli</code>. When it finishes, run <code>transcodes</code> and refresh.</p>
        <span class="cmd"><code>curl -fsSL https://raw.githubusercontent.com/transcodings/transcodes-guard/prod/cli/install.sh | bash &amp;&amp; transcodes install</code><button type="button" class="copy" data-copy="curl -fsSL https://raw.githubusercontent.com/transcodings/transcodes-guard/prod/cli/install.sh | bash &amp;&amp; transcodes install">Copy</button></span>
        <p class="note-hint">Already have Node.js 20+? You can also run <code>npm install -g @bigstrider/transcodes-cli</code>.</p>
      </div>
    </div>

    <div class="panel" id="panel-windows" role="tabpanel" aria-labelledby="tab-windows" hidden>
      <ol>
        <li>Open PowerShell — press <kbd>Win</kbd> + <kbd>R</kbd>, type <strong>powershell</strong>, press <kbd>Enter</kbd>.</li>
        <li>
          Type this and press <kbd>Enter</kbd>:
          <span class="cmd"><code>transcodes</code><button type="button" class="copy" data-copy="transcodes">Copy</button></span>
        </li>
        <li>Leave the window open, then click <strong>Refresh</strong> below.</li>
      </ol>
      <div class="note">
        <p class="note-title">Says “command not found”?</p>
        <p class="note-lede">Install first — the script sets up Node.js if needed and runs <code>npm install -g @bigstrider/transcodes-cli</code>. When it finishes, run <code>transcodes</code> and refresh.</p>
        <span class="cmd"><code>Set-ExecutionPolicy Bypass -Scope Process -Force; irm https://raw.githubusercontent.com/transcodings/transcodes-guard/prod/cli/install.ps1 | iex; transcodes install</code><button type="button" class="copy" data-copy="Set-ExecutionPolicy Bypass -Scope Process -Force; irm https://raw.githubusercontent.com/transcodings/transcodes-guard/prod/cli/install.ps1 | iex; transcodes install">Copy</button></span>
        <p class="note-hint">Already have Node.js 20+? You can also run <code>npm install -g @bigstrider/transcodes-cli</code>.</p>
      </div>
    </div>

    <div class="actions">
      <button type="button" class="refresh" onclick="location.reload()">Refresh</button>
      <span class="status" id="status">Checking every few seconds…</span>
    </div>
  </div>
  <script>
    function selectTab(name) {
      document.querySelectorAll(".tab").forEach(function (tab) {
        var on = tab.getAttribute("data-tab") === name;
        tab.setAttribute("aria-selected", on ? "true" : "false");
      });
      document.getElementById("panel-unix").hidden = name !== "unix";
      document.getElementById("panel-windows").hidden = name !== "windows";
    }

    document.querySelectorAll(".tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        selectTab(tab.getAttribute("data-tab"));
      });
    });

    selectTab((navigator.userAgent || "").indexOf("Win") !== -1 ? "windows" : "unix");

    document.addEventListener("click", function (e) {
      var btn = e.target.closest(".copy");
      if (!btn) return;
      navigator.clipboard.writeText(btn.getAttribute("data-copy")).then(function () {
        btn.textContent = "Copied";
        setTimeout(function () { btn.textContent = "Copy"; }, 1500);
      });
    });

    setInterval(function () {
      fetch("/health", { cache: "no-store" })
        .then(function (res) { if (res.ok) location.reload(); })
        .catch(function () {});
    }, 3000);
  </script>
</body>
</html>\`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      cache.put(
        OFFLINE_URL,
        new Response(OFFLINE_HTML, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      )
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  event.respondWith(
    fetch(request).catch(async () => {
      const wantsHtml =
        request.mode === 'navigate' ||
        (request.headers.get('accept') || '').includes('text/html');
      if (!wantsHtml) {
        return new Response('', { status: 503, statusText: 'Offline' });
      }
      const cached = await caches.match(OFFLINE_URL);
      return (
        cached ||
        new Response(OFFLINE_HTML, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      );
    })
  );
});
`;
