// Pack 569 — who may read and write what. SETUP.md Part C, re-implemented on the server.
//
// Part C (the Firestore security rules) is the source of truth. Each function below carries
// the Part C line it implements, word for word, in PART_C; the harness checks every quoted
// line is still in SETUP.md, so a change to Part C fails the build until this file follows.
//
// Roles come from the members table only — never from the request. The caller's role is
// 'none' when they have no member row. A job (cubmaster, treasurer, …) never appears here:
// jobs are a lens in the page, not a permission.
//
// Two rules Part C could not hold, because Firestore rules cannot count or see intent, and
// the page enforced them alone. The server now enforces both:
//   - THE LAST ADMIN. No change may leave a pack with no admin (the page: isLastAdmin).
//   - REQUEST MODE. The sign-up link only ever files a 'pending' request; the join config's
//     mode is 'request' and cannot be written as anything else (the page: joinMode()).
//
// Stricter than Part C, deliberately: every request needs a verified Google token
// (functions/_lib/token.js). Part C let any signed-in session read its own member doc and
// its own invite; here that session must also be a verified Google account.

export const ROLES = ['admin', 'editor', 'viewer', 'parent', 'pending'];
export const LEADER_ROLES = ['admin', 'editor', 'viewer'];
// Part C: an invite's role must be one of these. 'admin' is granted in person, never by invite.
export const INVITE_ROLES = ['editor', 'viewer', 'parent'];
export const MEMBER_NAME_MAX = 120;               // Part C memberKeysOk(): name.size() <= 120
export const JOIN_CODE_RE = /^[A-Za-z0-9]{1,64}$/; // the page's JOIN_CODE_RE
export const CONTACT_MAX = 160;                   // the page's cleanContactLine()
export const UID_RE = /^[A-Za-z0-9:_-]{1,128}$/;

// The Part C text each rule mirrors, by rule id. Quoted exactly as SETUP.md has it.
export const PART_C = {
  'packmeta.read': ["match /packmeta/{doc} {\n      allow read: if request.auth != null;"],
  'packmeta.create': ["request.resource.data.owner == request.auth.uid"],
  'packmeta.immutable': ["allow update, delete: if false;"],
  'pack.read': ["// Leaders only — parents and not-yet-approved users never receive the ledger.\n      allow read:  if isLeader();"],
  'pack.write': ["allow read:  if isLeader();\n      allow write: if myRole() in ['admin', 'editor'];"],
  'join.read': ["match /public/join {\n        allow read:  if isLeader();"],
  'join.write': ["allow read:  if isLeader();\n        allow write: if isAdmin();"],
  'view.read': ["allow read:  if myRole() in ['admin', 'editor', 'viewer', 'parent'];"],
  'view.write': ["allow read:  if myRole() in ['admin', 'editor', 'viewer', 'parent'];\n        allow write: if myRole() in ['admin', 'editor'];"],
  'members.read': ["allow read: if isLeader() || (signedIn() && request.auth.uid == uid);"],
  'members.create.self': ["allow create: if signedIn() && request.auth.uid == uid && viaGoogle()\n          && ownEmail() && memberKeysOk()"],
  'members.create.owner': ["( (ownerUid() == request.auth.uid && request.resource.data.role == 'admin')"],
  'members.create.invite': ["&& invitedRole() in ['editor', 'viewer', 'parent']\n                    && request.resource.data.role == invitedRole() )"],
  'members.create.join': ["( request.resource.data.role == 'pending'\n                    && exists(joinPath())\n                    && joinCfg().open == true\n                    && request.resource.data.joinCode == joinCfg().code ) );"],
  'members.keys': ["request.resource.data.keys().hasOnly(['role', 'name', 'email', 'addedAt', 'joinCode'])",
    "&& request.resource.data.name.size() <= 120"],
  'members.admin': ["allow update, delete: if isAdmin();"],
  'members.update.self': ["// Your own doc, written back with the same role.\n        allow update: if signedIn() && request.auth.uid == uid\n          && request.resource.data.role == resource.data.role"],
  'members.update.owner': ["// The pack owner can always restore their own admin role.\n        allow update: if signedIn() && request.auth.uid == uid\n          && ownerUid() == request.auth.uid\n          && request.resource.data.role == 'admin'"],
  'invites.read': ["match /invites/{email} {\n        allow read: if isAdmin() || (signedIn() && myEmailKey() == email);"],
  'invites.write': ["allow create, update: if isAdmin()\n          && request.resource.data.role in ['editor', 'viewer', 'parent']\n          && request.resource.data.email == email"],
  'invites.delete': ["allow delete: if isAdmin() || (signedIn() && myEmailKey() == email);"],
  'viaGoogle': ["return request.auth.token.firebase.sign_in_provider == 'google.com'\n          && request.auth.token.email_verified == true;"]
};

