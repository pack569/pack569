// GET    /api/pack/:id/invites/:email   one invite                     (admins; the invitee)
// PUT    /api/pack/:id/invites/:email   { role } or { positions, dens? } — invite that address (admins)
// DELETE /api/pack/:id/invites/:email   revoke, or decline your own    (admins; the invitee)
//
// :email is the address lowercased (the page's inviteEmailKey); anything else is a 404.
// Part C:
//   'invites.read'    isAdmin() || myEmailKey() == email
//   'invites.write'   admins only; role in ['editor', 'viewer', 'parent'] — an invite can
//                     never make an admin; the email in the body, if any, is the one in the
//                     path; nothing but role and email may be sent.
//   'invites.delete'  isAdmin() || myEmailKey() == email
// The inviter is recorded by account id (invited_by_uid), from the token — not by email, and
// never from the body.
// POSITIONS (stage 1 of position-based access; not in Part C): { positions: [...] } invites a
// 'leader' with those positions (or a 'parent', when Parent is all of them: rules.js
// roleForPositions). `role` may come with it only if it says the same. A 'leader' invite with no
// positions is refused. Writing an invite again replaces its positions; /api/session copies
// them to the new account when the invite is used. `dens` (own-den scope, Keith 2026-10-02): the
// dens a Den Leader or Assistant Den Leader position will lead (access.js cleanDens), only with one.
// RETIRED ROLES (Keith, 2026-10-02): a new invite is a leader (with positions) or a parent
// (rules.js INVITE_ROLES); { role: 'editor' } or 'viewer' is refused. An editor or viewer invite
// written before the switch still stands and still lets its person in, read-only.

import { route, json, readObject, refuse, forbidden, notFound, badRequest } from '../../../../_lib/http.js';
import { withMember, auditStmt, auditIf } from '../../../../_lib/pack.js';
import { canReadInvite, canWriteInvite, canDeleteInvite, emailKey, cleanPositions, roleForPositions } from '../../../../_lib/rules.js';
import { inviteOut, invitePositions, inviteDens } from './index.js';
import { cleanDens, DEN_POSITIONS } from '../../../../_lib/access.js';

function targetEmail(params) {
  let raw = params && params.email;
  if (typeof raw !== 'string') refuse(notFound());
  if (/%[0-9A-Fa-f]{2}/.test(raw)) { try { raw = decodeURIComponent(raw); } catch (e) { refuse(notFound()); } }
  const key = emailKey(raw);
  if (!key || key !== raw) refuse(notFound());
  return key;
}
async function readInvite(db, packId, email) {
  const row = await db.prepare('SELECT email, role, invited_by_uid, invited_at FROM invites WHERE pack_id = ? AND email = ?').bind(packId, email).first();
  if (row) { row.positions = (await invitePositions(db, packId, email))[email] || []; row.dens = (await inviteDens(db, packId, email))[email] || []; }
  return row;
}

async function get({ db, packId, role, user, params }) {
  const email = targetEmail(params);
  if (!canReadInvite(role, user.emailKey, email)) return forbidden();
  const row = await readInvite(db, packId, email);
  return json(200, row ? Object.assign({ exists: true }, inviteOut(row)) : { exists: false });
}

async function put({ request, db, packId, role, user, params }) {
  const email = targetEmail(params);
  const body = await readObject(request, 4096);
  for (const k of Object.keys(body)) if (k !== 'role' && k !== 'email' && k !== 'positions' && k !== 'dens') return forbidden();
  if (body.email !== undefined && body.email !== email) return forbidden();
  // Who may invite is decided before what was sent is looked at, as above.
  let inviteRole = body.role;
  let positions = [];
  if (body.positions !== undefined) {
    if (!canWriteInvite(role, 'leader')) return forbidden();
    positions = cleanPositions(body.positions);
    if (!positions) refuse(badRequest('positions'));
    if (body.role !== undefined && body.role !== roleForPositions(positions)) refuse(badRequest('role-and-positions'));
    inviteRole = roleForPositions(positions);
  }
  if (!canWriteInvite(role, inviteRole)) return forbidden();
  if (inviteRole === 'leader' && !positions.length) refuse(badRequest('positions'));
  let dens = [];
  if (body.dens !== undefined) {
    dens = cleanDens(body.dens);
    if (!dens || (dens.length && !positions.some((p) => DEN_POSITIONS.indexOf(p) !== -1))) refuse(badRequest('dens'));
  }
  const now = Date.now();
  const detail = positions.length ? { email, role: inviteRole, positions } : { email, role: inviteRole };
  if (dens.length) detail.dens = dens;
  await db.batch([
    db.prepare('INSERT INTO invites (pack_id, email, role, invited_by_uid, invited_at) VALUES (?, ?, ?, ?, ?) ' +
      'ON CONFLICT (pack_id, email) DO UPDATE SET role = excluded.role, invited_by_uid = excluded.invited_by_uid, invited_at = excluded.invited_at')
      .bind(packId, email, inviteRole, user.uid, now),
    db.prepare('DELETE FROM invite_positions WHERE pack_id = ? AND email = ?').bind(packId, email),
    db.prepare('INSERT INTO invite_positions (pack_id, email, position, dens) SELECT ?, ?, value, ' +
      "CASE WHEN value IN ('denleader', 'asstden') THEN ? ELSE NULL END FROM json_each(?) WHERE true")
      .bind(packId, email, JSON.stringify(dens), JSON.stringify(positions)),
    auditStmt(db, packId, user.uid, 'invite.write', detail, now)
  ]);
  return json(200, Object.assign({ exists: true }, inviteOut(await readInvite(db, packId, email))));
}

async function remove({ db, packId, role, user, params }) {
  const email = targetEmail(params);
  if (!canDeleteInvite(role, user.emailKey, email)) return forbidden();
  const now = Date.now();
  const action = user.emailKey === email && role !== 'admin' ? 'invite.decline' : 'invite.revoke';
  const res = await db.batch([
    // The audit row first, and only if there is an invite to delete.
    auditIf(db, packId, user.uid, action, { email }, now,
      'EXISTS (SELECT 1 FROM invites WHERE pack_id = ? AND email = ?)', [packId, email]),
    db.prepare('DELETE FROM invites WHERE pack_id = ? AND email = ?').bind(packId, email)
  ]);
  return json(200, { removed: !!(res[1].meta && res[1].meta.changes === 1) });
}

export const onRequest = route({ GET: withMember(get), PUT: withMember(put), DELETE: withMember(remove) });
