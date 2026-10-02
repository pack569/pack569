# An adventure across several den meetings

*Owner ask, 2026-08-02: "when I create den meetings, I want to be able to assign achievement
targets… show that based on attendance they earned their belt loop/badge, or they are 2/3 there
and missing this meeting." Clarified mid-build: "it's no more than one adventure per meeting, but
an adventure can take multiple meetings to complete."*

---

## 1. What was already there, and what was wrong with it

A den meeting already had an `adventure` field and a one-tap **"mark it done for everyone checked
in"**. That is correct for an adventure a den finishes in one evening, and wrong for most of them:
tag Bobcat on the first of three meetings, tap the button, and a scout who then misses the other
two keeps the credit.

Nothing in the app could express *"this is the second of three nights on Bobcat"*, because that
fact does not live on any one meeting.

## 2. The model: a RUN of sessions

No new stored field. The multiplicity is on the other side — many meetings, one adventure.

> Every den meeting naming an adventure is one **session** of it. The sessions sharing a
> (den, adventure) inside one program year are a **run**. A scout's progress is the sessions of
> that run they were checked in at.

```
adventureRuns()        → [{ den, adventure, sessions: [meeting, …] }]   date-ordered
runProgress(run)       → { total, scouts: [{ attended, missed, pending, count, full, status }],
                           onTrack, complete, short }
runForMeeting(m)       → { run, position, of, prog }   this meeting's place in its run
```

Everything is **derived** from the meetings and the attendance book that were already there, so it
stays right when a meeting is added, moved, retagged or deleted. There is no second record to keep
in step.

Three details that are the whole correctness of it:

- **`pending` is not `missed`.** A session in the future that a scout has not attended is *still to
  come*. Counting it as a miss would report every scout as behind the moment a den schedules next
  month's meetings. `missed` requires `ev.date <= today`.
- **Tonight is not the future.** *(Audit fix, 2026-09-27.)* This was `ev.date < today`, which left
  tonight's session in `pending` for every scout not checked in — so a scout who stayed home
  tonight had "missed nothing", and the Mark-done button, pressed at the end of the very meeting it
  is for, credited them. A session dated today that a scout is not checked in at is a miss.
- **Scoped to the program year.** A den works the same adventure again next year with a different
  set of children. Counting last year's meetings would report a scout as finished who has never
  been to one.
- **Grouped per den.** Wolf and Bear both working Bobcat is two runs, not one. A den meeting with
  no den set means all dens, matching what the meeting row already displays.

`onTrack` (attended at least one session, and missed nothing that has happened, tonight
included) and `complete` (attended every session, including the planned ones) are different
questions and both get asked. The mark-off button uses `onTrack`; the "every session" badge uses
`complete`. The "at least one" half is also a 2026-09-27 audit fix: "missed nothing" is true of a
scout who has not been to anything, and the button credits exactly this list.

## 3. What attendance is — the part that decided the copy

Researched rather than assumed, because it would have been easy to build a tracker that is subtly
wrong about the programme.

Cub Scout advancement is per **requirement**, and *"Do Your Best"* is the standard. From Scouting
America's own advancement training: preparation happens "in den meetings, pack meetings, or other
activities, or in family settings." For Tiger, Wolf and Bear, a requirement completed outside the
den meeting is signed by the parent or adult partner and **then approved by the den leader**; for
Webelos and Arrow of Light the den leader signs.

**So a missed den meeting does not cost a scout the adventure, and this app must never imply that
it does.** What attendance gives is *evidence*:

| | |
|---|---|
| Scouts at every session held | the ones a den leader can sign off without chasing anybody |
| Scouts who missed one | a **make-up-at-home** list, not a lost cause |

Both lists are shown, and the copy says exactly this. A harness test fails if the words
"cannot earn", "forfeit" or "missed out on the adventure" ever appear.

`advMarkDone` remains the only writer. Nothing here marks anything on its own — attendance is
evidence, the den leader is Akela.

## 4. Where it shows

- **Meeting editor** — the adventure box, then `session 2 of 3 · Jul 15 · Jul 22 (this one) ·
  Aug 19`. An undated meeting is told it needs a date before it counts as a session.
- **Below it** — one row per scout: `Ada Kent 3 of 3 recorded` / `Ben Doe 1 of 3 missed Jul 22`,
  the mark-off button, and the make-up sentence.
