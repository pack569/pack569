// Pack 569 — who may edit which part of the pack record, by pack position.
//
// Stage 1 of position-based access (the approved plan, 2026-10-01). Today the pack record is ONE
// JSON blob (pack_state.json), and an admin or editor may write any of it. Here each top-level key
// of that blob belongs to one SECTION of the app (KEY_OWNER), and each POSITION a leader holds says
// Edit, Read or Hidden for each section (ACCESS). The PUT of the pack record refuses a change to a
// key the caller cannot edit (refusedSections, api/pack/[id]/index.js).
//
// HIDDEN IS NOT PRIVACY YET. The whole record still goes to every leader (GET is unchanged), so in
// stage 1 'hidden' only declutters the page; it is enforced on writes exactly like 'read'. Stage 2
// splits the record on the server so that hidden sections are never sent.
//
// A POSITION IS NOT A JOB. JOBS in index.html (cubmaster, treasurer, kernel, …) is a lens: it marks
// and orders things, and a leader can edit their own job record. Nothing here reads it (the harness
// checks): the positions a leader holds come only from the member_positions table, which only an
// admin writes. The two share their ids (Keith, 2026-10-02): every job but 'cor' is a position of
// the same id, plus 'parent'. The Chartered Org Rep is not a position: the COR is made an admin.
// The harness checks the ids agree.
//
// The table between the markers is JSON, and index.html carries a byte-identical copy between the
// same markers (var ACCESS_TABLE). The harness fails if the two differ. Change both or neither.
//   positions         the positions, in the order the page lists them
//   sections          every section of the app (index.html WORKSPACES), plus three sub-sections:
//                     'attendance' (the calendar's attendance marks), 'calendar.denmeeting' (on a
//                     den meeting only: its adventure and notes — see denMeetingChangeOk) and
//                     'deposits' (banking storefront cash, and the deposit deadline: the
//                     treasurer, the chair, and the kernel, whose deposits the treasurer reviews —
//                     see depositRowsOk)
//   denMeetingFields  the fields 'calendar.denmeeting' may change on a kind 'den' event
//   access            per position: its default level, and the sections it edits or cannot see
//   keyOwner          each top-level key of the pack record -> its section; a list means any of
//                     them. Two buckets that are not sections: 'shared' (bookkeeping any writer
//                     changes: rev, the format, the one-time notices, and the sync log, which is
//                     append-only: syncLogOk) and 'admin' (archives and closed books: admins
//                     only). A key not listed is 'admin': an unknown key fails closed.
//   goneOwner         state.gone is split by its sub-keys (the deletion marks of each log), so a
//                     mark for the ledger cannot be written by someone who cannot edit the ledger.
//                     A sub-key not listed is 'admin'.
//   bookLogOwner      a pack setting the ledger's log names by a name that is not a key of the
//                     record (logSettingEdit's `name`, for the inventory's own settings) -> its
//                     section. With keyOwner, it says whose change a book 'edit' line records,
//                     so a leader who changes a setting may log it (ledgerLogOk).
//   actions           things a leader does that are not editing a section, each with the
//                     positions that may (an admin always may): shiftVerify, accepting a family's
//                     shift report and recording the cash collected (the leaders at the booth,
//                     Keith 2026-10-02: never a parent); shiftUndo, taking an accept back, or what
//                     became of the cash (the leader who did it may too: the endpoint knows who)
//   blockReportFields the fields of a storefront block that accepting a shift report writes; a
//                     shiftVerify holder may change these, and no others, without editing
//                     storefronts (storefrontReportChangeOk)
export const ACCESS_TABLE = /*ACCESS-BEGIN*/{
    "positions": [
      {"id": "cubmaster", "label": "Cubmaster"},
      {"id": "asstcub", "label": "Assistant Cubmaster"},
      {"id": "chair", "label": "Committee Chair"},
      {"id": "treasurer", "label": "Treasurer"},
      {"id": "secretary", "label": "Secretary"},
      {"id": "kernel", "label": "Popcorn Kernel"},
      {"id": "advancement", "label": "Advancement Chair"},
      {"id": "activities", "label": "Activities Chair"},
      {"id": "membership", "label": "Membership Chair"},
      {"id": "outdoors", "label": "Outdoor / Camping Chair"},
      {"id": "derbychair", "label": "Pinewood Derby Chair"},
      {"id": "comms", "label": "Communications"},
      {"id": "trainer", "label": "Pack Trainer"},
      {"id": "denleader", "label": "Den Leader"},
      {"id": "asstden", "label": "Assistant Den Leader"},
      {"id": "parent", "label": "Parent"}
    ],
    "sections": ["home", "calendar", "calendar.denmeeting", "attendance", "denplan", "derby", "camping", "roster", "advancement", "joining", "storefronts", "totals", "rewards", "inventory", "council", "budget", "ledger", "deposits", "dues", "fundraisers", "sharing", "people", "season"],
    "denMeetingFields": ["adventure", "denAdv", "note", "noteInternal"],
    "access": {
      "cubmaster": {"default": "read", "edit": ["calendar", "calendar.denmeeting", "attendance", "denplan", "derby", "camping", "advancement", "season"], "hidden": []},
      "asstcub": {"default": "read", "edit": ["calendar", "calendar.denmeeting", "attendance", "denplan", "derby", "camping", "advancement", "season"], "hidden": []},
      "chair": {"default": "read", "edit": ["calendar", "calendar.denmeeting", "attendance", "derby", "joining", "budget", "ledger", "deposits", "dues", "fundraisers", "people", "season"], "hidden": []},
      "treasurer": {"default": "read", "edit": ["budget", "ledger", "deposits", "dues", "fundraisers"], "hidden": []},
      "secretary": {"default": "read", "edit": ["roster"], "hidden": ["inventory", "council", "ledger", "deposits", "dues", "fundraisers"]},
      "kernel": {"default": "read", "edit": ["storefronts", "totals", "rewards", "inventory", "council", "deposits"], "hidden": []},
      "advancement": {"default": "read", "edit": ["advancement"], "hidden": ["inventory", "council", "ledger", "deposits", "dues", "fundraisers"]},
      "activities": {"default": "read", "edit": ["calendar", "calendar.denmeeting"], "hidden": ["inventory", "council", "ledger", "deposits", "dues", "fundraisers"]},
      "membership": {"default": "read", "edit": ["roster", "joining"], "hidden": ["inventory", "council", "ledger", "deposits", "dues", "fundraisers"]},
      "outdoors": {"default": "read", "edit": ["camping"], "hidden": ["inventory", "council", "ledger", "deposits", "dues", "fundraisers"]},
      "derbychair": {"default": "read", "edit": ["derby"], "hidden": ["inventory", "council", "ledger", "deposits", "dues", "fundraisers"]},
      "comms": {"default": "read", "edit": [], "hidden": ["inventory", "council", "ledger", "deposits", "dues", "fundraisers"]},
      "trainer": {"default": "read", "edit": [], "hidden": ["inventory", "council", "ledger", "deposits", "dues", "fundraisers"]},
      "denleader": {"default": "read", "edit": ["calendar.denmeeting", "attendance", "denplan", "advancement"], "hidden": ["inventory", "council", "ledger", "deposits", "dues", "fundraisers", "people"]},
      "asstden": {"default": "read", "edit": ["calendar.denmeeting", "attendance", "denplan", "advancement"], "hidden": ["inventory", "council", "ledger", "deposits", "dues", "fundraisers", "people"]},
      "parent": {"default": "hidden", "edit": [], "hidden": []}
    },
    "keyOwner": {
      "version": "shared",
      "fmt": "shared",
      "rev": "shared",
      "startHereDismissed": "shared",
      "movedNoticeDismissed": "shared",
      "balooNoticeDismissed": "shared",
      "syncLog": "shared",
      "events": "calendar",
      "meetings": "calendar",
      "rsvps": "calendar",
      "attendance": "attendance",
      "advNotes": "denplan",
      "advPlanEdits": "denplan",
      "derby": "derby",
      "camping": "camping",
      "scouts": "roster",
      "advancement": "advancement",
      "onboarding": "joining",
      "welcome": "joining",
      "recruitKit": "joining",
      "storefronts": "storefronts",
      "entries": "totals",
      "packLoc": "totals",
      "teImport": "totals",
      "commissionPct": ["totals", "budget"],
      "commissionPctOnline": ["totals", "budget"],
      "goalCents": ["totals", "budget"],
      "goalIsDerived": ["totals", "budget"],
      "stretchGoalCents": ["totals", "budget"],
      "cashGoalCents": ["totals", "budget"],
      "cashThroughTrailsEnd": ["totals", "budget"],
      "cashScoutPct": ["totals", "budget"],
      "cashInCommission": ["totals", "budget"],
      "cashInGoal": ["totals", "budget"],
      "wagonViaTEFrom": ["totals", "budget"],
      "rewardTiers": "rewards",
      "inventory": "inventory",
      "popcornCouncil": "council",
      "budget": "budget",
      "ledger": "ledger",
      "book": "ledger",
      "ledgerAside": "ledger",
      "ledgerLog": "ledger",
      "statements": "ledger",
      "depositDays": "deposits",
      "charges": "dues",
      "collected": "dues",
      "fundraisers": "fundraisers",
      "packName": "sharing",
      "leaders": "people",
      "densAdvancedYear": "season",
      "densAdvancedSummary": "season",
      "archives": "admin",
      "closedBooks": "admin",
      "closedGone": "admin"
    },
    "goneOwner": {"entries": "totals", "imports": "totals", "ledger": "ledger", "distributions": "inventory", "products": "inventory", "sales": "fundraisers", "fundraisers": "fundraisers", "scouts": "roster"},
    "bookLogOwner": {"orderTotalCents": "inventory", "invCommissionPct": "inventory"},
    "actions": {
      "shiftVerify": ["cubmaster", "asstcub", "chair", "treasurer", "kernel", "denleader", "asstden"],
      "shiftUndo": ["chair", "treasurer", "kernel"]
    },
    "blockReportFields": ["salesCents", "donationsCents", "cashCountedBy", "cashVerifiedBy", "reportId", "reportFrom", "reportApprovedBy", "reportConfirmedBy",
      "reportOverride", "reportOverrideNote", "reportCollected", "reportReturned", "reportPending", "salesCash"]
  }/*ACCESS-END*/;

