# Ideal Year of Scouting — Setup Guide

`index.html` is the entire app: one self-contained file, no build step, no dependencies.
Open it in a browser and it works **device-only** — everything is saved in that browser's
local storage. Nothing below is required to use the app.

The optional pieces below turn on **shared sync** (several leaders share one live ledger)
and, on top of that, **accounts & roles** (Google sign-in, so some leaders are view-only and
parents can get a schedule-only dashboard).

- **Part A** — turn on shared sync (Firebase).
- **Part B** — the baseline Firestore security rules (lets everyone with the passphrase edit).
  **Passphrase mode only** — never use these with Part D.
- **Part C** — accounts & roles: Google sign-in, one admin, view-only leaders,
  **parents** who only ever see the schedule and standings, and a **self-serve sign-up link**
  you can blast to every family without knowing their email addresses.
- **Part D** — *(recommended, once C is live)* **single-pack mode**: bake the pack id into the
  page so **nobody ever types a passphrase again**. Leaders open the sign-up link, sign in
  with Google, and the admin approves them.
- **If a page stays "out of date" after a reload** — how the owner recovers a pack record
  whose format number is higher than any page served (at the end of this guide).

---

## Do it in this order

If you're setting this up from scratch, this is the whole path. **The order is not
cosmetic — steps 2 and 5 are the security-critical ones, in that order.**

| # | Step | Where |
|---|------|-------|
| 1 | **Part A** — create the Firebase project and paste `FIREBASE_CONFIG` into `index.html` | Firebase console + the file |
| 2 | **Part C rules** — enable Google sign-in and **publish the Part C security rules** | Firebase console |
| 3 | **Sign in with Google yourself and claim admin** — you're the first signer, so you're the owner | the app, Pack tab |
| 4 | **Copy the Pack ID** from the Pack tab → Shared sync → *Pack ID* | the app, Pack tab |
| 5 | **Part D** — paste it into `var PACK_DOC_ID` in `index.html` and redeploy | the file |
| 6 | **Turn Anonymous sign-in off** in the Firebase console — single-pack mode never uses it | Firebase console |
| — | The passphrase is now gone forever. Send everyone else the sign-up link (or invite them) and approve them from the Members card. | the app |

**Why the order matters.** Until the Part C rules exist, the *only* thing guarding your
pack's data is that its Firestore document id is the SHA-256 hash of a passphrase nobody
outside the pack knows. Part D publishes that id inside a public web page. Doing step 5
before step 2 would therefore hand every visitor on the internet read **and write** access
to your ledger.

The app enforces this rather than trusting you to remember it: with `PACK_DOC_ID` set, it
signs nobody in anonymously, subscribes to nothing and writes nothing until a Google
sign-in has resolved a member role *without* a permission error. If the strict rules aren't
published it shows a full-screen "**This pack needs its security rules published before it
can sync — see SETUP.md Part C**" screen and stays device-only. You can't accidentally
expose the pack by doing it backwards; you'll just get a page that refuses to sync.

Step 4 is self-enforcing too: the **Pack ID** line only ever renders for a signed-in
**admin**, so by the time you can read the id, the ownership claim in step 3 has already
happened and no stranger can claim admin on your pack.

You can stop after Part C and keep using passphrases — everything below Part D is optional.

---

## Part A — Turn on shared sync (optional)

1. Go to <https://console.firebase.google.com> and create a free project.
2. **Build → Authentication → Sign-in method → enable "Anonymous".**
3. **Build → Firestore Database → Create database** (Production mode is fine — you'll paste
   rules in Part B).
4. **Project settings → Your apps → add a Web app**, then copy the config object
   (`apiKey`, `authDomain`, `projectId`, …).
5. In `index.html`, find `var FIREBASE_CONFIG = { … }` near the top of the `<script>` and
   paste your config in place of the existing one.
6. Every leader opens the page and, on the **Pack** tab → **Shared sync**, types the *same*
   passphrase. They now share one live ledger.

The passphrase selects which shared copy you're on — its SHA-256 hash is the Firestore
document id (`packs/{sha256(passphrase)}`). It never leaves the device except as that hash.
Leave `FIREBASE_CONFIG` as `null` for pure device-only mode.

---

## Part B — Baseline security rules

> **Part B is for passphrase mode only.** These rules let *any* signed-in user read and write
> the ledger, and the app signs everyone in anonymously — so the pack is protected purely by
> the document id being an unguessable hash. **Never run these with `PACK_DOC_ID` set**
> (Part D), which publishes that id on a public page. If you go to Part D, publish the Part C
> rules and leave them published.

