// /review — durable branch reviews discovered from real depot repositories.
import 'ui/nav';
import { installNavStyles, onLiveChange, wrapTables } from 'ui/nav';

installNavStyles();
const app = document.getElementById('app');
const keys = document.querySelector('deck-keys');
let current; let endpoint; let busy = false;
const esc = (value) => String(value ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

async function json(url, options) {
  let response = await fetch(url, { headers: { accept: 'application/json', 'content-type': 'application/json' }, ...options });
  let body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? response.statusText);
  return body;
}

async function selectRepository() {
  let catalog = await json('/_hub/repositories');
  let params = new URLSearchParams(location.search);
  let wanted = params.get('repository');
  let depot = params.get('depot');
  return catalog.repositories.find((item) => item.repository === wanted && (!depot || item.depot === depot)) ?? catalog.repositories.find((item) => item.initialized) ?? catalog.repositories[0];
}

function changes(state) {
  if (!state.changes.length) return `<p class="dim">no package changes in this review</p>`;
  return `<table class="repo-table stack"><thead><tr><th>package</th><th>exact diff</th></tr></thead><tbody>${state.changes.map((change) => `<tr><td class="s-package">${esc(change.name)}</td><td><a class="handoff" href="${esc(change.browseUrl)}">Browse Version diff →</a></td></tr>`).join('')}</tbody></table>`;
}

function history(state) {
  return `<ol class="review-history">${state.history.map((item) => `<li><code>${esc(item.revisionHash.slice(0, 12))}</code><div><strong>${esc(item.message)}</strong><br><span class="dim">${esc(item.author.name)} · ${esc(item.createdAt)}${item.parents.length === 2 ? ' · merge' : ''}</span></div></li>`).join('')}</ol>`;
}

function protocol(state) {
  return state.protocol.map((object) => `<details class="protocol-object"><summary><span>${esc(object.label)}</span><code>${esc(object.path)}</code></summary><pre>${esc(JSON.stringify(object.value, null, 2))}</pre></details>`).join('');
}

function render(state) {
  current = state;
  let pull = state.pullRequest;
  let runnable = state.preview?.projection ?? state.main.projection;
  let rootAddress = runnable.members[state.roots[0]];
  let featureBranches = state.branches.filter((branch) => branch.name !== 'main');
  let action = pull?.state === 'open'
    ? `<button class="action primary" data-action="merge" data-number="${pull.number}">Merge review</button>`
    : featureBranches.length
      ? `<button class="action primary" data-action="review">Open review</button>`
      : `<a class="action" href="/browse?at=${esc(rootAddress)}">Create a branch in Browse</a>`;
  app.innerHTML = `<main class="repository review-page">` +
    `<div class="review-context"><a href="/browse?at=${esc(rootAddress)}"><span class="s-publisher">${esc(state.owner)}</span><span class="sep">/</span><strong class="s-package">${esc(state.name)}</strong></a><span class="dim"> / reviews</span></div>` +
    `<section class="repo-section"><header><div><span class="section-index">01</span><h1>Review</h1></div>${action}</header>` +
    (pull ? `<article class="pull-summary"><div class="pull-heading"><span class="status status-${esc(pull.state)}">${pull.state === 'merged' ? '✓' : '●'} ${esc(pull.state)}</span><div><strong>${esc(pull.title)}</strong> <span class="dim">#${pull.number}</span><p>${esc(pull.body)}</p></div></div><div class="merge-line"><code>${esc(pull.source.branch)}</code><span>→</span><code>${esc(pull.target.branch)}</code></div>${changes(state)}<div class="handoffs"><a class="action" href="${esc(runnable.runUrl)}">Run exact Repository →</a><a href="${esc(rootAddress)}/index.html">raw root Version</a></div><h2>Review events</h2><ol class="review-events">${pull.events.map((event) => `<li><b>${esc(event.type)}</b> <code>${esc(event.revisionHash?.slice(0, 12) ?? event.hash.slice(0, 12))}</code> <span class="dim">${esc(event.actor.name)} · ${esc(event.createdAt)}</span></li>`).join('') || '<li class="dim">opened</li>'}</ol></article>` : `<p class="empty-pull">Choose a branch and open a review when the work is ready.</p>`) +
    `</section><section class="repo-section"><header><div><span class="section-index">02</span><h1>Work</h1></div></header>${history(state)}</section>` +
    `<section class="repo-section underneath"><header><div><span class="section-index">03</span><h1>Underneath</h1></div></header><p class="section-note">Canonical refs and immutable objects. This is the state the CLI, agents, and Hub share.</p>${protocol(state)}</section></main>`;
  app.setAttribute('aria-busy', 'false'); wrapTables(app);
  keys.keys = [['r', 'run selected state'], ['u', 'underneath']];
}

async function load() {
  try {
    let selected = await selectRepository();
    if (!selected) { app.innerHTML = '<main><p class="dim">No depot declares a repository.json yet.</p></main>'; return; }
    endpoint = selected.url; render(await json(endpoint));
  } catch (error) { app.innerHTML = `<main><div class="err"><b>review</b> — ${esc(error.message)}</div></main>`; }
}

app.addEventListener('click', async (event) => {
  let button = event.target.closest('[data-action]'); if (!button || busy) return;
  busy = true; button.disabled = true;
  try {
    if (button.dataset.action === 'review') {
      let branches = current.branches.filter((branch) => branch.name !== 'main');
      let source = prompt('Source branch', branches.at(-1)?.name ?? ''); if (!source) return;
      let title = prompt('Review title'); if (!title) return;
      render(await json(`${endpoint}/pulls`, { method: 'POST', body: JSON.stringify({ source, target: 'main', title }) }));
    } else {
      render(await json(`${endpoint}/pulls/${button.dataset.number}/merge`, { method: 'POST', body: '{}' }));
    }
  } catch (error) { button.insertAdjacentHTML('afterend', ` <span class="bad">${esc(error.message)}</span>`); }
  finally { busy = false; }
});

addEventListener('keydown', (event) => {
  if (event.key === 'r' && current) location.href = (current.preview?.projection ?? current.main.projection).runUrl;
  if (event.key === 'u') document.querySelector('.underneath')?.scrollIntoView({ behavior: 'smooth' });
});
onLiveChange(() => load());
load();