export const LEVELS = ['hidden', 'read', 'edit'];
export const POSITIONS = ACCESS_TABLE.positions.map((p) => p.id);
export const SECTIONS = ACCESS_TABLE.sections.slice();
export const BUCKETS = ['admin', 'shared'];
export const DEN_MEETING_FIELDS = ACCESS_TABLE.denMeetingFields.slice();
export const ACTIONS = Object.keys(ACCESS_TABLE.actions);
export const BLOCK_REPORT_FIELDS = ACCESS_TABLE.blockReportFields.slice();

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// position -> section -> 'edit' | 'read' | 'hidden', every section filled in.
export const ACCESS = (function () {
  const out = {};
  POSITIONS.forEach((p) => {
    const a = ACCESS_TABLE.access[p], row = {};
    SECTIONS.forEach((s) => {
      row[s] = a.edit.indexOf(s) !== -1 ? 'edit' : a.hidden.indexOf(s) !== -1 ? 'hidden' : a.default;
    });
    out[p] = row;
  });
  return out;
})();

// key -> section or bucket (or a list of sections), with no prototype: 'constructor' or
// '__proto__' as a key of the pack record is unknown, so 'admin'.
export const KEY_OWNER = Object.assign(Object.create(null), ACCESS_TABLE.keyOwner);
export const GONE_OWNER = Object.assign(Object.create(null), ACCESS_TABLE.goneOwner);
export const ownerOfKey = (k) => (own(KEY_OWNER, k) ? KEY_OWNER[k] : 'admin');
export const ownerOfGone = (k) => (own(GONE_OWNER, k) ? GONE_OWNER[k] : 'admin');
const BOOK_LOG_OWNER = Object.assign(Object.create(null), ACCESS_TABLE.bookLogOwner);
// Whose change a book 'edit' line's field records: a setting's own name, or a key of the record.
export const ownerOfBookLogField = (k) => (own(BOOK_LOG_OWNER, k) ? BOOK_LOG_OWNER[k] : ownerOfKey(k));