In **Firestore Database → Rules**, publish this. It lets any signed-in user (the app signs
everyone in anonymously) read and write the shared ledger — i.e. **anyone with the
passphrase can view and edit**. This is the default, and all you need if you're not using
Part C.

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /packs/{doc} {
      allow read, write: if request.auth != null;
    }
  }
}
```

---

## Part C — Turn on accounts & roles

> **Rules updated 2026-09-27 — paste this whole block into the Firebase console.** (The block
> is in step 2 below: Firestore Database → Rules → replace everything → Publish.) This update
> closes the ways in that didn't need an admin: a bare "pending" sign-up with nothing but the
> pack id, a readable join code, invites anyone could write, and the members list being
> visible to parents. See *Already running an earlier version of the Part C rules?* below.

This adds **Google sign-in** on top of the shared ledger so you can give some leaders
**view-only** access, and hand **parents** a link that shows the pack calendar and standings
and *nothing else*. It's purely additive: the ledger, the passphrase, and device-only mode
all keep working exactly as before. It is also the prerequisite for Part D — publish these
rules **before** you bake the pack id into the page.

> **The pack is moving to its own server** (`docs/cloudflare-setup.md`, "The pack's database").
> Once the page runs with `BACKEND = 'api'`, this Part C stops being rules you paste into
> Firebase and becomes *what the server enforces*. The server's `functions/_lib/rules.js`
> quotes each rule below word for word, and the test harness checks that it still does. The
> server also holds two rules the Firestore ones could not: the pack always keeps an admin, and
> the sign-up link only ever files a request. Until that switch, and for two weeks after it as
> the way back, keep these rules published exactly as they are. This part is rewritten when
> Firestore is retired.

How it works:

- A leader taps **Sign in with Google** on the Pack tab. In passphrase mode a passphrase must
  be set first (it picks which pack they're joining); in single-pack mode (Part D) there's
  nothing to type — the page already knows the pack. Parents arriving on the sign-up link
  skip it either way: the link itself says which pack.
- **The first person to sign in becomes the pack admin** (owner). The app records this as an
  immutable `packmeta/{sha256(passphrase)}` document holding their user id.
- **Everyone else comes in through the sign-up link or an invite.** Someone arriving on the
  sign-up link lands as **"pending"** and can't see anything until the admin approves them. On
  the Pack tab → **Members**, the admin approves each pending person as **Editor**, **Viewer**
  or **Parent**, and can change or remove members later. Someone who signs in with neither a
  link nor an invite is told to ask a pack leader, and nothing is created for them.
- **Or invite them ahead of time.** In the Members card, **Invite someone** takes an email
  address and a role. When that person signs in with Google using that address, they land
  *straight* in the invited role — no approval step, no pending limbo. Outstanding invites
  are listed underneath with a two-tap ✕ to revoke. (Nothing is emailed from the app; send
  them the page link yourself.)
- **Or hand out one self-serve link.** If you don't know every parent's email address, the
  **Parent sign-up link** card (Pack tab, admins only) gives you a single URL you can post to
  the pack's group chat. A family opens it, taps *Sign in with Google*, and — depending on
  the mode you picked — either lands straight in the view-only parent app or waits for you to
  approve them. **Parents never need the passphrase.** See *The parent sign-up link* below.

### The four roles

| Role | Can edit? | What they can see |
|------|-----------|-------------------|
| `admin` | yes | Everything, plus member management, invites and the sign-up link |
| `editor` | yes | Everything |
| `viewer` | no | Everything (the whole ledger), read-only |
| `parent` | no | **Only** the schedule and standings — see below |
| `pending` | no | **Nothing** — a "waiting for approval" screen and a sign-out button |

> **`pending` means waiting.** A not-yet-approved person sees no pack content at all: no
> calendar, no standings, no ledger. Their browser subscribes to nothing. That's what makes
> approval actually gate something. (In earlier versions `pending` saw the parent view; if
> you're upgrading, anyone sitting at `pending` will drop to the waiting screen until an
> admin approves them.)

- `admin` and `editor` can edit; `viewer` is read-only — the app hides the
  add/import/close-out controls, refuses to save or sync their changes, and shows a
  "Read-only" banner. The security rules below are what make view-only *genuinely*
  enforced: a viewer physically cannot write to the ledger, not just in the UI.
- There's always **at least one admin** — the app won't let the last admin be removed or
  demoted.

### What a parent sees (and what they can't)

Firestore security rules can allow or deny a **whole document** — they can't hide *parts*
of one. The ledger is a single document holding the entire pack, so "let parents see the
calendar but not the money" is impossible to do by permission alone. Instead the app keeps a
**second, sanitized document** and gives parents *only* that one:

- `packs/{doc}/public/view` — a derived copy regenerated by leaders' devices after each
  successful save (and once when a leader connects). It contains **only**:
  - always: the pack name and program year; the program year's events (July 1 to June 30) — storefront dates with
    their shift windows, den/pack meetings with time and location note, dated activities
    with time, place and which dens; the derby's name and date; the camping trips as leaders
    wrote them, **including each trip's cost line**, in date order, with each trip's first and
    last day and online sign-up deadline as dates (`startDate`, `endDate`,
    `registrationDeadline`) — sending a trip's intro, cost, when, camp, arrive or leave-by line
    blank while it still says "[verify with council", leaving out any section still marked
    "[verify with council" or
    still saying "BALOO is not required" (a wrong safety rule, held back until a leader corrects
    it), and
    the Webelos / Arrow of Light den campout template until it has a date; the **New to the pack** page (`welcome`)
    as leaders wrote it — each section's heading, text and link — once a leader has ticked
    **Show this page to families** (Scouts → New families), leaving out any section that is
    hidden or still says "[pack to fill in"; and **what the year is planned to cost**
    one scout and one adult in each den, line by line with who it's paid to, and what each
    reward tier (by name and the **sales that reach each tier**) takes off that; and the
    **"who to ask" line** an admin types on the Parent sign-up link card (shown at the foot of
    every family's page — use a role and the pack's email, not a personal phone);
  - with standings on (the default): the **first names** of the scouts on each storefront
    shift, the scout standings, one pack goal bar, the derby winners and design awards, the
    reward tiers (name, reward, note, due date and sales target), and what a full progress bar
    means (the tier ladder). Each scout's standings row is exactly:
    - first name (plus a last initial only where two scouts share a first name) and den;
    - total raised (`combinedCents`);
    - the reward tier reached **by selling** (`tier` — a tier a family paid the difference
      for is not shown) and the next one (`nextTier`, `nextReward`);
    - what is left to sell for it, overall and at each commission rate (`nextSalesCents`,
      `nextRoutes`), and what reaching it takes off that family's bill (`nextUnlocksCents`);
    - the progress bar (`nextPct`, `pastPlan`, `nextRungPct`, `nextMarkPct`).

    With **Show dollar amounts and rank** off, a row is only first name, den, `tier`,
    `nextTier`, `nextReward`, and the bar — `nextPct` shown only as the bottom of a broad band
    between the tier held and the next one (at most four bands per gap, each at least 10% of the
    bar; one band where the gap is narrower), `pastPlan` and `nextMarkPct` — listed by name. Total
    raised, what is left to sell, the per-rate routes, what reaching the next tier is worth,
    `nextRungPct` and the ranking are all removed. Each tier's sales target still shows. The
    pack goal bar's amount raised is rounded to the nearest $50, and its percentage is worked
    out from that rounded figure.
- It **never** contains: the budget itself (starting balance, planned or actual totals,
  income, expenses), dues or who has paid, any family's charges, payments or balance, who
  paid their way up a reward tier, inventory (products, cases, prices, hand-outs), the
  leader roster (names, phones, emails, training dates, notes), children's last names,
  past-season archives, any campout's readiness checklist, any pack meeting's agenda (its
  sections, the Recognition list or the printed leaders' copy), the School Night checklist
  (`recruitKit`), the new-member tracker (`onboarding`, and when each scout joined —
  `addedYear`), the council's popcorn dates and what the pack owes the council
  (`popcornCouncil`), who counted and verified a storefront's cash, when each charge or the
  pack's dues fall due, any family's statement, whether each leader is registered, 21 or
  older or female (or the supervision check built from those answers), which scouts have
  photo permission on file, scout notes or den labels, RSVP/attendance detail, or the ledger in any raw
  form.
- Parents and pending users are **denied the ledger document outright** by the rules below,
  so this isn't a UI choice — the pack's finances never reach their browser at all.
- In the app, a parent gets a stripped-down view: **Schedule** and **Standings**, plus
  **Camping** and **New to the pack** when the pack has published them (a family opens on New
  to the pack until they have seen it once on that device).
  The Pack tab, Members card, Budget, Inventory, Scouts, Advancement and Derby tabs aren't
  rendered for them at all.

**Calendar-only mode.** If you'd rather not publish scout names and totals to a widely-shared
link, untick **Include scout standings in the parent view** in the *Parent sign-up link* card.
The standings, the goal bar, the derby winners, the reward-tier board and the names on storefront
shifts are then left out of `packs/{doc}/public/view` **entirely** — not merely hidden in the
UI — so no child is named anywhere in it, and the monthly digest leaves out its popcorn
section. Parents get the Schedule tab (the shift times still show, without names, and
**what a year costs** each den moves onto it, still with what each tier takes off it) and
the Camping and New to the pack tabs if you've written them. Tick it again and the next leader save republishes the rest. It's
on by default, so a pack that never touches this behaves exactly as before.

### 1. Enable Google sign-in in the Firebase console

1. **Build → Authentication → Sign-in method → Add new provider → Google → Enable → Save.**
2. Set a support email if prompted.
3. **Authentication → Settings → Authorized domains** — make sure every domain you serve the
   page from is listed. For pack569.com on Cloudflare Pages that's `pack569.com`,
   `www.pack569.com` and `pack569.pages.dev` (see
   [docs/cloudflare-setup.md](docs/cloudflare-setup.md)); `localhost` is already allowed for
   testing. A preview link on `pages.dev` is device-only and never signs in, so it needs no
   entry.

**Anonymous sign-in: on for passphrase mode, OFF once you're in single-pack mode.** In
passphrase mode the app signs devices in anonymously so leaders who haven't signed in with
Google still sync, so keep **Anonymous** enabled (Part A). Once `PACK_DOC_ID` is set (Part D —
this is how pack569.com runs), the app never signs anyone in anonymously and ignores a stale
anonymous session, so turn it **off**: **Authentication → Sign-in method → Anonymous →
Disable**. Nothing in the app needs it, and the rules only accept Google accounts as members.

### 2. Publish the accounts security rules

Replace the Part B rules with these in **Firestore Database → Rules → Publish**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /packmeta/{doc} {
      allow read: if request.auth != null;
      allow create: if request.auth != null
                    && request.auth.token.firebase.sign_in_provider == 'google.com'
                    && request.resource.data.owner == request.auth.uid
                    && request.resource.data.keys().hasOnly(['owner']);
      allow update, delete: if false;
    }
    match /packs/{doc} {
      function signedIn() { return request.auth != null; }
      // A Google account whose address Google has verified. An unverified email is only a
      // claim, and the rules match invites and member docs on it.
      function viaGoogle() {
        return request.auth.token.firebase.sign_in_provider == 'google.com'
          && request.auth.token.email_verified == true;
      }
      function memberPath() {
        return /databases/$(database)/documents/packs/$(doc)/members/$(request.auth.uid);
      }
      // A member doc only counts from a Google sign-in — never from an anonymous session that
      // happens to share a uid with one.
      function isMember() { return signedIn() && viaGoogle() && exists(memberPath()); }
      function myRole() { return isMember() ? get(memberPath()).data.role : 'none'; }
      function isLeader() { return myRole() in ['admin', 'editor', 'viewer']; }
      function isAdmin() { return myRole() == 'admin'; }
      function ownerUid() {
        return get(/databases/$(database)/documents/packmeta/$(doc)).data.owner;
      }
      // Invites are keyed by the LOWERCASED email; Google tokens can carry capitals.
      function myEmailKey() { return request.auth.token.email.lower(); }
      function invitePath() {
        return /databases/$(database)/documents/packs/$(doc)/invites/$(myEmailKey());
      }
      function invitedRole() { return get(invitePath()).data.role; }
      function joinPath() {
        return /databases/$(database)/documents/packs/$(doc)/public/join;
      }
      function joinCfg() { return get(joinPath()).data; }
      // Every field the app writes on a member doc. Anything else is refused, and the name
      // (shown to every leader in the Members card) is a short string.
      function memberKeysOk() {
        return request.resource.data.keys().hasOnly(['role', 'name', 'email', 'addedAt', 'joinCode'])
          && request.resource.data.name is string
          && request.resource.data.name.size() <= 120;
      }
      function ownEmail() { return request.resource.data.email == request.auth.token.email; }

      // Leaders only — parents and not-yet-approved users never receive the ledger.
      allow read:  if isLeader();
      allow write: if myRole() in ['admin', 'editor'];

      // The self-serve sign-up switch, holding the live join code. Leaders only: the code is
      // what makes the sign-up link a key, so it must not be readable by anyone who merely
      // knows the pack id. A link visitor never reads it — their member create below is
      // checked against it server-side.
      match /public/join {
        allow read:  if isLeader();
        allow write: if isAdmin();
      }
      // The sanitized parent view. Approved members only — never 'pending'.
      match /public/view {
        allow read:  if myRole() in ['admin', 'editor', 'viewer', 'parent'];
        allow write: if myRole() in ['admin', 'editor'];
      }
      match /members/{uid} {
        // Leaders see the roster of accounts; everyone else sees only their OWN record —
        // which a brand-new signer needs, to find out they don't have one yet.
        allow read: if isLeader() || (signedIn() && request.auth.uid == uid);
        // You may create only your own doc, signed in with Google, with your own email, and
        // only as: the pack owner (admin); exactly the role an admin invited you as; or
        // 'pending' through the sign-up link while it is switched on and the code is current.
        allow create: if signedIn() && request.auth.uid == uid && viaGoogle()
          && ownEmail() && memberKeysOk()
          && ( (ownerUid() == request.auth.uid && request.resource.data.role == 'admin')
               || ( exists(invitePath())
                    && invitedRole() in ['editor', 'viewer', 'parent']
                    && request.resource.data.role == invitedRole() )
               || ( request.resource.data.role == 'pending'
                    && exists(joinPath())
                    && joinCfg().open == true
                    && request.resource.data.joinCode == joinCfg().code ) );
        allow update, delete: if isAdmin();
        // Your own doc, written back with the same role.
        allow update: if signedIn() && request.auth.uid == uid
          && request.resource.data.role == resource.data.role
          && ownEmail() && memberKeysOk();
        // The pack owner can always restore their own admin role.
        allow update: if signedIn() && request.auth.uid == uid
          && ownerUid() == request.auth.uid
          && request.resource.data.role == 'admin'
          && ownEmail() && memberKeysOk();
      }
      match /invites/{email} {
        allow read: if isAdmin() || (signedIn() && myEmailKey() == email);
        allow create, update: if isAdmin()
          && request.resource.data.role in ['editor', 'viewer', 'parent']
          && request.resource.data.email == email
          && request.resource.data.keys().hasOnly(['role', 'email', 'invitedBy', 'invitedAt']);
        // An admin revokes; the invitee consumes their own on first sign-in.
        allow delete: if isAdmin() || (signedIn() && myEmailKey() == email);
      }
    }
  }
}
```

