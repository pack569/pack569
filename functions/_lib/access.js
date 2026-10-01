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
// admin writes.
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
//                     changes: rev, the format, the one-time notices) and 'admin' (archives and
//                     closed books: admins only, legacy editors included). A key not listed is
//                     'admin': an unknown key fails closed.
//   goneOwner         state.gone is split by its sub-keys (the deletion marks of each log), so a
//                     mark for the ledger cannot be written by someone who cannot edit the ledger.
//                     A sub-key not listed is 'admin'.
export const ACCESS_TABLE = /*ACCESS-BEGIN*/{
    "positions": [
      {"id": "chair", "label": "Committee Chair"},
      {"id": "cubmaster", "label": "Cubmaster"},
      {"id": "asstcub", "label": "Assistant Cubmaster"},
      {"id": "denleader", "label": "Den Leader"},
      {"id": "asstden", "label": "Assistant Den Leader"},
      {"id": "treasurer", "label": "Treasurer"},
      {"id": "kernel", "label": "Popcorn Kernel"},
      {"id": "advancement", "label": "Advancement Chair"},
      {"id": "outdoor", "label": "Camping Chair"},
      {"id": "membership", "label": "Membership Chair"},
      {"id": "parent", "label": "Parent"}
    ],
    "sections": ["home", "calendar", "calendar.denmeeting", "attendance", "denplan", "derby", "camping", "roster", "advancement", "joining", "storefronts", "totals", "rewards", "inventory", "council", "budget", "ledger", "dues", "fundraisers", "sharing", "people", "season"],
    "denMeetingFields": ["adventure", "denAdv", "note", "noteInternal"],
    "access": {
      "chair": {"default": "read", "edit": ["calendar", "calendar.denmeeting", "attendance", "derby", "joining", "budget", "ledger", "dues", "fundraisers", "people", "season"], "hidden": []},
      "cubmaster": {"default": "read", "edit": ["calendar", "calendar.denmeeting", "attendance", "denplan", "derby", "camping", "advancement", "season"], "hidden": []},
      "asstcub": {"default": "read", "edit": ["calendar", "calendar.denmeeting", "attendance", "denplan", "derby", "camping", "advancement", "season"], "hidden": []},
      "denleader": {"default": "read", "edit": ["calendar.denmeeting", "attendance", "denplan", "advancement"], "hidden": ["inventory", "council", "ledger", "dues", "fundraisers", "people"]},
      "asstden": {"default": "read", "edit": ["calendar.denmeeting", "attendance", "denplan", "advancement"], "hidden": ["inventory", "council", "ledger", "dues", "fundraisers", "people"]},
      "treasurer": {"default": "read", "edit": ["budget", "ledger", "dues", "fundraisers"], "hidden": []},
      "kernel": {"default": "read", "edit": ["storefronts", "totals", "rewards", "inventory", "council"], "hidden": []},
      "advancement": {"default": "read", "edit": ["advancement"], "hidden": ["inventory", "council", "ledger", "dues", "fundraisers"]},
      "outdoor": {"default": "read", "edit": ["camping"], "hidden": ["inventory", "council", "ledger", "dues", "fundraisers"]},
      "membership": {"default": "read", "edit": ["roster", "joining"], "hidden": ["inventory", "council", "ledger", "dues", "fundraisers"]},
      "parent": {"default": "hidden", "edit": [], "hidden": []}
    },
    "keyOwner": {
      "version": "shared",
      "fmt": "shared",
      "rev": "shared",
      "startHereDismissed": "shared",
      "movedNoticeDismissed": "shared",
      "balooNoticeDismissed": "shared",
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
      "rewardTiers": "rewards",
      "inventory": "inventory",
      "popcornCouncil": "council",
      "budget": "budget",
      "ledger": "ledger",
      "book": "ledger",
      "ledgerAside": "ledger",
      "ledgerLog": "ledger",
      "statements": "ledger",
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
    "goneOwner": {"entries": "totals", "imports": "totals", "ledger": "ledger", "distributions": "inventory", "products": "inventory", "sales": "fundraisers", "fundraisers": "fundraisers", "scouts": "roster"}
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

// What a member may do with each section, from their role and (for 'leader') their positions:
// section -> level, for every section and both buckets.
//   admin    edit everything, the admin bucket too.
//   editor   (legacy: full edit until an admin assigns positions) edit every section and
//            'shared'; read 'admin'.
//   viewer   (legacy) read everything.
//   leader   per section, the most permissive of their positions. Positions this file does not
//            know are ignored. 'shared' is edit when any section is; 'admin' is read.
//            'calendar' edit carries 'calendar.denmeeting' edit with it.
//   anything else (parent, pending, none): hidden everywhere.
export function effectiveAccess(role, positions) {
  const out = {};
  const fill = (v) => { SECTIONS.concat(BUCKETS).forEach((s) => { out[s] = v; }); };
  if (role === 'admin') { fill('edit'); return out; }
  if (role === 'editor') { fill('edit'); out.admin = 'read'; return out; }
  if (role === 'viewer') { fill('read'); return out; }
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

// The sections (and buckets) a write from `stored` to `next` (both parsed records) changes that
// `access` may not edit, sorted; [] when it may make every change in it.
export function refusedSections(stored, next, access) {
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
    if (canEditOwner(access, owner)) continue;
    if (k === 'events' && access['calendar.denmeeting'] === 'edit' && denMeetingChangeOk(hasS ? s[k] : [], hasN ? n[k] : [])) continue;
    refuse(owner);
  }
  return Object.keys(refused).sort();
}
