// =============================================================
// fetch-jobs.js — runs once a day (via GitHub Actions) or by hand:
//     node scripts/fetch-jobs.js
//
// 1. Reads data/companies.json (your companies + roles)
// 2. Asks each company's job platform for its open jobs
// 3. Keeps jobs whose title matches one of your roles (and location, if set)
// 4. Sorts newest first, keeps at most MAX_PER_COMPANY
// 5. Writes data/jobs.json, which the web page displays
//
// No packages to install: needs Node 18 or newer (built-in fetch).
// =============================================================

const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, '..', 'data', 'companies.json');
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'jobs.json');
const MAX_PER_COMPANY = 5;


// ---------- PLATFORM FETCHERS ----------
// Each one returns a list of jobs in the same shape:
//   { title, location, postedAt (ISO date or null), url }
// so the rest of the script doesn't care which platform a company uses.

const fetchers = {
  // boards.greenhouse.io/<boardId>  or  job-boards.greenhouse.io/<boardId>
  async greenhouse(company) {
    const data = await getJson(`https://boards-api.greenhouse.io/v1/boards/${company.boardId}/jobs`);
    return data.jobs.map(job => ({
      title: job.title,
      location: job.location?.name,
      postedAt: job.first_published || job.updated_at || null,
      url: job.absolute_url,
    }));
  },

  // jobs.lever.co/<boardId>
  async lever(company) {
    const data = await getJson(`https://api.lever.co/v0/postings/${company.boardId}?mode=json`);
    return data.map(job => ({
      title: job.text,
      location: job.categories?.location,
      postedAt: job.createdAt ? new Date(job.createdAt).toISOString() : null,
      url: job.hostedUrl,
    }));
  },

  // jobs.ashbyhq.com/<boardId>
  async ashby(company) {
    const data = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${company.boardId}`);
    return data.jobs.map(job => ({
      title: job.title,
      location: job.location,
      postedAt: job.publishedAt || null,
      url: job.jobUrl,
    }));
  },

  // jobs.smartrecruiters.com/<boardId>
  async smartrecruiters(company) {
    const data = await getJson(`https://api.smartrecruiters.com/v1/companies/${company.boardId}/postings?limit=100`);
    return data.content.map(job => ({
      title: job.name,
      location: [job.location?.city, job.location?.country].filter(Boolean).join(', '),
      postedAt: job.releasedDate || null,
      url: `https://jobs.smartrecruiters.com/${company.boardId}/${job.id}`,
    }));
  },

  // <tenant>.wd3.myworkdayjobs.com/<site>  (common for big banks)
  // Workday has no official public feed; this uses the same request its own
  // careers page makes. It works for most companies but can break if they change it.
  async workday(company) {
    const url = new URL(company.careersUrl);
    const tenant = url.hostname.split('.')[0];
    const pathParts = url.pathname.split('/').filter(Boolean);
    const site = pathParts[pathParts.length - 1]; // skip "en-US" if present
    const endpoint = `https://${url.hostname}/wday/cxs/${tenant}/${site}/jobs`;

    // Workday lets us search by text, so run one search per role.
    const all = [];
    for (const role of company.roles) {
      const data = await getJson(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: role }),
      });
      for (const job of data.jobPostings || []) {
        all.push({
          title: job.title,
          location: job.locationsText,
          postedAt: parseWorkdayDate(job.postedOn),
          url: `https://${url.hostname}/${site}${job.externalPath}`,
        });
      }
    }
    return all;
  },
};

// Workday says "Posted Today", "Posted Yesterday", "Posted 3 Days Ago", "Posted 30+ Days Ago".
// We turn that into an approximate date.
function parseWorkdayDate(text = '') {
  const t = text.toLowerCase();
  let daysAgo = null;
  if (t.includes('today')) daysAgo = 0;
  else if (t.includes('yesterday')) daysAgo = 1;
  else {
    const match = t.match(/(\d+)\+?\s*days?/);
    if (match) daysAgo = Number(match[1]);
  }
  if (daysAgo === null) return null;
  return new Date(Date.now() - daysAgo * 864e5).toISOString(); // 864e5 ms = 1 day
}


// ---------- FILTERING ----------
// A job matches if its title contains any of your role keywords (case-insensitive).
function matchesRole(job, roles) {
  const title = (job.title || '').toLowerCase();
  return roles.some(role => title.includes(role.toLowerCase()));
}

// If you list locations, a job must mention one of them. Empty list = keep everything.
function matchesLocation(job, locations) {
  if (!locations || locations.length === 0) return true;
  const where = (job.location || '').toLowerCase();
  return locations.some(loc => where.includes(loc.toLowerCase()));
}

function newestFirst(a, b) {
  // Jobs without a date go to the bottom.
  return (b.postedAt ? Date.parse(b.postedAt) : 0) - (a.postedAt ? Date.parse(a.postedAt) : 0);
}

function removeDuplicates(jobs) {
  const seen = new Set();
  return jobs.filter(job => (seen.has(job.url) ? false : seen.add(job.url)));
}


// ---------- MAIN ----------
async function main() {
  const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  const results = [];

  for (const company of config.companies) {
    const roles = company.roles || [];
    const locations = company.locations ?? config.locations ?? [];
    const base = { name: company.name, careersUrl: company.careersUrl, roles };

    try {
      const fetcher = fetchers[company.platform];
      if (!fetcher) throw new Error(`unknown platform "${company.platform}"`);

      const jobs = removeDuplicates(await fetcher(company))
        .filter(job => matchesRole(job, roles))
        .filter(job => matchesLocation(job, locations))
        .sort(newestFirst)
        .slice(0, MAX_PER_COMPANY);

      results.push({ ...base, status: 'ok', jobs });
      console.log(`✓ ${company.name}: ${jobs.length} matching job(s)`);
    } catch (error) {
      // One broken company shouldn't stop the others.
      results.push({ ...base, status: 'error', error: error.message, jobs: [] });
      console.log(`✗ ${company.name}: ${error.message}`);
    }
  }

  const output = { updatedAt: new Date().toISOString(), companies: results };
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`\nSaved ${OUTPUT_FILE}`);
}

async function getJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'User-Agent': 'find-a-job-easier (personal job tracker)', ...options.headers },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}`);
  return response.json();
}

main();