// What a member may do with each section, from their role and (for 'leader') their positions:
// section -> level, for every section and both buckets.
//   admin    edit everything, the admin bucket too.
//   editor,  RETIRED (Keith, 2026-10-02): every committee job is its own position now. An
//   viewer   account still holding either reads everything and edits nothing until an admin
//            gives it positions (the Members card lists it as "needs a position"). The rows
//            stay legal (the role CHECKs keep both) so they still load.
//   leader   per section, the most permissive of their positions. Positions this file does not
//            know are ignored. 'shared' is edit when any section is; 'admin' is read.
//            'calendar' edit carries 'calendar.denmeeting' edit with it.
//   anything else (parent, pending, none): hidden everywhere.
export function effectiveAccess(role, positions) {
  const out = {};
  const fill = (v) => { SECTIONS.concat(BUCKETS).forEach((s) => { out[s] = v; }); };
  if (role === 'admin') { fill('edit'); return out; }
  if (role === 'editor' || role === 'viewer') { fill('read'); return out; }
  fill('hidden');
  if (role !== 'leader') return out;
  const held = Array.isArray(positions) ? positions : [];
  let any = false;
  SECTIONS.forEach((s) => {
    let best = 0;
    held.forEach((p) => {
      if (typeof p === 'string' && own(ACCESS, p)) best = Math.max(best, LEVELS.indexOf(ACCESS[p][s]));
    });
    out[s] = LEVELS[best];
    if (best === 2) any = true;
  });
  if (out.calendar === 'edit') out['calendar.denmeeting'] = 'edit';
  out.shared = any ? 'edit' : 'read';
  out.admin = 'read';
  return out;
}

// What a member may do of the table's actions: action -> true/false. An admin may do each; a
// leader, an action one of their positions lists; nobody else (the retired editor included).
export function effectiveActions(role, positions) {
  const out = {}, held = Array.isArray(positions) ? positions : [];
  ACTIONS.forEach((a) => {
    out[a] = role === 'admin' || (role === 'leader' && held.some((p) => typeof p === 'string' && ACCESS_TABLE.actions[a].indexOf(p) !== -1));
  });
  return out;
}
export const canDo = (role, positions, action) => effectiveActions(role, positions)[action] === true;

// Whether `access` (effectiveAccess) may edit what `owner` names (a section, a bucket, or a list
// of sections, any of which will do).
export function canEditOwner(access, owner) {
  const list = Array.isArray(owner) ? owner : [owner];
  return list.some((s) => typeof s === 'string' && own(access, s) && access[s] === 'edit');
}

// Two parsed JSON values are the same: objects compared by their keys whatever their order,
// arrays in order. Without recursion, so a deeply nested record cannot blow the stack.
export function sameJson(a, b) {
  const stack = [a, b];
  while (stack.length) {
    const y = stack.pop(), x = stack.pop();
    if (x === y) continue;
    if (x === null || y === null || typeof x !== 'object' || typeof y !== 'object') return false;
    const ax = Array.isArray(x);
    if (ax !== Array.isArray(y)) return false;
    if (ax) {
      if (x.length !== y.length) return false;
      for (let i = 0; i < x.length; i++) stack.push(x[i], y[i]);
    } else {
      const kx = Object.keys(x);
      if (kx.length !== Object.keys(y).length) return false;
      for (const k of kx) {
        if (!own(y, k)) return false;
        stack.push(x[k], y[k]);
      }
    }
  }
  return true;
}
// A top-level value (or a gone sub-key) is unchanged when it is the same, or when one side is
// missing and the other is empty: [], {} or null. So a newer page that starts a new key empty,
// or the first save of a fresh record, changes nothing; removing a key that held anything does.
const isEmpty = (v) => v === null || (Array.isArray(v) ? v.length === 0 : typeof v === 'object' && Object.keys(v).length === 0);
function sameTop(x, hasX, y, hasY) {
  if (hasX && hasY) return sameJson(x, y);
  if (!hasX && !hasY) return true;
  return isEmpty(hasX ? x : y);
}
const plain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// The one change 'calendar.denmeeting' allows to state.events (owner decisions, 2026-10-01): the
// same events, by id (none added or removed; their order may differ), and every event that
// changed is a den meeting (kind 'den', before and after) that changed only in
// DEN_MEETING_FIELDS: which adventure it works on (`adventure`; `denAdv` on an all-dens
// night, a den's own line) and its two notes. Its date, time, place, den, the Cubmaster's
// pack-wide pick (packAdv), the agenda, and everything else stay as they were.
export function denMeetingChangeOk(before, after) {
  if (!Array.isArray(before) || !Array.isArray(after) || before.length !== after.length) return false;
  const was = Object.create(null);
  for (const e of before) {
    if (!plain(e) || typeof e.id !== 'string' || !e.id || was[e.id]) return false;
    was[e.id] = e;
  }
  const seen = Object.create(null);
  for (const e of after) {
    if (!plain(e) || typeof e.id !== 'string' || !was[e.id] || seen[e.id]) return false;
    seen[e.id] = true;
    const b = was[e.id];
    if (sameJson(b, e)) continue;
    if (b.kind !== 'den' || e.kind !== 'den') return false;
    const keys = Object.keys(b).concat(Object.keys(e));
    for (const k of keys) {
      if (DEN_MEETING_FIELDS.indexOf(k) !== -1) continue;
      if (own(b, k) !== own(e, k) || !sameJson(b[k], e[k])) return false;
    }
    for (const k of ['adventure', 'note', 'noteInternal']) if (own(e, k) && typeof e[k] !== 'string') return false;
    if (own(e, 'denAdv') && !plain(e.denAdv)) return false;
  }
  return true;
}