- **Agenda row** — `Council Fire (2/3)` in the meta line.
- **Agenda detail** (the printable sheet) — `ADVENTURE Council Fire · session 1 of 3` and a
  `PROGRESS` line.
- **Advancement · Adventures in progress** — one card, every run this year, who is behind. The
  grid below it answers "has Ada got Bobcat"; this answers the question that comes first: "will
  the den get through Bobcat, and who is behind".

### The pack meeting

Recognition is immediate at the den meeting and **formal at the next pack meeting**, where the loop
or pin is actually handed over. The calendar knows which meeting that is, so once anything is
recorded the app names it: *"Present the loop or pin at the next pack meeting — Wed, Aug 26."*

## 5. Two bugs fixed on the way through

**"Edit this meeting" appeared to do nothing.** It set the selected day and re-rendered — and the
day's editable card is a screen and a half below the fold on a long calendar page, with scroll
deliberately preserved. It had always worked and had never been visible. Fixed with `ui.scrollToId`,
honoured at the very end of `render()` (so it beats both the scroll restore and the reset) and
cleared immediately so it can never yank a later render.

Note: **not** `behavior: 'smooth'`. That was the first attempt and in this app's own preview engine
it does nothing at all — 2.4 seconds of polling, `scrollY` never left 0, while the plain call moved
1,131px instantly. A jump that sometimes silently fails is the bug being fixed.

**A NUL byte in `index.html`.** The run key was briefly `den + '\x00' + adventure`. It worked
perfectly, and it made `grep` return **nothing at all** — silently, with a non-zero exit — for the
entire 925KB file, so every "no matches for X" became a lie. Second time in this project: the
harness once had a `join('\x00')` with the same effect. The separator is now `' :: '` (a den name
comes from the fixed `DENS` list and cannot contain it), and a harness test now fails on any
control character anywhere in the source.

## 6. Sources

