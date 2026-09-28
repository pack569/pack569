// GET    /api/pack/:id/members/:uid   one account's record          (leaders; anyone, their own)
// PATCH  /api/pack/:id/members/:uid   { role?, name? }              (admins; you, your own name)
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

import { route, json, readObject, refuse, forbidden, notFound, badRequest, lastAdmin } from '../../../../_lib/http.js';
import { withMember, memberOf, memberOut, auditIf } from '../../../../_lib/pack.js';
import { ROLES, MEMBER_NAME_MAX, UID_RE, canReadMember, canUpdateMember, canDeleteMember, isAdmin, emailKey } from '../../../../_lib/rules.js';

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
  const body = await readObject(request, 4096);
  for (const k of Object.keys(body)) if (k !== 'role' && k !== 'name') return forbidden();
  const row = await memberOf(db, packId, target);
  // A missing row would be a create, and creates happen only in /api/session.
  if (!row) return isAdmin(role) ? notFound() : forbidden();
  if (body.role !== undefined && ROLES.indexOf(body.role) === -1) refuse(badRequest('role'));
  const nextRole = body.role === undefined ? row.role : body.role;
  const pack = await db.prepare('SELECT owner_uid FROM packs WHERE id = ?').bind(packId).first();
  const allowed = canUpdateMember({ role, uid: user.uid, target, currentRole: row.role, nextRole,
    isOwner: !!pack && pack.owner_uid === user.uid });
  if (!allowed) return forbidden();
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
  if (nextRole !== row.role) {
    stmts.push(auditIf(db, packId, user.uid, 'member.role', { target, from: row.role, to: nextRole }, now,
      'EXISTS (SELECT 1 FROM members WHERE pack_id = ? AND uid = ? AND role = ?)', [packId, target, nextRole]));
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