What these rules guarantee:

- **The first signer becomes admin.** `packmeta` can only be *created* (never updated or
  deleted), only by someone signed in with Google, and only by a user writing their own id
  as `owner`. Whoever creates it first wins and is the permanent owner/admin.
- **Nobody can put themselves in the Members card.** A user may create only their **own**
  member document, only while signed in with Google (with an address Google has verified),
  only with the email on their Google account, and only with the fields the app writes
  (`role`, `name`, `email`, `addedAt`, `joinCode`; the name a string of at most 120
  characters). The role has to be one of exactly three things: `admin` for the pack owner,
  *exactly* the role in an invite an admin wrote for their email, or `pending` through the
  sign-up link. There is no fourth way — in particular, knowing the pack id is not enough to
  join the approval queue. (Single-pack mode prints the pack id in the page, so it is not a
  secret.)
- **The self-serve link can only ever create a `pending` request — never access.** A link
  visitor may create their own member doc **only** when `packs/{doc}/public/join` says
  `open: true` and the `joinCode` they write matches the code in that document, and the rule
  pins the role to `'pending'` outright. So a link plus a Google account gets someone into
  the approval queue and nothing more: an admin still has to accept them and choose Editor,
  Viewer or Parent. There is deliberately **no** auto-approve path, in the app or the rules.
  Switching the link off, or rotating the code, makes every previously-shared link stop
  working immediately, because the server stops matching it.
