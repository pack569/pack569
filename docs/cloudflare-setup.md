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
- **When it changes.** Cloudflare's site changes only when someone runs the **website**
  workflow by hand, and production only from `main`, after you approve; pushing or merging
  never deploys there. **GitHub Pages is different:** until you turn it off (cutover step 6),
  every merge to `main` republishes the repo there, as it does today.
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
- [ ] **`website-staging`**
  - Required reviewers: **Keith**.
  - Deployment branches and tags: leave at **No restriction**. Staging deploys whichever
    branch you have read; the approval click is the check.
- [ ] **`website-preview`**: no reviewer needed.

Create `website-production` and `website-staging` **before** the first production or staging
run. GitHub creates an environment a job names if it doesn't exist, with no protection at
all. The workflow's preflight refuses production unless its environment has a required
reviewer **and** a deployment branch rule (not "all branches"), and it refuses any branch but
`main`. It refuses staging unless `website-staging` has a required reviewer: staging is where
real Google sign-ins meet a branch's code, and those sign-ins work on the live pack too
([D](#d-a-preview-you-can-sign-in-to-stagingpack569pagesdev)).

Approve within 7 days: the built site waits between jobs as an artifact kept for a week.
If an approval comes later, run the workflow again. Nothing deploys meanwhile.

## 4. Secrets, on the environments

Put the two secrets on **each environment**, not on the repo. Settings → Environments →
`website-production` → Environment secrets → Add secret, then the same on `website-staging`
and on `website-preview`:

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
- **deploy_target**: `preview` (the default), `staging` or `production`.
  - `preview`: a new throwaway link for this commit, device-only (below).
  - `staging`: always `https://staging.pack569.pages.dev`, the page on the pack's own server
    with the preview database, where Google sign-in works. See
    [D. A preview you can sign in to](#d-a-preview-you-can-sign-in-to-stagingpack569pagesdev).
  - `production`: pack569.com, from `main` only, after your approval.

The run goes: gates (the harness and every build) → preflight (checks the built files
again; for production, the branch, the reviewer and the branch rule; for staging, the
reviewer) → deploy. Production and staging then wait for your approval. The link is in the
run's summary.

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
   public. `.gitignore` ignores `*.json`, but don't save it in the repo folder anyway.)
2. In a private window, open the preview, then Pack tab → **Import backup** and choose that
   file.
3. When done: close the private window, delete the file and empty the Trash.

The data stays in that one private window. It never goes to Cloudflare, Firestore, GitHub
or CI, and the live pack is never written. This covers every leader screen and "Preview as
parent". It can't test sign-in, roles or sync between devices.

### Lock previews to you (required before staging)

Cloudflare Access (free up to 50 people) can put a sign-in in front of preview links. In the
Pages project → Settings → General, turn on the access policy for preview deployments, and
allow only your own account. Production is not affected.

For a plain preview link this is recommended: the page there is device-only and nobody can
sign in. For **`staging` it is required**: real Google accounts sign in there, and those
sign-ins work on the live pack too ([D](#d-a-preview-you-can-sign-in-to-stagingpack569pagesdev)).
Do not deploy to `staging` until the lock is on and you have checked that it covers the
staging link.

**Unverified:** Cloudflare says this covers each deployment's own hash link
(`<hash>.pack569.pages.dev`), not `*.pages.dev` as a whole or custom domains. It is not
confirmed whether it also covers the `preview-<commit>` and `staging` branch aliases the
workflow creates. Before relying on it, open the links from the run summary in a private
window and check that each asks you to sign in. If `https://staging.pack569.pages.dev` does
not, stop and ask before deploying there again.

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
- **Staging, and production after the switch.** A page on the pack's own server
  (`BACKEND = 'api'`) may talk to its own site (`'self'`, where `/api/` is), Firebase Auth and
  the weather, and to no Firestore address at all. The build picks this from the page's own
  `BACKEND` line, so switching the page switches its policy with it.
- To change the policy, edit `_headers` or `cspSources()` and run
  `node scripts/build-site.mjs --target preview` (and `staging`, and `production`) before
  committing. After a deploy, check the browser Console for "Content-Security-Policy" errors.

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

**HSTS (the "always use HTTPS" header).** The page's `_headers` already sends
`Strict-Transport-Security: max-age=31536000; includeSubDomains`, but `_headers` does not
apply to the API under `/api/`: its answers carry their own safety headers
(`functions/_lib/http.js`) and no HSTS. A browser that has loaded the page has the rule
already, so this matters little, but set it at Cloudflare for the whole domain so nothing
depends on that. Once the site works over HTTPS on both `pack569.com` and `www.pack569.com`:
Cloudflare → `pack569.com` → SSL/TLS → Edge Certificates → **Always Use HTTPS** on, and
**HTTP Strict Transport Security (HSTS)** → Enable, with the same settings the page already
sends: max-age **12 months**, **Include subdomains** on, **Preload** off. (A browser that has
seen HSTS refuses plain HTTP to the domain and its subdomains for the whole max-age; the page
has been asking for exactly that, so this adds nothing new, it only covers `/api/` too.)
Then check: `curl -sI https://pack569.com/api/session | grep -i strict-transport` should
print the header (whatever the status code).

## The pack's database (Phase 2)

Phase 2 moves the pack out of Firestore and into **Cloudflare D1**, a database that lives
with the site. Firebase stays for one job only: signing in with Google. The site carries a
small server for this, the `functions/` folder ("the API"). It checks who is signed in, and
applies the same who-may-see-what rules as SETUP.md Part C, plus two the old rules could not
hold: the pack always keeps at least one admin, and the sign-up link only ever files a request.

There are **two databases**, and a preview's server is kept off the live one twice over: by
the ids in `wrangler.toml` (checked by `scripts/check-wrangler.mjs`, which the harness and the
deploy job both run), and by each database's
own record of which deployment it belongs to (step B). What is *not* separated is sign-in;
see [One Firebase project](#one-firebase-project-an-accepted-risk) below.

| Database | Used by |
|---|---|
| `pack569-prod` | production only (`--branch=main`, pack569.com) |
| `pack569-preview` | every preview link, and the `staging` link below |

`wrangler.toml` says which is which. Which one the *page* uses is one line in `index.html`,
`var BACKEND = …`. The committed page says `'firestore'`, so pack569.com keeps using Firestore
and the live API sits unused until the switch
([E. Moving the pack](#e-moving-the-pack-to-its-own-server-the-switch)). The `staging` build
says `'api'`.

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
itself once it is running (step B's last line). Edit only the text between the quotes: the
check reads the file strictly, one plain `key = "value"` per line, and refuses anything else
(a quoted key, a value over several lines, a comment after a value).

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

**The owner is permanent once it is written.** It is written the first time *that* account
signs in on the live site, and never on anyone else's sign-in. So if you mistype the id,
nobody is the owner yet (you will not come in as admin): fix the secret and sign in again.
But once you have signed in and come in as admin, the pack's owner can never be changed
here, not by you, not by the dashboard, so check the id against Firestore before that
first sign-in.

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
Its server uses `pack569-preview`, never the live pack's database. Its sign-in, though, is the
live pack's sign-in; read the next part before you add it.

- [ ] Firebase console → Authentication → Settings → **Authorized domains** → Add
      `staging.pack569.pages.dev`. (If the Google API key has a website restriction in
      Google Cloud, add it there too.)
- [ ] **Required:** put the Cloudflare Access lock on preview deployments
      ([above](#lock-previews-to-you-required-before-staging)), and check in a private window
      that `https://staging.pack569.pages.dev` asks you to sign in to Cloudflare before it
      shows the page. Real Google accounts sign in there. No lock, no staging deploy.
      That rule is yours to keep: the workflow cannot see the lock, and will deploy to
      `staging` whether it is on or not.

To deploy there: Actions → **website** → Run workflow, from the branch, with `deploy_target`
**`staging`**, and approve it (the `website-staging` environment, step 3). The build is the
branch's page with `BACKEND = 'api'` and `STAGING = true`, which makes the page refuse the
real move file; nothing else in it changes. Only deploy a branch whose code you have read
(see the risk below).

What to check on staging, in a private window:

- [ ] **Before you sign in:** Cloudflare Access asks you to sign in first, before the page
      shows. If the pack page shows straight away, close the window without signing in, and
      stop: the lock is not covering staging.
- [ ] DevTools → Network: calls go to `/api/…` on staging itself, and nothing goes to
      `firestore.googleapis.com`. The Console shows no "Content-Security-Policy" errors.
- [ ] Sign in. The first account to sign in on `pack569-preview` owns its test pack and is its
      admin (previews use `OWNER_MODE = "first-signer"`); that should be you.
- [ ] Make a change on one device and watch it arrive on a second within about 15 seconds
      (the page asks the server every 15 s for a leader, every 60 s for a family, and at once
      when you switch back to the tab).
- [ ] With a second made-up Google account: open the sign-up link, approve it as a parent,
      and check the family view arrives.

**Only made-up data goes in `pack569-preview`.** Never copy the real pack into it: preview
links are easier to reach than the live site, and it has none of production's protections.

#### One Firebase project: an accepted risk

Previews, `staging` and production all accept Google sign-ins from the **same** Firebase
project, `pack-569` (`FIREBASE_PROJECT_ID` in `wrangler.toml`). A sign-in is a token the page
sends with every request, and the live API cannot tell a token made on `staging` from one
made on pack569.com. So:

- **The code running on `staging` handles real sign-ins that also work on the live pack.**
  When a leader signs in on `staging`, the page there holds a token that the live API would
  accept as that leader, with their live role. Each token lasts an hour, but that is not the
  limit: Firebase also keeps a refresh token in that browser's storage for `staging`, and
  mints a new hour-long token from it whenever asked, until its sessions are revoked, the
  account is disabled, or its password or email changes. Signing out on `staging` only
  removes this browser's copy; a copy already sent elsewhere keeps working. Code on
  `staging` that sent those tokens somewhere else, or used them against pack569.com itself,
  could read or change the live pack as that leader for as long as that lasts. The database separation above does not stop this; it only keeps the
  *preview's own server* off the live database.
- The same holds the other way: a token from pack569.com is accepted by a preview's server,
  but that server only has the made-up pack in it.

The review of Phase 2 offered a fix: a second Firebase project just for previews and
staging, so their tokens would mean nothing to the live API. **Decision (Keith, 2026-09-28):
accept the risk and keep one Firebase project.** What that asks of you instead:

- **Only you deploy branches, and only branches whose code you have read.** A deploy is a
  hand-started run of the website workflow, which anyone with write access to the repository
  can start, so keep that list to yourself. Deploying a branch to `staging` means trusting
  its code with real sign-ins: the same trust as merging it.
- The Cloudflare Access lock on preview deployments is **required** (above), so only you can
  open `staging` and sign in there. Sign in there only with your own account, in a private
  window, and when you are done: sign out on `staging`, then close the private window. That
  is housekeeping, not containment. Signing out removes the refresh token from that browser
  and closing the window throws away the rest, but neither reaches a copy the page's code
  already sent somewhere else; that copy keeps working until the next step ends it.
- **If a sign-in on `staging` may have been misused** (you deployed code you now doubt, or
  someone else got in): Firebase console → **Authentication** → **Users** → find the account →
  its menu → **Disable account**. This is what ends it. A disabled account gets no new
  tokens, so every copy of its refresh token is dead, wherever it went; a token already made
  still works on the live API until its hour runs out, so treat the next hour as exposed.
  Before you enable the account again, also revoke its sessions, belt and braces, so no old
  refresh token comes back to life with it. The console has no button for this: it is
  Firebase's `revokeRefreshTokens`, one Admin SDK call. One way is Google Cloud console
  (project `pack-569`) → **Activate Cloud Shell**, then, with the account's **User UID** from
  the Users list in place of `THE_UID`:

  ```
  mkdir -p revoke && cd revoke && npm install firebase-admin
  node -e "const a=require('firebase-admin');a.initializeApp({projectId:'pack-569'});a.auth().revokeRefreshTokens('THE_UID').then(()=>console.log('revoked'))"
  ```

  If that does not print `revoked`, ask for help rather than re-enabling. Disabling your own
  account signs you out of the live pack too, so make sure another admin can still get in
  first.
- If you ever stop being the only person who can run the workflow, or want other leaders to
  try `staging`, revisit this: that is when the second Firebase project is worth making.

### E. Moving the pack to its own server (the switch)

The pack is copied from Firestore to `pack569-prod` **once**, by you, through a file on your
own computer:

1. On the Firestore page (pack569.com today), signed in as the pack's owner: Pack → Sharing →
   **Download pack for the new server**. It saves the whole pack, the members, the open
   invites and the sign-up link settings as one file. Only the owner sees this button.
2. On the new page, signed in as the owner, while the server has no pack yet: Pack → Sharing →
   **Copy pack to new server…**, and choose that file. The page shows what is in it (the
   pack's name, its newest event, the counts) before anything is sent.

The server takes the copy only from `PACK_OWNER_UID` (step C), only while it has no pack, and
only once. After that it refuses every copy.

Why a file, and not one button that sends straight from the old page: the old page can only
talk to the server from the same address. That depends on the DNS move, and letting other
addresses call the API would widen who can reach it. A file works either way. The family
data in it goes from Firestore to your browser, to your computer, to the server, and never
through GitHub or CI.

**The move file holds the whole pack, every member's email and the sign-up code.** These are
rules, not tips:

- Save it on **this computer only**, in Downloads. Not in iCloud Desktop or Documents, not in
  Dropbox or OneDrive, and not in the repo folder (`.gitignore` ignores `*.json`, but don't
  rely on it).
- After it downloads, check in Finder that it is in Downloads, and that Downloads is not a
  synced folder.
- **Never email, AirDrop or text it.** Don't open it in a notes app or a cloud app, and don't
  copy and paste it anywhere: the page has no Copy button for it on purpose.
- When the pack is copied in, **delete it and empty the Trash** (switch step 7).
- If it may have gone anywhere other than this computer, change the sign-up code (switch
  step 8).

Until the copy is made, the live pack on the server is empty, and **no one's save can start
it**. The API refuses the first save to an empty pack in production (it answers
`awaiting-import`). A leader who opens the new page before you have copied the pack in sees
"Waiting for the pack's owner to copy the pack over". Their changes stay on their own device.
When the pack arrives, the page compares, and asks them which copy to keep if the two differ.
If the server itself is not set up (a missing database id or `deployment` row), the page says
"The pack's server isn't set up yet" and keeps its own copy.

#### Rehearse it on staging first (made-up data only)

- [ ] If you still have a real `popcorn-backup.json` from earlier (a Backup (JSON) of the
      live pack), delete it before you start, and empty the Trash. The only pack file on this
      computer should be the made-up one below.
- [ ] On any `preview` link (device-only), make a small made-up pack: Program → Seed the
      standard year, and a few invented scouts. Pack → Sharing → **Backup (JSON)**, and save
      it as **`made-up-test-pack.json`** (the page names it `popcorn-backup.json`; rename it as
      you save). A backup brings the pack record only, not members; the real move file brings
      both. Staging refuses the real move file outright.
- [ ] Deploy `staging` from the branch (D above) and approve it. Open it in a private window.
      **Before you sign in, check that Cloudflare Access asks you to sign in first**; if the
      pack page shows straight away, close the window without signing in, and stop. Then sign
      in.
- [ ] If the preview database already has a pack record from earlier testing, it can't take a
      copy. Clear it first (preview only, never `--env production`):
      `npx wrangler d1 execute pack569-preview --remote --command "DELETE FROM pack_state; DELETE FROM import_lock"`
- [ ] Reload staging. Pack → Sharing shows **Copy pack to new server…**; choose
      `made-up-test-pack.json`. The screen names the pack and its newest event: check they are
      your made-up ones (if it is the real pack, cancel), read the warning, and copy it in.
      The pack appears within a few seconds.
- [ ] Delete `made-up-test-pack.json` and empty the Trash.

#### The switch, in order

Before you start: A–C above are done (both databases, the tables, each `deployment` row,
`PACK_OWNER_UID`); the rehearsal worked; **pack569.com is already served by Cloudflare**
([Cutover, in order](#cutover-in-order), step 4); and **GitHub Pages is off** (cutover step 6).
The new page calls `/api/` on its own address. GitHub Pages has no `/api/`, so a switched page
served from GitHub Pages would find no server, and while GitHub Pages is on, merging the switch
commit publishes the switched page there at once.

1. Tell the leaders: no changes on the pack for the next hour. Anything changed on the old
   page after step 3 is not in the file.
2. Make the switch commit on a branch: in `index.html`, change `var BACKEND = 'firestore';`
   to `var BACKEND = 'api';`, and in `test/harness.mjs` the test that pins it (search for
   "the committed page is not the Firestore build"). Run the harness, review, and merge to
   `main`. Nothing is deployed yet: the website workflow deploys only when you run it, and
   GitHub Pages is off (before you start).
3. On pack569.com (still the Firestore page), signed in as the owner, wait for the pill to say
   **Synced**, then Pack → Sharing → **Download pack for the new server**. Save the file by
   the rules above: this computer, Downloads, checked in Finder.
4. Actions → **website** → Run workflow from `main`, `production`, and approve it.
5. Open pack569.com, sign in as the owner. The page says the server has no copy of the pack
   yet. Pack → Sharing → **Copy pack to new server…** → the file → check the pack's name, its
   newest event and the counts → **Copy it in**. If this device's copy differs from the file,
   the page asks which to keep. Choose **Use cloud copy**: that is the file you just copied in.
6. Check: the Members card lists everyone; a second leader signs in and sees the pack; a
   parent account sees the calendar. The owner's page republishes the family view as soon as
   the pack arrives.
7. Delete the file and empty the Trash.
8. If the file may have gone anywhere other than this computer (a synced folder, an email, a
   message, another device), change the sign-up link's code: Pack → Sharing → Parent sign-up
   link → **New code** (tap it twice). The old link stops working; send families the new one.
   If the link is switched off, press **New code** the next time you turn it on.

**The way back.** Firestore still holds the pack as it was at step 3. Leave the Firestore
rules exactly as they are for two weeks. To go back: revert the switch commit and deploy
production again. Anything changed on the new server since the switch is not in Firestore,
so first download a **Backup (JSON)** on the new page and import it on the old one (the move
file's rules above apply to that backup too). After two
weeks with no problems, Firestore can be retired (a later change: SETUP.md Part C then
becomes a description of what the server enforces).

### Backups

D1 keeps 7 days of history (Time Travel), so a bad day can be undone:
`npx wrangler d1 time-travel info pack569-prod` shows where you can go back to. A weekly copy
to private storage is a later step. Never put a database export in the repo or in CI.
