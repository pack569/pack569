# Hosting pack569.com on Cloudflare Pages

> **Owner steps.** Everything below is a dashboard, DNS or GitHub-settings action for the
> pack's site owner. The repo side is `scripts/build-site.mjs`, `_headers`, `wrangler.toml`
> and `.github/workflows/website.yml`.

Until the nameservers change (step 4 of the cutover), pack569.com keeps serving from GitHub
Pages. Creating the Cloudflare account, the Pages project or the zone changes nothing live.

## What changes, and what doesn't

- **What is served.** GitHub Pages serves every file in the repo: SETUP.md, the design docs,
  `test/`. The Cloudflare site serves exactly two files, `index.html` and `_headers`, written
  by `scripts/build-site.mjs`. The repo is still public, so anything committed is still public
  on GitHub; it just isn't on the website.
- **When it changes.** Pushing or merging never deploys. The site changes only when someone
  runs the **website** workflow by hand, and production only from `main`, after you approve.
- **Firebase is unchanged.** Same project, same sign-in, same pack record, same rules.

## Why Direct Upload, not the Git integration

A Git-connected Pages project serves the repo as it is and deploys on every push. Direct
Upload sends only the built `_site/` folder, and only when the workflow runs. Do not connect
the project to GitHub later "to save a step"; it would undo both.

## 1. Cloudflare account and the Pages project

- [ ] Sign up for a free Cloudflare account.
- [ ] Create the project **`pack569`** as Direct Upload. Either:
  - Workers & Pages → Create → Pages → **Upload assets** (not "Connect to Git"), name it
    `pack569`, and upload any placeholder folder; or
  - once, from any computer: `npx wrangler pages project create pack569 --production-branch=main`
- [ ] The production branch must be **`main`**. Pages decides production by branch name: the
      workflow deploys production with `--branch=main` and previews with `--branch=preview-<commit>`.
      If the project's production branch were anything else, every "production" deploy would
      quietly land on a preview link instead.

The name `pack569` must match `wrangler.toml` and `--project-name` in the workflow.

## 2. An API token that can only deploy Pages

- [ ] My Profile → API Tokens → Create Token → **Custom token**.
- [ ] Permissions: **Account → Cloudflare Pages → Edit**. Nothing else. Account resources:
      this account only.
- [ ] Give it an expiry date and note when to rotate it. Never use the Global API Key.

"Pages · Edit" is the narrowest permission Cloudflare offers. It covers every Pages project
in the account, which today is just this one.

## 3. GitHub secrets

Repo → Settings → Secrets and variables → Actions → New repository secret:

- [ ] `CLOUDFLARE_API_TOKEN`: the token from step 2.
- [ ] `CLOUDFLARE_ACCOUNT_ID`: shown in the Cloudflare dashboard (Workers & Pages, right side).

## 4. GitHub environments

Repo → Settings → Environments → New environment:

- [ ] **`website-production`**
  - Required reviewers: **Keith**.
  - Deployment branches and tags: **Selected branches → `main`** only.
- [ ] **`website-preview`**: no rules.

Create `website-production` **before** the first production run. GitHub creates an
environment a job names if it doesn't exist, with no protection at all. The workflow's
preflight checks for the required reviewer and refuses production without one, and it also
refuses production from any branch but `main`.

Approve within 7 days: the built site waits between jobs as an artifact kept for a week.
If an approval comes later, run the workflow again. Nothing deploys meanwhile.

## 5. Running a deploy

Actions → **website** → **Run workflow**:

- **Use workflow from**: the branch to deploy. Any branch can be previewed without merging;
  that branch's own copy of the site and the workflow is what runs.
- **deploy_target**: `preview` (the default) or `production`.

The run goes: gates (the harness and both builds) → preflight (checks the built files
again; for production, the branch and the reviewer) → deploy. Production then waits for your
approval. The link is in the run's summary.

