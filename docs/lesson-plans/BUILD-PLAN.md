# Adventure lesson plans for den leaders (queued)

## Context
Den leaders plan their meetings in **Program → Den plans**, but the app only knows adventure *names* (`ADVENTURES`, index.html:7567). It has no activity ideas, supply lists or meeting outlines. Keith wants researched, meeting-by-meeting lesson plans for each adventure, so leaders have ready ideas and plans for den meetings.

**Timing:** this is queued. It starts only after the current database work (Cloudflare Phase 3: C5–C9, the server tables, the backend switch) and the other planned updates have landed on main. Right now the only step is to record it in memory so a later session picks it up.

**Keith's decisions (2026-09-29)**
- **Depth:** meeting by meeting. Each adventure gets 2–4 meetings. Each meeting has a gathering activity, an opening, 2–3 activities tied to the requirements, a closing, a supply list and prep notes, plus links to the official scouting.org pages.
- **Scope:** the 36 required adventures (6 per rank) first. Electives follow in a second pass, starting with the ones every rank shares: Race Time, Champions for Nature, Let's Camp!, Archery, BB Gun, Slingshot and Summertime Fun. That is about 148 adventures in all.
- **Editing:** the researched plans ship fixed in the app. Each den leader can add their own notes per adventure; the notes save with the pack record and carry over from year to year.
- **Visibility:** leaders only. The parent view stays unchanged.

**Update 2026-09-29: the plans become runnable meeting guides.** Keith pointed to his "Bobcat Night: Wolves & Bears" page (https://claude.ai/artifact/TnfxEbQRSRM4LzUcZLQp2E) as the model.
- **Where:** each plan meeting becomes a **"Run this meeting"** screen inside the app, for leaders only. It opens from Den plans or from a den meeting on the calendar.
- **What the screen has:**
  - A meeting timer (Start, Next step, Skip), where a skipped step's minutes come off the total.
  - Numbered steps that open and close. Each step has its minutes, requirement chips per den, a **Say** box, how-to bullets and a tip.
  - A supplies list, and a "Tell parents before they leave" box.
  - Reference tabs: Oath & Law with tap-to-explain points, sign/salute/handshake, and later the Outdoor Code and Six Essentials.
- **All-dens nights:** a den switch shows Both dens or one den. Gathering, opening and closing are shared. Den time becomes a **breakout** with each den's own rank activity for the same category, using the app's existing `denAdvAt` model.
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
  - The step data needs an `options: [{label, steps}]` form, or a meeting-level variant.
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

### 2. Data: `ADVENTURE_PLANS` inline constant in index.html
- Plans go inline next to `ADVENTURES` (index.html:~7608), like the other static content. The page is one self-contained file.
  - The CSP (`_headers`) allows only the page's hashed inline script and has no `connect-src 'self'`, so a separate data file would mean a CSP change.
- **Shape:** it is keyed with the existing run-key separator, `den + ' :: ' + adventure`:
  ```
  'Wolf :: Council Fire': { verified, sources: [url], summary, safety: [], reqs: [{ n, text, where }],
    meetings: [{ title, prep, supplies: [], tellParents,
      steps: [{ kind: 'gathering'|'opening'|'den'|'closing', title, mins, reqs: '1, 2',
                say, how: [], tip, home }] }] }
  // All-dens night: shared gathering/opening/closing; 'den' steps from each den's plan → breakout
  ```
- Shared electives can reuse one text through a small helper with per-rank tweaks, so the same text isn't pasted six times.
- **Size budget:** the required pass adds about 150 KB, and all adventures about 500 KB, to a 1.67 MB page.
  - A harness test caps the constant's size.
  - Before the elective pass, re-check the budget. If it's too big, move the plans to a same-origin JSON file fetched on demand; that needs `connect-src 'self'`, which the Phase 2 `/api` may already add.
- The loader and `normalizeState` must never read `ADVENTURE_PLANS`, so where it is declared doesn't matter to them. The load-order rule at ~1941 still applies to anything they do read.

### 3. Leader notes: `state.advNotes`
- **Shape:** `{ 'Wolf :: Council Fire': { text, by, at } }`. It is normalized in `normalizeState` (near the event normalisation at ~4149–4177) and stays in the pack record.
  - Follow whatever the Phase 3 reload gate and version rules require for a new field at that point.
- **Who can edit:** editors and admins. Viewers can read.
- **Not published to parents:** `buildParentView` (~9969) is an allowlist, so the notes stay out automatically. A harness assertion is added anyway, next to the existing one at test/harness.mjs:5784.

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

### 5. Build order
1. Required pass, one rank per commit: research → safety review → Keith skims → data.
2. UI: plan panel, meeting-editor line, agenda printout, leader notes.
3. Reviews, one at a time: `cubmaster-program` for content, `parent-experience-editor` for wording and the printout, `security-access-reviewer` for notes and the parent view.
4. Elective pass, shared themes first, the same way. Re-check the size budget first.
5. Docs: add a "Lesson plans" section to `DESIGN-adventures.md`. It covers the sources, the copyright rule, the data shape and the "not for parents" rule.

The engineer is `app-engineer`, and commits follow the repo's house style.

## Critical files
- `index.html`: `ADVENTURES` 7567, `ADV_ELECTIVE_THEMES` 7617, runs 7774+, `denAdvAt` 7724, `renderDenPlanner` 8129, `denMeetingsBlock` 8192, meeting editor ~13018, `agendaDetail` 12558, `buildParentView` 9969, `normalizeState` ~4149. Line numbers will have moved by the time this starts.
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