- **The join code is readable by leaders only.** `public/join` holds the live code, and it is
  what makes the link a key. A visitor never reads it: their member create is checked against
  it on the server. So someone who has only the pack id cannot look the code up, and **New
  code** really does shut out a link that has escaped.
- **Invites are admin-made, and can't make an admin.** Only an `admin` creates, changes or
  revokes invites, and an invite's role must be `editor`, `viewer` or `parent`. Only admins can
  list invites; the invitee may read and delete (consume) **their own** — matched on their
  Google email, lowercased — and nobody else's.
- **Only leaders see who has an account.** The members list (names and emails of every
  leader, parent and pending request) is readable by `admin`, `editor` and `viewer`. A parent
  or a pending user can read their own member record and nothing else — which is all the app
  needs to tell them they've been approved.
- **Parents and pending users never receive the ledger.** `packs/{doc}` is readable only by
  `admin`, `editor` and `viewer`. This is the load-bearing line of the whole parent feature:
  the pack's budget, dues, inventory and leader contact details are not filtered out of their
  copy — their browser is never sent a copy at all.
- **The parent view is a separate, leader-written document.** `packs/{doc}/public/view` is
  readable by approved members (`admin`, `editor`, `viewer`, `parent` — **not** `pending`)
  and writable only by `admin`/`editor`. It's regenerated from the ledger by a leader's
  device, so a parent can never make it say something else.
- **View-only is real.** The ledger is writable only when your member role is `admin` or
  `editor`. A **viewer's, parent's or pending user's writes are rejected by the server** —
  the read-only UI is a courtesy; this rule is the actual enforcement.
- **Only admins manage members.** Changing another person's role or removing them requires
  an `admin` role. (Exceptions: writing your own doc back with the same role and your own
  email, and the pack owner always being able to restore their own `admin` role — so a rogue
  co-admin can't lock you out.)

> **Share the passphrase only with trusted leaders — and become admin first.** The `packmeta`
> ownership claim is permanent: whoever signs in first with a given passphrase becomes the
> admin forever, and it can't be transferred or reset (short of moving the pack to a new
> passphrase). So publish these rules, then **sign in yourself before handing the passphrase
> to anyone else.** Anyone who knows the passphrase and signs in before you could otherwise
> claim admin.

### Order of operations & the safe default

**Until you publish the Part C rules, everyone with the passphrase still edits — that's the
safe default.** The app is built so it never breaks while the console is half-configured:

- If Google sign-in isn't enabled yet, the **Sign in with Google** button just shows a
  "Google sign-in isn't enabled yet — see the SETUP guide" note and the app stays in
  anonymous/passphrase mode.
- If the Part C rules aren't published yet, the accounts reads are denied, the app treats
  accounts as "not set up" (the Members card shows a setup hint), **roles are not enforced,
  and everyone keeps editing** — exactly like Part B. *(This "keep editing" fallback is safe
  only because the passphrase is still secret. In single-pack mode — Part D — there is no
  secret left, so the same denial instead stops sync dead and shows the setup screen.)*
- Once you publish the Part C rules, anonymous (not-signed-in) users lose ledger access —
  that's the deliberate flip that turns roles on. From then on, every leader signs in with
  Google, the first becomes admin, and everyone else comes in by the sign-up link or an
  invite, to be approved as editors, viewers or parents.

**Already running an earlier version of the Part C rules?** Do it in this order:
**deploy this version of `index.html` first, reload it once, then publish these rules.**
The new page works under the old rules too; an old page does not work under the new rules
(a parent's old page asks for the whole members list, the new rules refuse it, and the old
page reads that refusal as "rules not published" — the setup screen). One difference you
may notice in the gap between the two steps: the new page never files a bare `pending`
request, so someone who signs in with neither the sign-up link nor an invite is told to ask
a leader, under the old rules as well as the new ones.

The 2026-09-27 block changes these things, all deliberate:

- A member doc can no longer be created as `pending` with nothing but the pack id — only
  through the sign-up link with its current code, an admin's invite, or the owner claim.
  Anyone already pending, approved or invited is untouched. **New leaders now come in by
  the sign-up link or an invite**, the same as families.