- Cub Scout Advancement: Delivering Adventure (presenter's notes) —
  <https://filestore.scouting.org/filestore/boyscouts/pdf/CubScoutAdvancementDeliveringAdventure_SpeakerNotes.pdf>
  — the three steps (preparation / qualification / recognition), who signs for which rank, and
  where awards are presented
- Den Leader Resources — <https://www.scouting.org/programs/cub-scouts/leader-resources/den-meeting-resources/>
- Den leader planning (a pack's own working guide) — <https://pack680.org/?page_id=484> — dens
  plan **two meetings a month**, "some adventures are planned over multiple meetings"

Den Leader Guides give four monthly den meeting outlines built around an adventure, so **two to
four den meetings per adventure** is the normal shape — which is exactly what the run model is for.

## 7. What deliberately does not happen

- **Nothing is marked automatically.** Attendance never writes advancement. Since 2026-10-02 the
  app *derives* more — an adventure's parts across den meetings and events, and who is done or
  in progress by them (§9) — but it still writes nothing until a leader taps.
- **One MAIN adventure per meeting** (owner ruling 2026-08-02, extended 2026-10-01 — §8). The
  field stays a single string; extra adventures at an event are a separate list, `advOffers`,
  which since §9 can be narrowed to the ranks each one is for.
- **No parent visibility.** Not asked for, and a per-scout progress board is a different privacy
  question from a campout page — the parent view publishes no advancement today and still doesn't.
  That includes a mark in progress and its note (§9).
- **No requirement-level tracking.** This app is an at-a-glance tracker; the official record is
  Scoutbook Plus, which the Advancement card already says. *In progress* (§9) is one status on the
  whole adventure, not a list of requirements — "started, not finished", with a short note.

## 8. Assigning adventures — 2026-10-01

*Owner, extending the §7 ruling the same day: "add the ability to assign multiple electives to a
meeting, i.e. the fall and spring family camping offer BBs, bows and arrows, fishing, and Let's
Camp (Let's Camp is automatic to all who attend, the rest are electives)."*

**The ruling now reads:** a den meeting still has ONE main adventure per den (`adventure`, or
`packAdv` / `denAdv` on an All-dens night) — that is what a run of sessions is built from. Any
event can also OFFER more adventures, and a campout or outing (kind `activity`) has only those.

### Several adventures at one event — `ev.advOffers = [{ key, auto }]`

- `key` is a pack-wide choice (`packAdvChoices`: `req:N`, `th:fishing`, `el:Archery`), so each
  scout gets their own rank's version (`packAdvName`). *(Widened in §9: any rank's elective, and
  `dens` to say which ranks an offer is for.)* A rank without it is simply not offered it
  and the editor says so: Lions have no BB Gun, Arrow of Light has no "Let's Camp!".
- `auto: true` — *everyone who attends earns it* (Let's Camp!): one button, the same path as the
  run's Mark-done (`advMarkDone`, `'done'`, never `'awarded'`), for the active scouts checked in
  whose rank has it.
- `auto: false` — *offered, scouts who choose it*: a checklist of those attendees; the leader
  ticks who did it. Nothing is recorded for anybody else, and never automatically.
- **Not a session of a run.** A run's Mark-done credits everyone at every session, which is wrong
  for an elective a scout walked past. Offers stay out of `meetingAdvs` / `adventureRuns` and
  are counted on their own: Den plans (`denOfferEntries` → `denPlan`, "at Fall family campout
  Oct 17"), the Den plans meeting list ("also …"), and the leaders' agenda sheet.
- **Range sports** (Archery, BB Gun, Slingshot): a warning, not a block, on a den meeting — pack
  rule, never at a den meeting, only on a council range. On an activity, a note that a pack-run
  trip is not a council event. Fill the calendar leaves them off its list.
- `normalizeState` keeps shape only (array, choice-shaped key once, boolean `auto`, at most 12,
  none on a pack meeting). The rollover carries a campout's offers like its dens.
- New seeds: the Fall and Spring family campouts (both council weekends) get Let's Camp! (auto)
  and Archery, BB Gun, Fishing (offered). An existing event is never touched.
- **Leaders only.** The parent view publishes no adventure for a meeting, so it publishes no
  offers either; nor do the digest or the .ics.

### Plan a meeting — on one already on the calendar

Den plans' Plan a meeting lists this program year's upcoming meetings the den is at — its own and
the All-dens nights — that have nothing for it (no adventure, no den line, not marked away, no
pack-wide pick that reaches the den) and picks the first; "New den meeting on …" is still there.
A den-only meeting gets `adventure`; an All-dens night gets `denAdv[den]`, never `packAdv`, which
is the Cubmaster's. Re-checked on submit, so a meeting tagged meanwhile is never overwritten;
Undo on the toast.

### Fill the calendar

On Den plans, editors only: an ordered list of pack-wide choices with a meeting count each
(default: the lesson plan's den-meeting count — for a required category, the MOST any den with
scouts needs, so no den runs out; else 1), a start date, and a preview. It fills the next All-dens
nights in date order that have no `packAdv` and no typed adventure, skipping — never changing —
any that do, and says how many meetings are left when the calendar runs out. Apply writes
`packAdv` through `setPackAdv` (the meeting picker's writer), recomputed from the record at that
moment; Undo on the toast. The list itself is `ui` only, never stored.

## 9. Per rank, in progress, and the parts of an adventure — 2026-10-02

*Owner: "Add a way to separate adventures available for events per rank, auto handle partials if
the same adventure is assigned to multiple events, and mark partial credit earned manually."*

Three rulings, all the owner's:

1. **Partial credit is a status, not requirements.** `'partial'` — *in progress*, ◐ — sits beside
   `'done'` and `'awarded'`. Scoutbook stays the official per-requirement record (§7).
2. **The app derives progress; nothing is written until a leader taps.** Attendance is still
   evidence, not a signoff (§3).
3. **Den meetings and events count together** as the parts of one adventure, for one den, in one
   program year.

### Offers per rank — `ev.advOffers = [{ key, auto, dens?, part? }]`

Webelos Woods made the gap obvious. The weekend's patrol campout is part of Arrow of Light's
Outdoor Adventurer, but `req:3` is one key for both ranks, and for Webelos it means Webelos
Walkabout — a hike NEGA does not run. So the seed left it out and said so.

- `dens` is an optional list of `DENS` names; absent or empty means every rank at the event that
  has the adventure. `offerDens(ev, key)` is the event's dens (`offerEventDens`) narrowed by it.
  A narrowing that no longer meets the event's dens narrows to *nobody*, never quietly to everyone.
- `offerByDen`, `offerAttendees` and `denOfferEntries` all read it. `offerByDen` adds `off` — ranks
  that have the adventure but were left out — beside `lacks`. `offerAttendees` adds `notFor`:
  scouts checked in whose den the offer is not for, a younger sibling at Webelos Woods included.
  Neither list is ever credited.
- **The editor:** each offer row gets *For:* with a box per den at the event whose rank has the
  adventure, labelled with that rank's own name (`Arrow of Light · Outdoor Adventurer`). Unticking
  narrows; all ticked stores no `dens`; the last ticked box is disabled and the handler refuses an
  empty list — removing an offer is its ✕. Editors only (`canEdit`), `data-ch="offer-dens"`.
  Anyone else reads the ranks it is for and "Not offered to Webelos here".
- **Any rank's elective is an offer.** `packAdvChoices` lists only electives two ranks share, which
  is right for an All-dens night and wrong here: Knife Safety, Chef's Knife were not offerable.
  `advOfferChoices` / `advOfferLabel` add every elective, labelled with its rank when only one has
  it ("Knife Safety (Arrow of Light)"). An elective that is one rank's version of a theme (Arrow of
  Light's "Fishing") is left to the theme, narrowed, so one event cannot offer the same adventure
  twice under two keys. `packAdvChoices` is unchanged.
- `normalizeState` keeps shape only: `DENS` names, in `DENS` order, once; dropped when empty. It
  still reads nothing assigned after `load()`. `offerCopy` is the one way an offer is copied (the
  seed, the rollover, the add form), so `dens` survives each.
- `part: true` — *covers part of it* (owner, 2026-10-02; see the decision below). Absent is a
  **full chance**: one event earns the adventure, exactly as offers always did. Kept only when
  true; a "Covers part of it" box on each offer row and on the add form (`data-ch="offer-part"`,
  editors only).
- **Webelos Woods** now offers Outdoor Adventurer (`req:3`) and First Aid (`req:5`), *everyone who
  attends*, for Arrow of Light only, as **parts** (`part: true`); Let's Camp! for Webelos, a part;
  and Personal Fitness (`req:4`: Webelos Stronger, Faster, Higher; Arrow of Light Personal
  Fitness), a part the leader ticks for a den that planned and cooked its meal. Archery and BB Gun
  stay full chances. The family campouts' Let's Camp! is a part too; their ranges and fishing are
  full chances (`SEED_CAMP_OFFERS`). Seeds only — an event a pack already has is never touched.
- **Names.** An offer narrowed to ONE rank is called by that rank's own adventure everywhere —
  the event block, the agenda line, the toasts (`offerLabel`): "Outdoor Adventurer", never
  "Outdoors for Arrow of Light". Narrowed to two or more, the agenda names the ranks.
- **A part says so:** "a part, for everyone who attends" on the event block, the editor's reading
  text and the agenda line.

### In progress — `'partial'`

- `advancement[id] = { req, elect, notes? }`, values `'partial' | 'done' | 'awarded'`.
- **Truthy is not earned.** `advEarned` (done or awarded) is what every "has it" asks:
  `scoutAdvComplete`, `advElectCount` (counts earned keys only), `bobcatNudgeFor` (on both sides),
  Recognition's "finished, not recorded", the Home step's count, and every run, offer and card row
  (`row.earned`). A bare `advStatus` is kept only where *any* mark is the question: the grid cell,
  "already tracking that elective", and `uncreditedRuns` — a run a leader has marked in progress
  has been looked at, so it does not nag.
- `advMarkDone` upgrades `partial → done` (it used to refuse any status) and drops the note.
  `advMarkPartial` writes blank → `partial` and nothing else, so it can never take a mark away.
  Neither commits.
- **The grid cell** steps blank → ◐ in progress → ✓ done → ★ awarded → blank (`ADV_CYCLE`). In
  progress is outlined, dashed, never filled, so a half-way mark reads as "not yet". A legend under
  the Advancement heading names all four. Adding an elective still records it *done*.
- **The note.** `notes['req|Name' | 'elect|Name']`, trimmed, at most 120 characters
  (`ADV_PARTIAL_NOTE_MAX`), only beside a `'partial'` — `normalizeState`, `advCycle` and
  `advMarkDone` drop it otherwise. Written in the scout's expanded grid row ("In progress — Ada"),
  shown in the cell's label and on the Adventures in progress card. **Leaders only:** not in
  `buildParentView`, the digest, the .ics or the agenda sheet (harness).

### The parts of an adventure — `advParts(den, name, py)`

> For one den and one adventure in a program year, the parts are that den's run sessions plus
> every dated event whose offers give that den the adventure **as a part** (`offer.part`).
> `[{ ev, kind: 'session' | 'offer', auto }]`, date-ordered, one per event. Den-meeting sessions
> are always parts; an offer without `part` is a full chance and no part of anything.

- `advPartsRun` wraps them in a run-shaped object so **`runProgress` reads them unchanged** — the
  same pending/missed rule (tonight is not the future), active scouts of the den, this program
  year. `advRunParts(run)` widens a den's run; an "All dens" run keeps its sessions.
- It is **not a run.** `adventureRuns`, `runForMeeting`, the agenda's `(2/3)` and the lesson plan's
  "session 2 of 3" are still den meetings only — a campout is not a lesson-plan night.
- **Attendance at a part counts for that part, auto or not** (§3). An offered elective
  (`auto: false`) still records nothing without the leader's tick.

**Who a tap records — `advMarkable`, one rule for the den meeting and the event:**

| | done | in progress |
|---|---|---|
| one part, or a full-chance offer | everyone at it, not yet earned — exactly as before | — |
| 2+ parts | everyone **on track**: at every part held so far (tonight included), at least one, missed none — even with parts still to come | everyone who came to some but missed a part, no mark yet |

- The meeting's block (`meetingAdvMarkFor`) and the event's (`advOfferMarkFor`, through
  `offerMarkable`, per den) show "part k of N" with the parts' dates, each scout's "n of N, missed
  Sep 8 / Webelos Woods Sep 26", and the two buttons, `mtg-adv-mark` / `mtg-adv-partial` and
  `offer-mark` / `offer-mark-partial`. The handlers recompute through the same functions, so the
  scouts drawn and the scouts written cannot differ. Editors only.
- An offered elective keeps its tick list; a ticked scout is done if on track, else in progress.
- **The early done button stays** (owner, 2026-10-02). A run's Mark-done has always credited "every
  session so far" with sessions still ahead, and still does — the button says "so far" and the
  line under it "most dens wait for the last one": that is the leader's call, not the button's.
  The first build made the button wait for the last part; the owner ruled it back.
- The **Adventures in progress** card reads parts (`advProgressUnits`): every run widened, plus an
  adventure a den has only at events when there are two or more of them. It shows ◐ marks with
  their notes, and lists "Also in progress" for a mark no row shows. **Den plans** says "3 parts"
  where meetings and events both carry an adventure, and how many are recorded and in progress.
  §3's copy rule holds over all of it: a missed part is a make-up, never a lost adventure.

### Deliberately not done

- **No Undo toast on the record buttons.** Mark-done never had one; the grid cell steps any mark
  back by hand.
- **No family message for a missed event.** The make-up message is about den meetings
  (`makeupMessage`); its button appears only where a scout missed one.
- **Nothing new for parents.** As §7.

### Decided: parts or chances (owner, 2026-10-02)

The first build made every event that offers an adventure a part of it. The seeds offer Let's
Camp! at both family campouts and Webelos Woods, so Let's Camp! became two or three parts and the
fall campout recorded *in progress* — though one campout is all it asks. Two events can be two
**halves** of an adventure or two **chances** at it, and the app cannot tell which without being
told. **Ruling: a per-offer `part` box.** Unticked (the default, and every offer saved before) is
a full chance, recorded exactly as before this section; ticked joins the den's meetings as a part.

**Let's Camp! is a part** in the seeds (both family campouts, and Webelos Woods for Webelos).
Keith's ruling, knowing the consequence: where the den has two or more parts, one campout records
it *in progress*, not done, and a leader steps the cell on when the adventure is finished.

### Make-up copy (program review, 2026-10-02)

The reassurance under a missed part or session (`makeupReassure`) is on the den meeting AND the
event block, says the work can be done "at home or at another outing", and says who signs by the
scouts' rank (`makeupSignText`, §3): Lion to Bear, a parent or adult partner signs and the den
leader approves; Webelos and Arrow of Light, the den leader signs.
