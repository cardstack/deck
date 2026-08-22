// /review — a working queue over durable branch Reviews.
import 'ui/nav';
import { installNavStyles, onLiveChange, wrapTables } from 'ui/nav';

installNavStyles();
const app = document.getElementById('app');
const keys = document.querySelector('deck-keys');
let current;
let endpoint;
let reviewSource;
let queueMode = 'open';
let busy = false;

const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"]/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char],
  );

async function json(url, options) {
  let response = await fetch(url, {
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    ...options,
  });
  let body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? response.statusText);
  return body;
}

async function selectRepository() {
  let catalog = await json('/_hub/repositories');
  let params = new URLSearchParams(location.search);
  let wanted = params.get('repository');
  let depot = params.get('depot');
  let selected =
    catalog.repositories.find(
      (item) =>
        item.repository === wanted && (!depot || item.depot === depot),
    ) ??
    catalog.repositories.find((item) => item.initialized) ??
    catalog.repositories[0];
  let sourceName = params.get('source');
  let source =
    sourceName &&
    catalog.repositories.find(
      (item) =>
        item.repository === sourceName && item.depot === selected?.depot,
    );
  let review = Number(params.get('review'));
  queueMode = params.get('view') === 'all' ? 'all' : 'open';
  return {
    selected,
    source,
    review: Number.isSafeInteger(review) && review > 0 ? review : undefined,
  };
}

function updateQuery(values, replace = false) {
  let params = new URLSearchParams(location.search);
  for (let [name, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === '') {
      params.delete(name);
    } else {
      params.set(name, String(value));
    }
  }
  history[replace ? 'replaceState' : 'pushState'](
    {},
    '',
    `?${decodeURIComponent(params.toString())}`,
  );
}

function disposition(review) {
  if (review.state === 'merged') return { key: 'merged', label: 'merged' };
  if (review.state === 'closed') return { key: 'closed', label: 'closed' };
  let verdict = [...review.events]
    .reverse()
    .find((event) => event.type === 'reviewed')?.verdict;
  if (verdict === 'approved') return { key: 'approved', label: 'approved' };
  if (verdict === 'changes-requested') {
    return { key: 'changes', label: 'changes requested' };
  }
  return { key: 'waiting', label: 'waiting' };
}

function updatedAt(review) {
  return review.events.at(-1)?.createdAt ?? review.createdAt;
}

