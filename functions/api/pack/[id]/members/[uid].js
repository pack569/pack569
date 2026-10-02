// GET    /api/pack/:id/members/:uid   one account's record          (leaders; anyone, their own)
// PATCH  /api/pack/:id/members/:uid   { role?, name? }              (admins; you, your own name)
//                                     { positions, name? }          (admins)
// DELETE /api/pack/:id/members/:uid   remove an account             (admins)
//
// Part C:
//   'members.read'          leaders read anyone's; you may read your own (a missing one is
//                           { exists: false }, which is how a new signer learns they have none).
//   'members.admin'         allow update, delete: if isAdmin();
//   'members.update.self'   your own row with the same role — here, your name; the email
//                           is rewritten from your token, as ownEmail() required.
//   'members.update.owner'  the pack owner may always restore their own admin role.
//   'members.keys'          a name is a string of at most 120 characters.
// On top of Part C, THE LAST ADMIN: no change or removal may leave the pack without an admin
// (409 last-admin). It is checked inside the same UPDATE/DELETE, so two admins demoting each
// other at once cannot both succeed.
// Removing an account also removes any invite still under its email — an invite can outlive
// the member it made, and would walk them straight back in (the page's removeMember).
//
// POSITIONS (position-based access, stage 1, 2026-10-01; not in Part C). An admin gives an
// account its pack positions, all at once: { positions: ['denleader', 'treasurer'] } replaces
// what it held. The account becomes a 'leader' — or a 'parent' when Parent is all it was given
// (rules.js roleForPositions). Only an admin, never your own row otherwise, never with `role` in
// the same request, and at least one position (to take them all away, set a role instead; the
// role change takes the positions with it, migration 0005). The last-admin rule holds: an admin
// given positions stops being an admin. Recorded in the audit as 'member.positions'.
// RETIRED ROLES (Keith, 2026-10-02): `role` may set admin, parent or pending (rules.js
// SETTABLE_ROLES); never editor or viewer again, and leader only through positions. An editor or
// viewer account left from before reads, writes nothing, and keeps its role until an admin
// gives it positions.

import { route, json, readObject, refuse, forbidden, notFound, badRequest, lastAdmin } from '../../../../_lib/http.js';
import { withMember, memberOf, memberOut, auditIf } from '../../../../_lib/pack.js';
import { ROLES, SETTABLE_ROLES, MEMBER_NAME_MAX, UID_RE, canReadMember, canUpdateMember, canDeleteMember, isAdmin, emailKey,
  cleanPositions, roleForPositions } from '../../../../_lib/rules.js';

// Leaves an admin behind: the target is not an admin, or stays one, or is not the only one.
const KEEPS_AN_ADMIN = "(role != 'admin' OR ? = 'admin' OR (SELECT count(*) FROM members WHERE pack_id = ? AND role = 'admin') > 1)";

function targetUid(params) {
  const t = params && params.uid;
  if (typeof t !== 'string' || !UID_RE.test(t)) refuse(notFound());
  return t;
}

async function get({ db, packId, role, user, params }) {
  const target = targetUid(params);
  if (!canReadMember(role, user.uid, target)) return forbidden();
  const row = await memberOf(db, packId, target);
  return json(200, row ? Object.assign({ exists: true }, memberOut(row)) : { exists: false });
}