// isLeader(): myRole() in ['admin', 'editor', 'viewer']
export const isLeader = (role) => LEADER_ROLES.indexOf(role) !== -1;
// isAdmin(): myRole() == 'admin'
export const isAdmin = (role) => role === 'admin';

// packs/{doc} — 'pack.read': allow read: if isLeader();
export const canReadPack = (role) => isLeader(role);
// packs/{doc} — 'pack.write': allow write: if myRole() in ['admin', 'editor'];
export const canWritePack = (role) => role === 'admin' || role === 'editor';

// public/join — 'join.read': allow read: if isLeader();  (the live code: leaders only)
export const canReadJoin = (role) => isLeader(role);
// public/join — 'join.write': allow write: if isAdmin();
export const canWriteJoin = (role) => isAdmin(role);

// public/view — 'view.read': approved members, never 'pending'
export const canReadView = (role) => ['admin', 'editor', 'viewer', 'parent'].indexOf(role) !== -1;
// public/view — 'view.write': allow write: if myRole() in ['admin', 'editor'];
export const canWriteView = (role) => canWritePack(role);

// members — 'members.read': the roster to leaders; to anyone else, only their own record.
export const canReadRoster = (role) => isLeader(role);
export const canReadMember = (role, uid, target) => isLeader(role) || uid === target;

// members — create. Only your own row (the server writes uid, email and name from the
// token, which is 'members.create.self'), and only as one of exactly three things:
//   'members.create.owner'   the pack owner, as admin;
//   'members.create.invite'  exactly the role an admin invited your email as;
//   'members.create.join'    'pending', through the sign-up link while it is open and the
//                            code is current.
// Returns the role to create, or null. The SQL in /api/session re-checks the invite and the
// join config in the same statement that inserts, so a revoke or a new code between this
// check and the write still wins.
export function memberCreateRole(o) {
  if (o.isOwner) return 'admin';
  if (o.invitedRole && INVITE_ROLES.indexOf(o.invitedRole) !== -1) return o.invitedRole;
  if (o.join && o.join.open === 1 && typeof o.joinCode === 'string' && o.joinCode === o.join.code) return 'pending';
  return null;
}

// members — update. 'members.admin': an admin may change anyone. Otherwise only your own row:
// 'members.update.self' with the role unchanged, or 'members.update.owner' restoring the
// owner's own admin role. (The last-admin guard is on top of this, in SQL.)
export function canUpdateMember(o) {
  if (isAdmin(o.role)) return true;
  if (o.uid !== o.target) return false;
  if (o.nextRole === o.currentRole) return true;
  return !!o.isOwner && o.nextRole === 'admin';
}
// members — delete. 'members.admin': allow update, delete: if isAdmin();
export const canDeleteMember = (role) => isAdmin(role);

// invites — 'invites.read': an admin lists them all; you may read the one for your own email.
export const canListInvites = (role) => isAdmin(role);
export const canReadInvite = (role, emailKey, target) => isAdmin(role) || emailKey === target;
// invites — 'invites.write': admins only, and never for admin (or pending).
export const canWriteInvite = (role, inviteRole) => isAdmin(role) && INVITE_ROLES.indexOf(inviteRole) !== -1;
// invites — 'invites.delete': an admin revokes; the invitee consumes their own.
export const canDeleteInvite = (role, emailKey, target) => isAdmin(role) || emailKey === target;

