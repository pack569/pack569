# Continue prompt: den-meeting lesson plans

Paste everything below the line into a new Claude Code session opened in the `pack569` repo. It assumes no memory of earlier sessions.

---

You're picking up the **den-meeting lesson plans** for Cub Scout Pack 569's app. The app is the single `index.html`, with the Node test harness in `test/harness.mjs` (run it with `node test/harness.mjs`). I'm Keith, the Cubmaster and the owner.

**Where the work is**
- **Branch `adventure-plans`**, and its pull request against `main`. It adds `docs/lesson-plans/` and allowlists two public hotline numbers in the harness. It changes no app code.
- **Content**, all in `docs/lesson-plans/`. **These files are the source of truth, so edit them there.**
  - Required adventures, one file per rank: `lion.md`, `tiger.md`, `wolf.md`, `bear.md`, `webelos.md`, `arrow-of-light.md`.
  - Shared electives: `electives/race-time.md`, `champions-for-nature.md`, `lets-camp.md`, `summertime-fun.md`, `range-sports.md`, `cycling.md`, `fishing.md`, `swimming.md`.
  - `open-questions.md`: the master list of questions still waiting on me. Answer them there and push each answer into every draft it affects.
  - `safety-review-camping.md` and `safety-review-youth-protection.md`: both reviews said FIX. Their **High and Med** findings are applied, and the **Low** ones are deliberately deferred.
  - `BUILD-PLAN.md`: the approved plan for building the app screens.

**What the plans are**
- Each adventure is written as "Run this meeting" guides, modeled on my Bobcat Night page (https://claude.ai/artifact/TnfxEbQRSRM4LzUcZLQp2E).
- Meeting headers read `### Meeting k of N · title · 40 min`.
- Steps read `N. **Title** · den|closing · M min · Reqs: …`, followed by `- Say:` / `- How:` / `- Tip:` lines. They also use:
  - the `(set-up)` and `(at home)` markers;
  - "Done at the pack opening:", "Done at a pack meeting:", "Done at a council range:" and similar lines;
  - "Leader's choice: Option A / Option B";
  - `(outing, about N min)`;
  - "[date]" placeholders.
- **Every den night totals 40 minutes or less.**

**My standing decisions (don't reopen them)**
- **Scope:** the 36 required adventures plus the 8 shared elective files above. **No rank-only electives.** In the app, an adventure without a plan shows its scouting.org link.
- **Den night:** the pack opens together, then each den has about 40 minutes. There's no gathering or opening step. The den closing is a clean-up and handing each scout to their adult by name. Parents pick up from each den.
- **Pack opening:** dens stand with their leader, so the Oath and Law said there count; saying them along with the others counts. Dens take turns leading the flag ceremony in the normal rotation.
- **App behavior:**
  - The guides are for leaders only. The parent view doesn't change.
  - The guides don't tick requirements. A "Record in Advancement" link takes their place, so DESIGN-adventures §7 stands.
  - Leader notes are saved per adventure.
- **Two-deep:** two registered adults 21 or over in every den room, with no one-on-one contact, and a woman 21 or over if any girl attends. Lion and Tiger adult partners don't count unless they're registered. Early set-up starts only when both adults are there. A chase car never carries a lone scout who isn't the driver's own child.
- **Protect Yourself material** is done at home with a parent. When a requirement says "with your adult partner" and the partner at den night is the scout's parent, the den activity counts. That parent rule applies only to the Protect Yourself requirements.
- **Disclosure steps (Georgia), used in every rank:**
  1. Make sure the child is safe, and call 911 if needed.
  2. **You personally** report within 24 hours to DFCS, 1-855-GACHILD, or to the police.
  3. Then tell the NEGA Scout executive, or call Scouts First at 1-844-SCOUTS1.
- **Faith:** families lead it. The chartered organization is a local church (name unknown), and its services are one optional choice.
- **Knives:** a scout who has earned the rank's knife adventure this year (Bear Whittling, AoL Knife Safety) may use a knife at home, at campouts and on outings, never at den meetings. **Handsaw:** Tiger to AoL may use one at home under close supervision; Lions never. **Fire:** for Webelos and AoL it's the den leader's choice: an adult lights it, or the scout lights it with an adult at their elbow. The Firem'n Chit is Scouts BSA only. **Cooking:** at home, at a pack campout, or at a Webelos/AoL den or patrol campout, with adults running the stoves. No den picnics. A no-cook food activity is OK with an allergy check.
- **Water and ranges:**
  - Pack 569 **never runs a swim**. The dens teach water safety on dry land, and the swim itself happens at a council camp, in lessons, or with family.
  - Archery, BB guns and slingshots happen **only at council ranges**, with no den meetings. At Scoutland, Lions shoot bows and Tigers and up shoot BB guns.
  - Fishing is catch-and-release only. Life jackets follow the official rule.
- **Devices and photos:** scouts use no devices; leaders use their own or printouts. Only scouts whose parents gave photo permission are photographed, and photos go only on the pack's official channel, with no names.
- **Location:** the pack is **not** in Gwinnett, and its exact area isn't recorded. Never name local parks, pools or district camps; write "a local park (check)". The pack's known campouts are fine: Scoutland, Camp Rainey Mountain and Fort Yargo (council-approved).
- **Leader's choice:** when I say "up to the den leader", the guide shows both options. Off-site den nights are coordinated with the Cubmaster.
- **Unknown dates:** the card night, crossover, derby, guest speakers and campout dates stay as "[date]". The app fills them from the calendar later.
- **Pack events:** there are several guest-speaker nights a year. The pack holds a derby build day, runs no Raingutter Regatta, and has loaner tents only (no helmets or bikes). Each den mails its own military holiday cards to 10,000 for the Troops.
- **Copyright:** write in our own words only, never copying Den Leader Guides or requirement text (summaries of 12 words or fewer), and link to scouting.org.

**How to work**
- Run **one agent at a time**, because I want low machine load.
- Research agents: plain WebFetch truncates scouting.org, so read it through `https://r.jina.ai/<url>`.
- After any content edit, check two things:
  - Every den meeting (not outings) still totals 40 minutes or less. Sum the `· N min` values per `### Meeting`.
  - The count of `- Say:` lines is unchanged, unless steps were intentionally added or removed.
- **Gotcha:** meeting steps and open questions are both numbered "N. **…**". When you mark answers, scope the edit to the text after `## Open questions for Keith`.
- Commit messages follow the repo's style: one sentence saying what now works, in present tense, with no prefix, and a short plain body. End with the Co-Authored-By line.
- **Only I push, merge, or deploy.** Deploys are the manual pipeline from `main`. GitHub Pages is gone, and the Cloudflare build doesn't publish `docs/`.

**What's next (ask me which)**
1. **Answer open questions:** go through `open-questions.md` with me, a few at a time, and push each answer into every draft it touches.
2. **Low review items:** apply them if I say so.
3. **App build (`BUILD-PLAN.md`):** start only after the database work (Cloudflare Phase 3, PR #6) is merged into `main`. Then merge `main` into this branch before touching `index.html`. Key parts:
   - an `ADVENTURE_PLANS` constant built from these drafts;
   - the "Run this meeting" screen, with a timer, steps, the den switch and breakouts;
   - leader notes in `state.advNotes`;
   - "credit from an event" lines;
   - `RANGE_ELECTIVES` filtered out of the pickers;
   - renames: Pedal With the Pack, BB Guns;
   - the Summertime Fun move-up data-loss fix (`advanceDens`);
   - date placeholders filled from the calendar.

Start by reading `BUILD-PLAN.md` and `open-questions.md`, then ask me what to take up.