- Member docs must be created from a Google sign-in, carry the account's own email, and hold
  only the fields the app writes.
- Only admins can create, change or revoke invites, and an invite can't grant `admin`. An
  invitee can read and consume only their own invite.
- The members list is readable by leaders only; parents and pending users see their own
  record. The parent view is no longer readable by `pending` users. The join code is
  readable by leaders only, so a rotated code actually stops a leaked link.
- Membership counts only from a Google sign-in whose email Google has verified. An
  ordinary Gmail or Google Workspace account always is.

**Then clean up what the old rules let in.** The new rules stop new ways in; they don't
remove anyone who already used one. Once they are published, the owner should:

1. **Pack tab → Members:** remove any **admin, editor or viewer** you didn't approve yourself.
2. Still in Members: remove any **pending** request you don't recognise, and any with **no
   email**.
3. **Firebase console → Firestore Database → Data → `packs` → your pack id → `invites`:**
   delete any invite whose `role` is `admin`. (The app never writes one; the old rules let
   anybody who knew an email address write one.)
4. **Firebase console → Authentication → Users:** delete the **anonymous** users (the ones
   with no email, shown as "Anonymous" in the Providers column). Single-pack mode never uses
   them, and the new rules give them nothing.

Earlier still, re-publishing changed three things: (1) `pending` members lose ledger access and now see a
"waiting for approval" screen with no pack content until an admin approves them, (2) the
`public/` and `invites/` subcollections start working, and (3) the self-serve sign-up link
becomes available (it stays **off** until an admin turns it on). Nothing else moves — existing
admins, editors, viewers and parents are untouched.

**The parent view appears on its own.** The first time a leader opens the app after the
rules are published, their device publishes `packs/{doc}/public/view`, and it's refreshed
after every save from then on. If parents report an empty screen, have a leader open the
page once. (If *no* leader has the app open, nothing regenerates — that's by design: only
`admin`/`editor` may write it.)

### Shift reports

*Server only.* This needs `BACKEND = 'api'`. Firestore has no shift reports, and the rules
block above says nothing about them. The server enforces these rules in
`functions/_lib/rules.js` and `functions/api/pack/[id]/shift-reports/`.

At the end of a storefront shift, a family enters the shift's two totals, the **Trail's End
amount** and the **cash donations**, and ticks a box to sign that they counted them. A leader
then accepts the report as the **second sign-off**, and only then do the figures reach the
block and the standings. Reports are kept in their own table (`shift_reports`), never in the
pack record, so a parent who can send one still can't write anything else.

- **Who can send one:** any approved member, so `admin`, `editor`, `viewer` or `parent`.
  `pending` members and accounts with no membership cannot. The server records the sender's
  name, account and time from their member record. The page never sends them. A leader sends
  one the same way a family does, through the API. The parent preview a leader opens on the
  Pack tab only shows where reports stand; nothing can be sent from it.
- **How many:** one account can have at most **3 reports waiting** at once, and send at most
  **20 in a day**.
