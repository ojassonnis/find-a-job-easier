// =============================================================
// Find a Job Easier — page logic
// Sections:
//   1. Tabs
//   2. LinkedIn search (builds a LinkedIn URL from your inputs)
//   3. Saved searches (kept in this browser only)
//   4. Job board (reads data/jobs.json, made daily by the script)
//   5. Filters and helpers
// =============================================================

const tabs = document.querySelectorAll('.tab');
let currentJobData = null;

// ---------- 1. TABS ----------
function showTab(tabId) {
  tabs.forEach(tab => {
    const isActive = tab.id === tabId;
    tab.setAttribute('aria-selected', isActive);
    document.getElementById(tab.getAttribute('aria-controls')).hidden = !isActive;
  });
  history.replaceState(null, '', '#' + tabId.replace('tab-', ''));
}

tabs.forEach(tab => tab.addEventListener('click', () => showTab(tab.id)));

if (location.hash === '#job-board') showTab('tab-job-board');

// ---------- 2. LINKEDIN SEARCH ----------
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
  event.preventDefault();
  const s = currentSearch();
  window.open(buildLinkedInUrl(s.keywords, s.city, s.timeWindow), '_blank', 'noopener');
});

// ---------- 3. SAVED SEARCHES ----------
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
    keywordsInput.reportValidity();
    return;
  }
  storeSaved([s, ...loadSaved()]);
  renderSaved();
});

renderSaved();

// ---------- 4. JOB BOARD / FILTERS ----------
const board = document.getElementById('board');
const updatedNote = document.getElementById('updated-note');
const filterDate = document.getElementById('filter-date');
const filterLocation = document.getElementById('filter-location');
const filterCompany = document.getElementById('filter-company');
const filterTitle = document.getElementById('filter-title');
const filterToggle = document.getElementById('filter-toggle');
const filtersPanel = document.getElementById('filters-panel');
const clearFiltersBtn = document.getElementById('clear-filters');

function populateCompanyOptions(data) {
  if (!filterCompany) return;

  const companies = [...new Set((data.companies || []).map(company => company.name).filter(Boolean))].sort((a, b) => a.localeCompare(b));

  filterCompany.innerHTML = '<option value="all">All companies</option>' + companies.map(company =>
    `<option value="${escapeHtml(company)}">${escapeHtml(company)}</option>`
  ).join('');
}

function getDateThreshold(dateValue) {
  const ranges = {
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
    '90d': 90 * 24 * 60 * 60 * 1000,
  };
  return ranges[dateValue] || null;
}

function matchesDateFilter(job, dateValue) {
  if (!dateValue || dateValue === 'all' || !job.postedAt) return true;

  const cutoff = getDateThreshold(dateValue);
  if (!cutoff) return true;

  const age = Date.now() - new Date(job.postedAt).getTime();
  return Number.isFinite(age) && age >= 0 && age <= cutoff;
}

function matchesTextFilter(value, haystack) {
  if (!value) return true;
  return String(haystack || '').toLowerCase().includes(value.toLowerCase());
}

function sortJobsByDate(jobs) {
  return [...jobs].sort((a, b) => {
    const dateA = a.postedAt ? new Date(a.postedAt).getTime() : 0;
    const dateB = b.postedAt ? new Date(b.postedAt).getTime() : 0;
    return dateB - dateA;
  });
}

function filterBoardData(data) {
  const selectedCompany = filterCompany && filterCompany.value ? filterCompany.value : 'all';
  const locationQuery = filterLocation ? filterLocation.value.trim() : '';
  const titleQuery = filterTitle ? filterTitle.value.trim() : '';
  const dateQuery = filterDate ? filterDate.value : 'all';

  return (data.companies || []).map(company => {
    const jobs = sortJobsByDate((company.jobs || []).filter(job => {
      if (selectedCompany !== 'all' && company.name !== selectedCompany) return false;
      if (locationQuery && !matchesTextFilter(locationQuery, job.location)) return false;
      if (titleQuery && !matchesTextFilter(titleQuery, job.title)) return false;
      if (!matchesDateFilter(job, dateQuery)) return false;
      return true;
    }));

    return { ...company, jobs };
  });
}

function getCompanyIcon(name) {
  const words = String(name || '').split(/\s+/).filter(Boolean);
  const initials = words.slice(0, 2).map(word => word[0]).join('').toUpperCase() || 'J';
  const palette = ['#2d6cdf', '#2d9c7c', '#8b5cf6', '#ef5da8', '#f59e0b', '#ef4444'];
  const index = initials.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0) % palette.length;

  return {
    initials,
    color: palette[index],
  };
}

