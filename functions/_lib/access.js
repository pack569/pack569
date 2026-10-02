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
//   sections          every section of the app (index.html WORKSPACES), plus two sub-sections:
//                     'attendance' (the calendar's attendance marks) and 'calendar.denmeeting'
//                     (on a den meeting only: its adventure and notes — see denMeetingChangeOk)
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
    "sections": ["home", "calendar", "calendar.denmeeting", "attendance", "denplan", "derby", "camping", "roster", "advancement", "joining", "storefronts", "totals", "rewards", "inventory", "council", "budget", "ledger", "dues", "fundraisers", "sharing", "people", "season"],
    "denMeetingFields": ["adventure", "denAdv", "note", "noteInternal"],
    "access": {
      "cubmaster": {"default": "read", "edit": ["calendar", "calendar.denmeeting", "attendance", "denplan", "derby", "camping", "advancement", "season"], "hidden": []},
      "asstcub": {"default": "read", "edit": ["calendar", "calendar.denmeeting", "attendance", "denplan", "derby", "camping", "advancement", "season"], "hidden": []},
      "chair": {"default": "read", "edit": ["calendar", "calendar.denmeeting", "attendance", "derby", "joining", "budget", "ledger", "dues", "fundraisers", "people", "season"], "hidden": []},
      "treasurer": {"default": "read", "edit": ["budget", "ledger", "dues", "fundraisers"], "hidden": []},
      "secretary": {"default": "read", "edit": ["roster"], "hidden": ["inventory", "council", "ledger", "dues", "fundraisers"]},
      "kernel": {"default": "read", "edit": ["storefronts", "totals", "rewards", "inventory", "council"], "hidden": []},
      "advancement": {"default": "read", "edit": ["advancement"], "hidden": ["inventory", "council", "ledger", "dues", "fundraisers"]},
      "activities": {"default": "read", "edit": ["calendar", "calendar.denmeeting"], "hidden": ["inventory", "council", "ledger", "dues", "fundraisers"]},
      "membership": {"default": "read", "edit": ["roster", "joining"], "hidden": ["inventory", "council", "ledger", "dues", "fundraisers"]},
      "outdoors": {"default": "read", "edit": ["camping"], "hidden": ["inventory", "council", "ledger", "dues", "fundraisers"]},
      "derbychair": {"default": "read", "edit": ["derby"], "hidden": ["inventory", "council", "ledger", "dues", "fundraisers"]},
      "comms": {"default": "read", "edit": [], "hidden": ["inventory", "council", "ledger", "dues", "fundraisers"]},
      "trainer": {"default": "read", "edit": [], "hidden": ["inventory", "council", "ledger", "dues", "fundraisers"]},
      "denleader": {"default": "read", "edit": ["calendar.denmeeting", "attendance", "denplan", "advancement"], "hidden": ["inventory", "council", "ledger", "dues", "fundraisers", "people"]},
      "asstden": {"default": "read", "edit": ["calendar.denmeeting", "attendance", "denplan", "advancement"], "hidden": ["inventory", "council", "ledger", "dues", "fundraisers", "people"]},
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
      "depositDays": "ledger",
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
    "bookLogOwner": {"orderTotalCents": "inventory", "invCommissionPct": "inventory"}
  }/*ACCESS-END*/;

export const LEVELS = ['hidden', 'read', 'edit'];
export const POSITIONS = ACCESS_TABLE.positions.map((p) => p.id);
export const SECTIONS = ACCESS_TABLE.sections.slice();
export const BUCKETS = ['admin', 'shared'];
export const DEN_MEETING_FIELDS = ACCESS_TABLE.denMeetingFields.slice();

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
//   - every entry kept keeps what it had (keepsWhatItHad). Their order is the writer's to keep.
export function appendOnlyOk(before, after, uid, cap, newOk) {
  if (!Array.isArray(after)) return false;
  const was = Object.create(null);
  (Array.isArray(before) ? before : []).forEach((e) => { if (plain(e) && typeof e.id === 'string') was[e.id] = e; });
  const seen = Object.create(null);
  for (const e of after) {
    if (!plain(e) || typeof e.id !== 'string' || !e.id || seen[e.id]) return false;
    seen[e.id] = true;
    if (own(was, e.id)) { if (!keepsWhatItHad(was[e.id], e)) return false; }
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
export const SYNC_LOG_CAP = { max: 500 };
export const LEDGER_LOG_CAP = { max: 1000, bytes: 128 * 1024 };

// state.syncLog (shared: any leader who edits something may log a kept-mine), append-only.
export const syncLogOk = (before, after, uid) => appendOnlyOk(before, after, uid, SYNC_LOG_CAP, null);

// state.ledgerLog, append-only. A leader who edits the ledger adds their own lines of any kind. One
// who does not may add only their own lines recording a pack setting they changed: a book 'edit'
// whose every field is a setting they may edit (ownerOfBookLogField). Commission, goals, the wagon
// date and the deposit days are logged on the book; the people who may set them are not all
// ledger editors (logSettingEdit and its kin, index.html).
export function ledgerLogOk(before, after, uid, access) {
  const ledger = canEditOwner(access, 'ledger');
  return appendOnlyOk(before, after, uid, LEDGER_LOG_CAP, ledger ? null : (e) =>
    e.op === 'edit' && e.row === 'book' && plain(e.f) && Object.keys(e.f).length > 0 &&
    Object.keys(e.f).every((k) => canEditOwner(access, ownerOfBookLogField(k))));
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

// The sections (and buckets) a write from `stored` to `next` (both parsed records) changes that
// `access` may not edit, sorted; [] when it may make every change in it. `uid` is the caller's: the
// logs, the statements and the settlement say who did what, and nobody below an admin may say it
// for someone else (above). Called only for a caller who is not an admin.
export function refusedSections(stored, next, access, uid) {
  const refused = Object.create(null);
  const refuse = (owner) => { (Array.isArray(owner) ? owner : [owner]).forEach((s) => { refused[s] = true; }); };
  const s = plain(stored) ? stored : {}, n = plain(next) ? next : {};
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
    if (k === 'ledgerLog') { if (!ledgerLogOk(was, now, uid, access)) refuse(owner); continue; }
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
