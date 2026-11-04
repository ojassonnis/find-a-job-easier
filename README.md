# Find a Job Easier

A two-tab job search page:

- **LinkedIn**: type keywords and a city, and it opens LinkedIn's search already filtered and sorted newest first. You can save searches you run often.
- **Job Board**: up to 5 matching jobs per target company, pulled from each company's careers site every 24 hours, newest first, with direct links.

## What's in here

| File | What it does | Edit it when… |
|---|---|---|
| `index.html` | Page structure (tabs, form, labels) | you want to change wording or add a field |
| `styles.css` | The look. Colors and fonts are at the top | you want to restyle |
| `app.js` | Page behaviour: tabs, LinkedIn link, saved searches, job list | you want to change how things work |
| `data/companies.json` | **Your companies and roles** | you add/remove a company or role |
| `data/jobs.json` | The listings. Written by the script, don't edit by hand | never |
| `scripts/fetch-jobs.js` | Fetches listings and writes `jobs.json` | you add a new job platform or change the 5-per-company limit |
| `.github/workflows/update-jobs.yml` | Runs the script daily on GitHub | you want a different time |

## Updating your companies and roles

Edit `data/companies.json`. Each company looks like this:

```json
{
  "name": "Shown on the page",
  "platform": "greenhouse",
  "boardId": "the-id-from-the-careers-url",
  "careersUrl": "https://boards.greenhouse.io/the-id",
  "roles": ["product manager", "analyst"],
  "locations": ["Toronto"]
}
```

- `roles`: a job is kept if its title **contains** any of these (not case-sensitive). "analyst" matches "Senior Financial Analyst".
- `locations` (optional): only keep jobs mentioning one of these. Leave it out to use the `locations` list at the top of the file. Use `[]` for anywhere.

### Finding the platform and boardId

Open the company's careers page, click into any job, and look at the address bar:

| URL looks like | platform | boardId |
|---|---|---|
| `boards.greenhouse.io/acme` or `job-boards.greenhouse.io/acme` | `greenhouse` | `acme` |
| `jobs.lever.co/acme` | `lever` | `acme` |
| `jobs.ashbyhq.com/acme` | `ashby` | `acme` |
| `jobs.smartrecruiters.com/Acme` | `smartrecruiters` | `Acme` |
| `acme.wd3.myworkdayjobs.com/en-US/AcmeCareers` | `workday` | none. Put that URL (up to the site name) in `careersUrl` |

If a company uses something else (Taleo, iCIMS, its own custom site), the script can't read it yet. It will show an error for that company and keep going.

## Putting it online (one-time setup, ~15 minutes)

1. Create a free account at github.com and make a new **public** repository called `find-a-job-easier`.
2. Upload all these files, keeping the folders (on the repo page: **Add file → Upload files**, drag the whole folder in). Make sure the `.github` folder came through; Windows can hide folders starting with a dot.
3. **Settings → Actions → General → Workflow permissions**: choose **Read and write permissions**, save.
4. **Settings → Pages**: Source = **Deploy from a branch**, branch = `main`, folder = `/ (root)`, save. After a minute your page is live at `https://<your-username>.github.io/find-a-job-easier/`.
5. **Actions tab → Update jobs → Run workflow** to fill the job board for the first time. After that it runs every day by itself, and also whenever you edit `companies.json`.

To check a run: **Actions tab**, click the latest run, then **Fetch jobs**. You'll see a ✓ or ✗ line per company.

## Trying it on your own computer (optional)

Needs Node.js (nodejs.org, LTS version). In a terminal in this folder:

```
node scripts/fetch-jobs.js
npx serve .
```

Then open the address it prints. Opening `index.html` by double-clicking won't load the job board, because browsers block reading local files.

## Good to know

- **Posting dates:** Lever, Ashby and SmartRecruiters give the real posted date. Greenhouse gives the first-published date where available, otherwise last-updated. Workday only says "3 days ago", so dates are approximate.
- **Workday** (used by many banks) has no official public feed. The script uses the same request the careers page makes, which works for most companies but may break if they change it.
- **LinkedIn** doesn't allow other sites to pull its listings, which is why that tab opens LinkedIn directly instead.
- `data/jobs.json` currently holds sample data so you can preview the page. The first real run replaces it.