// ---- The logs, the statements and the settlement: whose they are, entry by entry ----
// A section's editors may change its keys, but some parts of them record WHO did something, and no
// one below an admin may write those for anyone else, or rewrite what is there (the plan's step 4,
// and the re-analysis of main, 2026-10-02). These run only for a caller who is not an admin.

// The order the logs keep (mergeLedgerLog, normalizeSyncLog): by `at`, then id.
const logCmp = (a, b) => {
  const x = String(a.at || ''), y = String(b.at || '');
  return x < y ? -1 : x > y ? 1 : (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0);
};
const utf8 = (s) => new TextEncoder().encode(s).length;
// An entry a log kept keeps every field it had, with the same value. A newer page may add a field
// (normalizeSyncLog fills one in as ''), never change or drop one.
function keepsWhatItHad(was, now) {
  if (!plain(was) || !plain(now)) return false;
  return Object.keys(was).every((k) => own(now, k) && sameJson(was[k], now[k]));
}
// An append-only log (state.syncLog, state.ledgerLog: lists of { id, at, byUid, … }) changed from
// `before` to `after` only as its writers do:
//   - entries added, each the caller's own (byUid === uid), and each one `newOk` passes;
//   - the oldest dropped by the log's cap, and only then: every entry dropped sorts before every
//     entry left, and the log is full: `cap.max` entries, or (cap.bytes) the newest one dropped
//     would not have fitted in that many bytes of JSON (mergeLedgerLog's own sum);
//   - every entry kept keeps what it had (keepsWhatItHad), or, with cap.exact, is exactly what it was:
//     not a field added either. Their order is the writer's to keep.
export function appendOnlyOk(before, after, uid, cap, newOk) {
  if (!Array.isArray(after)) return false;
  const was = Object.create(null);
  (Array.isArray(before) ? before : []).forEach((e) => { if (plain(e) && typeof e.id === 'string') was[e.id] = e; });
  const seen = Object.create(null);
  for (const e of after) {
    if (!plain(e) || typeof e.id !== 'string' || !e.id || seen[e.id]) return false;
    seen[e.id] = true;
    if (own(was, e.id)) { if (!(cap.exact ? sameJson(was[e.id], e) : keepsWhatItHad(was[e.id], e))) return false; }
    else if (typeof uid !== 'string' || !uid || e.byUid !== uid || (newOk && !newOk(e))) return false;
  }
  const dropped = Object.keys(was).filter((id) => !seen[id]).map((id) => was[id]);
  if (!dropped.length) return true;
  if (!after.length || !dropped.every((d) => after.every((e) => logCmp(d, e) < 0))) return false;
  if (after.length >= cap.max) return true;
  if (!cap.bytes) return false;
  const newest = dropped.slice().sort(logCmp)[dropped.length - 1];
  const size = 2 + after.reduce((n, e, i) => n + utf8(JSON.stringify(e)) + (i ? 1 : 0), 0);
  return size + utf8(JSON.stringify(newest)) + 1 > cap.bytes;
}
// The two logs' caps, as the page keeps them: SYNC_LOG_MAX; mergeLedgerLog's 1000 events and 128 KB.
// The ledger's log is exact (security review of 714a920..045e7ac): a line there is never rewritten,
// not even by a field added to it, whoever edits the ledger. Every line the page writes is whole
// (ledgerEvent), and normalizeLedgerEvent adds nothing to a line a page wrote; a field added to an
// old line (a `why`, an `f`) would change what the trail says was done. The sync log keeps the
// looser rule: normalizeSyncLog fills in a field an older page's line lacks.
export const SYNC_LOG_CAP = { max: 500 };
export const LEDGER_LOG_CAP = { max: 1000, bytes: 128 * 1024, exact: true };

// state.syncLog (shared: any leader who edits something may log a kept-mine), append-only.
export const syncLogOk = (before, after, uid) => appendOnlyOk(before, after, uid, SYNC_LOG_CAP, null);

// state.ledgerLog, append-only for everyone below an admin, its own editors too: a line there stays
// exactly as it is (LEDGER_LOG_CAP.exact). A leader who edits the ledger adds their own lines of any kind. One
// who does not may add only their own lines recording a pack setting they changed: a book 'edit'
// whose every field is a setting they may edit (ownerOfBookLogField). Commission, goals, the wagon
// date and the deposit days are logged on the book; the people who may set them are not all
// ledger editors (logSettingEdit and its kin, index.html).
// And a deposit holder may log the 'add' of a deposit they add in the same save (`deposits`, its ids):
// the ledger's add path logs one when the date is in a reconciled or closed period.
export function ledgerLogOk(before, after, uid, access, deposits) {
  const ledger = canEditOwner(access, 'ledger'), added = Array.isArray(deposits) ? deposits : [];
  return appendOnlyOk(before, after, uid, LEDGER_LOG_CAP, ledger ? null : (e) =>
    (e.op === 'add' && added.indexOf(e.row) !== -1) ||
    (e.op === 'edit' && e.row === 'book' && plain(e.f) && Object.keys(e.f).length > 0 &&
      Object.keys(e.f).every((k) => canEditOwner(access, ownerOfBookLogField(k)))));
}

