# Adventure lesson plans for den leaders (queued)

## Context
Den leaders plan their meetings in **Program → Den plans**, but the app only knows adventure *names* (`ADVENTURES`, index.html:7567). It has no activity ideas, supply lists or meeting outlines. Keith wants researched, meeting-by-meeting lesson plans for each adventure, so leaders have ready ideas and plans for den meetings.

**Timing:** this is queued. It starts only after the current database work (Cloudflare Phase 3: C5–C9, the server tables, the backend switch) and the other planned updates have landed on main. Right now the only step is to record it in memory so a later session picks it up.

**Keith's decisions (2026-09-29)**
- **Depth:** meeting by meeting. Each adventure gets 2–4 meetings. Each meeting has a gathering activity, an opening, 2–3 activities tied to the requirements, a closing, a supply list and prep notes, plus links to the official scouting.org pages.
- **Scope:** the 36 required adventures (6 per rank) first. Electives follow in a second pass, starting with the ones every rank shares: Race Time, Champions for Nature, Let's Camp!, Archery, BB Gun, Slingshot and Summertime Fun. That is about 148 adventures in all.
- **Editing (changed 2026-09-30):** the researched plans are the starting version, **not written in stone. Admins can edit any plan in the app** (see §3a). Each den leader can still add their own notes per adventure; the notes save with the pack record and carry over from year to year.
- **Visibility:** leaders only. The parent view stays unchanged.

