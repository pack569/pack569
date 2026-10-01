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

- **Nothing is marked automatically.** Attendance never writes advancement.
- **One MAIN adventure per meeting** (owner ruling 2026-08-02, extended 2026-10-01 — §8). The
  field stays a single string; extra adventures at an event are a separate list, `advOffers`.
- **No parent visibility.** Not asked for, and a per-scout progress board is a different privacy
  question from a campout page — the parent view publishes no advancement today and still doesn't.
- **No requirement-level tracking.** This app is an at-a-glance tracker; the official record is
  Scoutbook Plus, which the Advancement card already says.

## 8. Assigning adventures — 2026-10-01

*Owner, extending the §7 ruling the same day: "add the ability to assign multiple electives to a
meeting, i.e. the fall and spring family camping offer BBs, bows and arrows, fishing, and Let's
Camp (Let's Camp is automatic to all who attend, the rest are electives)."*

**The ruling now reads:** a den meeting still has ONE main adventure per den (`adventure`, or
`packAdv` / `denAdv` on an All-dens night) — that is what a run of sessions is built from. Any
event can also OFFER more adventures, and a campout or outing (kind `activity`) has only those.

### Several adventures at one event — `ev.advOffers = [{ key, auto }]`

- `key` is a pack-wide choice (`packAdvChoices`: `req:N`, `th:fishing`, `el:Archery`), so each
  scout gets their own rank's version (`packAdvName`). A rank without it is simply not offered it
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
