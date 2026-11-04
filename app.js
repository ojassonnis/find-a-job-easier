// =============================================================
// Find a Job Easier — page logic
// Sections:
//   1. Tabs
//   2. LinkedIn search (builds a LinkedIn URL from your inputs)
//   3. Saved searches (kept in this browser only)
//   4. Job board (reads data/jobs.json, made daily by the script)
//   5. Helpers
// =============================================================


// ---------- 1. TABS ----------
const tabs = document.querySelectorAll('.tab');

function showTab(tabId) {
  tabs.forEach(tab => {
    const isActive = tab.id === tabId;
    tab.setAttribute('aria-selected', isActive);
    document.getElementById(tab.getAttribute('aria-controls')).hidden = !isActive;
  });
  // Remember the tab in the URL so a refresh or bookmark lands on it.
  history.replaceState(null, '', '#' + tabId.replace('tab-', ''));
}

tabs.forEach(tab => tab.addEventListener('click', () => showTab(tab.id)));

// Open the tab named in the URL (#job-board), otherwise LinkedIn.
if (location.hash === '#job-board') showTab('tab-job-board');


// ---------- 2. LINKEDIN SEARCH ----------
// LinkedIn doesn't allow other sites to pull its listings, so instead we
// build a link to LinkedIn's own search page with your filters applied.
//   keywords = what to search for
//   location = the city
//   f_TPR    = how recent ("r86400" = posted in the last 86,400 seconds = 24h)
//   sortBy   = "DD" means "date descending", i.e. newest first
function buildLinkedInUrl(keywords, city, timeWindow) {
  const params = new URLSearchParams();
  params.set('keywords', keywords);
  if (city) params.set('location', city);
  if (timeWindow) params.set('f_TPR', timeWindow);
  params.set('sortBy', 'DD');
  return 'https://www.linkedin.com/jobs/search/?' + params.toString();
}

const form = document.getElementById('linkedin-form');
const keywordsInput = document.getElementById('li-keywords');
const cityInput = document.getElementById('li-city');
const windowInput = document.getElementById('li-window');

function currentSearch() {
  return {
    keywords: keywordsInput.value.trim(),
    city: cityInput.value.trim(),
    timeWindow: windowInput.value,
  };
}

form.addEventListener('submit', event => {
  event.preventDefault(); // stop the browser reloading the page
  const s = currentSearch();
  window.open(buildLinkedInUrl(s.keywords, s.city, s.timeWindow), '_blank', 'noopener');
});


// ---------- 3. SAVED SEARCHES ----------
// Stored in localStorage: this browser only, not synced anywhere.
const STORAGE_KEY = 'fje-saved-searches';
const savedList = document.getElementById('saved-searches');

function loadSaved() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function storeSaved(searches) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(searches));
  } catch {
    // Storage can be blocked (e.g. private browsing). The page still works.
  }
}

function renderSaved() {
  const searches = loadSaved();
  savedList.innerHTML = '';

  if (searches.length === 0) {
    savedList.innerHTML = '<li class="empty">Save a search to run it again in one click.</li>';
    return;
  }

  searches.forEach((s, index) => {
    const li = document.createElement('li');

    const link = document.createElement('a');
    link.href = buildLinkedInUrl(s.keywords, s.city, s.timeWindow);
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = s.city ? `${s.keywords} in ${s.city}` : s.keywords;

    const remove = document.createElement('button');
    remove.className = 'remove';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => {
      const updated = loadSaved();
      updated.splice(index, 1);
      storeSaved(updated);
      renderSaved();
    });

    li.append(link, remove);
    savedList.append(li);
  });
}

document.getElementById('li-save').addEventListener('click', () => {
  const s = currentSearch();
  if (!s.keywords) {
    keywordsInput.reportValidity(); // shows the browser's "please fill in" bubble
    return;
  }
  storeSaved([s, ...loadSaved()]);
  renderSaved();
});

renderSaved();


// ---------- 4. JOB BOARD ----------
const board = document.getElementById('board');
const updatedNote = document.getElementById('updated-note');

async function loadJobBoard() {
  try {
    // cache: 'no-store' makes sure we get today's file, not a stale copy.
    const response = await fetch('data/jobs.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    renderJobBoard(data);
  } catch (error) {
    updatedNote.textContent = 'Job board couldn’t load.';
    board.innerHTML = `<p class="company-error">data/jobs.json couldn’t be read (${error.message}).
      If you opened index.html straight from your computer, run a local server instead (see README).</p>`;
  }
}

function renderJobBoard(data) {
  updatedNote.textContent = `Job board updated ${timeAgo(data.updatedAt, true)}.`;
  board.innerHTML = '';

  if (!data.companies || data.companies.length === 0) {
    board.innerHTML = '<p class="empty">No companies yet. Add some to data/companies.json.</p>';
    return;
  }

  data.companies.forEach(company => {
    const section = document.createElement('section');
    section.className = 'company';

    const careersLink = company.careersUrl
      ? `<a href="${escapeHtml(company.careersUrl)}" target="_blank" rel="noopener">Careers page</a>`
      : '';

    section.innerHTML = `
      <div class="company-head">
        <h2>${escapeHtml(company.name)}</h2>
        ${careersLink}
      </div>`;

    if (company.status === 'link') {
      section.innerHTML += `<p class="company-error">This careers site can’t be checked automatically. Use the careers page link.</p>`;
    } else if (company.status === 'error') {
      section.innerHTML += `<p class="company-error">Couldn’t fetch listings: ${escapeHtml(company.error)}</p>`;
    } else if (company.jobs.length === 0) {
      section.innerHTML += `<p class="company-error">No matching roles open right now.</p>`;
    } else {
      const list = document.createElement('ul');
      list.className = 'job-list';
      company.jobs.forEach(job => list.append(renderJob(job)));
      section.append(list);
    }

    board.append(section);
  });
}

function renderJob(job) {
  const li = document.createElement('li');
  li.className = 'job';
  if (job.postedAt && hoursSince(job.postedAt) < 24) li.classList.add('is-fresh');

  const posted = job.postedAt ? new Date(job.postedAt).toLocaleDateString() : 'Date not listed';

  li.innerHTML = `
    <div class="age" title="Posted ${posted}">${job.postedAt ? timeAgo(job.postedAt) : '?'}</div>
    <div>
      <a class="job-title" href="${escapeHtml(job.url)}" target="_blank" rel="noopener">${escapeHtml(job.title)}</a>
      ${job.role ? `<p class="job-role">Priority ${job.priority}: ${escapeHtml(job.role)}</p>` : ''}
      <p class="job-meta">${escapeHtml(job.location || 'Location not listed')}, posted ${posted}</p>
    </div>`;
  return li;
}

loadJobBoard();


// ---------- 5. HELPERS ----------
function hoursSince(isoDate) {
  return (Date.now() - new Date(isoDate).getTime()) / 36e5; // 36e5 ms = 1 hour
}

// Short form for the age column ("5h", "3d"); long form for sentences.
function timeAgo(isoDate, long = false) {
  const hours = hoursSince(isoDate);
  if (hours < 1) return long ? 'less than an hour ago' : 'now';
  if (hours < 24) {
    const h = Math.floor(hours);
    return long ? `${h} hour${h === 1 ? '' : 's'} ago` : `${h}h`;
  }
  const d = Math.floor(hours / 24);
  return long ? `${d} day${d === 1 ? '' : 's'} ago` : `${d}d`;
}

// Stops job titles containing < or > from breaking the page.
function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}