async function patch({ request, db, packId, role, user, params }) {
  const target = targetUid(params);
  // Only an admin may touch someone else's row, and that is decided FIRST — before the body is
  // read or the row looked up — so a non-admin gets the one fixed 403 whether or not the
  // account is in the pack, and whatever they sent (security review of stage A, finding 5:
  // a 400 for a bad role on a real member, 403 for a missing one, told them which was which).
  if (!isAdmin(role) && target !== user.uid) return forbidden();
  const body = await readObject(request, 4096);
  for (const k of Object.keys(body)) if (k !== 'role' && k !== 'name' && k !== 'positions') return forbidden();
  // Positions are an admin's to give, and never your own to send.
  if (body.positions !== undefined && !isAdmin(role)) return forbidden();
  const row = await memberOf(db, packId, target);
  // A missing row would be a create, and creates happen only in /api/session.
  if (!row) return isAdmin(role) ? notFound() : forbidden();
  if (body.role !== undefined && ROLES.indexOf(body.role) === -1) refuse(badRequest('role'));
  let positions = null;
  if (body.positions !== undefined) {
    if (body.role !== undefined) refuse(badRequest('role-and-positions'));
    positions = cleanPositions(body.positions);
    if (!positions) refuse(badRequest('positions'));
  }
  const nextRole = positions ? roleForPositions(positions) : body.role === undefined ? row.role : body.role;
  const pack = await db.prepare('SELECT owner_uid FROM packs WHERE id = ?').bind(packId).first();
  const allowed = canUpdateMember({ role, uid: user.uid, target, currentRole: row.role, nextRole,
    isOwner: !!pack && pack.owner_uid === user.uid });
  if (!allowed) return forbidden();
  // A role set by name is admin, parent or pending (SETTABLE_ROLES): a leader comes with positions,
  // and editor and viewer are retired. A row keeping the role it has is no change. (After the
  // check above, so only an admin can be told this.)
  if (!positions && nextRole !== row.role && SETTABLE_ROLES.indexOf(nextRole) === -1) refuse(badRequest('role'));
  if (body.name !== undefined && (typeof body.name !== 'string' || body.name.length > MEMBER_NAME_MAX)) return forbidden();
  const self = target === user.uid;
  const name = body.name === undefined ? row.name : body.name;
  // Your own row always carries your own email (ownEmail()); an admin editing someone else's
  // row leaves theirs alone.
  const email = self ? user.email : row.email;
  const now = Date.now();
  const stmts = [
    db.prepare('UPDATE members SET role = ?, name = ?, email = ? WHERE pack_id = ? AND uid = ? AND ' + KEEPS_AN_ADMIN)
      .bind(nextRole, name, email, packId, target, nextRole, packId)
  ];
  // Written only if the role landed (the last-admin rule can stop it): the role change itself
  // has already taken the old positions (migration 0005), and these replace them.
  const landed = 'EXISTS (SELECT 1 FROM members WHERE pack_id = ? AND uid = ? AND role = ?)';
  if (positions) {
    stmts.push(
      db.prepare('DELETE FROM member_positions WHERE pack_id = ? AND uid = ? AND ' + landed).bind(packId, target, packId, target, nextRole),
      db.prepare('INSERT INTO member_positions (pack_id, uid, position, den) SELECT ?, ?, value, NULL FROM json_each(?) WHERE ' + landed)
        .bind(packId, target, JSON.stringify(positions), packId, target, nextRole),
      auditIf(db, packId, user.uid, 'member.positions',
        { target, from: { role: row.role, positions: row.positions }, to: { role: nextRole, positions } }, now, landed, [packId, target, nextRole]));
  } else if (nextRole !== row.role) {
    stmts.push(auditIf(db, packId, user.uid, 'member.role', { target, from: row.role, to: nextRole }, now, landed, [packId, target, nextRole]));
  }
  const res = await db.batch(stmts);
  if (!(res[0].meta && res[0].meta.changes === 1)) return lastAdmin();
  return json(200, Object.assign({ exists: true }, memberOut(await memberOf(db, packId, target))));
}

async function remove({ db, packId, role, user, params }) {
  const target = targetUid(params);
  if (!canDeleteMember(role)) return forbidden();
  const row = await memberOf(db, packId, target);
  if (!row) return notFound();
  const key = emailKey(row.email);
  const now = Date.now();
  const gone = 'NOT EXISTS (SELECT 1 FROM members WHERE pack_id = ? AND uid = ?)';
  const res = await db.batch([
    db.prepare('DELETE FROM members WHERE pack_id = ? AND uid = ? AND ' + KEEPS_AN_ADMIN).bind(packId, target, 'removed', packId),
    db.prepare('DELETE FROM invites WHERE pack_id = ? AND email = ? AND ' + gone).bind(packId, key || '', packId, target),
    auditIf(db, packId, user.uid, 'member.remove', { target, role: row.role }, now, gone, [packId, target])
  ]);
  if (!(res[0].meta && res[0].meta.changes === 1)) return lastAdmin();
  return json(200, { removed: target });
}

export const onRequest = route({ GET: withMember(get), PATCH: withMember(patch), DELETE: withMember(remove) });