function renderJob(job) {
  const li = document.createElement('li');
  li.className = 'job';
  if (job.postedAt && hoursSince(job.postedAt) < 24) li.classList.add('is-fresh');

  const posted = job.postedAt ? new Date(job.postedAt).toLocaleDateString() : 'Date not listed';
  const roleText = job.role ? `<span class="job-role">${escapeHtml(job.role)}</span>` : '';

  li.innerHTML = `
    <div class="job-age"><div class="age" title="Posted ${posted}">${job.postedAt ? timeAgo(job.postedAt) : '?'}</div></div>
    <div class="job-content">
      <div class="job-header">
        <a class="job-title" href="${escapeHtml(job.url)}" target="_blank" rel="noopener">${escapeHtml(job.title)}</a>
        ${roleText}
      </div>
      <p class="job-meta">${escapeHtml(job.location || 'Location not listed')} · posted ${posted}</p>
    </div>`;
  return li;
}

function renderJobBoard(data) {
  currentJobData = data;
  updatedNote.textContent = `Job board updated ${timeAgo(data.updatedAt, true)}.`;
  board.innerHTML = '';

  if (!data.companies || data.companies.length === 0) {
    board.innerHTML = '<p class="empty">No companies yet. Add some to data/companies.json.</p>';
    return;
  }

  const visibleCompanies = filterBoardData(data)
    .filter(company => company.jobs.length > 0 || company.status === 'link' || company.status === 'error' || (filterCompany && filterCompany.value !== 'all' && company.name === filterCompany.value))
    .sort((companyA, companyB) => {
      const newestA = companyA.jobs[0]?.postedAt ? new Date(companyA.jobs[0].postedAt).getTime() : 0;
      const newestB = companyB.jobs[0]?.postedAt ? new Date(companyB.jobs[0].postedAt).getTime() : 0;
      return newestB - newestA;
    });

  if (visibleCompanies.length === 0) {
    board.innerHTML = '<p class="empty">No roles match your filters. Try widening the date range or clearing a filter.</p>';
    return;
  }

  visibleCompanies.forEach(company => {
    const section = document.createElement('section');
    section.className = 'company';

    const companyIcon = getCompanyIcon(company.name);
    const careersLink = company.careersUrl
      ? `<a href="${escapeHtml(company.careersUrl)}" target="_blank" rel="noopener">Careers page</a>`
      : '';

    const header = document.createElement('div');
    header.className = 'company-head';
    header.innerHTML = `
      <div class="company-brand">
        <span class="company-icon" style="--company-color: ${companyIcon.color};">${companyIcon.initials}</span>
        <h2>${escapeHtml(company.name)}</h2>
      </div>
      ${careersLink}
    `;
    section.append(header);

    if (company.status === 'link') {
      section.insertAdjacentHTML('beforeend', '<p class="company-error">This careers site can’t be checked automatically. Use the careers page link.</p>');
    } else if (company.status === 'error') {
      section.insertAdjacentHTML('beforeend', `<p class="company-error">Couldn’t fetch listings: ${escapeHtml(company.error)}</p>`);
    } else if (company.jobs.length === 0) {
      section.insertAdjacentHTML('beforeend', '<p class="company-error">No matching roles open right now.</p>');
    } else {
      const list = document.createElement('ul');
      list.className = 'job-list';
      company.jobs.forEach(job => list.append(renderJob(job)));
      section.append(list);
    }

    board.append(section);
  });
}

async function loadJobBoard() {
  try {
    const response = await fetch('data/jobs.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    currentJobData = data;
    populateCompanyOptions(data);
    renderJobBoard(data);
  } catch (error) {
    updatedNote.textContent = 'Job board couldn’t load.';
    board.innerHTML = `<p class="company-error">data/jobs.json couldn’t be read (${error.message}).
      If you opened index.html straight from your computer, run a local server instead (see README).</p>`;
  }
}

if (filterToggle) {
  filterToggle.addEventListener('click', () => {
    const isCollapsed = filtersPanel.classList.toggle('is-collapsed');
    filterToggle.textContent = isCollapsed ? 'Show' : 'Hide';
    filterToggle.setAttribute('aria-expanded', String(!isCollapsed));
  });
}

['change', 'input'].forEach(eventName => {
  if (filterDate) filterDate.addEventListener(eventName, () => {
    if (currentJobData) renderJobBoard(currentJobData);
  });
  if (filterLocation) filterLocation.addEventListener(eventName, () => {
    if (currentJobData) renderJobBoard(currentJobData);
  });
  if (filterCompany) filterCompany.addEventListener(eventName, () => {
    if (currentJobData) renderJobBoard(currentJobData);
  });
  if (filterTitle) filterTitle.addEventListener(eventName, () => {
    if (currentJobData) renderJobBoard(currentJobData);
  });
});

if (clearFiltersBtn) {
  clearFiltersBtn.addEventListener('click', () => {
    if (filterDate) filterDate.value = 'all';
    if (filterLocation) filterLocation.value = '';
    if (filterCompany) filterCompany.value = 'all';
    if (filterTitle) filterTitle.value = '';
    if (currentJobData) renderJobBoard(currentJobData);
  });
}

loadJobBoard();

// ---------- 5. HELPERS ----------
function hoursSince(isoDate) {
  return (Date.now() - new Date(isoDate).getTime()) / 36e5;
}

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

function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[ch]);
}