- **Which shift:** only a shift the pack has published in the **parent view** (the storefront's
  id and the block's id, as `buildParentView` wrote them). The storefront must be dated
  **today or up to 14 days ago**, in the pack's time zone (Eastern). Nobody can report a shift
  that is in the future, too old, or not published.
- **The figures:** whole cents, from $0 to **$10,000** each, plus an optional note of at most
  **300 characters**. The signature box must be ticked.
- **Cash from popcorn sales not converted** (S-5, Keith 2026-10-01): an optional third figure,
  for the whole shift. Pack policy is that families convert all cash from popcorn sales to
  credit in the Trail's End app before they leave the table, so it should be $0. If it isn't,
  the report says how much wasn't converted, the note says who has it, and that cash goes to
  the leader collecting the money. It follows the same rules as the
  other two figures (whole cents, $0 to $10,000), it defaults to $0 when left out, and it can't
  be more than the Trail's End amount, because those sales are already part of it. For the same
  reason it is **never added** to the block's sales or to any scout's standings. A second
  parent's confirmation and a leader's accept must name it, like the other two figures. It is
  never published to parents; another family sees it only in the one exception under *Who sees
  what* below.
- **What became of that cash** (treasurer and security review, followups round 1): only an
  `admin` or `editor`, and only on a report that has some and was **accepted** (it may have
  been sent back since), records on the server that they **collected** it, or that the family
  **converted** it to credit after all. On a report sent back after it was accepted, they can
  instead mark it **the same cash as the new report** (`replaced`), so a corrected report's
  figure isn't counted twice. They can undo any of these. The record names the amount it is about and is refused if the report has moved
  since. It keeps who recorded it and when, from their member record and the server's clock.
  Each change is audited (`shift.salescash.collected`, `.converted`, `.replaced`, `.undo`), and leaders see
  it in the season's shift-report history.
- **One at a time:** each block can have only one report that is waiting or accepted. A
  second report for the same block is refused until a leader sends the first one back or its
  sender withdraws it.
- **Changing a report:** only the sender can edit or withdraw it, and only while it is waiting.
  An edit has to be signed again.
- **Accepting or sending back:** only `admin` and `editor`. The leader who accepts must be a
  **different adult** from the one who sent it, and from the parent who confirmed it. The
  server refuses a leader accepting a report they sent or confirmed, just as the cash box
  refuses the same person as counter and verifier. A leader can send back a waiting or an
  accepted report, and must give a reason. The family then sends a corrected report as a new
  one.
- **A different family from the sender** (Keith, 2026-10-01): the accepting leader must not be
  in the sender's family. The server works out each account's families from the stored pack
  record: the families of the scouts an admin has linked that account to on the Members card,
  with brothers and sisters as one family. If the leader and the sender share one, the plain
  accept and "I collected and counted this cash" are refused. The only way left is to accept
  with a written reason, which is audited as an override, and the block says "accepted by
  ‹leader› (same family as the sender)". If either account is linked to no scout, the accept
  works as before. If the pack record exists but can't be read, the server treats it as the
  same family, so only an accept with a reason gets through. The same rule applies to recording
  what became of a report's cash from popcorn sales, which is never the sender, nor the parent
  who confirmed it, either; anyone may undo that record. The rule reads links between people, never pack jobs.
- **Who verified the cash** (Keith, review round 1). Every accepted report names who did:
  - **Two or more families on the shift:** the parent from the other family who confirmed it.
    The accepting leader is recorded as the approver.
  - **One family:** the accepting leader, who collected and counted the cash at the end of the
    storefront. Their button says so: "I collected and counted this cash — accept".
  - **Anyone else:** a leader who didn't collect it, or a two-family shift with only one
    parent's signature, accepts with a written reason. That is an override, audited as
    `shift.accept.override`, and nobody is named as verifier, so the block's cash-count
    warning stays until someone checks it.
  - The accept is recorded once (who, when, the reason, and whether they collected it), and
    a later send-back doesn't change that record.
- **A second parent, when a shift has two or more families** (Keith, 2026-10-01): if the
  scouts on a shift come from two or more families (brothers and sisters count as one), a
  second parent has to confirm the report before a leader accepts it.
  - The parent view publishes the number of families on each shift. It is only a number, and
    it is published in calendar-only mode too. The server reads it from the stored view when
    the report is sent, never from the report itself. If a view has no number (published
    before this change), the report needs a second parent anyway.
  - Only a **parent from another family on that shift** can confirm: an account an admin has
    linked on the Members card to a scout on the shift whose family is not the sender's. A
    spouse, or a second account of the sender's family, can't confirm. If the sender isn't
    linked to any scout, nobody can confirm, and a leader accepts it with a written reason (or
    links the sender on the Members card first). The server checks this against the
    stored pack record. It is never the sender, never `pending`, and never an account that
    isn't linked. If the record, the storefront or the block can't be found, nobody can confirm.
  - A confirm names the figures it was shown. If the sender has changed them since, it is
    refused. It works only while the shift is still published and within the same 14 days.
  - If the sender edits the report, the confirmation is cleared.
  - An admin or editor can accept a report that has no second signature, but only with a
    written reason (see *Who verified the cash* above).
  - On the block, the sender is "Cash counted by" and the confirming parent is "Verified by".
    The accepting leader is shown as the approver.
- **Who sees what:** leaders (`admin`, `editor`, `viewer`) see every report in full, going back
  400 days, plus any still waiting. A parent sees their own reports, the first name of the
  leader who reviewed them and of the parent who confirmed them, and a leader's note only when
  it is the reason the report was sent back. For anyone
  else's report, a parent sees only that the block has a report and whether it is waiting,
  accepted, sent back or withdrawn. They never see another family's amounts, name or note,
  with **one exception**: a report still waiting for a second parent, on a shift from the last
  14 days, shows its amounts (all three), its note and the sender's first name to the parents who are
  allowed to confirm it, and to no one else. They can't confirm figures they can't see. No
  account ids or links are ever sent.
- **Your family's shifts** (Keith, 2026-10-01): the list also tells each account which
  published shifts from the last 14 days have one of **their own** scouts on them (a scout an
  admin has linked to that account on the Members card; a parent linked family-wide gets each
  child's shifts), and whether the account is linked to any scout at all. The server works
  this out from the stored pack record and sends **only the storefront and block ids** the
  parent view already publishes, and a yes/no, never a scout, a name or a link. If the record
  can't be read, the list is empty and the account counts as unlinked.
  - The family's *Storefront shift totals* card lists **only** those shifts, marked "Your
    family's shift". It also always lists a shift whose totals the account may confirm, and
    one it has sent totals for. "Worked a different shift? Show all shifts" shows the rest.
  - An account linked to no scout sees every shift, with a line asking a leader to link it.
- **The parent preview is the leader's own parent self** (Keith, 2026-10-01): the preview asks
  for `GET …/shift-reports?as=parent`, which any approved role may ask. It answers exactly what
  a parent with that account would get, and never a leader-only field. From the preview, a
  leader who is also a parent can send, change, withdraw and confirm their own family's
  totals, as that parent. Everything else in the preview stays read-only. The rules above are
  unchanged, so the same leader still can't accept their own report, or record its cash.
- Every report, edit, withdrawal, acceptance, send-back and record of the cash from sales is written to the `audit` table
  in the same step as the change itself.

### The sign-up link — the recommended way

One link for **everyone**, leaders and families alike. Use it when you don't know (or don't
want to collect) every email address. Nobody sees the passphrase, so it stays a leaders-only
secret.

1. Pack tab → **Parent sign-up link** (admins only).
2. Tick **Let people request access with a link**.
3. Copy the link and send it out.

**The link never grants access by itself.** Whoever opens it signs in with Google, lands on a
"waiting for approval" screen with no pack content at all, and appears as `pending` in your
Members card. You then accept them as **Editor**, **Viewer** or **Parent** (or ignore them) —
so the same link works to onboard a new den leader and a new family; you decide which they
are at the moment you accept. This is enforced by the security rules, not just the interface:
there is no auto-approve mode in the app *or* the rules.
4. **Copy link** and post it wherever your families already are — group chat, pack email,
   a QR code on a flyer. It looks like
   `https://…/pack569/?pack=<pack id>&join=<code>` — or, in single-pack mode (Part D), just
   `https://…/pack569/?join=<code>`, because the page already knows which pack it is.
5. If the link gets forwarded somewhere you didn't intend, tap **New code** (two taps to
   confirm). A fresh code is written and **every previously-shared link stops working
   immediately** — including for people who haven't opened theirs yet. Anyone who *already*
   joined keeps their access; re-share the new link with everyone else.

What the visitor experiences: the page opens on a small welcome screen with the pack's fleur
mark, one line about what they'll get, and a **Sign in with Google** button. The `pack` and
`join` parameters are copied into that browser's own storage and then **stripped from the
address bar**, so the code isn't left sitting in a screenshot or a shared tab. A refresh or a
return visit still works — the browser remembers the pack it joined.

> **Anyone you approve as a parent from this link can see the pack calendar and scout
> standings** — first names, dens, totals — **including which store the pack will be at and
> when, and which children are on each shift.** Approve only people you recognise, and treat
> what parents see as widely shared. If that's more than you want to publish, untick *Include scout standings in the
> parent view* for a calendar-only page, and rotate the code whenever the audience changes.

A leader's own device is completely unaffected by any of this: if a passphrase is set, a
stray `?pack=…` parameter is ignored outright — the passphrase always decides which pack that
device is on. In single-pack mode the baked-in `PACK_DOC_ID` decides, and a `?pack=…`
parameter is ignored on *every* device (and scrubbed from the address bar), so a forwarded
link from some other pack can never re-point the page.

