# Hosting pack569.com on Cloudflare Pages

> **Owner steps.** Everything below is a dashboard, DNS or GitHub-settings action for the
> pack's site owner. The repo side is `scripts/build-site.mjs`, `_headers`, `wrangler.toml`,
> `.github/workflows/website.yml`, and for the pack's database `functions/` and `migrations/`.

Until the nameservers change (step 4 of the cutover), pack569.com keeps serving from GitHub
Pages. Creating the Cloudflare account, the Pages project or the zone changes nothing live.

> **Owner note: do this first, whatever happens with Cloudflare.** GitHub Pages serves every
> file in the repo, and the live site serves `/test/harness.mjs` today. On `main` that file
> still has real families' names and email addresses in its test fixtures. PR #1 replaces
> them with made-up ones, so merging PR #1 soon takes them off the live site, whether or not
> the Cloudflare move has happened. They stay in the repo's history until it is purged, and
> that purge is still on the owner's list.

## What changes, and what doesn't

- **What is served.** GitHub Pages serves every file in the repo: SETUP.md, the design docs,
  `test/`. The Cloudflare site serves exactly two files, `index.html` and `_headers`, written
  by `scripts/build-site.mjs`. The repo is still public, so anything committed is still public
  on GitHub; it just isn't on the website.
- **When it changes.** Pushing or merging never deploys. The site changes only when someone
  runs the **website** workflow by hand, and production only from `main`, after you approve.