// A statement's parts set once after it is written (index.html statementOnceGroups): its review,
// its reopening, the balance added to a legacy one. All three are an admin's.
const STATEMENT_ONCE = ['reviewedAt', 'reviewedBy', 'reviewedByUid', 'reopenedAt', 'reopenedBy', 'reopenedByUid', 'reopenWhy',
  'addedAt', 'addedCents', 'addedBy', 'addedByUid'];
// state.statements, below an admin (owner decision, security re-check of C5, R1; the plan's step 4):
// every statement there stays, exactly as it is (reviewing, reopening, changing or removing one is
// an admin's: canReopenStatement); a statement added is the caller's own (byUid), and carries
// none of the parts set once. By id: their order is the writer's.
export function statementsOk(before, after, uid) {
  if (!Array.isArray(after)) return false;
  const was = Object.create(null);
  (Array.isArray(before) ? before : []).forEach((st) => { if (plain(st) && typeof st.id === 'string') was[st.id] = st; });
  const seen = Object.create(null);
  for (const st of after) {
    if (!plain(st) || typeof st.id !== 'string' || !st.id || seen[st.id]) return false;
    seen[st.id] = true;
    if (own(was, st.id)) { if (!sameJson(was[st.id], st)) return false; continue; }
    if (typeof uid !== 'string' || !uid || st.byUid !== uid) return false;
    if (STATEMENT_ONCE.some((k) => own(st, k))) return false;
  }
  return Object.keys(was).every((id) => seen[id]);
}

// state.book.councilSettled (the popcorn settled with the council): a settlement written or changed
// is the caller's own (byUid). Taking one back (absent) names nobody, and is any ledger editor's.
export function councilSettledOk(beforeBook, afterBook, uid) {
  const b = plain(beforeBook) ? beforeBook.councilSettled : undefined;
  const a = plain(afterBook) ? afterBook.councilSettled : undefined;
  if (a === undefined || a === null || sameJson(a, b)) return true;
  return plain(a) && typeof uid === 'string' && !!uid && a.byUid === uid;
}

// ---- Shift reports and deposits: a slice of a section, for a leader who does not edit it ----