// public/view — WHAT a parent view may hold (security review of stage A, finding 7). Part C
// only said who may write it; the page's buildParentView (index.html) is the allowlist of what
// a family may see, and the server used to store whatever a leader's device sent. Now it
// holds the view to the same shape:
//   - top-level keys only from PARENT_VIEW_KEYS, which are buildParentView's own (the harness
//     reads the function and fails if the two lists drift apart);
//   - none of PARENT_VIEW_STANDINGS_KEYS while the pack has "show standings" off: those are
//     exactly what buildParentView writes after `if (!withStandings) return out;`;
//   - no key named noteInternal anywhere in it (leaders-only meeting notes; the page's
//     "MUST NOT reach any outbound surface"), nor advNotes or advPlanEdits (each den's notes on
//     a lesson plan, and the pack's own edits to the plans: leaders only, security review of the
//     lesson plans, 2026-09-30). buildParentView never writes any of them; this is the backstop
//     for a page that one day did. The refusal's reason is 'view-note-internal' for all three
//     (the name it already had, which the import's audit records);
//   - nested no deeper than PARENT_VIEW_MAX_DEPTH, so the database can always edit it.
// generatedAt is not in the list: the server stamps its own, and drops one that is sent.
export const PARENT_VIEW_KEYS = ['rev', 'packName', 'programYear', 'events', 'camping', 'welcome', 'contact', 'familyCost',
  'standings', 'goals', 'derby', 'tiers', 'tierLadder'];
export const PARENT_VIEW_STANDINGS_KEYS = ['standings', 'goals', 'derby', 'tiers', 'tierLadder'];
export const PARENT_VIEW_NEVER_KEYS = ['noteInternal', 'advNotes', 'advPlanEdits'];
// How many objects and arrays deep a view may nest, the view itself being 1. See below.
export const PARENT_VIEW_MAX_DEPTH = 64;
// Why this view may not be stored, or null if it may. `view` is a parsed JSON object.
export function parentViewProblem(view, showStandings) {
  for (const k of Object.keys(view)) {
    if (PARENT_VIEW_KEYS.indexOf(k) === -1) return 'view-key';
    if (!showStandings && PARENT_VIEW_STANDINGS_KEYS.indexOf(k) !== -1) return 'view-standings-off';
  }
  // Every key at every depth, without recursion (a deep payload cannot blow the stack).
  // And no deeper than PARENT_VIEW_MAX_DEPTH: SQLite's JSON functions refuse nesting past
  // 1000, so a deeper view would store, and then make the json_remove in PUT /join fail —
  // rolling back the switch that turns standings off, and leaving them showing (security
  // review of 5690c3a..20b4fd6, item 2). buildParentView writes a handful of levels.
  const stack = [[view, 1]];
  while (stack.length) {
    const [v, depth] = stack.pop();
    if (!v || typeof v !== 'object') continue;
    if (depth > PARENT_VIEW_MAX_DEPTH) return 'view-too-deep';
    if (!Array.isArray(v)) {
      for (const k of Object.keys(v)) if (PARENT_VIEW_NEVER_KEYS.indexOf(k) !== -1) return 'view-note-internal';
    }
    for (const k of Object.keys(v)) stack.push([v[k], depth + 1]);
  }
  return null;
}

// The page's cleanContactLine: one line, plain text, capped.
export function cleanContactLine(v) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, CONTACT_MAX);
}
// An email as an invite key: lowercased and trimmed, like the page's inviteEmailKey — and
// then refused unless it looks like an address with no slash, space or percent sign in it.
export function emailKey(raw) {
  const k = String(raw == null ? '' : raw).trim().toLowerCase();
  return /^[^\s\/%@]+@[^\s\/%@]+\.[^\s\/%@]+$/.test(k) && k.length <= 320 ? k : null;
}

// ---- Shift reports (migrations/0003_shift_reports.sql) ----
// Not a Firestore rule: Part C never had them, and the Firestore page never shows them. A
// family sends a storefront shift's two totals and signs that they counted them; a leader
// accepts the report as the second sign-off. SETUP.md Part C, "Shift reports", says the same
// in prose.

// Who may send a report: any approved member — never 'pending', never someone with no row.
export const canSubmitShiftReport = (role) => ['admin', 'editor', 'viewer', 'parent'].indexOf(role) !== -1;
// Who may accept one or send it back: the people who may write the pack record, since
// accepting is what puts the figures into it.
export const canReviewShiftReport = (role) => canWritePack(role);
// Who sees every report in full (names, amounts, notes): the leaders, as with the ledger. A
// parent sees their own in full, and of anyone else's only which blocks are spoken for.
export const canReadAllShiftReports = (role) => isLeader(role);