A **preview** is device-only. Its `FIREBASE_CONFIG` and `PACK_DOC_ID` are null and its
Content-Security-Policy allows no Google address, so it cannot read or write the live pack,
and nobody can sign in on it. It is marked `noindex`. Cloudflare shortens long branch names,
so the alias link is shorter than the full commit id; use the link the summary prints.

## Testing a preview with real data

The preview starts empty. To try it with the real pack:

1. On live **pack569.com**, Pack tab → **Backup (JSON)**. Save the file **outside the repo**
   folder (the repo is public; `.gitignore` ignores `*.json`, but don't rely on it).
2. On the preview, Pack tab → **Import backup** and choose that file.

The data stays in that one browser's storage for the preview's address. It never goes to
Cloudflare, Firestore, GitHub or CI, and the live pack is never written. This covers every
leader screen and "Preview as parent". It can't test sign-in, roles or sync between devices.

When you're done: delete the backup file, and clear the preview's site data (browser
settings → site data for that `pages.dev` address).

### Optional: lock previews to you

Cloudflare Access (free up to 50 people) can put a sign-in in front of preview links. In the
Pages project → Settings → General, turn on the access policy for preview deployments, and
allow only your own account. Production is not affected.

## What the Content-Security-Policy blocks

`_headers` is a template; the build fills in the hash of the page's one script and the
allowed addresses for each target. The page may run only its own script (plus, in production,
the Firebase SDK and Google sign-in), and talk only to Firestore, Firebase Auth and the
open-meteo weather service. Preview: weather only.

- **Calendar from a link.** "Paste calendar link or text…" with an `https://` or `webcal://`
  link is blocked, on purpose: allowing it would mean allowing the page to fetch from anywhere. The
  dialog falls back to "open the link in your browser, copy, and paste the calendar text
  instead", which is also what happens today for calendars (BAND included) that refuse
  cross-site reads. To allow one calendar host, add its origin to `CONNECT` in the production
  branch of `cspSources()` in `scripts/build-site.mjs`, never `https:` as a whole.
- **Inline `onclick="…"`.** Blocked, and the build refuses a page that has one. Wire buttons
  with `data-act` and a listener, as the rest of the app does.
- To change the policy, edit `_headers` or `cspSources()` and run
  `node scripts/build-site.mjs --target preview` (and `production`) before committing. After
  a deploy, check the browser Console for "Content-Security-Policy" errors.

## Cutover, in order

1. Merge PR #1, PR #2, then PR #3b. This also redeploys GitHub Pages with the new page, which
   is the "deploy this version first" step SETUP.md asks for before the rules.
2. Actions → website → Run workflow from `main`: first `preview` as a smoke test, then
   `production`, which you approve. Check it at `pack569.pages.dev`.
3. Firebase console → Authentication → Settings → Authorized domains: add
   **`pack569.pages.dev`**, then test Google sign-in there. (If the Google API key has a
   website restriction in Google Cloud, add `pack569.pages.dev` there too.)
4. DNS:
   - Cloudflare → Add a site → `pack569.com`, Free plan. Cloudflare imports the current records.
   - **Check that the imported records include the email ones (MX and TXT, such as SPF).**
     Moving nameservers moves all DNS, and a missing MX record stops the domain's email.
     Add anything missing before the next step.
   - At GoDaddy, change the nameservers to the two Cloudflare gives you. The domain stays
     registered at GoDaddy. Wait for Cloudflare to show the zone as Active.
   - Pages project → Custom domains: add `pack569.com` and `www.pack569.com`.
5. Reload the live site once, **then** publish the Firestore rules (SETUP.md Part C), then do
   the console clean-up SETUP.md lists after publishing.
6. After a week with no problems: repo Settings → Pages → turn GitHub Pages off, and delete
   the `CNAME` file. From then on, pushing to `main` changes nothing live.

After DNS moves, check on a real phone: sign-in and sync work, `/SETUP.md` and
`/test/harness.mjs` return 404, and securityheaders.com shows the headers.