- **Firebase is unchanged, for now.** Same project, same sign-in, same pack record, same
  rules. Phase 2 adds a small server to the site (`functions/`, "the API") that keeps the pack
  in a Cloudflare database instead; until the page is switched over to it, the API sits
  unused. Its setup is [The pack's database](#the-packs-database-phase-2) below.

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

## 3. GitHub environments

Repo → Settings → Environments → New environment:

- [ ] **`website-production`**
  - Required reviewers: **Keith**.
  - Deployment branches and tags: **Selected branches → `main`** only.
- [ ] **`website-preview`**: no reviewer needed.

Create `website-production` **before** the first production run. GitHub creates an
environment a job names if it doesn't exist, with no protection at all. For production the
workflow's preflight refuses to go on unless the environment has a required reviewer **and**
a deployment branch rule (not "all branches"), and it refuses any branch but `main`.

Approve within 7 days: the built site waits between jobs as an artifact kept for a week.
If an approval comes later, run the workflow again. Nothing deploys meanwhile.

## 4. Secrets, on the environments

Put the two secrets on **each environment**, not on the repo. Settings → Environments →
`website-production` → Environment secrets → Add secret, then the same on `website-preview`:

- [ ] `CLOUDFLARE_API_TOKEN`: the token from step 2.
- [ ] `CLOUDFLARE_ACCOUNT_ID`: shown in the Cloudflare dashboard (Workers & Pages, right side).

Do **not** add them under "Repository secrets". Environment secrets are handed only to the
deploy job, after its environment's rules pass, so a push or pull-request run can never
read them. If they are ever added as repository secrets, delete those.

### What the approval does and doesn't protect against

The branch check and the approval click catch **mistakes**: deploying the wrong branch,
deploying production by accident. They do not stop a person with **write access** to the
repo who sets out to get round them. That person can edit the workflow on a branch, and the
preview environment hands its token to any branch; a Pages · Edit token can deploy the
production branch of the project, so a preview run could be turned into a production deploy.

Today that is only you: the repo's only collaborator, and the `pack569` organization's only
member, is Keith (checked 2026-09-28). Check again before giving anyone write access
(`gh api repos/pack569/pack569/collaborators --jq '.[].login'`).

**Optional, stronger:** put previews in a **separate Pages project under a second free
Cloudflare account**, and give `website-preview` only that account's token and id. Then no
secret a branch can reach is able to touch pack569.com. The workflow would need the preview
project's name on the preview deploy; ask for that change if you want it.

## 5. Running a deploy

Actions → **website** → **Run workflow**:

- **Use workflow from**: the branch to deploy. Any branch can be previewed without merging;
  that branch's own copy of the site and the workflow is what runs.
- **deploy_target**: `preview` (the default) or `production`.

The run goes: gates (the harness and both builds) → preflight (checks the built files
again; for production, the branch, the reviewer and the branch rule) → deploy. Production
then waits for your approval. The link is in the run's summary.

Every deploy also sends the API (`functions/`) with the site. The deploy stops with
"wrangler.toml still has placeholder D1 ids" until you have done step A of
[The pack's database](#the-packs-database-phase-2).

A **preview** is device-only. Its `FIREBASE_CONFIG` and `PACK_DOC_ID` are null and its
Content-Security-Policy allows no Google address, so it cannot read or write the live pack,
and nobody can sign in on it. It is marked `noindex`. Cloudflare shortens long branch names,
so the alias link is shorter than the full commit id; use the link the summary prints.

**Never send a preview link to families or other leaders.** A preview works as a complete
app on its own, saving to the device, so someone could type their children's details into
it believing it was the pack's site. Nothing they typed would reach the pack, and it would
sit in their browser.

## Testing a preview with real data

The preview starts empty. You can load the real pack into it. These are rules, not tips:

- **Your own device only**, never a shared or borrowed one.
- **Only a preview built from a branch you have reviewed.** That branch's build script and
  headers are what run with the pack's data in the page.
- **A private (incognito) window**, closed when you finish. Preview links stay reachable for
  good, and closing the window is what removes the copy from the browser.
- **The backup file**: save it somewhere that does not sync (not iCloud Desktop or
  Documents, not Dropbox or OneDrive, not the repo folder). Never email, AirDrop or text it.
  Delete it when you finish, and empty the Trash.

Steps:

1. On live **pack569.com**, Pack tab → **Backup (JSON)**. Save it as above. (The repo is
   public. PR #1 makes `.gitignore` ignore `*.json`; until PR #1 is merged nothing ignores
   it, so a backup saved in the repo folder could be committed.)
2. In a private window, open the preview, then Pack tab → **Import backup** and choose that
   file.
3. When done: close the private window, delete the file and empty the Trash.

The data stays in that one private window. It never goes to Cloudflare, Firestore, GitHub
or CI, and the live pack is never written. This covers every leader screen and "Preview as
parent". It can't test sign-in, roles or sync between devices.

### Recommended: lock previews to you

Cloudflare Access (free up to 50 people) can put a sign-in in front of preview links. In the
Pages project → Settings → General, turn on the access policy for preview deployments, and
allow only your own account. Production is not affected.

**Unverified:** Cloudflare says this covers each deployment's own hash link
(`<hash>.pack569.pages.dev`), not `*.pages.dev` as a whole or custom domains. It is not
confirmed whether it also covers the `preview-<commit>` branch alias the workflow creates.
Before relying on it, open both links from the run summary in a private window and check
that each asks you to sign in.

## What the Content-Security-Policy blocks

`_headers` is a template; the build fills in the hash of the page's one script and the
allowed addresses for each target. The page may run only its own script (plus, in production,
the Firebase SDK from its exact versioned path, and Google sign-in), and talk only to
Firestore, Firebase Auth and the open-meteo weather service. Preview: weather only.

- **Calendar from a link.** "Paste calendar link or text…" with an `https://` or `webcal://`
  link is blocked, on purpose: allowing it would mean allowing the page to fetch from anywhere. The
  dialog falls back to "open the link in your browser, copy, and paste the calendar text
  instead", which is also what happens today for calendars (BAND included) that refuse
  cross-site reads. To allow one calendar host, add its origin to `CONNECT` in the production
  branch of `cspSources()` in `scripts/build-site.mjs`, never `https:` as a whole.
- **Inline `onclick="…"`.** Blocked, and the build refuses a page that has one. Wire buttons
  with `data-act` and a listener, as the rest of the app does.
- **A new Firebase SDK version.** The SDK path comes from `SYNC_SDK_BASE` in `index.html`, so
  bumping the version there moves the CSP with it.
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
   - **First, verify the domain with GitHub**, so no one else's GitHub Pages site can claim
     pack569.com once it stops pointing at this repo: the `pack569` organization's Settings →
     Pages → **Verified domains** → Add a domain (or your personal Settings → Pages if the
     repo ever moves), and add the TXT record GitHub shows you. Wait until it says verified.
   - Cloudflare → Add a site → `pack569.com`, Free plan. Cloudflare imports the current records.
   - **Check that the imported records include the email ones (MX and TXT, such as SPF).**
     Moving nameservers moves all DNS, and a missing MX record stops the domain's email.
     Add anything missing before the next step.
   - At GoDaddy, change the nameservers to the two Cloudflare gives you. The domain stays
     registered at GoDaddy. Wait for Cloudflare to show the zone as Active.
   - In Cloudflare DNS, **delete the imported GitHub Pages records**: the apex A records
     `185.199.108.153`, `185.199.109.153`, `185.199.110.153` and `185.199.111.153`, any AAAA
     records starting `2606:50c0:`, and the `www` CNAME to `keith-dougherty.github.io`.
   - Pages project → Custom domains: add `pack569.com` and `www.pack569.com`. Cloudflare
     creates the records that replace the ones you deleted.
5. Reload the live site once, **then** publish the Firestore rules (SETUP.md Part C), then do
   the console clean-up SETUP.md lists after publishing.
6. Turn GitHub Pages off as soon as you no longer need it as a way back (a week with no
   problems is plenty): until then the repo's `github.io` address keeps serving every file
   in it. Before you do, check that nothing still points at GitHub:

   ```
   dig +short pack569.com A
   dig +short pack569.com AAAA
   dig +short www.pack569.com CNAME
   ```

   None of the answers may be a `185.199.` address, a `2606:50c0:` address or
   `github.io`. Then repo Settings → Pages → turn GitHub Pages off, and delete the `CNAME`
   file. From then on, pushing to `main` changes nothing live.

After DNS moves, check on a real phone: sign-in and sync work, `/SETUP.md` and
`/test/harness.mjs` return the app page, not the file (the site has no 404 page, so Pages
answers every unknown address with `index.html`), and securityheaders.com shows the headers.

## The pack's database (Phase 2)

Phase 2 moves the pack out of Firestore and into **Cloudflare D1**, a database that lives
with the site. Firebase stays for one job only: signing in with Google. The site carries a
small server for this, the `functions/` folder ("the API"). It checks who is signed in, and
applies the same who-may-see-what rules as SETUP.md Part C, plus two the old rules could not
hold: the pack always keeps at least one admin, and the sign-up link only ever files a request.

There are **two databases**, and a preview can never reach the live one:

| Database | Used by |
|---|---|
| `pack569-prod` | production only (`--branch=main`, pack569.com) |
| `pack569-preview` | every preview link, and the `staging` link below |

`wrangler.toml` says which is which. Until the page itself is switched over to the API (a
later change), the page keeps using Firestore and the API sits unused.

**Do A before the next deploy of any branch that has `functions/`.** Until the database ids
are in `wrangler.toml`, the deploy job stops on purpose.

### A. Create the two databases (once)

On your own computer, in the repo folder:

- [ ] `npx wrangler login`. A browser opens; sign in to Cloudflare and allow it.
- [ ] `npx wrangler d1 create pack569-prod`
- [ ] `npx wrangler d1 create pack569-preview`

Each prints a `database_id` (a long id with dashes). In `wrangler.toml`, replace:

- [ ] `REPLACE_WITH_PACK569_PROD_DATABASE_ID` with the `pack569-prod` id. It appears once,
      under `[[env.production.d1_databases]]`.
- [ ] `REPLACE_WITH_PACK569_PREVIEW_DATABASE_ID` with the `pack569-preview` id. It appears
      **twice**, under `[[d1_databases]]` and `[[env.preview.d1_databases]]`.

The preview id must be the same in both places, and must not be the prod id. The harness and
the deploy job both refuse a `wrangler.toml` where that does not hold, and so does the API
itself once it is running (step B's last line).

Commit that on a branch. A database id is not a secret: nothing can open the database
without a Cloudflare login or token for your account.

### B. Create the tables

Still on your computer, from the repo folder:

- [ ] `npx wrangler d1 migrations apply pack569-preview --remote`
- [ ] `npx wrangler d1 migrations apply pack569-prod --remote --env production`

Each one lists the files in `migrations/` it has not run yet (`0001_init.sql`,
`0002_deployment.sql`, …), asks you to confirm, and creates the tables. Later changes add more
files; apply those the same way, preview first. To check:

```
npx wrangler d1 execute pack569-preview --remote --command "SELECT name FROM sqlite_master WHERE type = 'table'"
```

Then tell each database, once, which deployment it belongs to. **Copy these exactly; the
word at the end is different for each:**

- [ ] `npx wrangler d1 execute pack569-preview --remote --command "INSERT INTO deployment (id, env) VALUES (1, 'preview')"`
- [ ] `npx wrangler d1 execute pack569-prod --remote --env production --command "INSERT INTO deployment (id, env) VALUES (1, 'prod')"`

The API compares that row with the deployment it is running in (`DEPLOY_ENV` in
`wrangler.toml`) on every request, and answers nothing but an error (503) if they differ,
or if the row is not there yet. So if a preview were ever bound to `pack569-prod` by mistake,
it would refuse to serve the live pack rather than hand it to whoever has the preview link.
Until you run these two lines, the API answers `deployment-unset` everywhere, which is the
safe way for it to fail. To check a database: `npx wrangler d1 execute pack569-prod --remote
--env production --command "SELECT env FROM deployment"` should say `prod`. Nothing in the
site ever changes this row; if you seeded one wrongly, stop and ask.

**Unverified:** that `--env production` is how wrangler finds `pack569-prod` in this Pages
project's `wrangler.toml`. If wrangler says it cannot find the database, stop and ask. Do not
run the `.sql` file by hand: the migrations list would not know it had run, and would try to
run it again later.

### C. Say who owns the pack (production only)

In production, the pack's owner is set by you, not by whoever signs in first. That owner is
the only person who can ever copy the pack in from Firestore, and is always an admin.

- [ ] Find your account id: Firebase console → **Firestore Database** → `packmeta` → the
      pack's document → the `owner` field. (It is also your row's **User UID** under
      Authentication → Users. The two must match.)
- [ ] Cloudflare → Workers & Pages → `pack569` → Settings → **Variables and Secrets** →
      **Production** → Add → type **Secret**, name `PACK_OWNER_UID`, value the id. Or, from
      your computer: `npx wrangler pages secret put PACK_OWNER_UID --project-name pack569`.

Don't set it for previews. There the first person to sign in owns the test pack, so you can
try things out. If production has no `PACK_OWNER_UID`, the pack has no owner: nobody is made
admin and nothing can be copied in. That is the safe way for it to fail.

The other settings (`FIREBASE_PROJECT_ID`, `PACK_IDS`, `OWNER_MODE`) are in `wrangler.toml`.
Because the file sets them, the dashboard shows them read-only; change them in the file.

**Unverified:** that the deploy token from step 2 (Pages · Edit) is enough to deploy a site
whose API uses a database. If a deploy fails with a permission error about D1, stop and ask
rather than widening the token.

### D. A preview you can sign in to: `staging.pack569.pages.dev`

Google sign-in works only on addresses listed in Firebase, exactly, and every
`preview-<commit>` link is new. So a preview that needs sign-in is deployed to one fixed
branch name, **`staging`**, which Pages serves at **`https://staging.pack569.pages.dev`**.
It is a preview: it uses `pack569-preview`, never the live pack.

- [ ] Firebase console → Authentication → Settings → **Authorized domains** → Add
      `staging.pack569.pages.dev`. (If the Google API key has a website restriction in
      Google Cloud, add it there too.)
- [ ] Put the Cloudflare Access lock on preview deployments ([above](#recommended-lock-previews-to-you))
      and check it covers the staging link, since real Google accounts can sign in there.

Today's preview build is device-only, with sign-in switched off, so staging is of no use
yet. The change that switches the page over to the API also adds a `staging` choice to the
workflow. Until then, nothing deploys to `staging`.

**Only made-up data goes in `pack569-preview`.** Never copy the real pack into it: preview
links are easier to reach than the live site, and it has none of production's protections.

### E. Copying the pack in (later)

When the page is ready to switch, you, signed in as the owner on the last Firestore version
of the page, copy the pack across once. The API takes it only from `PACK_OWNER_UID`, only
while the pack is empty here, and only once; after that it refuses every copy. Try the whole
thing first on `staging` with a made-up pack.

### Backups

D1 keeps 7 days of history (Time Travel), so a bad day can be undone:
`npx wrangler d1 time-travel info pack569-prod` shows where you can go back to. A weekly copy
to private storage is a later step. Never put a database export in the repo or in CI.