export const SHIFT_REPORT_MAX_CENTS = 1000000;    // $10,000: the migration's CHECK
export const SHIFT_REPORT_NOTE_MAX = 300;
export const SHIFT_REPORT_DAYS = 14;              // how long after the shift a report may be sent
export const SHIFT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;   // the page's uid(), with room to spare
// The pack's own calendar. The server has no "today" of its own anywhere else, and the page's
// todayISO() is the device's local date; Pack 569 meets in Eastern time, so a shift on
// Saturday is "today" all Saturday evening there, whatever UTC says.
export const PACK_TIME_ZONE = 'America/New_York';

// Today's date in the pack's time zone, as YYYY-MM-DD, at `ms` (default: now).
export function packToday(ms) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: PACK_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(ms === undefined ? Date.now() : ms));
  const get = (t) => parts.filter((p) => p.type === t)[0].value;
  return get('year') + '-' + get('month') + '-' + get('day');
}
// Whole days from date `a` to date `b` (both YYYY-MM-DD), or NaN if either is not a date.
export function daysBetween(a, b) {
  const t = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s)) ? Date.parse(s + 'T00:00:00Z') : NaN);
  return Math.round((t(b) - t(a)) / 86400000);
}

// A note as it is stored: one line of plain text, like the page's cleanContactLine — but NOT
// cut short. A note over the limit is refused, so a family's words are never silently trimmed.
export function cleanReportNote(v) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim();
}
const wholeCents = (v) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= SHIFT_REPORT_MAX_CENTS;

// Why these figures may not be signed, or null. Shared by a new report and an edit: both
// amounts as whole cents in range, a note if any within the limit, and the box ticked.
export function shiftReportFiguresProblem(body) {
  if (body.attest !== true) return 'attest';
  if (!wholeCents(body.teCents)) return 'te-cents';
  if (!wholeCents(body.cashCents)) return 'cash-cents';
  if (body.note !== undefined && body.note !== null && typeof body.note !== 'string') return 'note';
  if (cleanReportNote(body.note).length > SHIFT_REPORT_NOTE_MAX) return 'note';
  return null;
}

