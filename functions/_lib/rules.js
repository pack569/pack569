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
//
// Beyond Part C: the role 'leader' (position-based access, stage 1, 2026-10-01). It exists only
// on this API. A leader reads what any leader reads, and writes the pack record only where the
// positions they hold allow (member_positions; what each position may edit is the table in
// functions/_lib/access.js, which the pack PUT enforces key by key). Only an admin gives
// positions. 'editor' and 'viewer' keep working as before until an admin assigns positions.

import { POSITIONS, SECTIONS, effectiveAccess } from './access.js';

export const ROLES = ['admin', 'editor', 'viewer', 'leader', 'parent', 'pending'];
export const LEADER_ROLES = ['admin', 'editor', 'viewer', 'leader'];
// Part C: an invite's role must be one of these. 'admin' is granted in person, never by invite.
// 'leader' (not in Part C) comes with the positions it gives.
export const INVITE_ROLES = ['editor', 'viewer', 'leader', 'parent'];
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

// isLeader(): myRole() in ['admin', 'editor', 'viewer'] — and 'leader'
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
export const canReadView = (role) => ['admin', 'editor', 'viewer', 'leader', 'parent'].indexOf(role) !== -1;
// public/view — 'view.write': allow write: if myRole() in ['admin', 'editor'];
// And a 'leader' who may edit at least one section (the den meeting sub-section counts): the
// parent view stays "always published" (owner decision, 2026-10-01), so every leader who can
// change something parents see keeps it current. A leader who only reads may not. WHAT a view
// may hold is parentViewProblem's to say, below, whoever writes it.
export function canWriteView(role, positions) {
  if (role === 'admin' || role === 'editor') return true;
  if (role !== 'leader') return false;
  const acc = effectiveAccess(role, positions);
  return SECTIONS.some((s) => acc[s] === 'edit');
}

// A list of positions as a request may send it: distinct, each one access.js knows, at least
// one. Returns them in POSITIONS order, or null.
export function cleanPositions(v) {
  if (!Array.isArray(v) || !v.length || v.length > POSITIONS.length) return null;
  if (!v.every((p) => typeof p === 'string' && POSITIONS.indexOf(p) !== -1)) return null;
  if (new Set(v).size !== v.length) return null;
  return POSITIONS.filter((p) => v.indexOf(p) !== -1);
}
// The role a set of positions makes: a parent if Parent is all of them, otherwise a leader.
export const roleForPositions = (ps) => (ps.every((p) => p === 'parent') ? 'parent' : 'leader');

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
// invites — 'invites.write': admins only, and never for admin (or pending). A 'leader' invite
// carries its positions (the endpoint refuses one without).
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
