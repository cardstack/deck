// Self-contained Deck browser — served at `/` and `/_browser`.
// Honest about at-rest structure: <store>/<name>/{meta.json,packs/…}.
// Tier-1 history only (sealed packs). No jj/historyd UI pretenses.

export const BROWSER_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Deck store browser</title>
<style>
  :root {
    --bg: #0e1116;
    --panel: #161b22;
    --panel-2: #1c2330;
    --line: #30363d;
    --text: #e6edf3;
    --muted: #8b949e;
    --accent: #3fb950;
    --accent-dim: #238636;
    --warn: #d29922;
    --link: #58a6ff;
    --danger: #ff7b72;
    --mono: "JetBrains Mono", "SF Mono", "Menlo", ui-monospace, monospace;
    --sans: "IBM Plex Sans", "Segoe UI", system-ui, sans-serif;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: var(--bg); color: var(--text); font-family: var(--sans); }
  body { display: grid; grid-template-rows: auto auto 1fr; }
  header.app {
    display: flex; align-items: center; gap: 1rem; flex-wrap: wrap;
    padding: 0.75rem 1rem; border-bottom: 1px solid var(--line); background: var(--panel);
  }
  header.app h1 { margin: 0; font-size: 1.05rem; font-weight: 600; letter-spacing: 0.02em; }
  header.app h1 span { color: var(--accent); }
  header.app .sub { color: var(--muted); font-size: 0.85rem; font-family: var(--mono); }
  .truth {
    padding: 0.55rem 1rem; border-bottom: 1px solid var(--line);
    background: #1a1510; color: #e3c07a; font-size: 0.8rem; line-height: 1.4;
  }
  .truth code { font-family: var(--mono); color: #ffe8a3; }
  .truth strong { color: var(--warn); font-weight: 600; }
  .layout { display: grid; grid-template-columns: 260px 1fr; min-height: 0; }
  @media (max-width: 760px) { .layout { grid-template-columns: 1fr; } aside { max-height: 32vh; } }
  aside {
    border-right: 1px solid var(--line); background: var(--panel);
    overflow: auto; padding: 0.6rem 0;
  }
  aside h2 {
    margin: 0; padding: 0.4rem 0.9rem 0.5rem; font-size: 0.7rem;
    text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); font-weight: 600;
  }
  .pkg {
    display: block; width: 100%; text-align: left; border: 0; background: transparent;
    color: var(--text); font: inherit; padding: 0.5rem 0.9rem; cursor: pointer;
  }
  .pkg:hover { background: var(--panel-2); }
  .pkg.active { background: var(--panel-2); box-shadow: inset 3px 0 0 var(--accent); }
  .pkg .name { font-family: var(--mono); font-size: 0.86rem; }
  .pkg .meta { display: block; color: var(--muted); font-size: 0.7rem; margin-top: 0.15rem; font-family: var(--mono); }
  .pkg .tag { color: var(--accent); }
  main { display: grid; grid-template-rows: auto auto auto 1fr; min-height: 0; min-width: 0; }
  .toolbar {
    display: flex; flex-wrap: wrap; gap: 0.6rem; align-items: center;
    padding: 0.65rem 1rem; border-bottom: 1px solid var(--line); background: var(--panel);
  }
  .toolbar label { color: var(--muted); font-size: 0.78rem; }
  select, button.action {
    background: var(--panel-2); color: var(--text); border: 1px solid var(--line);
    border-radius: 6px; padding: 0.35rem 0.55rem; font: inherit; font-size: 0.85rem;
  }
  select { font-family: var(--mono); min-width: 14rem; max-width: 100%; }
  button.action { cursor: pointer; }
  button.action:hover { border-color: var(--accent-dim); }
  .atrest {
    padding: 0.55rem 1rem; border-bottom: 1px solid var(--line);
    background: var(--panel-2); font-family: var(--mono); font-size: 0.75rem; color: var(--muted);
    line-height: 1.5;
  }
  .atrest strong { color: var(--text); font-weight: 600; }
  .crumbs {
    display: flex; flex-wrap: wrap; gap: 0.25rem; align-items: center;
    padding: 0.5rem 1rem; border-bottom: 1px solid var(--line); font-family: var(--mono); font-size: 0.82rem;
  }
  .crumbs a { color: var(--link); text-decoration: none; }
  .crumbs a:hover { text-decoration: underline; }
  .crumbs .sep { color: var(--muted); }
  .hash { margin-left: auto; color: var(--muted); font-size: 0.75rem; }
  .content { overflow: auto; min-height: 0; }
  table.files { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
  table.files th {
    text-align: left; padding: 0.5rem 1rem; color: var(--muted); font-weight: 500;
    font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.06em;
    border-bottom: 1px solid var(--line); position: sticky; top: 0; background: var(--bg);
  }
  table.files td { padding: 0.4rem 1rem; border-bottom: 1px solid var(--line); font-family: var(--mono); font-size: 0.84rem; }
  table.files tr:hover td { background: var(--panel); }
  table.files a { color: var(--text); text-decoration: none; }
  table.files a:hover { color: var(--link); }
  .dir::before { content: "▸ "; color: var(--warn); }
  .file::before { content: "· "; color: var(--muted); }
  .size, .sha { color: var(--muted); font-size: 0.78rem; word-break: break-all; }
  pre.view {
    margin: 0; padding: 1rem; overflow: auto; font-family: var(--mono); font-size: 0.8rem;
    line-height: 1.45; white-space: pre; tab-size: 2;
  }
  .filebar {
    display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: center;
    padding: 0.55rem 1rem; border-bottom: 1px solid var(--line); background: var(--panel-2);
    font-size: 0.82rem;
  }
  .filebar a { color: var(--link); }
  .empty, .error { padding: 2rem 1rem; color: var(--muted); }
  .error { color: var(--danger); }
  .pill {
    display: inline-block; padding: 0.1rem 0.4rem; border: 1px solid var(--line);
    border-radius: 999px; font-size: 0.7rem; color: var(--accent); margin-left: 0.35rem;
  }
  .pill.warn { color: var(--warn); border-color: #6e5a2a; }
</style>
</head>
<body>
  <header class="app">
    <h1><span>Deck</span> store</h1>
    <div class="sub">&lt;store&gt;/&lt;name&gt;/{meta.json, packs/&lt;treeHash&gt;.pack.zip}</div>
  </header>
  <div class="truth" id="truth">
    Loading store capability…
  </div>
  <div class="layout">
    <aside>
      <h2>Store packages</h2>
      <div id="pkg-list"><div class="empty">loading…</div></div>
    </aside>
    <main>
      <div class="toolbar" id="toolbar" hidden>
        <label for="version">View</label>
        <select id="version"></select>
        <button class="action" id="reload" type="button">Refresh</button>
        <span id="kind-pill"></span>
      </div>
      <div class="atrest" id="atrest" hidden></div>
      <div class="crumbs" id="crumbs" hidden></div>
      <div class="content" id="content"><div class="empty">Select a package directory</div></div>
    </main>
  </div>
<script type="module">
const $ = (id) => document.getElementById(id);
const pkgList = $('pkg-list');
const versionEl = $('version');
const toolbar = $('toolbar');
const atrest = $('atrest');
const crumbs = $('crumbs');
const content = $('content');
const kindPill = $('kind-pill');
const truth = $('truth');

let catalogMeta = null;
let packages = [];
let state = { name: '', version: '', path: '' };

function parseHash() {
  let h = location.hash.replace(/^#\\/?/, '');
  if (!h) return { name: '', version: '', path: '' };
  let m = h.match(/^([^@\\/]+)@([^\\/]+)(?:\\/(.*))?$/);
  if (!m) return { name: '', version: '', path: '' };
  return { name: m[1], version: m[2], path: (m[3] || '').replace(/\\/+$/, '') };
}

function setHash(name, version, path = '') {
  let base = \`\${name}@\${version}\`;
  location.hash = path ? \`#/\${base}/\${path}\` : \`#/\${base}\`;
}

function shortHash(h) {
  return h ? h.slice(0, 12) : '';
}

function fmtSize(n) {
  if (n == null) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / (1024 * 1024)).toFixed(1) + ' MB';
}

async function loadPackages() {
  let res = await fetch('/_packages');
  if (!res.ok) throw new Error('failed to list packages');
  let body = await res.json();
  catalogMeta = body.meta || null;
  packages = body.data || [];
  renderTruth();
  renderPkgList();
}

function renderTruth() {
  let h = catalogMeta?.history;
  if (!h) {
    truth.innerHTML = 'Store listing loaded.';
    return;
  }
  truth.innerHTML = \`<strong>History tier \${h.tier}</strong> —
    \${h.kind}.
    jj: <code>\${h.jj}</code>,
    historyd: <code>\${h.historyd}</code>.
    \${h.note}
    Layout: <code>\${catalogMeta.storeLayout}</code>\`;
}

function renderPkgList() {
  if (!packages.length) {
    pkgList.innerHTML = '<div class="empty">Store is empty — no &lt;name&gt;/meta.json yet.</div>';
    return;
  }
  pkgList.innerHTML = packages.map((p) => {
    let n = Object.keys(p.versions || {}).length;
    let live = p.live ? '<span class="tag">+ live dir</span>' : '';
    let active = p.name === state.name ? ' active' : '';
    return \`<button class="pkg\${active}" data-name="\${p.name}" type="button">
      <span class="name">\${p.storePath || (p.name + '/')}</span>
      <span class="meta">\${live} \${n} version pointer\${n === 1 ? '' : 's'} in meta.json</span>
    </button>\`;
  }).join('');
  pkgList.querySelectorAll('.pkg').forEach((btn) => {
    btn.addEventListener('click', () => {
      let p = packages.find((x) => x.name === btn.dataset.name);
      if (!p) return;
      let ver = p.live
        ? 'live'
        : p.distTags?.latest ||
          p.distTags?.dev ||
          Object.keys(p.versions || {}).sort().at(-1) ||
          'latest';
      setHash(p.name, ver, '');
    });
  });
}

function fillVersions(p) {
  let opts = [];
  if (p.live) {
    opts.push({
      value: 'live',
      label: \`live → \${p.livePath || '(watched dir)'}\`,
    });
  }
  for (let [tag, ver] of Object.entries(p.distTags || {})) {
    let rec = p.versions?.[ver];
    opts.push({
      value: tag,
      label: \`tag:\${tag} → \${ver} (\${shortHash(rec?.treeHash)})\`,
    });
  }
  let versions = Object.keys(p.versions || {}).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  for (let v of versions) {
    let rec = p.versions[v];
    opts.push({
      value: v,
      label: \`\${v} → \${rec.file || ('packs/' + rec.treeHash + '.pack.zip')}\`,
    });
  }
  versionEl.innerHTML = opts.map((o) => \`<option value="\${o.value}">\${o.label}</option>\`).join('');
  if ([...versionEl.options].some((o) => o.value === state.version)) {
    versionEl.value = state.version;
  } else {
    versionEl.selectedIndex = 0;
    state.version = versionEl.value;
  }
}

function renderAtRest(p) {
  atrest.hidden = false;
  let resolved = state.version;
  let rec = p.versions?.[resolved];
  if (!rec && p.distTags?.[resolved]) {
    resolved = p.distTags[resolved];
    rec = p.versions?.[resolved];
  }
  if (state.version === 'live') {
    atrest.innerHTML = \`<strong>Viewing</strong> live working tree<br/>
      <strong>livePath</strong> \${p.livePath || '—'}<br/>
      <strong>store</strong> \${p.storePath}meta.json + packs/ (not what you're reading)\`;
    return;
  }
  atrest.innerHTML = \`<strong>Viewing</strong> sealed pack tree<br/>
    <strong>meta</strong> \${p.metaPath} · version <strong>\${resolved}</strong><br/>
    <strong>pack</strong> \${p.storePath}\${rec?.file || 'packs/?.pack.zip'}<br/>
    <strong>treeHash</strong> \${rec?.treeHash || '—'}
    \${p.livePath ? '<br/><strong>also live</strong> ' + p.livePath : ''}\`;
}

async function loadBrowse() {
  let p = packages.find((x) => x.name === state.name);
  if (!p) {
    toolbar.hidden = true;
    atrest.hidden = true;
    crumbs.hidden = true;
    content.innerHTML = '<div class="empty">Select a package directory from the store</div>';
    return;
  }
  toolbar.hidden = false;
  fillVersions(p);
  renderAtRest(p);
  kindPill.innerHTML = state.version === 'live'
    ? '<span class="pill">live tree</span>'
    : '<span class="pill warn">sealed pack</span>';

  let url = \`/_browse/\${encodeURIComponent(state.name)}@\${encodeURIComponent(state.version)}\`;
  if (state.path) url += '/' + state.path.split('/').map(encodeURIComponent).join('/');
  let res = await fetch(url);
  let body = await res.json();
  if (!res.ok) {
    content.innerHTML = \`<div class="error">\${body.errors?.[0]?.detail || res.status}</div>\`;
    crumbs.hidden = false;
    renderCrumbs(null);
    return;
  }
  if (body.data?.type === 'file') {
    renderFile(body.data.attributes);
  } else {
    renderListing(body.data.attributes);
  }
}

function renderCrumbs(listing) {
  crumbs.hidden = false;
  let parts = state.path ? state.path.split('/') : [];
  let html = \`<a href="#/\${state.name}@\${state.version}">\${state.name}/</a>\`;
  let acc = [];
  for (let part of parts) {
    acc.push(part);
    let path = acc.join('/');
    html += \`<span class="sep"></span><a href="#/\${state.name}@\${state.version}/\${path}">\${part}\${path === state.path && listing?.entries ? '/' : ''}</a>\`;
  }
  if (listing?.treeHash) {
    html += \`<span class="hash">treeHash \${shortHash(listing.treeHash)}</span>\`;
  } else if (listing?.kind === 'live') {
    html += \`<span class="hash">no treeHash — unsaved working tree</span>\`;
  }
  crumbs.innerHTML = html;
}

function renderListing(listing) {
  renderCrumbs(listing);
  if (!listing.entries.length) {
    content.innerHTML = '<div class="empty">Empty directory</div>';
    return;
  }
  let rows = listing.entries.map((e) => {
    let href = \`#/\${state.name}@\${state.version}/\${e.path}\`;
    let cls = e.type === 'dir' ? 'dir' : 'file';
    return \`<tr>
      <td><a class="\${cls}" href="\${href}">\${e.name}\${e.type === 'dir' ? '/' : ''}</a></td>
      <td class="size">\${e.type === 'file' ? fmtSize(e.size) : '—'}</td>
      <td class="sha">\${e.sha256 ? e.sha256 : ''}</td>
    </tr>\`;
  }).join('');
  content.innerHTML = \`<table class="files">
    <thead><tr><th>Name</th><th>Size</th><th>sha256 (from packlist)</th></tr></thead>
    <tbody>\${rows}</tbody>
  </table>\`;
}

function renderFile(file) {
  renderCrumbs({ treeHash: file.treeHash, kind: file.kind });
  let parent = file.path.includes('/') ? file.path.split('/').slice(0, -1).join('/') : '';
  let back = \`#/\${state.name}@\${state.version}\${parent ? '/' + parent : ''}\`;
  let raw = file.rawUrl;
  let body = file.binary
    ? \`<div class="empty">Binary file (\${fmtSize(file.size)}). <a href="\${raw}">Raw bytes</a></div>\`
    : \`<pre class="view"></pre>\`;
  content.innerHTML = \`<div class="filebar">
    <a href="\${back}">← parent</a>
    <span>\${file.path}</span>
    <span class="size">\${fmtSize(file.size)}</span>
    <a href="\${raw}" target="_blank" rel="noreferrer">raw \${raw}</a>
  </div>\${body}\`;
  if (!file.binary && file.text != null) {
    content.querySelector('pre.view').textContent = file.text;
  }
}

async function syncFromHash() {
  state = parseHash();
  renderPkgList();
  if (!state.name && packages[0]) {
    let p = packages[0];
    let ver = p.live ? 'live' : (p.distTags?.latest || p.distTags?.dev || Object.keys(p.versions)[0]);
    setHash(p.name, ver, '');
    return;
  }
  try {
    await loadBrowse();
  } catch (e) {
    content.innerHTML = \`<div class="error">\${e.message || e}</div>\`;
  }
}

versionEl.addEventListener('change', () => {
  setHash(state.name, versionEl.value, '');
});
$('reload').addEventListener('click', () => syncFromHash());
window.addEventListener('hashchange', () => syncFromHash());

await loadPackages();
await syncFromHash();
</script>
</body>
</html>
`;