### Inviting one specific parent by email

1. Members card → **Invite someone** → their email → role **parent** → *Send invite*.
2. Send them the page link. If you have the sign-up link turned on — or you're in single-pack
   mode — send **that** URL and they never need a passphrase; in passphrase mode without the
   sign-up link, you'd have to send the plain page URL plus the passphrase.
3. They tap **Sign in with Google** with that address and land on a two-tab, view-only
   Schedule + Standings screen. They never see the money.

> **If a parent has to type the passphrase** (i.e. you're not using the sign-up link), it is
> no longer a secret shared only among leaders — so **don't revert to the Part B rules once
> parents have it**, because under Part B anyone holding the passphrase can edit the whole
> ledger again. If you ever need to go back, change the passphrase first (Pack tab → Shared
> sync) and re-share the new one with leaders only. The sign-up link avoids this problem
> entirely, which is why it's the recommended route.

To turn accounts **off** again, re-publish the Part B rules; the app falls back to
"anyone with the passphrase edits" with no code changes. Turn the sign-up link toggle **off**
first, and read the passphrase warning above if parents already know it. **If you're in
single-pack mode (Part D), set `PACK_DOC_ID` back to `null` and redeploy *before* you touch
the rules** — otherwise you'd be publishing the pack id under Part B rules, which is exactly
the combination that exposes the ledger. (The app will refuse to sync and show the setup
screen rather than let that happen, but don't rely on it: put the constant back first.)

---

## Part D — Single-pack mode: retire the passphrase (recommended)

Once Part C is live, the passphrase isn't protecting anything any more — Google sign-in plus
the admin's approval is what decides who gets in. It's just one more thing to explain, mistype
and leak. Part D removes it entirely: you bake this pack's document id into the page, and from
then on **nobody ever types a passphrase**. A leader opens the sign-up link (or you invite
them), taps *Sign in with Google*, and waits for you to approve them in the Members card.

> **Publish the Part C rules first. This step makes your pack's document id public.**
> Under the Part B rules the id *is* the password. Read *Do it in this order* at the top of
> this guide before you continue.

> **One thing the app can't detect for you: Firestore "test mode" rules.** The safety gate
> works by noticing that the accounts reads were *denied*. Rules that allow everything
> (`allow read, write: if true`, which is what "Start in test mode" publishes, and what
> expires after 30 days) deny nothing, so the app can't tell them apart from the real Part C
> rules — and with a public pack id those rules mean anyone can read and edit your pack.
> Before Part D, open **Firestore Database → Rules** and confirm the text there is the Part C
> block, character for character.

### 1. Claim admin (if you haven't already)

Open the page with the passphrase set, tap **Sign in with Google**, and confirm the Pack tab →
**Members** card shows you as `admin`. Whoever signs in first becomes the permanent owner, so
do this before handing the passphrase (or the page) to anyone else.

### 2. Copy the Pack ID

Pack tab → **Shared sync** → **Pack ID**. It's a 64-character hex string, with a **Copy**
button next to it. Only a signed-in **admin** sees this line — which is the point: the id is
the SHA-256 of the passphrase, so only a device that already knows the passphrase can compute
it, and only the admin is shown it.

### 3. Paste it into `index.html`

Near the top of the `<script>`, just below `FIREBASE_CONFIG`:

```js
var PACK_DOC_ID = null;                 // before
var PACK_DOC_ID = '3f8a…64 hex chars';  // after
```

Redeploy the page. On Cloudflare Pages that means committing to `main`, then **Actions →
website → Run workflow** from `main` with `production`, and approving it
([docs/cloudflare-setup.md](docs/cloudflare-setup.md)); pushing alone changes nothing live.
(While the site is still on GitHub Pages, the push to `main` is the deploy.) That's the whole
change.

Just below it, `PACK_PUBLIC_NAME` is what the sign-in screen calls the pack before anyone
signs in (it can't read the pack's own name until then). It ships as `'Cub Scout Pack 569'`;
a different pack running this file should change it to its own public name.

If the value isn't a 64-character lowercase hex string, the app ignores it completely, logs a
one-line warning to the browser console, and stays in passphrase mode — it never half-applies
a bad id and lands you on the wrong pack.

### 4. What changes

- **The passphrase field is gone** from the Pack tab. So is every mention of typing one.
- **Everyone signs in with Google.** Signed-out visitors get the welcome screen with a single
  *Sign in with Google* button. Someone who arrived on the sign-up link lands as `pending` and
  waits for an admin; someone invited lands straight in their role; anyone else is told to
  ask a pack leader for the link, and nothing is created for them.
- **The sign-up link loses its `?pack=` parameter** — it's now just
  `https://…/pack569/?join=<code>`. The code, rotation and the standings toggle all work
  exactly as before, and it still only ever creates a `pending` request. Old two-parameter
  links still work.
- **The pack id wins over everything.** A leftover passphrase in some leader's browser, or a
  forwarded `?pack=…` link from another pack, changes nothing: the page is pinned to this pack.
- **No anonymous sessions.** In passphrase mode the app signs everyone in anonymously; in
  single-pack mode it never does, and it ignores a stale anonymous session left over from
  before the switch. An anonymous visitor has no member document, so the Part C rules would
  deny them anyway — this just means they never even ask. Now turn **Anonymous** off in the
  Firebase console (Authentication → Sign-in method) — see Part C step 1.
- **Everything else is untouched:** the ledger format, `localStorage`, device-only mode,
  roles, invites, the parent view, backups.

### 5. If something's wrong

| What you see | What it means |
|---|---|
| "This pack needs its security rules published before it can sync — see SETUP.md Part C" | `PACK_DOC_ID` is set but the Part C rules aren't published (or aren't published *correctly*). The app is refusing to sync **on purpose** and is device-only until you fix it. Publish the rules from Part C, then reload. |
| The welcome / sign-in screen when you expected the app | You're signed out. Single-pack mode has no anonymous fallback — sign in with Google. |
| "Waiting for approval" | You signed in but no admin has approved you yet. |
| "Ask a pack leader to let you in" | You signed in with neither the sign-up link nor an invite, so the rules won't let the app add you. Get the current link (or an invite for this Google account) from an admin and open it on this device. |
| Console warning about `PACK_DOC_ID` | The value isn't a valid 64-hex id; the app fell back to passphrase mode. Re-copy it from the Pack tab. |
| **"Offline — (Missing or insufficient permissions.)" plus "Accounts aren't fully set up", while signed in with Google** | Your rules are missing `\|\| request.auth.uid == uid` on the members **read** (see Part C). Without it, a brand-new signer can't read their own membership record to discover they don't have one yet, so they can never create it — and with no member record the ledger is denied too. Re-publish the Part C rules exactly as written and reload. |

To go back to passphrase mode, set `PACK_DOC_ID = null`, redeploy, and type the passphrase on
each leader's device again. Nothing in the cloud has to change — it's the same pack, the same
document, the same members.

---

## If a page stays "out of date" after a reload (the reload gate)

**Download or copy each device's stored record before changing `fmt`** (step 1 below). Then fix
the pack's copy, then each device, then reload.

Every pack record carries a format number, `fmt`. The page knows its own
(`var PACK_FORMAT` in `index.html`). A page that meets a record with a **higher** `fmt` (in the
pack's shared copy, or in its own browser's storage, written by a newer page in another tab)
stops: it saves nothing, sends nothing, publishes nothing to parents, refuses every edit, and
shows "This page is out of date … Reload the page before you change anything else." Normally a reload loads the
newer page and that is the end of it.

If a reload does **not** clear it, the record's `fmt` is higher than any page you serve. That
happens in two ways:

- **The page was rolled back** past the change that raised `PACK_FORMAT`. The pack's copy, and
  every browser that opened the newer page, now hold the newer format. The better fix is almost
  always to deploy the newer page again (or a fix on top of it). Only lower `fmt` by hand if you
  know the older page reads that record correctly: the change that raised `PACK_FORMAT` says what
  an older page gets wrong.
- **Someone saved a bad `fmt`** (a hand-edited record, or an editor's device writing
  `"fmt":999`). Nothing in the app can undo it, because every push, copy and import is refused
  over it. Lowering it by hand is the fix.

Nothing is lost while the page holds: each device keeps its own copy. The steps below are the
only way out, and they are done by the owner.

Steps 1 and 4 use the browser's developer console, so they need a **desktop browser** (Chrome,
Edge, Firefox or Safari on a computer). An **iPhone or iPad** has no console of its own: it needs
a Mac, with Safari's Web Inspector connected to the device by cable, and on the iPhone or iPad
**Settings → Safari → Advanced → Web Inspector** turned on. **Don't clear the site's data**
(or "website data", or the browser's history and site data) to get past the hold: that throws
away that device's copy for good, and with it anything that was only on that device.

### 1. First, download or copy each device's stored record before changing `fmt`

On **every** leader device that has used the page, before you touch the pack's copy:

- Open the page. If **Pack → Backup (JSON)** downloads a file, keep it. (It works while the hold
  comes from the pack's copy.)
- If it says "Backup not downloaded", this device's own stored copy is the newer record. Open the
  browser's developer console on the page (a desktop browser, or a Mac for an iPhone or iPad: see
  above) and run
  `copy(localStorage.getItem('pack-popcorn-ledger-v1'))`, then paste into a text file and keep it.

These files hold children's names and the pack's money. Keep them private: never in the repo,
an issue, or a chat.

### 2. See what `fmt` the pack's copy has

The number to compare with is `PACK_FORMAT` in the `index.html` you serve.

- **Firestore** (`BACKEND = 'firestore'`): Firebase console → **Firestore Database** → **Data** →
  `packs` → the Pack ID document → the `json` field. It is one long line of text. The record's
  own `fmt` is the top-level `"fmt":N` (usually near the end). A `"fmt"` inside a note or a
  nested object is not it.
- **D1** (`BACKEND = 'api'`):
  `npx wrangler d1 execute pack569-prod --remote --env production --command "SELECT rev, json_extract(json, '$.fmt') AS fmt FROM pack_state WHERE pack_id = '<Pack ID>'"`
  (for staging and preview: `pack569-preview`, without `--env production`). `<Pack ID>` is the
  pack's id: `var PACK_DOC_ID` in the `index.html` you serve (before single-pack mode, the Pack tab
  → **Shared sync** → **Pack ID**). Always keep the `WHERE`: the table can hold more than one pack.