// state.storefronts changed by a shiftVerify holder who does not edit storefronts (Keith, 2026-10-02):
// only as the page's shift-report steps change it, and each step tied to the server's own record of
// the report (shift_reports, read by the PUT for the reports the changed blocks name: `ctx.reports`,
// id -> row). Security review of 714a920..045e7ac, finding 1: the first version compared the
// figures only with a marker the same caller wrote, so a den leader could put any figures and any
// names on any block. Now:
//   - the same storefronts, by id, each as it was but for its blocks; the same blocks, by id, each as
//     it was but for BLOCK_REPORT_FIELDS (as before);
//   - ACCEPT (step 1 of acceptShiftReport, or a stuck one taken over: srTakeOver): the caller's
//     marker (reportPending.by) on a block whose reportId is a report OF THAT BLOCK still waiting
//     (or accepted by the caller), not the caller's own nor one they confirmed; the marker's and the
//     block's figures are the report's; the names are the report's (the sender's, the confirming
//     parent's) and the caller's own (`ctx.name`, their member name as the page signs it); what
//     the marker keeps to undo itself (`was`) is what the block held. A takeover changes only the
//     marker's by/at and the approver's name;
//   - SETTLE (the marker goes, srSettle): the report is accepted with the marker's figures;
//   - UNDO (the marker goes, srRollback): each field back to the marker's `was` or left as it is; by
//     the marker's own leader, an undo-list holder (`ctx.canUndo`), or once the report is no longer
//     waiting (sent back, withdrawn) — never over a report accepted with the marker's figures;
//   - SENT BACK (returnShiftReport on an accepted one): the report is sent back after an accept; the
//     link and the verifier go, and the warning says the report's own reason;
//   - THE CASH FROM SALES (b.salesCash): an entry's outcome is the report's (srCashMirror,
//     srSalesCashSet) and names who recorded it as the report does; an accept adds its own entry;
//     an undo takes its own entry (with no outcome) back off.
// Anything else refuses the save.
const PARENT_SIGNED = 'a signed-in parent', LEADER_SIGNED = 'a signed-in leader';
// The page's srNameClean (a sender's or confirming parent's name on a block), and the name a leader
// signs a block with (srSignName: their member name, as the server holds it).
export const parentNameClean = (v) => { const n = String(v == null ? '' : v).trim(); return n.indexOf('@') === -1 ? n : PARENT_SIGNED; };
export const signerName = (v) => { const n = String(v == null ? '' : v).trim(); return n && n.indexOf('@') === -1 ? n : LEADER_SIGNED; };
const stampClean = (v) => (typeof v !== 'string' ? '' : v.indexOf('@') === -1 ? v : LEADER_SIGNED);
// The fields an accept keeps in its marker's `was`, as acceptShiftReport writes them from the block.
function blockWas(b) {
  const str = (k) => (typeof b[k] === 'string' && b[k] ? b[k] : '');
  return { salesCents: b.salesCents || 0, donationsCents: b.donationsCents || 0, cashCountedBy: str('cashCountedBy'), cashVerifiedBy: str('cashVerifiedBy'),
    reportId: str('reportId'), reportFrom: str('reportFrom'), reportApprovedBy: str('reportApprovedBy'), reportConfirmedBy: str('reportConfirmedBy'),
    reportOverride: str('reportOverride'), reportOverrideNote: str('reportOverrideNote'), reportCollected: b.reportCollected === true,
    reportReturned: plain(b.reportReturned) ? { note: String(b.reportReturned.note || '') } : null };
}
// The link to a report (srUnlink takes these off).
const LINK_FIELDS = ['reportId', 'reportFrom', 'reportApprovedBy', 'reportConfirmedBy', 'reportOverride', 'reportOverrideNote', 'reportCollected'];
const OVERRIDES = ['same-family', 'second-parent', 'not-collected'];
const listById = (list) => {
  const m = Object.create(null);
  for (const x of list) { if (!plain(x) || typeof x.id !== 'string' || !x.id || m[x.id]) return null; m[x.id] = x; }
  return m;
};
// Blocks that differ between two storefront lists: [[sf id, before, after]], or null when the lists
// do not pair up by id.
function changedBlocks(before, after) {
  if (!Array.isArray(before) || !Array.isArray(after) || before.length !== after.length) return null;
  const was = listById(before), now = listById(after);
  if (!was || !now) return null;
  const out = [];
  for (const id of Object.keys(was)) {
    const sb = was[id], sa = now[id];
    if (!sa) return null;
    const keys = Object.keys(sb).concat(Object.keys(sa));
    if (keys.some((k) => k !== 'blocks' && (own(sb, k) !== own(sa, k) || !sameJson(sb[k], sa[k])))) return null;
    const bb = Array.isArray(sb.blocks) ? sb.blocks : [], ba = Array.isArray(sa.blocks) ? sa.blocks : [];
    if (own(sb, 'blocks') !== own(sa, 'blocks') || bb.length !== ba.length) return null;
    const bw = listById(bb), bn = listById(ba);
    if (!bw || !bn) return null;
    for (const bid of Object.keys(bw)) {
      if (!bn[bid]) return null;
      if (!sameJson(bw[bid], bn[bid])) out.push([id, bw[bid], bn[bid]]);
    }
  }
  return out;
}
// The report ids the changed blocks name (their reportId before and after, and their cash-from-sales
// entries'), for the PUT to read; null when the storefronts do not pair up, or name too many.
export const STOREFRONT_REPORTS_MAX = 100;
export function storefrontReportIds(before, after) {
  const blocks = changedBlocks(before, after);
  if (!blocks) return null;
  const ids = Object.create(null);
  const add = (v) => { if (typeof v === 'string' && v) ids[v] = true; };
  blocks.forEach(([, b, a]) => {
    [b, a].forEach((x) => {
      add(x.reportId);
      (Array.isArray(x.salesCash) ? x.salesCash : []).forEach((e) => { if (plain(e)) add(e.reportId); });
    });
  });
  const out = Object.keys(ids);
  return out.length > STOREFRONT_REPORTS_MAX ? null : out;
}
export function storefrontReportChangeOk(before, after, uid, ctx) {
  const blocks = changedBlocks(before, after);
  if (!blocks || typeof uid !== 'string' || !uid) return false;
  const c = plain(ctx) ? ctx : {}, reports = plain(c.reports) ? c.reports : {}, me = signerName(c.name);
  const rowOf = (rid, sfId, blockId) => {
    const r = typeof rid === 'string' && own(reports, rid) ? reports[rid] : null;
    return r && r.sf_id === sfId && r.block_id === blockId ? r : null;
  };
  for (const [sfId, b, a] of blocks) {
    for (const k of Object.keys(b).concat(Object.keys(a))) {
      if (BLOCK_REPORT_FIELDS.indexOf(k) === -1 && (own(b, k) !== own(a, k) || !sameJson(b[k], a[k]))) return false;
    }
    const pa = plain(a.reportPending) ? a.reportPending : null, pb = plain(b.reportPending) ? b.reportPending : null;
    if (own(a, 'reportPending') && !pa) return false;
    // Everything but the cash entries: which step is this?
    const rest = (x) => { const o = {}; BLOCK_REPORT_FIELDS.forEach((k) => { if (k !== 'salesCash' && own(x, k)) o[k] = x[k]; }); return o; };
    let added = null, takenBack = null;   // the accept's own cash entry; the undone accept's report id
    if (!sameJson(rest(b), rest(a))) {
      if (pa && !sameJson(pa, pb)) {
        // ACCEPT, or a stuck accept taken over.
        const row = rowOf(a.reportId, sfId, b.id);
        if (!row || pa.by !== uid || row.submitted_by_uid === uid || row.confirmed_by_uid === uid) return false;
        if (!(row.status === 'submitted' || (row.status === 'accepted' && row.accepted_by_uid === uid))) return false;
        if (pa.te !== row.te_cents || pa.cash !== row.cash_cents || a.salesCents !== row.te_cents || a.donationsCents !== row.cash_cents) return false;
        const sc = row.sales_cash_cents || 0;
        if (sc > 0 ? pa.salesCash !== sc : own(pa, 'salesCash')) return false;
        if (own(pa, 'alsoCash') && !(pa.alsoCash === true && sc > 0 && pa.collected === true)) return false;
        if (pb) {
          // Taken over: the same accept, now this leader's to finish.
          const keep = (x) => { const o = Object.assign({}, x); delete o.by; delete o.at; return o; };
          if (b.reportId !== a.reportId || !sameJson(keep(pa), keep(pb)) || pb.collected || pb.override) return false;
          const ra = rest(a), rb = rest(b);
          delete ra.reportPending; delete rb.reportPending; delete ra.reportApprovedBy; delete rb.reportApprovedBy;
          if (!sameJson(ra, rb) || a.reportApprovedBy !== me) return false;
        } else {
          const confirmed = row.needs_confirm === 1 && !!row.confirmed_by_uid;
          const counted = parentNameClean(row.submitted_by_name), confirmer = confirmed ? parentNameClean(row.confirmed_by_name) : '';
          const collected = a.reportCollected === true;
          const verified = confirmed ? confirmer : collected ? me : '';
          const override = typeof a.reportOverride === 'string' ? a.reportOverride : '';
          const note = typeof a.reportOverrideNote === 'string' ? a.reportOverrideNote : null;
          if (a.reportFrom !== counted || a.cashCountedBy !== counted || a.reportConfirmedBy !== confirmer || a.cashVerifiedBy !== verified ||
            a.reportApprovedBy !== me) return false;
          if (collected && (confirmed || row.needs_confirm !== 0)) return false;
          if (typeof a.reportCollected !== 'boolean' || note === null || note.length > 300) return false;
          if (override ? OVERRIDES.indexOf(override) === -1 || !note.trim() : note !== '') return false;
          if (own(a, 'reportReturned')) return false;
          if (pa.override !== !!override || pa.note !== note || pa.collected !== collected) return false;
          if (!sameJson(pa.was, blockWas(b)) || !sameJson(pa.wrote, { counted, verified })) return false;
          if (typeof pa.at !== 'number') return false;
          const allowed = ['by', 'at', 'te', 'cash', 'was', 'wrote', 'override', 'note', 'collected', 'salesCash', 'alsoCash'];
          if (Object.keys(pa).some((k) => allowed.indexOf(k) === -1)) return false;
          if (sc > 0) added = { reportId: row.id, cents: sc, from: counted, outcome: null };
        }
      } else if (pb && !pa) {
        const row = rowOf(b.reportId, sfId, b.id);
        if (!row) return false;
        const sameFigs = row.te_cents === pb.te && row.cash_cents === pb.cash && (row.sales_cash_cents || 0) === (pb.salesCash || 0);
        const ra = rest(a), rb = rest(b);
        delete rb.reportPending;
        const unlinked = Object.assign({}, rb);
        LINK_FIELDS.forEach((k) => { delete unlinked[k]; });
        if (row.status === 'accepted' && sameFigs) {
          // SETTLED: the marker goes; the link too, if the figures were changed by hand meanwhile.
          if (!sameJson(ra, rb) && !sameJson(ra, unlinked)) return false;
        } else {
          // UNDONE: by the marker's leader, an undo-list holder, or once the report no longer waits.
          if (!(pb.by === uid || c.canUndo === true || row.status === 'returned' || row.status === 'withdrawn' || row.status === 'accepted')) return false;
          const was = plain(pb.was) ? pb.was : {};
          const figs = (x) => [x.salesCents || 0, x.donationsCents || 0];
          if (!sameJson(figs(a), figs(b)) && !sameJson(figs(a), [was.salesCents || 0, was.donationsCents || 0])) return false;
          const val = (x, k) => (own(x, k) ? x[k] : k === 'reportCollected' ? false : k === 'reportReturned' ? null : '');
          for (const k of BLOCK_REPORT_FIELDS) {
            if (k === 'salesCents' || k === 'donationsCents' || k === 'salesCash' || k === 'reportPending') continue;
            const v = val(a, k);
            if (!sameJson(v, val(b, k)) && !(own(was, k) && sameJson(v, was[k]) && (k !== 'reportReturned' || v === null || plain(v)))) return false;
          }
          takenBack = b.reportId;
        }
      } else if (!pa && !pb && typeof b.reportId === 'string' && !own(a, 'reportId')) {
        // SENT BACK after its accept.
        const row = rowOf(b.reportId, sfId, b.id);
        if (!row || row.status !== 'returned' || !row.accepted_by_uid) return false;
        const want = Object.assign({}, rest(b));
        LINK_FIELDS.forEach((k) => { delete want[k]; });
        want.cashVerifiedBy = '';
        want.reportReturned = { note: String(row.review_note || '').slice(0, 300) };
        if (!sameJson(rest(a), want)) return false;
      } else return false;
    }
    // The cash from sales, entry by entry.
    const eb = Array.isArray(b.salesCash) ? b.salesCash : [], ea = Array.isArray(a.salesCash) ? a.salesCash : [];
    if ((own(b, 'salesCash') && !Array.isArray(b.salesCash)) || (own(a, 'salesCash') && !Array.isArray(a.salesCash))) return false;
    if (sameJson(eb, ea) && own(a, 'salesCash') === own(b, 'salesCash')) continue;
    const byRid = (list) => {
      const m = Object.create(null);
      for (const e of list) { if (!plain(e) || typeof e.reportId !== 'string' || !e.reportId || m[e.reportId]) return null; m[e.reportId] = e; }
      return m;
    };
    const mb = byRid(eb), ma = byRid(ea);
    if (!mb || !ma) return false;
    for (const rid of Object.keys(mb)) {
      const e = mb[rid], f = ma[rid];
      if (!f) {
        if (rid === takenBack && !e.outcome) continue;   // the undone accept's own entry
        return false;
      }
    }
    for (const rid of Object.keys(ma)) {
      const f = ma[rid], e = mb[rid];
      if (added && rid === added.reportId) {
        if (!sameJson(f, added)) return false;
        continue;
      }
      if (!e || e.cents !== f.cents || e.from !== f.from || Object.keys(f).some((k) => ['reportId', 'cents', 'from', 'outcome'].indexOf(k) === -1)) return false;
      if (sameJson(e.outcome, f.outcome)) continue;
      const row = rowOf(rid, sfId, b.id);
      if (!row) return false;
      const want = row.sales_cash_outcome || null;
      if (want === null ? f.outcome !== null : !(plain(f.outcome) && f.outcome.outcome === want &&
        f.outcome.by === (stampClean(row.sales_cash_by_name || '') || 'a leader') && f.outcome.at === (row.sales_cash_at || 0) &&
        Object.keys(f.outcome).length === 3)) return false;
    }
    if (added && !ma[added.reportId]) return false;
    // The order the page writes: an accept's own entry last, the rest as they were.
    const order = (list) => list.map((e) => e.reportId).filter((r) => !added || r !== added.reportId);
    const orderB = order(eb).filter((r) => own(ma, r));
    if (!sameJson(order(ea), orderB)) return false;
    if (added && ea[ea.length - 1].reportId !== added.reportId) return false;
  }
  return true;
}

