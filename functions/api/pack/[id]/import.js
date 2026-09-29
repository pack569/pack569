// POST /api/pack/:id/import   the one-time copy of the pack from Firestore     (the pack owner)
//   { pack: { rev, device, json }, members: [...], invites: [...], join: {...} | null, view: {...} | null }
//
// The owner, signed in on the last Firestore page, sends what that page can read: the pack
// record (json is the Firestore document's json string, as it is), the member docs, the
// invites, the join config and the parent view. Family data never goes through git or CI.
//
// Allowed ONLY when all of these hold, and refused with the fixed 403 otherwise:
//   - the caller is the pack's owner (packs.owner_uid: PACK_OWNER_UID in production, which is
//     Firestore's packmeta owner) — being an admin is not enough;
//   - the pack has no pack record here yet;
//   - it has never been imported. import_lock is written in the same batch, with a plain
//     INSERT, so a second import fails on its key and nothing of it lands.
// Everything is written in one batch: all of it lands, or none of it.
// Rows that already exist here win (a member who signed in before the import keeps their row),
// except that the owner always ends up an admin. Invites the rules would refuse today (an
// 'admin' invite, a bad address) are left behind and counted in the answer, not copied; so is
// a parent view that PUT /view would refuse (viewSkipped says why).

import { route, json, readObject, refuse, forbidden, badRequest, MAX_STATE_BYTES } from '../../../_lib/http.js';
import { withMember, auditStmt, standingsShown, MAX_REV } from '../../../_lib/pack.js';
import { ROLES, INVITE_ROLES, UID_RE, MEMBER_NAME_MAX, JOIN_CODE_RE, cleanContactLine, emailKey, parentViewProblem,
  PARENT_VIEW_STANDINGS_KEYS } from '../../../_lib/rules.js';

const MAX_ROWS = 2000;
const time = (v, dflt) => (typeof v === 'number' && isFinite(v) && v >= 0 ? Math.floor(v) : dflt);