### 3. Set `fmt` back to the page's `PACK_FORMAT`

Change only `fmt`. Leave `rev` and everything else as it is.

- **Firestore:** in the console, edit the `json` field. Copy its value into a text editor, change
  the top-level `"fmt":N` to the served page's `PACK_FORMAT` (e.g. `"fmt":4`), check the rest of
  the text is untouched, paste it back, and **Update**.
- **D1:**
  `npx wrangler d1 execute pack569-prod --remote --env production --command "UPDATE pack_state SET json = json_set(json, '$.fmt', 4) WHERE pack_id = '<Pack ID>'"`
  (with `4` being the served page's `PACK_FORMAT`, and `<Pack ID>` as in step 2). Without the
  `WHERE` it would rewrite every pack in the database. Run the `SELECT` from step 2 again to check.
  If the change goes wrong, D1's Time Travel can put the database back to before it
  ([docs/cloudflare-setup.md](docs/cloudflare-setup.md), *Backups*).

### 4. Fix each device whose own copy is the newer record

This is needed only after a rollback, and only on the devices where Backup (JSON) said "Backup
not downloaded" in step 1. Such a device holds on its own stored copy, whatever the pack's copy
says.

Do this **in the same browser app on that device** that holds the copy: each browser keeps its
own stored copy, so a console opened on the page in another browser, or on another device,
changes a different copy and leaves the held one as it was. (On an iPhone or iPad, point the
Mac's Web Inspector at the page as it is open in that browser app on that iPhone or iPad.)

**First close every other tab or window of the page on that device**, so only one is open. A
newer page still open in another tab saves its `fmt` back over the fix. Then, in the browser's
developer console on the page (a desktop browser, or a Mac for an iPhone or iPad), run:

```js
var k = 'pack-popcorn-ledger-v1', r = JSON.parse(localStorage.getItem(k)); r.fmt = 4; localStorage.setItem(k, JSON.stringify(r)); location.reload();
```

(with `4` being the served page's `PACK_FORMAT`). The key is fixed and must never change: it is
where every device's copy lives.

### 5. Reload every device

Each device then compares its copy with the pack's. Where they differ, the leader is asked
which copy to keep, and the chooser lists what is only on that device. If anything is missing
afterwards, it is in the files from step 1: **Pack → Import backup** one of them on a device, check
it, and let it sync.