// A ledger row that is a deposit of storefront cash a 'deposits' holder who does not edit the ledger
// may add (Keith, 2026-10-02: the kernel records the deposit, the treasurer reviews it). Money in,
// marked as storefront cash and nobody's payment, entered by the caller, flagged for the treasurer
// (depositReview: true; the treasurer's edit takes the flag off), and nothing the ledger's own
// steps set: not ticked or on a statement, not voided, not approved.
const DEPOSIT_UNSET = ['reconciled', 'reconciledAt', 'statementId', 'off', 'voidReason', 'voidedAt', 'voidedBy', 'voidedByUid',
  'approvedBy', 'approvedByUid', 'approvedAt', 'tierMakeup', 'scoutId', 'reimbursement'];
export function depositRowOk(e, uid) {
  return plain(e) && typeof e.id === 'string' && !!e.id && e.direction === 'in' && e.source === 'storefront' &&
    typeof e.amountCents === 'number' && typeof uid === 'string' && !!uid && e.enteredByUid === uid && e.depositReview === true &&
    DEPOSIT_UNSET.every((k) => !e[k]);
}
// state.ledger changed by such a leader: every row there still there, as it was (by id), and every row
// added a deposit (depositRowOk). Returns the ids added, or null when it is anything else.
export function depositRowsAdded(before, after, uid) {
  if (!Array.isArray(after)) return null;
  const was = Object.create(null);
  (Array.isArray(before) ? before : []).forEach((e) => { if (plain(e) && typeof e.id === 'string') was[e.id] = e; });
  const seen = Object.create(null), added = [];
  for (const e of after) {
    if (!plain(e) || typeof e.id !== 'string' || !e.id || seen[e.id]) return null;
    seen[e.id] = true;
    if (own(was, e.id)) { if (!sameJson(was[e.id], e)) return null; continue; }
    if (!depositRowOk(e, uid)) return null;
    added.push(e.id);
  }
  return Object.keys(was).every((id) => seen[id]) ? added : null;
}