function when(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function visibleReviews(state) {
  return queueMode === 'all'
    ? state.reviews
    : state.reviews.filter((review) => review.state === 'open');
}

function queue(state, canOpen) {
  let visible = visibleReviews(state);
  let open = state.reviews.filter((review) => review.state === 'open');
  let approved = open.filter(
    (review) => disposition(review).key === 'approved',
  ).length;
  let changes = open.filter(
    (review) => disposition(review).key === 'changes',
  ).length;
  let filters =
    `<button data-queue-mode="open"${queueMode === 'open' ? ' aria-pressed="true"' : ''}>` +
    `open <b>${open.length}</b></button>` +
    `<button data-queue-mode="all"${queueMode === 'all' ? ' aria-pressed="true"' : ''}>` +
    `all <b>${state.reviews.length}</b></button>`;
  let rows = visible
    .map((review) => {
      let status = disposition(review);
      let selected = review.number === state.review?.number;
      return (
        `<button class="review-queue-row" data-review-number="${review.number}"` +
        `${selected ? ' aria-current="true"' : ''}>` +
        `<span class="queue-status queue-status-${status.key}">${esc(status.label)}</span>` +
        `<span class="queue-title"><b>#${review.number} ${esc(review.title)}</b>` +
        `<small>${esc(review.source.branch)} → ${esc(review.target.branch)}</small></span>` +
        `<span class="queue-author">${esc(review.author.name ?? review.author.id)}</span>` +
        `<time datetime="${esc(updatedAt(review))}">${esc(when(updatedAt(review)))}</time>` +
        `<span class="queue-open">→</span></button>`
      );
    })
    .join('');
  return (
    `<section class="repo-section review-inbox"><header><div>` +
    `<span class="section-index">01</span><h1>Reviews</h1>` +
    `<span class="queue-summary">${approved} approved · ${changes} need changes</span>` +
    `</div><div class="queue-actions"><div class="queue-filters">${filters}</div>` +
    (canOpen
      ? `<button class="action" data-action="review">Open review</button>`
      : '') +
    `</div></header><div class="review-queue">` +
    (rows || `<p class="empty-pull">No ${queueMode} Reviews.</p>`) +
    `</div></section>`
  );
}

function changes(state) {
  if (!state.changes.length) {
    return `<p class="dim">No package changes in this Review.</p>`;
  }
  return (
    `<div class="review-changes">${state.changes
      .map(
        (change) =>
          `<a href="${esc(change.browseUrl)}"><span class="s-package">${esc(change.name)}</span>` +
          `<span>Version diff →</span></a>`,
      )
      .join('')}</div>`
  );
}

function reviewEvents(review) {
  let opened =
    `<li><b>opened</b><span>${esc(review.author.name ?? review.author.id)}</span>` +
    `<time>${esc(when(review.createdAt))}</time></li>`;
  let events = review.events
    .map((event) => {
      let label =
        event.type === 'reviewed' && event.verdict
          ? event.verdict.replace('-', ' ')
          : event.type.replace('-', ' ');
      return (
        `<li><b>${esc(label)}</b>` +
        `<span>${esc(event.actor.name ?? event.actor.id)}` +
        (event.checkpointHash
          ? ` · <code>${esc(event.checkpointHash.slice(0, 8))}</code>`
          : '') +
        `</span><time>${esc(when(event.createdAt))}</time></li>`
      );
    })
    .join('');
  return `<ol class="review-events">${opened}${events}</ol>`;
}

function historyView(state) {
  return (
    `<ol class="review-history">${state.history
      .map(
        (item) =>
          `<li><code>${esc(item.checkpointHash.slice(0, 12))}</code><div>` +
          `<strong>${esc(item.message)}</strong><br><span class="dim">` +
          `${esc(item.author.name)} · ${esc(when(item.createdAt))}` +
          `${item.parents.length === 2 ? ' · merge' : ''}</span></div></li>`,
      )
      .join('')}</ol>`
  );
}

function protocol(state) {
  return state.protocol
    .map(
      (object) =>
        `<details class="protocol-object"><summary><span>${esc(object.label)}</span>` +
        `<code>${esc(object.path)}</code></summary>` +
        `<pre>${esc(JSON.stringify(object.value, null, 2))}</pre></details>`,
    )
    .join('');
}

function detail(state, runnable, rootAddress) {
  let review = state.review;
  if (!review) {
    return (
      `<section class="repo-section review-detail"><header><div>` +
      `<span class="section-index">02</span><h1>Selected</h1></div></header>` +
      `<p class="empty-pull">Select a Review from the queue.</p></section>`
    );
  }
  let status = disposition(review);
  let merge = '';
  if (review.state === 'open' && status.key === 'approved') {
    merge = `<button class="action primary" data-action="merge" data-number="${review.number}">Merge</button>`;
  } else if (review.state === 'open' && status.key === 'changes') {
    merge = `<button class="action" disabled>Merge blocked</button>`;
  } else if (review.state === 'open') {
    merge = `<button class="action" disabled>Awaiting review</button>`;
  }
  return (
    `<section class="repo-section review-detail"><header><div>` +
    `<span class="section-index">02</span><h1>Selected</h1>` +
    `<span class="dim">#${review.number}</span></div>${merge}</header>` +
    `<article class="pull-summary"><div class="pull-heading">` +
    `<span class="status queue-status-${status.key}">${esc(status.label)}</span>` +
    `<div><strong>${esc(review.title)}</strong>` +
    `<p>${esc(review.body)}</p></div></div>` +
    `<div class="review-meta"><span>${esc(review.author.name ?? review.author.id)}</span>` +
    `<code>${esc(review.source.repository)}:${esc(review.source.branch)}</code>` +
    `<span>→</span><code>${esc(review.target.repository)}:${esc(review.target.branch)}</code></div>` +
    `<div class="review-detail-grid"><div><h2>Packages</h2>${changes(state)}` +
    `<div class="handoffs"><a class="action" href="${esc(runnable.runUrl)}">Run exact Repository →</a>` +
    `<a href="${esc(rootAddress)}/index.html">raw root Version</a></div></div>` +
    `<aside><h2>Activity</h2>${reviewEvents(review)}</aside></div></article></section>`
  );
}

function render(state) {
  current = state;
  if (!state.initialized) {
    app.innerHTML =
      `<main class="repository review-page"><section class="repo-section">` +
      `<header><div><span class="section-index">01</span><h1>Reviews</h1></div></header>` +
      `<p class="empty-pull">${esc(state.repository)} is mutable, but its main branch has not been initialized yet. Create a branch from Browse to begin.</p>` +
      `</section></main>`;
    app.setAttribute('aria-busy', 'false');
    return;
  }
  let runnable = state.preview?.projection ?? state.main.projection;
  let rootAddress = runnable.members[state.roots[0]];
  let featureBranches = state.branches.filter(
    (branch) => branch.name !== 'main',
  );
  let forkReady =
    reviewSource?.initialized && reviewSource.forkedFrom?.checkpointHash;
  let canOpen = forkReady || featureBranches.length;
  app.innerHTML =
    `<main class="repository review-page">` +
    `<div class="review-context"><a href="/browse?at=${esc(rootAddress)}">` +
    `<span class="s-publisher">${esc(state.owner)}</span><span class="sep">/</span>` +
    `<strong class="s-package">${esc(state.name)}</strong></a>` +
    `<span class="dim"> / review queue</span></div>` +
    queue(state, canOpen) +
    detail(state, runnable, rootAddress) +
    `<section class="repo-section"><header><div><span class="section-index">03</span>` +
    `<h1>Work</h1></div></header>${historyView(state)}</section>` +
    `<section class="repo-section underneath"><header><div>` +
    `<span class="section-index">04</span><h1>Underneath</h1></div></header>` +
    `<p class="section-note">Canonical refs and immutable objects. This is the state the CLI, agents, and Hub share.</p>` +
    `${protocol(state)}</section></main>`;
  app.setAttribute('aria-busy', 'false');
  wrapTables(app);
  keys.keys = [
    ['j', 'next review'],
    ['k', 'previous review'],
    ['r', 'run selected'],
    ['m', 'merge selected'],
    ['u', 'underneath'],
  ];
}

async function chooseReview(number, replace = false) {
  app.setAttribute('aria-busy', 'true');
  let state = await json(`${endpoint}/reviews/${number}`);
  updateQuery({ review: number }, replace);
  render(state);
}

async function load() {
  try {
    let { selected, source, review } = await selectRepository();
    if (!selected) {
      app.innerHTML =
        '<main><p class="dim">No depot declares a repository.json yet.</p></main>';
      return;
    }
    endpoint = selected.url;
    reviewSource = source ? await json(source.url) : undefined;
    let state = await json(review ? `${endpoint}/reviews/${review}` : endpoint);
    if (!review && state.review) {
      updateQuery({ review: state.review.number }, true);
    }
    render(state);
  } catch (error) {
    app.innerHTML =
      `<main><div class="err"><b>review</b> — ${esc(error.message)}</div></main>`;
  }
}

app.addEventListener('click', async (event) => {
  let filter = event.target.closest('[data-queue-mode]');
  if (filter) {
    queueMode = filter.dataset.queueMode;
    updateQuery({ view: queueMode === 'all' ? 'all' : undefined });
    render(current);
    return;
  }
  let row = event.target.closest('[data-review-number]');
  if (row && !busy) {
    await chooseReview(Number(row.dataset.reviewNumber));
    return;
  }
  let button = event.target.closest('[data-action]');
  if (!button || busy) return;
  busy = true;
  button.disabled = true;
  try {
    if (button.dataset.action === 'review') {
      let branches = current.branches.filter(
        (branch) => branch.name !== 'main',
      );
      let source = reviewSource
        ? 'main'
        : prompt('Source branch', branches.at(-1)?.name ?? '');
      if (!source) return;
      let title = prompt('Review title');
      if (!title) return;
      let state = await json(`${endpoint}/reviews`, {
        method: 'POST',
        body: JSON.stringify({
          source,
          target: 'main',
          title,
          ...(reviewSource
            ? { sourceRepository: reviewSource.repository }
            : {}),
        }),
      });
      updateQuery({ review: state.review?.number }, true);
      render(state);
    } else {
      let state = await json(
        `${endpoint}/reviews/${button.dataset.number}/merge`,
        { method: 'POST', body: '{}' },
      );
      updateQuery({ review: state.review?.number }, true);
      render(state);
    }
  } catch (error) {
    button.insertAdjacentHTML(
      'afterend',
      ` <span class="bad">${esc(error.message)}</span>`,
    );
  } finally {
    busy = false;
  }
});

addEventListener('keydown', async (event) => {
  if (event.target.matches('input, textarea, select')) return;
  if ((event.key === 'j' || event.key === 'k') && current) {
    let rows = visibleReviews(current);
    let index = rows.findIndex(
      (review) => review.number === current.review?.number,
    );
    let delta = event.key === 'j' ? 1 : -1;
    let next = rows[Math.max(0, Math.min(rows.length - 1, index + delta))];
    if (next && next.number !== current.review?.number) {
      await chooseReview(next.number);
    }
  }
  if (event.key === 'r' && current) {
    location.href = (current.preview?.projection ?? current.main.projection)
      .runUrl;
  }
  if (event.key === 'm') {
    document.querySelector('[data-action="merge"]')?.click();
  }
  if (event.key === 'u') {
    document
      .querySelector('.underneath')
      ?.scrollIntoView({ behavior: 'smooth' });
  }
});

addEventListener('popstate', () => load());
onLiveChange(() => load());
load();
