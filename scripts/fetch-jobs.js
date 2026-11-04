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
  // Companies whose careers site can't be read automatically (Oracle, SuccessFactors,
  // custom sites...). Nothing is fetched; the page just shows their careers link.
  async link() {
    return [];
  },

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

  // <tenant>.wd3.myworkdayjobs.com/<site>  (common for big banks)
  // Workday has no official public feed; this uses the same request its own
  // careers page makes. It works for most companies but can break if they change it.
  async workday(company) {
    const url = new URL(company.careersUrl);
    const pathParts = url.pathname.split('/').filter(Boolean);
    let tenant, site, jobBase;

    if (url.hostname.includes('myworkdaysite.com')) {
      // Style 2: wd1.myworkdaysite.com/recruiting/<tenant>/<site>
      const i = pathParts.indexOf('recruiting');
      tenant = pathParts[i + 1];
      site = pathParts[i + 2];
      jobBase = `https://${url.hostname}/recruiting/${tenant}/${site}`;
    } else {
      // Style 1: <tenant>.wd3.myworkdayjobs.com/<site>  (an "en-US" in the path is skipped)
      tenant = url.hostname.split('.')[0];
      site = pathParts[pathParts.length - 1];
      jobBase = `https://${url.hostname}/${site}`;
    }
    const endpoint = `https://${url.hostname}/wday/cxs/${tenant}/${site}/jobs`;
    const search = (body) => getJson(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: 20, offset: 0, searchText: '', appliedFacets: {}, ...body }),
    });

    // Big global companies have thousands of jobs, so Toronto ones get buried.
    // Ask Workday which location filters it offers, and use the one for our country.
    const appliedFacets = findCountryFacet((await search({ limit: 1 })).facets, company.country);

    const all = [];
    for (const term of company.searchTerms) {
      for (const offset of [0, 20]) { // two pages = up to 40 jobs per search
        const data = await search({ searchText: term, offset, appliedFacets });
        const postings = data.jobPostings || [];
        for (const job of postings) {
          all.push({
            title: job.title,
            location: job.locationsText,
            postedAt: parseWorkdayDate(job.postedOn),
            url: jobBase + job.externalPath,
          });
        }
        if (postings.length < 20) break; // no more pages
        await pause(200);
      }
    }
    return all;
  },

  // <host>.fa.<region>.oraclecloud.com  (JPMorgan, Goldman Sachs, Oracle)
  // Oracle Recruiting Cloud's public job search, the same one its careers pages use.
  async oracle(company) {
    const api = `https://${company.host}/hcmRestApi/resources/latest`;

    // The site code in a careers URL can be a nickname ("LateralHiring").
    // An unknown code silently returns some OTHER site's jobs, so look up the real one.
    let site = company.site;
    try {
      const sites = (await getJson(`${api}/recruitingCESites?onlyData=true&limit=200`)).items || [];
      if (!sites.some(s => s.SiteNumber === site)) {
        const match = sites.find(s => Object.values(s).some(v => typeof v === 'string' && v.toLowerCase() === site.toLowerCase()));
        if (match) site = match.SiteNumber;
      }
    } catch { /* keep the code as given */ }

    const q = (text) => encodeURIComponent(`"${text}"`);
    const read = async (term, withCountry) => {
      const finder = [`siteNumber=${site}`, `keyword=${q(term)}`];
      if (withCountry) finder.push(`location=${q(company.country)}`);
      finder.push('limit=50', 'sortBy=POSTING_DATES_DESC');
      const data = await getJson(`${api}/recruitingCEJobRequisitions?onlyData=true` +
        `&expand=requisitionList.secondaryLocations&finder=findReqs;${finder.join(',')}`);
      return data.items?.[0]?.requisitionList || [];
    };

    const all = [];
    for (const term of company.searchTerms) {
      let rows = await read(term, true);
      if (rows.length === 0) rows = await read(term, false); // in case the country filter isn't supported
      for (const job of rows) {
        const extra = (job.secondaryLocations || []).map(l => l.Name).filter(Boolean);
        all.push({
          title: job.Title,
          location: [job.PrimaryLocation, ...extra].filter(Boolean).join('; '),
          postedAt: job.PostedDate ? new Date(job.PostedDate).toISOString() : null,
          url: `https://${company.host}/hcmUI/CandidateExperience/en/sites/${site}/job/${job.Id}`,
        });
      }
      await pause(200);
    }
    return all;
  },

  // jobs.<company>.com search pages built on SAP SuccessFactors (Scotiabank, SAP).
  // There's no data feed, so this reads the search results page itself.
  // EXPERIMENTAL: if the company redesigns its page, this stops working.
  async successfactors(company) {
    const origin = new URL(company.careersUrl).origin;
    const all = [];
    let sawRows = false;
    for (const term of company.searchTerms) {
      const html = await getText(`${origin}/search/?q=${encodeURIComponent(term)}` +
        `&locationsearch=${encodeURIComponent(company.locationSearch || '')}` +
        '&sortColumn=referencedate&sortDirection=desc');
      for (const row of html.split(/<tr[^>]*class="[^"]*data-row/).slice(1)) {
        sawRows = true;
        const link = row.match(/<a[^>]*jobTitle-link[^>]*>[\s\S]*?<\/a>/);
        if (!link) continue;
        const href = link[0].match(/href="([^"]+)"/)?.[1];
        const title = cleanText(link[0].replace(/<[^>]+>/g, ''));
        const where = row.match(/class="jobLocation[^"]*"[^>]*>([\s\S]*?)<\/span>/)?.[1];
        const when = row.match(/class="jobDate[^"]*"[^>]*>([\s\S]*?)<\/span>/)?.[1];
        const date = when ? new Date(cleanText(when)) : null;
        all.push({
          title,
          location: where ? cleanText(where) : '',
          postedAt: date && !isNaN(date) ? date.toISOString() : null,
          url: href ? new URL(href, origin).href : company.careersUrl,
        });
      }
      await pause(300);
    }
    if (!sawRows) throw new Error('search page layout not recognised (no result rows found)');
    return all;
  },
};