// The storefront event and the shift itself, in a parent view, or null. See shiftInView below.
export function shiftOfView(view, sfId, blockId) {
  const events = view && Array.isArray(view.events) ? view.events : [];
  for (const ev of events) {
    if (!ev || ev.kind !== 'storefront' || ev.sfId !== sfId || !Array.isArray(ev.shifts)) continue;
    const shift = ev.shifts.filter((s) => s && s.blockId === blockId)[0];
    if (shift) return { ev, shift };
  }
  return null;
}
// S-4 (Keith, 2026-10-01) — does a report on this published shift need a second parent? Yes when
// the shift has scouts from two or more families (the view's `families`, buildParentView's count
// of distinct family keys on the block). FAIL CLOSED: a shift whose count is missing or not a
// whole number (a view published by a page from before S-4) needs one too; a leader can still
// accept without one, with a written reason, and the next leader save republishes the count.
export function shiftNeedsConfirm(shift) {
  const n = shift && shift.families;
  return !(typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < 2);
}
// S-4 amendment — the accounts that are parents of a scout on this block, from the stored pack
// record (pack_state.json, parsed): state.storefronts[sfId].blocks[blockId].assignments[].scoutId,
// then those scouts' parentUids (set by an admin on the Members card; a parent of one scout is
// linked to the whole family). null when the record, the storefront or the block is missing or
// not the shape it should be: FAIL CLOSED, nobody confirms. Only a yes/no ever leaves the server.
export function shiftParentUids(pack, sfId, blockId) {
  if (!pack || typeof pack !== 'object' || !Array.isArray(pack.storefronts) || !Array.isArray(pack.scouts)) return null;
  const sf = pack.storefronts.filter((x) => x && x.id === sfId)[0];
  const b = sf && Array.isArray(sf.blocks) ? sf.blocks.filter((x) => x && x.id === blockId)[0] : null;
  if (!b || !Array.isArray(b.assignments)) return null;
  const on = {};
  b.assignments.forEach((a) => { if (a && typeof a.scoutId === 'string') on[a.scoutId] = true; });
  const out = [];
  pack.scouts.forEach((sc) => {
    if (!sc || !on[sc.id] || !Array.isArray(sc.parentUids)) return;
    sc.parentUids.forEach((u) => { if (typeof u === 'string' && u && out.indexOf(u) === -1) out.push(u); });
  });
  return out;
}
// Review round 1 (Keith, 2026-10-01) — WHO MAY CONFIRM: a parent of a scout on the shift from a
// DIFFERENT FAMILY than the sender. The sender's families are the family keys (familyId, or the
// scout's own id: the page's familyKeyOf) of every scout the sender is linked to; a confirmer
// counts only through a scout on the block outside those families, so a spouse or a second
// account of the same family never confirms. A sender linked to no scout has no family to rule
// out, so NOBODY confirms theirs (security re-check 4: otherwise their own spouse could): a leader
// accepts it with a written reason. null: fail closed, as above.
export function shiftConfirmers(pack, sfId, blockId, senderUid) {
  if (shiftParentUids(pack, sfId, blockId) === null) return null;
  const famOf = (sc) => (typeof sc.familyId === 'string' && sc.familyId) || sc.id;
  const senderFams = {};
  pack.scouts.forEach((sc) => {
    if (sc && Array.isArray(sc.parentUids) && sc.parentUids.indexOf(senderUid) !== -1) senderFams[famOf(sc)] = true;
  });
  if (!Object.keys(senderFams).length) return [];
  const sf = pack.storefronts.filter((x) => x && x.id === sfId)[0];
  const b = sf.blocks.filter((x) => x && x.id === blockId)[0];
  const on = {};
  b.assignments.forEach((a) => { if (a && typeof a.scoutId === 'string') on[a.scoutId] = true; });
  const out = [];
  pack.scouts.forEach((sc) => {
    if (!sc || !on[sc.id] || senderFams[famOf(sc)] || !Array.isArray(sc.parentUids)) return;
    sc.parentUids.forEach((u) => { if (typeof u === 'string' && u && u !== senderUid && out.indexOf(u) === -1) out.push(u); });
  });
  return out;
}
// May this account confirm this report as the second parent? An approved member, one of the
// shift's confirmers (shiftConfirmers: a parent from another family on the shift), not the sender.
export function canConfirmShiftReport(role, uid, senderUid, confirmers) {
  return canSubmitShiftReport(role) && !!uid && uid !== senderUid && Array.isArray(confirmers) && confirmers.indexOf(uid) !== -1;
}
// Review round 1 (security 6) — the most reports one account may have waiting at once, and send
// in a day. A table holds a few shifts; anything more is a mistake or worse.
export const SHIFT_REPORT_MAX_OPEN = 3;
export const SHIFT_REPORT_MAX_PER_DAY = 20;
// How far back a leader's list goes (and everything still waiting, whenever it was sent): a season
// and a bit, so a year-end history has the whole season to read.
export const SHIFT_REPORT_LEADER_DAYS = 400;

// The storefront event in a parent view that holds this shift, or null. `view` is the stored
// parent view (parent_views.payload, parsed): the page's buildParentView publishes each
// storefront as { kind: 'storefront', sfId, date, shifts: [{ blockId, when, who? }] }.
export function shiftInView(view, sfId, blockId) {
  const events = view && Array.isArray(view.events) ? view.events : [];
  for (const ev of events) {
    if (!ev || ev.kind !== 'storefront' || ev.sfId !== sfId || !Array.isArray(ev.shifts)) continue;
    if (ev.shifts.some((s) => s && s.blockId === blockId)) return ev;
  }
  return null;
}

// Why a new report may not be sent, or null. A report is for a shift the sender can see: one
// in the parent view the pack has published (so a family can report only a real shift of this
// year, and never one a leader has taken out), on a storefront dated today or in the last
// SHIFT_REPORT_DAYS days in the pack's time zone (`today`, from packToday()).
export function shiftReportProblem(body, view, today) {
  if (typeof body.sfId !== 'string' || !SHIFT_ID_RE.test(body.sfId)) return 'sf-id';
  if (typeof body.blockId !== 'string' || !SHIFT_ID_RE.test(body.blockId)) return 'block-id';
  const figures = shiftReportFiguresProblem(body);
  if (figures) return figures;
  const ev = shiftInView(view, body.sfId, body.blockId);
  if (!ev) return 'not-in-view';
  const ago = daysBetween(ev.date, today);
  if (Number.isNaN(ago)) return 'not-in-view';
  if (ago < 0) return 'future';
  if (ago > SHIFT_REPORT_DAYS) return 'too-old';
  return null;
}