// The sections (and buckets) a write from `stored` to `next` (both parsed records) changes that
// `access` may not edit, sorted; [] when it may make every change in it. `uid` is the caller's: the
// logs, the statements and the settlement say who did what, and nobody below an admin may say it
// for someone else (above). `actions` (effectiveActions) lets a shiftVerify holder write a shift
// report's fields on the storefronts. Called only for a caller who is not an admin.
//
// `ctx` is what the PUT read for it: { reports } (shift_reports rows, by id: storefrontReportIds) and
// { name } (the caller's member name), for the storefronts slice; { now } (ms) for the logs.
export function refusedSections(stored, next, access, uid, actions, ctx) {
  const cx = plain(ctx) ? ctx : {};
  const refused = Object.create(null);
  const refuse = (owner) => { (Array.isArray(owner) ? owner : [owner]).forEach((s) => { refused[s] = true; }); };
  const s = plain(stored) ? stored : {}, n = plain(next) ? next : {};
  const can = plain(actions) ? actions : {};
  // A deposit holder who does not edit the ledger: the deposits they add, which their own log lines may name.
  let deposits = [];
  if (!canEditOwner(access, 'ledger') && access.deposits === 'edit' && !sameTop(s.ledger, own(s, 'ledger'), n.ledger, own(n, 'ledger'))) {
    deposits = depositRowsAdded(own(s, 'ledger') ? s.ledger : [], own(n, 'ledger') ? n.ledger : [], uid);
  }
  const keys = Object.create(null);
  Object.keys(s).concat(Object.keys(n)).forEach((k) => { keys[k] = true; });
  for (const k of Object.keys(keys)) {
    const hasS = own(s, k), hasN = own(n, k);
    if (k === 'gone' && (!hasS || plain(s.gone)) && (!hasN || plain(n.gone))) {
      const gs = hasS ? s.gone : {}, gn = hasN ? n.gone : {}, subs = Object.create(null);
      Object.keys(gs).concat(Object.keys(gn)).forEach((g) => { subs[g] = true; });
      for (const g of Object.keys(subs)) {
        if (sameTop(gs[g], own(gs, g), gn[g], own(gn, g))) continue;
        const owner = ownerOfGone(g);
        if (!canEditOwner(access, owner)) refuse(owner);
      }
      continue;
    }
    if (sameTop(s[k], hasS, n[k], hasN)) continue;
    const owner = ownerOfKey(k);
    const was = hasS ? s[k] : [], now = hasN ? n[k] : [];
    // The ledger's log: its own rule, for ledger editors and the setting-changers alike.
    if (k === 'ledgerLog') { if (!ledgerLogOk(was, now, uid, access, deposits || [])) refuse(owner); continue; }
    if (k === 'ledger' && !canEditOwner(access, owner)) { if (!deposits || !deposits.length) refuse(owner); continue; }
    if (k === 'storefronts' && !canEditOwner(access, owner)) {
      if (!(can.shiftVerify === true && storefrontReportChangeOk(was, now, uid, { reports: cx.reports, name: cx.name, canUndo: can.shiftUndo === true }))) refuse(owner);
      continue;
    }
    if (canEditOwner(access, owner)) {
      if (k === 'syncLog' && !syncLogOk(was, now, uid)) refuse(owner);
      else if (k === 'statements' && !statementsOk(was, now, uid)) refuse(owner);
      else if (k === 'book' && !councilSettledOk(s[k], n[k], uid)) refuse(owner);
      continue;
    }
    if (k === 'events' && access['calendar.denmeeting'] === 'edit' && denMeetingChangeOk(was, now)) continue;
    refuse(owner);
  }
  return Object.keys(refused).sort();
}