async function importPack({ request, db, packId, user }) {
  const pack = await db.prepare('SELECT owner_uid FROM packs WHERE id = ?').bind(packId).first();
  if (!pack || !pack.owner_uid || pack.owner_uid !== user.uid) return forbidden();
  const locked = () => db.prepare('SELECT (SELECT count(*) FROM import_lock WHERE pack_id = ?) + ' +
    '(SELECT count(*) FROM pack_state WHERE pack_id = ?) AS n').bind(packId, packId).first();
  if ((await locked()).n > 0) return forbidden();

  const b = await readObject(request, 3 * MAX_STATE_BYTES);
  const now = Date.now();
  const p = b.pack;
  if (!p || typeof p !== 'object' || typeof p.json !== 'string') refuse(badRequest('pack'));
  if (new TextEncoder().encode(p.json).byteLength > MAX_STATE_BYTES) refuse(json(413, { error: 'too-large', code: 'resource-exhausted' }));
  let st;
  try { st = JSON.parse(p.json); } catch (e) { refuse(badRequest('pack.json')); }
  if (!st || typeof st !== 'object' || Array.isArray(st)) refuse(badRequest('pack.json'));
  // At least 1: a stored rev of 0 is what a first save's If-Match 0 names, so a leader's device
  // that heard "no pack" just before the copy-in would write straight over it (security review
  // of 260f467..db851c7, F2). From 1, that save is a conflict, and the page compares the two.
  const rev = Math.max(time(p.rev, 0), 1);
  // A rev PUT's If-Match could never name again (it takes at most 15 digits) would leave the
  // pack unwritable for good (security review of stage A, finding 8).
  if (rev > MAX_REV) refuse(badRequest('pack.rev'));
  const device = typeof p.device === 'string' ? p.device.slice(0, 128) : '';

  const members = Array.isArray(b.members) ? b.members : [];
  const invites = Array.isArray(b.invites) ? b.invites : [];
  if (members.length > MAX_ROWS || invites.length > MAX_ROWS) refuse(badRequest('too-many-rows'));
  const mRows = members.map((m, i) => {
    if (!m || typeof m !== 'object' || typeof m.uid !== 'string' || !UID_RE.test(m.uid)) refuse(badRequest('members[' + i + '].uid'));
    if (ROLES.indexOf(m.role) === -1) refuse(badRequest('members[' + i + '].role'));
    return {
      uid: m.uid, role: m.role,
      name: String(typeof m.name === 'string' ? m.name : '').slice(0, MEMBER_NAME_MAX),
      email: String(typeof m.email === 'string' ? m.email : '').slice(0, 320),
      joinCode: typeof m.joinCode === 'string' && JOIN_CODE_RE.test(m.joinCode) ? m.joinCode : null,
      addedAt: time(m.addedAt, now)
    };
  });
  let skipped = 0;
  const iRows = [];
  invites.forEach((v) => {
    const key = v && emailKey(v.email);
    if (!key || INVITE_ROLES.indexOf(v.role) === -1) { skipped += 1; return; }
    iRows.push({ email: key, role: v.role, invitedAt: time(v.invitedAt, now) });
  });
  const j = b.join;
  if (j != null) {
    if (typeof j !== 'object' || typeof j.code !== 'string' || !JOIN_CODE_RE.test(j.code)) refuse(badRequest('join'));
  }
  const view = b.view;
  if (view != null && (typeof view !== 'object' || Array.isArray(view))) refuse(badRequest('view'));
  let viewText = null;
  let viewSkipped = null;
  let hasStandings = 0;
  if (view) {
    const v = Object.assign({}, view);
    delete v.generatedAt;   // a Firestore timestamp; the server stamps its own
    // Held to the same shape as PUT /view (rules.js parentViewProblem), against the standings
    // switch this pack will have after the import: its join config here if it has one (the
    // import never overwrites it), else the imported one. A view that fails is left behind and
    // named in the answer, like a refused invite; the next leader save publishes a fresh one.
    const cur = await db.prepare('SELECT show_standings FROM join_config WHERE pack_id = ?').bind(packId).first();
    const shown = cur ? cur.show_standings === 1 : !(j && j.showStandings === false);
    viewSkipped = parentViewProblem(v, shown);
    if (!viewSkipped) {
      // Too deep for the runtime to stringify: left behind, like any other view it cannot take.
      try { viewText = JSON.stringify(v); } catch (e) { viewSkipped = 'view-too-deep'; }
    }
    if (viewText) {
      hasStandings = PARENT_VIEW_STANDINGS_KEYS.some((k) => Object.prototype.hasOwnProperty.call(v, k)) ? 1 : 0;
      if (new TextEncoder().encode(viewText).byteLength > MAX_STATE_BYTES) refuse(json(413, { error: 'too-large', code: 'resource-exhausted' }));
    }
  }

  const stmts = [
    db.prepare('INSERT INTO import_lock (pack_id, uid, at) VALUES (?, ?, ?)').bind(packId, user.uid, now),
    db.prepare('INSERT INTO pack_state (pack_id, rev, json, device, updated_at) VALUES (?, ?, ?, ?, ?)').bind(packId, rev, p.json, device, now),
    db.prepare("INSERT INTO members (pack_id, uid, role, name, email, join_code, added_at) SELECT ?, json_extract(value, '$.uid'), " +
      "json_extract(value, '$.role'), json_extract(value, '$.name'), json_extract(value, '$.email'), json_extract(value, '$.joinCode'), " +
      "json_extract(value, '$.addedAt') FROM json_each(?) WHERE true ON CONFLICT (pack_id, uid) DO NOTHING").bind(packId, JSON.stringify(mRows)),
    db.prepare("INSERT INTO members (pack_id, uid, role, name, email, join_code, added_at) VALUES (?, ?, 'admin', ?, ?, NULL, ?) " +
      "ON CONFLICT (pack_id, uid) DO UPDATE SET role = 'admin'").bind(packId, user.uid, user.name.slice(0, MEMBER_NAME_MAX), user.email, now),
    db.prepare("INSERT INTO invites (pack_id, email, role, invited_by_uid, invited_at) SELECT ?, json_extract(value, '$.email'), " +
      "json_extract(value, '$.role'), ?, json_extract(value, '$.invitedAt') FROM json_each(?) WHERE true ON CONFLICT (pack_id, email) DO NOTHING")
      .bind(packId, user.uid, JSON.stringify(iRows))
  ];
  if (j) {
    stmts.push(db.prepare("INSERT INTO join_config (pack_id, open, mode, code, show_standings, show_amounts, contact, updated_at) " +
      "VALUES (?, ?, 'request', ?, ?, ?, ?, ?) ON CONFLICT (pack_id) DO NOTHING")
      .bind(packId, j.open === true ? 1 : 0, j.code, j.showStandings === false ? 0 : 1, j.showAmounts === false ? 0 : 1,
        cleanContactLine(j.contact), now));
  }
  // The standings check is repeated inside the write, as PUT /view does (security re-review of
  // stage A, follow-up 2): a PUT /join switching standings off after the read above must not
  // be undone by this batch. It runs after the join_config insert, so it sees whatever this
  // pack's switch is by then, the imported one included.
  let viewAt = -1;
  if (viewText) {
    viewAt = stmts.length;
    stmts.push(db.prepare('INSERT INTO parent_views (pack_id, payload, generated_at) SELECT ?, ?, ? ' +
      'WHERE ? = 0 OR NOT EXISTS (SELECT 1 FROM join_config WHERE pack_id = ? AND show_standings = 0) ON CONFLICT (pack_id) DO NOTHING')
      .bind(packId, viewText, now, hasStandings, packId));
  }
  stmts.push(auditStmt(db, packId, user.uid, 'import',
    { rev, members: mRows.length, invites: iRows.length, invitesSkipped: skipped, join: !!j, view: !!viewText, viewSkipped }, now));
  let results;
  try {
    results = await db.batch(stmts);
  } catch (e) {
    // Lost a race with another import or a first save: that is the lock doing its job.
    if ((await locked()).n > 0) return forbidden();
    throw e;
  }
  // The view was not stored: held back inside the write because standings went off in the
  // meantime, or a parent view was already here (it wins, like every row that already
  // exists). The answer says which, so `view: true` always means this view was stored
  // (review of 5690c3a..20b4fd6, item 4). Standings being off only held it back if it had
  // standings in it; a view without them was held back by the one already here, whatever the
  // switch says (review of eb504db..366f6c9, item 3). The audit row, written in the same
  // batch, records the view that was sent.
  if (viewAt >= 0 && !(results && results[viewAt] && results[viewAt].meta && results[viewAt].meta.changes >= 1)) {
    viewText = null;
    viewSkipped = (hasStandings && !(await standingsShown(db, packId))) ? 'view-standings-off' : 'view-exists';
  }
  return json(200, { imported: true, rev, members: mRows.length, invites: iRows.length, invitesSkipped: skipped,
    join: !!j, view: !!viewText, viewSkipped });
}

export const onRequest = route({ POST: withMember(importPack) });
