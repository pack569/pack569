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
    "denMeetingFields": ["adventure", "denAdv", "note", "noteInternal", "advOffers"],
    "dens": ["Lion", "Tiger", "Wolf", "Bear", "Webelos", "Arrow of Light"],
    "denPositions": ["denleader", "asstden"],
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
      "signoffFrom": "ledger",
      "depositDays": "deposits",
      "charges": "dues",
      "collected": "dues",
      "fundraisers": "fundraisers",
      "packName": "sharing",
      "leaders": "people",
      "densAdvancedYear": "admin",
      "densAdvancedSummary": "admin",
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
export const DENS = ACCESS_TABLE.dens.slice();
export const DEN_POSITIONS = ACCESS_TABLE.denPositions.slice();
// The dens a request names for a den leader: distinct DENS names, in DENS order, or null.
export function cleanDens(v) {
  if (!Array.isArray(v) || v.length > DENS.length) return null;
  if (!v.every((d) => typeof d === 'string' && DENS.indexOf(d) !== -1) || new Set(v).size !== v.length) return null;
  return DENS.filter((d) => v.indexOf(d) !== -1);
}
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
// night, a den's own line), its two notes, and the adventures it offers (advOffers; Keith,
// 2026-10-02). Its date, time, place, den, the Cubmaster's pack-wide pick (packAdv), the agenda,
// and everything else stay as they were.
// OWN DEN (Keith, 2026-10-02: enforced in stage 1, for den meetings). `dens` are the dens the
// caller leads (member_positions.dens). A meeting of one den changes only if it is one of theirs;
// on an All-dens night (no den) only their own dens' lines of denAdv change, and nothing else of
// it. A den leader with no den changes no den meeting.
// The values are held to the page's shapes and to a size (security review of 714a920..045e7ac,
// finding 7, and the webelos-woods review): text the page never caps is capped here.
export const DEN_NOTE_MAX = 4000, DEN_ADV_MAX = 200, OFFERS_MAX = 12, OFFER_KEY_MAX = 80, OFFER_DEN_MAX = 20;
const OFFER_KEYS = ['key', 'auto', 'dens', 'part'];
function offersOk(v) {
  if (!Array.isArray(v) || v.length > OFFERS_MAX) return false;
  return v.every((o) => plain(o) && Object.keys(o).every((k) => OFFER_KEYS.indexOf(k) !== -1) &&
    typeof o.key === 'string' && o.key.length <= OFFER_KEY_MAX && typeof o.auto === 'boolean' &&
    (!own(o, 'dens') || (Array.isArray(o.dens) && o.dens.length <= DENS.length &&
      o.dens.every((d) => typeof d === 'string' && d.length <= OFFER_DEN_MAX && DENS.indexOf(d) !== -1))) &&
    (!own(o, 'part') || o.part === true));
}
function denMeetingValuesOk(e) {
  for (const k of ['note', 'noteInternal']) if (own(e, k) && !(typeof e[k] === 'string' && e[k].length <= DEN_NOTE_MAX)) return false;
  if (own(e, 'adventure') && !(typeof e.adventure === 'string' && e.adventure.length <= DEN_ADV_MAX)) return false;
  if (own(e, 'denAdv')) {
    if (!plain(e.denAdv)) return false;
    for (const d of Object.keys(e.denAdv)) {
      const v = e.denAdv[d];
      if (DENS.indexOf(d) === -1 || !(v === false || (typeof v === 'string' && v.length <= DEN_ADV_MAX))) return false;
    }
  }
  return !own(e, 'advOffers') || offersOk(e.advOffers);
}
export function denMeetingChangeOk(before, after, dens) {
  if (!Array.isArray(before) || !Array.isArray(after) || before.length !== after.length) return false;
  const mine = Array.isArray(dens) ? dens.filter((d) => typeof d === 'string' && DENS.indexOf(d) !== -1) : [];
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
    if (!denMeetingValuesOk(e)) return false;
    const den = typeof b.den === 'string' ? b.den : '';
    if (den) {
      if (mine.indexOf(den) === -1) return false;
      continue;
    }
    // An All-dens night: their own dens' lines of denAdv, and nothing else.
    for (const k of DEN_MEETING_FIELDS) {
      if (k === 'denAdv') continue;
      if (own(b, k) !== own(e, k) || !sameJson(b[k], e[k])) return false;
    }
    const db = plain(b.denAdv) ? b.denAdv : {}, da = plain(e.denAdv) ? e.denAdv : {};
    for (const d of Object.keys(db).concat(Object.keys(da))) {
      if ((own(db, d) !== own(da, d) || !sameJson(db[d], da[d])) && mine.indexOf(d) === -1) return false;
    }
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
// A log's size as mergeLedgerLog counts it: the JSON of the list, in bytes.
const logBytes = (list) => 2 + list.reduce((n, e, i) => n + utf8(JSON.stringify(e)) + (i ? 1 : 0), 0);
// An entry a log kept keeps every field it had, with the same value; with cap.exact, it is exactly
// what it was. A field it gains must be one cap.fill names, with the value cap.fill gives it: what
// normalizeSyncLog fills in on a line an older page wrote (security review of 714a920..045e7ac, 4d:
// before, any field could be added to anyone's line).
function keptAsItWas(was, now, cap) {
  if (!plain(was) || !plain(now)) return false;
  if (cap.exact) return sameJson(was, now);
  if (!Object.keys(was).every((k) => own(now, k) && sameJson(was[k], now[k]))) return false;
  const fill = plain(cap.fill) ? cap.fill : {};
  return Object.keys(now).every((k) => own(was, k) || (own(fill, k) && now[k] === fill[k]));
}
// How far ahead of the server's clock a new line's time may be.
export const LOG_AHEAD_MS = 10 * 60 * 1000;
const ISO_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
// An append-only log (state.syncLog, state.ledgerLog: lists of { id, at, byUid, … }) changed from
// `before` to `after` only as its writers do (security review of 714a920..045e7ac, finding 4):
//   - entries added: at most cap.add in one save, each the caller's own (byUid === uid), at most
//     cap.line bytes of JSON, timed (`at`, an ISO time as the page writes it) no later than the
//     server's clock (`now`) plus LOG_AHEAD_MS, so a line "from 2099" can't outlive the rest; and
//     each one `newOk` passes;
//   - the log no longer than its cap (cap.max entries, cap.bytes of JSON), unless it already was,
//     and then no longer than it was;
//   - the oldest dropped by the cap, and only then: every entry dropped sorts before every entry left
//     (the newest dropped before the oldest left: one pass), and only as many as the cap needs: no
//     more than were added where the count is the cap, or, by bytes, the newest one dropped would not
//     have fitted (mergeLedgerLog's own sum);
//   - every entry kept as it was (keptAsItWas). Their order is the writer's to keep.
export function appendOnlyOk(before, after, uid, cap, newOk, now) {
  if (!Array.isArray(after)) return false;
  const clock = typeof now === 'number' ? now : Date.now();
  const prior = Array.isArray(before) ? before : [];
  const was = Object.create(null);
  prior.forEach((e) => { if (plain(e) && typeof e.id === 'string') was[e.id] = e; });
  const seen = Object.create(null);
  let added = 0;
  for (const e of after) {
    if (!plain(e) || typeof e.id !== 'string' || !e.id || seen[e.id]) return false;
    seen[e.id] = true;
    if (own(was, e.id)) { if (!keptAsItWas(was[e.id], e, cap)) return false; continue; }
    added += 1;
    if (added > cap.add || typeof uid !== 'string' || !uid || e.byUid !== uid) return false;
    if (typeof e.at !== 'string' || !ISO_AT.test(e.at) || !(Date.parse(e.at) <= clock + LOG_AHEAD_MS)) return false;
    if (utf8(JSON.stringify(e)) > (cap.line || 4096)) return false;
    if (newOk && !newOk(e)) return false;
  }
  const over = (list) => list.length > cap.max || (cap.bytes && logBytes(list) > cap.bytes);
  if (over(after) && (!over(prior) || after.length > prior.length || (cap.bytes && logBytes(after) > logBytes(prior)))) return false;
  const dropped = Object.keys(was).filter((id) => !seen[id]).map((id) => was[id]);
  if (!dropped.length) return true;
  if (!after.length) return false;
  let newest = dropped[0], oldest = after[0];
  dropped.forEach((d) => { if (logCmp(d, newest) > 0) newest = d; });
  after.forEach((e) => { if (logCmp(e, oldest) < 0) oldest = e; });
  if (!(logCmp(newest, oldest) < 0)) return false;
  if (after.length >= cap.max) return dropped.length <= added;
  if (!cap.bytes) return false;
  // By bytes (security re-check of ce6b8de, finding 2a): no more dropped than was added, to within the
  // one line the cap rounds by (every dropped line but the newest fits in the bytes the new lines take),
  // whatever room the log had before; and the newest dropped would not have fitted (mergeLedgerLog's own
  // sum). Not by count: a leader's one new line can be longer than the two oldest lines it pushes out,
  // and the page has no way to drop less. A log already past its cap (stored before the cap) is only
  // trimmed back toward it, by the second rule.
  const sizeOf = (list) => list.reduce((n, e) => n + utf8(JSON.stringify(e)) + 1, 0);
  const newLines = after.filter((e) => !own(was, e.id));
  if (!over(prior) && sizeOf(dropped) - (utf8(JSON.stringify(newest)) + 1) > sizeOf(newLines)) return false;
  return logBytes(after) + utf8(JSON.stringify(newest)) + 1 > cap.bytes;
}
// The ids of the lines a save drops from a log (an audit row says which: refusedSections' caller).
export function logDropped(before, after) {
  const seen = Object.create(null);
  (Array.isArray(after) ? after : []).forEach((e) => { if (plain(e) && typeof e.id === 'string') seen[e.id] = true; });
  return (Array.isArray(before) ? before : []).filter((e) => plain(e) && typeof e.id === 'string' && !seen[e.id]).map((e) => e.id);
}
// The two logs' caps, as the page keeps them: SYNC_LOG_MAX; mergeLedgerLog's 1000 events and 128 KB.
// The ledger's log is exact (security review of 714a920..045e7ac): a line there is never rewritten,
// not even by a field added to it, whoever edits the ledger. Every line the page writes is whole
// (ledgerEvent), and normalizeLedgerEvent adds nothing to a line a page wrote; a field added to an
// old line (a `why`, an `f`) would change what the trail says was done. The sync log may gain only
// the fields normalizeSyncLog fills in on an older page's line, with the values it gives them.
// A line's size: a sync log line's values are clipped to 200 characters (well under 4 KB); a ledger
// line's `rows` may name every entry a Tick all ticked, so it gets 8 KB. Lines one save may add: the
// ledger's page writes a handful; the conflict chooser logs one line per field a leader keeps, so the
// sync log allows more, and the page keeps to it (SYNC_LOG_ADD_MAX, index.html).
const SYNC_LOG_FILL = { byName: '', byUid: '', key: '', item: '', field: '', serverValue: '', keptValue: '', baseValue: '', mineValue: '',
  kept: 'mine', how: 'item', serverChangedAt: '', serverChangedAfter: '' };
// Security re-check of ce6b8de (2, low): 200 own lines a save let three saves push out everyone's
// conflict history; 50 is more than a leader keeps in one sitting.
export const SYNC_LOG_CAP = { max: 500, line: 4096, add: 50, fill: SYNC_LOG_FILL };
export const LEDGER_LOG_CAP = { max: 1000, bytes: 128 * 1024, exact: true, line: 8192, add: 50 };
// A setting's line from a leader who does not keep the books (finding 2b): one setting's [old, new], a
// few hundred bytes as the page writes it, so a kilobyte is plenty, and a line can't be padded to push
// the trail out (the PoC: 16 lines of 7.9 KB dropped 871 of 900).
export const LEDGER_LOG_SETTING_CAP = Object.assign({}, LEDGER_LOG_CAP, { line: 1024 });

// state.syncLog (shared: any leader who edits something may log a kept-mine), append-only.
export const syncLogOk = (before, after, uid, now) => appendOnlyOk(before, after, uid, SYNC_LOG_CAP, null, now);

// state.ledgerLog, append-only for everyone below an admin, its own editors too: a line there stays
// exactly as it is (LEDGER_LOG_CAP.exact). A leader who edits the ledger adds their own lines of any kind. One
// who does not may add only their own lines recording a pack setting they changed: a book 'edit'
// whose every field is a setting they may edit (ownerOfBookLogField). Commission, goals, the wagon
// date and the deposit days are logged on the book; the people who may set them are not all
// ledger editors (logSettingEdit and its kin, index.html). Such a line (finding 2b) is the shape
// ledgerEvent writes, at most a kilobyte, and each field's value is a pair [old, new] of what that
// setting holds (BOOK_SETTING_OK): a field the table does not name is refused.
// A deposit holder's deposit logs nothing: the ledger's add path logs an 'add' only for a date in a
// reconciled or closed period, and depositRowOk refuses those (the treasurer's review, item 4, closed
// the allowance this had for it). Clearing a deposit's review flag is a ledger editor's, and its line
// is checked with the row (depositReviewsOk).
const pctLike = (v) => v === null || (typeof v === 'number' && isFinite(v)) || (typeof v === 'string' && v.length <= 12 && /^-?[0-9]*\.?[0-9]*$/.test(v));
const centsLike = (v) => v === null || (Number.isInteger(v) && v >= 0 && v <= 1e11);
const BOOK_SETTING_OK = Object.assign(Object.create(null), {
  commissionPct: pctLike, commissionPctOnline: pctLike, cashScoutPct: pctLike, invCommissionPct: pctLike,
  goalCents: centsLike, cashGoalCents: centsLike, stretchGoalCents: centsLike, orderTotalCents: centsLike,
  cashThroughTrailsEnd: (v) => v === null || typeof v === 'boolean',
  wagonViaTEFrom: (v) => v === null || v === '' || (typeof v === 'string' && ISO_DAY.test(v)),
  depositDays: (v) => v === null || (Number.isInteger(v) && v >= 0 && v <= 366)
});
const LEDGER_EVENT_KEYS = ['id', 'at', 'by', 'byUid', 'dev', 'row', 'op', 'f'];
function settingLineOk(e, access) {
  if (!(e.op === 'edit' && e.row === 'book' && plain(e.f) && Object.keys(e.f).length > 0)) return false;
  if (!Object.keys(e).every((k) => LEDGER_EVENT_KEYS.indexOf(k) !== -1)) return false;
  return Object.keys(e.f).every((k) => own(BOOK_SETTING_OK, k) && canEditOwner(access, ownerOfBookLogField(k)) &&
    Array.isArray(e.f[k]) && e.f[k].length === 2 && BOOK_SETTING_OK[k](e.f[k][0]) && BOOK_SETTING_OK[k](e.f[k][1]));
}
export function ledgerLogOk(before, after, uid, access, deposits, now) {
  const ledger = canEditOwner(access, 'ledger');
  return appendOnlyOk(before, after, uid, ledger ? LEDGER_LOG_CAP : LEDGER_LOG_SETTING_CAP, ledger ? null : (e) => settingLineOk(e, access), now);
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

// ---- Parent links and the record's format: an admin's, in sections others edit ----

// state.scouts below an admin (security review of 714a920..045e7ac, finding 2). The roster is the
// Secretary's and the Membership Chair's, but a scout's parent accounts (parentUids, set by an admin
// on the Members card) are the server's authority for who may confirm a family's shift report and
// for the different-family rule (rules.js shiftConfirmers, sameFamily), and a linked scout's family
// (familyId) decides who is in which family there. So below an admin: every scout's parentUids stay
// exactly as they are (missing is []); a scout added has none; a scout with any is not removed; and a
// scout with any keeps its familyId (missing is ''). An unlinked scout's family is the roster's.
export function parentLinksOk(before, after) {
  if (!Array.isArray(after)) return false;
  const uids = (sc) => (Array.isArray(sc.parentUids) ? sc.parentUids : own(sc, 'parentUids') ? null : []);
  const fam = (sc) => (own(sc, 'familyId') ? sc.familyId : '');
  const was = Object.create(null);
  (Array.isArray(before) ? before : []).forEach((sc) => { if (plain(sc) && typeof sc.id === 'string') was[sc.id] = sc; });
  const seen = Object.create(null);
  for (const sc of after) {
    if (!plain(sc) || typeof sc.id !== 'string') return false;
    seen[sc.id] = true;
    const now = uids(sc);
    if (now === null) return false;
    if (!own(was, sc.id)) { if (now.length) return false; continue; }
    const had = uids(was[sc.id]) || [];
    if (!sameJson(had, now)) return false;
    if (had.length && !sameJson(fam(was[sc.id]), fam(sc))) return false;
  }
  return Object.keys(was).every((id) => seen[id] || !(uids(was[id]) || []).length);
}

// The record's `version` and `fmt` (finding 3). normalizeState refuses a record whose version is not
// 1, and a fmt above a page's PACK_FORMAT holds every push of that page (formatAhead): one leader
// setting either would stop the whole pack saving. Below an admin: version stays as it is (or is
// written as 1 where the record had none); fmt stays as it is, or is written as PACK_FORMAT (this
// server's, below) where the record had none or a lower one. Security re-check of ce6b8de, finding 1:
// "rises by exactly one" let any leader set 5 -> 6 while every page was still at 5, so every page,
// the admins' too, held its pushes. The server and the page deploy together (one Pages project), so
// the format they agree on is a constant here: the harness checks it equals the page's PACK_FORMAT.
export const PACK_FORMAT = 5;
export function versionOk(s, hasS, n, hasN) {
  if (hasS && hasN) return sameJson(s, n);
  if (!hasS && !hasN) return true;
  return !hasS && n === 1;
}
export function fmtOk(s, hasS, n, hasN) {
  if (hasS && hasN && sameJson(s, n)) return true;
  if (!hasS && !hasN) return true;
  if (!hasN || n !== PACK_FORMAT) return false;
  return !hasS || (Number.isInteger(s) && s < PACK_FORMAT);
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
          // Security re-check of ce6b8de, finding 3: the marker is refused wherever the accept PATCH would
          // refuse it, with the override the page names for each (acceptShiftReport): in the sender's
          // family (rules.js sameFamily, from the stored record: ctx.sameFamily; unknown is the same
          // family, failing closed as the PATCH does), 'same-family'; two families, nobody confirmed,
          // 'second-parent'; one family and the cash not collected, 'not-collected'. Collecting it is
          // never this leader's in the sender's family.
          const same = typeof c.sameFamily === 'function' ? c.sameFamily(uid, row.submitted_by_uid) === true : true;
          if (collected && (same || confirmed || row.needs_confirm !== 0)) return false;
          const required = same ? 'same-family' : confirmed || collected ? '' : row.needs_confirm === 1 ? 'second-parent' : 'not-collected';
          if (override !== required) return false;
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
// may add (Keith, 2026-10-02: the kernel records the deposit, the treasurer reviews it). An
// ALLOWLIST of the fields the page's add form writes (normalizeLedgerRow), each with what it may
// hold (security review of 714a920..045e7ac, finding 5, and the treasurer's review, item 4):
// money in, a whole number of cents above 0 and at most DEPOSIT_MAX_CENTS; marked as storefront
// cash and nobody's payment; no budget line (the treasurer files it); entered by the caller;
// flagged for the treasurer (depositReview: true; the treasurer's review takes it off); nothing the
// ledger's own steps set (not ticked, approved, voided or reversed). And dated where nothing is
// signed off yet: the book not closed out, the date after the period already reconciled
// (book.reconciledThrough) and not before the opening date. Stricter than the warning a ledger
// editor gets for a back-dated add, on purpose: the treasurer can still enter it.
export const DEPOSIT_MAX_CENTS = 10000000;   // $100,000
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const shortText = (max) => (v) => typeof v === 'string' && v.length <= max;
const DEPOSIT_FIELDS = {
  id: (v) => typeof v === 'string' && v.length > 0 && v.length <= 128,
  date: (v) => typeof v === 'string' && ISO_DAY.test(v),
  description: shortText(500), ref: shortText(200), donor: shortText(200), method: shortText(40),
  amountCents: (v) => Number.isInteger(v) && v > 0 && v <= DEPOSIT_MAX_CENTS,
  direction: (v) => v === 'in', source: (v) => v === 'storefront', depositReview: (v) => v === true,
  lineId: (v) => v === '', scoutId: (v) => v === '', tierMakeup: (v) => v === '',
  reimbursement: (v) => v === false, notCommission: (v) => v === false, reconciled: (v) => v === false,
  approvedBy: (v) => v === '', approvedAt: (v) => v === '', approvedByUid: (v) => v === '',
  depositFor: shortText(4000), depositFrom: (v) => v === '' || (typeof v === 'string' && ISO_DAY.test(v)),
  depositTo: (v) => v === '' || (typeof v === 'string' && ISO_DAY.test(v)),
  enteredBy: shortText(120), enteredAt: shortText(40), enteredByUid: () => true
};
const DEPOSIT_NEEDS = ['id', 'date', 'amountCents', 'direction', 'source', 'depositReview', 'enteredByUid'];
// Security re-check of ce6b8de, finding 5: a deposit is dated no later than a week past the server's
// day (a slip dated tomorrow is fine; 2099 is not), at most DEPOSITS_PER_SAVE of them come in one save
// (the page adds one a tap), and the name it is entered under is the caller's own, as the page signs
// (signerName: their member name), not "Treasurer".
export const DEPOSIT_AHEAD_DAYS = 7, DEPOSITS_PER_SAVE = 10;
const isoDayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
export function depositRowOk(e, uid, book, name, now) {
  if (!plain(e) || typeof uid !== 'string' || !uid || e.enteredByUid !== uid) return false;
  if (!DEPOSIT_NEEDS.every((k) => own(e, k))) return false;
  if (!Object.keys(e).every((k) => own(DEPOSIT_FIELDS, k) && DEPOSIT_FIELDS[k](e[k]))) return false;
  if (e.enteredBy !== signerName(name)) return false;
  const clock = typeof now === 'number' ? now : Date.now();
  if (e.date > isoDayOf(clock + DEPOSIT_AHEAD_DAYS * 86400000)) return false;
  const bk = plain(book) ? book : {};
  if (bk.closedAt) return false;
  const rt = typeof bk.reconciledThrough === 'string' ? bk.reconciledThrough : '';
  if (rt && e.date <= rt) return false;
  const od = typeof bk.openingDate === 'string' ? bk.openingDate : '';
  return !(od && e.date < od);
}
// state.ledger changed by such a leader: every row there still there, as it was (by id), and every row
// added a deposit (depositRowOk), at most DEPOSITS_PER_SAVE. Returns the ids added, or null when it is
// anything else.
export function depositRowsAdded(before, after, uid, book, name, now) {
  if (!Array.isArray(after)) return null;
  const was = Object.create(null);
  (Array.isArray(before) ? before : []).forEach((e) => { if (plain(e) && typeof e.id === 'string') was[e.id] = e; });
  const seen = Object.create(null), added = [];
  for (const e of after) {
    if (!plain(e) || typeof e.id !== 'string' || !e.id || seen[e.id]) return null;
    seen[e.id] = true;
    if (own(was, e.id)) { if (!sameJson(was[e.id], e)) return null; continue; }
    if (added.length >= DEPOSITS_PER_SAVE || !depositRowOk(e, uid, book, name, now)) return null;
    added.push(e.id);
  }
  return Object.keys(was).every((id) => seen[id]) ? added : null;
}

// ---- The treasurer's check of a flagged deposit, below an admin (security re-check of ce6b8de, 4) ----
// The page (deposit-review-ok) takes the flag off a storefront deposit only for whoever keeps the books,
// never the leader who entered it, and stamps who and when, with a ledgerLog line. The server holds the
// same: for a leader who edits the ledger (one who doesn't can't change a row at all), a row that was
// flagged (depositReview: true) and is not any more:
//   - was not entered by the caller (enteredByUid);
//   - names the caller as its reviewer, by uid and by the name the page signs with (signerName);
//   - was reviewed within REVIEW_CLOCK_MS of the server's clock;
//   - comes with the caller's own new ledgerLog line saying so (op 'edit', its row, f.depositReview [true, null]).
// The review stamps change only then: never on another row, and a row added carries none. A deposit of
// storefront cash such a leader adds carries the flag when the page's rule says it must
// (depositSelfCollected): a storefront it covers has a block whose cash the caller collected, as the
// record says it (an accept that collected it, or the cash from sales marked collected, under the
// caller's signed name). The page also reads the server's reports, so it flags at least these.
// Returns the ids reviewed (for the audit row 'ledger.deposit.review'), or null when refused.
export const REVIEW_CLOCK_MS = 10 * 60 * 1000;
const REVIEW_STAMPS = ['depositReviewedBy', 'depositReviewedByUid', 'depositReviewedAt'];
function depositCoveredIds(e, storefronts) {
  const ids = String(typeof e.depositFor === 'string' ? e.depositFor : '').split(',').map((x) => x.trim()).filter((x) => x);
  const from = typeof e.depositFrom === 'string' ? e.depositFrom : '', to = typeof e.depositTo === 'string' ? e.depositTo : '';
  return (Array.isArray(storefronts) ? storefronts : []).filter((sf) => plain(sf) && (ids.indexOf(sf.id) !== -1 ||
    (from && to && typeof sf.date === 'string' && sf.date >= from && sf.date <= to)));
}
export function depositSelfCollectedOk(e, storefronts, me) {
  return depositCoveredIds(e, storefronts).some((sf) => (Array.isArray(sf.blocks) ? sf.blocks : []).some((b) => plain(b) &&
    ((b.reportCollected === true && b.reportApprovedBy === me) ||
      (Array.isArray(b.salesCash) ? b.salesCash : []).some((x) => plain(x) && plain(x.outcome) && x.outcome.outcome === 'collected' && x.outcome.by === me))));
}
export function depositReviewsOk(s, n, uid, name, now) {
  const before = Array.isArray(s.ledger) ? s.ledger : [], after = Array.isArray(n.ledger) ? n.ledger : [];
  const me = signerName(name), clock = typeof now === 'number' ? now : Date.now();
  const was = Object.create(null);
  before.forEach((e) => { if (plain(e) && typeof e.id === 'string') was[e.id] = e; });
  const hadLine = Object.create(null);
  (Array.isArray(s.ledgerLog) ? s.ledgerLog : []).forEach((l) => { if (plain(l) && typeof l.id === 'string') hadLine[l.id] = true; });
  const myLines = (Array.isArray(n.ledgerLog) ? n.ledgerLog : []).filter((l) => plain(l) && !hadLine[l.id] && l.byUid === uid);
  const sfs = Array.isArray(n.storefronts) ? n.storefronts : s.storefronts;
  const reviewed = [];
  for (const e of after) {
    if (!plain(e) || typeof e.id !== 'string') continue;
    const b = own(was, e.id) ? was[e.id] : null;
    if (!b) {
      if (REVIEW_STAMPS.some((k) => own(e, k))) return null;
      if (e.source === 'storefront' && e.direction === 'in' && e.depositReview !== true && depositSelfCollectedOk(e, sfs, me)) return null;
      continue;
    }
    const cleared = b.depositReview === true && e.depositReview !== true;
    if (!cleared) {
      if (REVIEW_STAMPS.some((k) => own(b, k) !== own(e, k) || !sameJson(b[k], e[k]))) return null;
      continue;
    }
    if (typeof b.enteredByUid === 'string' && b.enteredByUid === uid) return null;
    if (e.enteredByUid !== b.enteredByUid) return null;
    if (e.depositReviewedByUid !== uid || e.depositReviewedBy !== me) return null;
    const at = typeof e.depositReviewedAt === 'string' && ISO_AT.test(e.depositReviewedAt) ? Date.parse(e.depositReviewedAt) : NaN;
    if (!(Math.abs(at - clock) <= REVIEW_CLOCK_MS)) return null;
    if (!myLines.some((l) => l.op === 'edit' && l.row === e.id && plain(l.f) && sameJson(l.f.depositReview, [true, null]))) return null;
    reviewed.push(e.id);
  }
  return reviewed;
}

// The sections (and buckets) a write from `stored` to `next` (both parsed records) changes that
// `access` may not edit, sorted; [] when it may make every change in it. `uid` is the caller's: the
// logs, the statements and the settlement say who did what, and nobody below an admin may say it
// for someone else (above). `actions` (effectiveActions) lets a shiftVerify holder write a shift
// report's fields on the storefronts. Called only for a caller who is not an admin.
//
// `ctx` is what the PUT read for it: { reports } (shift_reports rows, by id: storefrontReportIds) and
// { name } (the caller's member name), for the storefronts slice; { now } (ms) for the logs; { dens }
// (the dens the caller leads) for den meetings.
export function refusedSections(stored, next, access, uid, actions, ctx) {
  const cx = plain(ctx) ? ctx : {};
  const refused = Object.create(null);
  const refuse = (owner) => { (Array.isArray(owner) ? owner : [owner]).forEach((s) => { refused[s] = true; }); };
  const s = plain(stored) ? stored : {}, n = plain(next) ? next : {};
  const can = plain(actions) ? actions : {};
  // A deposit holder who does not edit the ledger: the deposits they add, which their own log lines may name.
  let deposits = [];
  if (!canEditOwner(access, 'ledger') && access.deposits === 'edit' && !sameTop(s.ledger, own(s, 'ledger'), n.ledger, own(n, 'ledger'))) {
    deposits = depositRowsAdded(own(s, 'ledger') ? s.ledger : [], own(n, 'ledger') ? n.ledger : [], uid, s.book, cx.name, cx.now);
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
    // The record's format: an admin's to change (versionOk, fmtOk), whoever may write the rest.
    if (k === 'version') { if (!versionOk(s[k], hasS, n[k], hasN)) refuse('admin'); continue; }
    if (k === 'fmt') { if (!fmtOk(s[k], hasS, n[k], hasN)) refuse('admin'); continue; }
    if (sameTop(s[k], hasS, n[k], hasN)) continue;
    const owner = ownerOfKey(k);
    const was = hasS ? s[k] : [], now = hasN ? n[k] : [];
    // The ledger's log: its own rule, for ledger editors and the setting-changers alike.
    if (k === 'ledgerLog') { if (!ledgerLogOk(was, now, uid, access, deposits || [], cx.now)) refuse(owner); continue; }
    if (k === 'ledger' && !canEditOwner(access, owner)) { if (!deposits || !deposits.length) refuse(owner); continue; }
    if (k === 'storefronts' && !canEditOwner(access, owner)) {
      if (!(can.shiftVerify === true && storefrontReportChangeOk(was, now, uid, { reports: cx.reports, name: cx.name, canUndo: can.shiftUndo === true,
        sameFamily: cx.sameFamily }))) refuse(owner);
      continue;
    }
    if (canEditOwner(access, owner)) {
      if (k === 'ledger' && depositReviewsOk(s, n, uid, cx.name, cx.now) === null) refuse(owner);
      else if (k === 'syncLog' && !syncLogOk(was, now, uid, cx.now)) refuse(owner);
      else if (k === 'statements' && !statementsOk(was, now, uid)) refuse(owner);
      else if (k === 'book' && !councilSettledOk(s[k], n[k], uid)) refuse(owner);
      else if (k === 'scouts' && !parentLinksOk(was, now)) refuse('admin');
      continue;
    }
    if (k === 'events' && access['calendar.denmeeting'] === 'edit' && denMeetingChangeOk(was, now, cx.dens)) continue;
    refuse(owner);
  }
  return Object.keys(refused).sort();
}

// The audit rows a save below an admin writes beside itself, once refusedSections has passed it
// (security re-check of ce6b8de, findings 2c and 4): the ledger's own log is written by the page, so
// the server keeps its own note of the two things a leader could otherwise do quietly:
//   'ledger.deposit.review'  the flagged deposits this save marked as checked (depositReviewsOk);
//   'ledger.log.drop'        lines of the ledger's log this save dropped (the cap pushing the oldest
//                            out, which a padded line could otherwise do to the whole trail).
// [{ action, detail }], each detail a few hundred bytes to under 2 KB (the audit table's CHECK).
const AUDIT_DETAIL_MAX = 1800;
function idsThatFit(ids, base) {
  const out = [];
  for (const id of ids) {
    if (JSON.stringify(Object.assign({}, base, { ids: out.concat([id]) })).length > AUDIT_DETAIL_MAX) break;
    out.push(id);
  }
  return out;
}
export function putAudits(stored, next, uid, name, now) {
  const s = plain(stored) ? stored : {}, n = plain(next) ? next : {}, out = [];
  if (!sameTop(s.ledger, own(s, 'ledger'), n.ledger, own(n, 'ledger'))) {
    const reviewed = depositReviewsOk(s, n, uid, name, now) || [];
    if (reviewed.length) {
      const base = { count: reviewed.length };
      out.push({ action: 'ledger.deposit.review', detail: Object.assign(base, { ids: idsThatFit(reviewed, base) }) });
    }
  }
  if (Array.isArray(s.ledgerLog) && !sameTop(s.ledgerLog, true, n.ledgerLog, own(n, 'ledgerLog'))) {
    const gone = logDropped(s.ledgerLog, n.ledgerLog);
    if (gone.length) {
      const ats = s.ledgerLog.filter((e) => plain(e) && gone.indexOf(e.id) !== -1).map((e) => String(e.at || '')).sort();
      const base = { count: gone.length, oldest: ats[0] || '', newest: ats[ats.length - 1] || '' };
      out.push({ action: 'ledger.log.drop', detail: Object.assign(base, { ids: idsThatFit(gone, base) }) });
    }
  }
  return out;
}