**Update 2026-09-29: the plans become runnable meeting guides.** Keith pointed to his "Bobcat Night: Wolves & Bears" page (https://claude.ai/artifact/TnfxEbQRSRM4LzUcZLQp2E) as the model.
- **Where:** each plan meeting becomes a **"Run this meeting"** screen inside the app, for leaders only. It opens from Den plans or from a den meeting on the calendar.
- **What the screen has:**
  - A short line at the top, the same on the plan panel: "A guide, not the rulebook. The official requirements and the Guide to Safe Scouting come first; check with your Cubmaster." (Keith, 2026-09-30: the plans are a guide for den leaders, not a complete or official source.)
  - A meeting timer (Start, Next step, Skip), where a skipped step's minutes come off the total.
  - Numbered steps that open and close. Each step has its minutes, requirement chips per den, a **Say** box, how-to bullets and a tip.
  - A supplies list, and a "Tell parents before they leave" box.
  - Reference tabs: Oath & Law with tap-to-explain points, sign/salute/handshake, and later the Outdoor Code and Six Essentials.
- **All-dens nights:** a den switch shows Both dens or one den. The closing is shared. Den time becomes a **breakout** with each den's own rank activity for the same category, using the app's existing `denAdvAt` model.
- **Progress:** the guide does **not** tick individual requirements (Keith's decision). At the end, a "Record in Advancement" button goes to the existing adventure board. The DESIGN-adventures.md §7 rule ("no requirement-level tracking") stands.
- **Research format changes to timed steps:**
  - Each step has `title, mins, reqs, say, how[], tip, home?`, and each meeting totals about 60 minutes.
  - The Wolf draft (`~/.claude/plans/pack569-lesson-plans/wolf.md`) gets converted to this format.
- **Meeting length (Keith, 2026-09-29):**
  - The pack does the opening ceremony together, then dens split for about **40 minutes of den time**.
  - The guides have **no gathering or opening steps**, only den activities plus a short den closing that totals about 40 minutes.
  - Anything the pack opening covers, like saying the Oath and Law, is noted as "done at the pack opening" instead of getting a step.
  - Adventures that no longer fit get an extra meeting.
  - The Both-dens switch still helps a leader who runs two dens.
- **Night shape (Keith, 2026-09-29):**
  - Parents pick up from each den.
  - Dens stand together at the pack opening, so the Oath and Law said there counts. A meeting shows a "Done at the pack opening" line for it, which needs its own field.
  - Dens take turns leading the opening flag ceremony.
  - Running With the Pack keeps 3 meetings.
- **Step data (from the Wolf drafts):**
  - Kinds are `den` and `closing` only.
  - A step can list requirements it completes and others it only sets up, like "3; 1 (set-up)".
  - An outing sets its own length.
- **Leader's-choice options (Keith, 2026-09-30):**
  - Where Keith leaves a choice to the den leader, the meeting offers **Option A / Option B**, for example a parents-invited night or home, or photo cards or real sealed products.
  - The data carries these as `choices`, `forOptions`/`variants` and step-level `options` (see §2).
  - The Run screen lets the leader pick one before starting the timer, so the minutes add up for the option chosen.
- **Pack-wide guest speaker:** requirements such as meeting an elected official can be done at the pack's yearly guest speaker night. That is a "done at a pack meeting" line, like "Done at the pack opening".
- **Credit from events, not den runs (found during the electives research):** some requirements are done at pack or council events rather than den meetings:
  - Race Time: the pack derby
  - Champions for Nature: cleanups and pack-meeting drives
  - Let's Camp!: pack campouts
  - Summertime Fun: any 3 den, pack or council activities from May to August
  - the range sports: council ranges only

  The build needs a way for the Advancement board to show these as "done at <event>" lines. The DESIGN-adventures.md run model doesn't cover them.
- **Summertime Fun crosses the year boundary.** It belongs to the rank the scout is moving into, but `advanceDens()` (~index.html:24771) deletes `state.advancement[s.id]` on move-up. Anything recorded before the move is lost. The build must record it after the move, or keep it through the move.
- **Range electives are never on den nights (Keith, 2026-09-30):**
  - Add `RANGE_ELECTIVES`. Filter Archery, BB Guns and Slingshot out of `packAdvChoices()` (~7645) and the den-meeting adventure picker.
  - An old record that has one should say "Council range only: not a den activity."
  - Rename "BB Gun" to "BB Guns" to match the official name, with an `ADV_RENAMES` entry.
- **Scope (Keith, 2026-09-30):**
  - The content is the 36 required adventures plus the shared electives: Race Time, Champions for Nature, Let's Camp!, Summertime Fun, Archery/BB Gun/Slingshot, cycling, fishing and swimming.
  - **No rank-only electives.** In the app, an adventure without a plan shows only its official scouting.org link.
- **Dates stay blank until known (Keith, 2026-09-30):**
  - Guides use "[date]" for pack-specific dates: card night, crossover, derby, guest speakers and campouts. They're filled in later.
  - In the app, a guide should show the matching calendar event's date when one exists, and otherwise "date not set".
- **Timer state is only on this device.** The current step lives in ui state or localStorage, not in the pack record.

## Approach

### 1. Research and writing (one rank at a time, one agent at a time)
- For each rank, a `cubmaster-program` agent reads that rank's scouting.org adventure pages, where the requirements and den meeting resources are. It cross-checks them against council and pack sources, then **writes original plans**.
- **Copyright rule:** Scouting America's Den Leader Guides and requirement text are copyrighted.
  - Don't copy them. Summarize each requirement in a few words, write the activities fresh, and link to the official page for the full text.
  - Every plan records its `sources` URLs and a `verified` date.
- **Safety pass:** check each rank's drafts against the Guide to Safe Scouting and Youth Protection before building. The `outdoor-camping-chair` covers outings, knives, fire and water. The `youth-protection-brand-reviewer` covers two-deep leadership, photos and use of the name and logo.
  - Range electives (archery, BB gun, slingshot) must say "council-run range / trained range officer only".
- Drafts are reviewed as Markdown in the scratchpad before any code is written. Keith can skim one rank's drafts before the rest are written.

### 2. Data: `plans.json`, built from the markdown and fetched on demand
**Changed (Keith, 2026-09-30):** the plans are about 1.1 MB of text and the page is already 2.2 MB, so they are NOT an inline constant. Built in commit 670485c.
- **Source:** the markdown in `docs/lesson-plans/` stays the only place plans are edited. `scripts/lesson-plans.mjs` parses it; `scripts/build-site.mjs` writes `plans.json` next to `index.html` and `_headers` (the site is now those three files), and `--verify` checks it byte for byte.
  - The parser reads `ADVENTURES` out of index.html and refuses any plan key not in it. `NAME_FIXES` maps markdown spellings to the app's (e.g. "Pedal With the Pack"); a harness test fails if a mapping goes stale once the renames land.
  - It publishes only the `## Name (Rank)` sections, never a file's intro or open-questions notes. It stops with `file:line` on anything it can't read, a den meeting over 40 minutes, control characters or HTML-like `<`.
- **CSP:** connect-src now includes `'self'` for both backends and the preview.
- **Page:** `loadAdventurePlans()` fetches the file once (same-origin), caches it, and on failure shows "The lesson plans couldn't be loaded…" and waits 60 s before trying again. **Plans arrive asynchronously, so every screen that shows them needs a loading state and a failed state.**
- **Shape:** `{ format: 1, guide, plans: { 'Wolf :: Bobcat': plan } }`, keyed with the run-key separator `den + ' :: ' + adventure`.
  - Plan: `den, adventure, heading, category, official, verified, sources[], summary, reqs[{n,text,where}], safety[], done?[], choices?[], notes?[], meetings[]`.
  - Meeting: `n, of, title, kind: 'den'|'outing'|'add-on', mins, forOptions?, prep, supplies (text), tellParents, done?, choices?, variants?, steps[], stepMins`. The timer uses `stepMins` (a header can say 40 when the steps add up to less).
  - Step: `n, title, kind: 'den'|'closing', mins, reqs, done[], setup[], say, sayTo?, how[{n,text}], tip, home[], options?, forOptions?`. There are no gathering or opening kinds.
  - **Options** show up three ways: a leader's-choice line on the plan or meeting (`choices`), a meeting that belongs to one option (`forOptions`, with `variants` for the other), or two ways inside one step's How (`options`).
  - Text keeps `**bold**` as markdown and contains no HTML. The UI must escape everything and convert only `**…**`.
- Each rank's section of a shared elective is parsed as written. There's no shared-text helper.
- **Size:** about 1.07 MB (93 plans, 191 meetings, 897 steps). `PLANS_MAX_BYTES` caps it at 1.34 MB in both the build and the harness.
- `normalizeState` and the state loader never read plans; a harness test checks it.

### 3. Leader notes: `state.advNotes`
- **Shape:** `{ 'Wolf :: Council Fire': { text, by, at } }`. It is normalized in `normalizeState` (near the event normalisation at ~4149–4177) and stays in the pack record.
  - Follow whatever the Phase 3 reload gate and version rules require for a new field at that point.
- **Who can edit:** editors and admins. Viewers can read.
- **Not published to parents:** `buildParentView` is an allowlist, so the notes stay out automatically. The security review (2026-09-30, Med) asks for more, **in the same commit that adds `advNotes`**:
  - Add `'advNotes'` (and `'advPlanEdits'`, §3a) to `PARENT_VIEW_NEVER_KEYS` in `functions/_lib/rules.js` (~132), the server-side filter.
  - Extend the existing `noteInternal` tests to cover them.
  - Add a runtime canary: put a unique string in `state.advNotes[...]`, in `state.advPlanEdits[...]` and in a meeting, then assert it's absent from `buildParentView(...)`, `monthlyDigest(...)`, `buildICS()` and `parentEventICS(...)`.

### 3a. Admin edits to the plans: `state.advPlanEdits` (Keith, 2026-09-30)
- **Plans aren't written in stone.** Admins can change anything in a plan: text, minutes, requirements, supplies, prep, parent notes, and adding, removing or reordering steps and meetings.
- **Only changed plans are stored.** The pack record has a 1.5 MB cap (`MAX_STATE_BYTES`) and all the plans are about 1.07 MB, so the record never holds the full set.
  - When an admin first edits an adventure's plan, the app copies that one plan from `plans.json` into `state.advPlanEdits['Wolf :: Bobcat'] = { plan, base, by, at }`. Here `base` is the `verified` date (or a hash) of the original it was copied from.
  - Every screen uses the pack's copy when there is one, and `plans.json` otherwise.
  - It syncs like any other pack field. Follow the Phase 3 reload gate and version rules for a new field.
- **Who:** admins only can edit plans. Editors keep their den notes (§3). Viewers read.
- **Reset and drift:**
  - A "Reset to original" button (with a confirm) deletes the pack's copy.
  - If the original in `plans.json` changes after the pack's edit (`base` differs), show "The original plan was updated since your pack edited it", with a way to view the original.
- **Guards:**
  - `normalizeState` validates the shape with the same limits the parser enforces: kinds den|closing, no control characters, and `**` as the only markup.
  - It caps each edited plan (about 40 KB) and the total (about 250 KB), dropping junk.
  - If saving would pass the cap, refuse with a plain message instead of breaking the record.
  - Going over 40 minutes on a den night **warns** in the editor but doesn't block.
- **The editor:** a leaders-only edit mode on the plan panel, with a step list that can add, delete and move steps. The 40-minute check shows as a running total. Phone-first.
- **The markdown in `docs/lesson-plans/` stays the researched original.** A pack edit never changes it, and the build never reads pack edits.

### 4. Where plans show
- **Den plans** (`renderDenPlanner`, ~8129; `denMeetingsBlock`, ~8192): each adventure gets a "Lesson plan" button. It opens a plan panel with all its meetings, the supplies rolled up, the safety notes, the source links and the den's leader notes (editable).
- **Meeting editor** (adventure box ~13018–13050): if the meeting has an adventure, show "Plan for meeting N of M". N comes from `runForMeeting`/`adventureRuns` (~7774–7850). The line shows that meeting's outline and supplies and links to the full plan.
  - On an All-dens night, `denAdvAt` (7724) gives each den's adventure, and each den's plan is listed.
- **Printable agenda** (`agendaDetail`, ~12558): add an optional leader printout of the session's outline and supply list. It follows the same rule as `noteInternal`: it is never in the parent view, the digest or the .ics export.
- **Yearly check:** the July "re-check adventures" Home task (`ADVENTURES_VERIFIED`, ~17394) also names the plans whose `verified` date is more than a year old.

A visual mockup of all three was shown to Keith on 2026-09-29, in the app's own cream, navy and gold styling:
1. The Den plans rows with a "Lesson plan" button.
2. The plan panel: collapsible meetings, a safety box, "Our den's notes" and the official links.
3. The meeting editor's "Plan for tonight · meeting 2 of 3" box.

### 4a. Rendering rules for every plan screen (security review, 2026-09-30)
- Treat every plan field (original or pack-edited) as untrusted. Build text with `String(...)`, then `esc(...)`, and only after escaping replace `\*\*([^*]+)\*\*` with `<strong>$1</strong>`. Convert no other markup unless it's added the same way.
- Leave `[date]` as literal text until the calendar fill is built.
- Link `sources`/`official` only after checking `^https://`, with `rel="noopener noreferrer"`.
- Never write plan text into `event.note`, a parent-facing field, `showToast` or copy-to-parents text. The only exception is `tellParents`, and only when a leader chooses to send it.
- `plans.json` is **public** (anyone can fetch `pack569.com/plans.json`). "Leaders only" describes the screens, not the file, so never put anything private in the markdown.

### 5. Build order
1. Required pass, one rank per commit: research → safety review → Keith skims → data.
2. UI: plan panel, meeting-editor line, agenda printout, leader notes, then admin plan editing (§3a).
3. Reviews, one at a time: `cubmaster-program` for content, `parent-experience-editor` for wording and the printout, `security-access-reviewer` for notes and the parent view.
4. Elective pass, shared themes first, the same way. Re-check the size budget first.
5. Docs: add a "Lesson plans" section to `DESIGN-adventures.md`. It covers the sources, the copyright rule, the data shape and the "not for parents" rule.

The engineer is `app-engineer`, and commits follow the repo's house style.

## Critical files
- `index.html`: `ADVENTURES` 7567, `ADV_ELECTIVE_THEMES` 7617, runs 7774+, `denAdvAt` 7724, `renderDenPlanner` 8129, `denMeetingsBlock` 8192, meeting editor ~13018, `agendaDetail` 12558, `buildParentView` 9969, `normalizeState` ~4149. Line numbers will have moved by the time this starts.
- `scripts/lesson-plans.mjs` (parser), `scripts/build-site.mjs` (publishes `plans.json`), `loadAdventurePlans()` in index.html.
- `test/harness.mjs`, `DESIGN-adventures.md`.

## Verification
- **Harness:**
  - Every required adventure in `ADVENTURES` has a plan, and no plan has a key that isn't in `ADVENTURES`.
  - Each plan has 1–4 meetings, https source links and a `verified` date.
  - There are no control characters, and the size cap holds.
  - `advNotes` normalizes (junk is dropped and the text is capped).
  - The parent view, digest and .ics contain no plan text or notes.
- **Run `node test/harness.mjs`:** all pass.
- **Browser check (built-in browser, local preview):**
  - Open Den plans, open a Wolf plan, and add a leader note.
  - Schedule a 3-meeting run and confirm the editor shows "meeting 2 of 3" with the right outline.
  - Set an All-dens night and confirm each den's plan is shown.
  - Print the agenda.
  - Switch to the parent view and confirm nothing leaked.
  - Check at phone width.