// Walks Workday's list of filters and returns the one for our country (e.g. Canada),
// shaped the way Workday expects: { locationCountry: ["<id>"] }. Returns {} if none.
function findCountryFacet(facets, country) {
  if (!country) return {};
  const found = [];
  const walk = (node, param) => {
    const p = node.facetParameter || param;
    if (node.id && node.descriptor && node.descriptor.toLowerCase() === country.toLowerCase()) {
      found.push({ param: p, id: node.id });
    }
    (node.values || []).forEach(child => walk(child, p));
  };
  (facets || []).forEach(f => walk(f));
  if (found.length === 0) return {};
  const best = found.find(f => /country/i.test(f.param)) || found[0];
  return { [best.param]: [best.id] };
}

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


// ---------- FILTERING & PRIORITY ----------
// Roles in companies.json are listed in priority order (first = most wanted).
// Each role has a name and keywords. A job gets the priority of the FIRST role
// whose keyword appears in its title as whole words.
//   "senior ba" matches "Senior BA, Payments" but not "Senior Banker".

// Lowercase and turn dashes/commas/slashes into spaces, so
// "Product Manager – Technology" and "Product Manager, Technology" both
// become "product manager technology".
function normalize(text) {
  return ` ${String(text || '').toLowerCase().replace(/[–—\-,/|()]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
}

function titleHas(title, keyword) {
  return normalize(title).includes(normalize(keyword)); // the spaces around each make it whole-word
}

// Returns { priority, role } for the best-matching role, or null if none match.
function matchRole(job, roles) {
  for (let i = 0; i < roles.length; i++) {
    if (roles[i].keywords.some(k => titleHas(job.title, k))) {
      return { priority: i + 1, role: roles[i].name };
    }
  }
  return null;
}

// Also accepts a plain list of keywords, e.g. ["product manager", "analyst"].
function toRoleList(roles) {
  return roles.map(r => (typeof r === 'string' ? { name: r, keywords: [r] } : r));
}

// If you list locations, a job must mention one of them. Empty list = keep everything.
// Every word must appear: "Remote Canada" matches "Remote (Canada)" but not "US-Remote".
function matchesLocation(job, locations) {
  if (!locations || locations.length === 0) return true;
  const where = (job.location || '').toLowerCase();
  if (/\d+ locations/.test(where)) return true; // Workday hides multi-location details
  return locations.some(loc => loc.toLowerCase().split(/\s+/).every(word => where.includes(word)));
}

// Highest priority first; within the same priority, newest first.
function byPriorityThenNewest(a, b) {
  if (a.priority !== b.priority) return a.priority - b.priority;
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
    const roles = toRoleList(company.roles || config.roles || []);
    const searchTerms = config.workdaySearchTerms || roles.flatMap(r => r.keywords);
    const locations = company.locations ?? config.locations ?? [];
    const base = { name: company.name, careersUrl: company.careersUrl };

    try {
      const fetcher = fetchers[company.platform];
      if (!fetcher) throw new Error(`unknown platform "${company.platform}"`);

      const jobs = removeDuplicates(await fetcher({
        country: config.country, locationSearch: config.locationSearch, ...company, searchTerms }))
        .map(job => ({ ...job, ...matchRole(job, roles) }))
        .filter(job => job.priority) // drop jobs that matched no role
        .filter(job => matchesLocation(job, locations))
        .sort(byPriorityThenNewest)
        .slice(0, MAX_PER_COMPANY);

      results.push({ ...base, status: company.platform === 'link' ? 'link' : 'ok', jobs });
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

function pause(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function cleanText(html) {
  return html.replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

async function getText(url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'find-a-job-easier (personal job tracker)' } });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}`);
  return response.text();
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
