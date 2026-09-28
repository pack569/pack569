// GET    /api/pack/:id/invites/:email   one invite                     (admins; the invitee)
// PUT    /api/pack/:id/invites/:email   { role } — invite that address (admins)
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

import { route, json, readObject, refuse, forbidden, notFound } from '../../../../_lib/http.js';
import { withMember, auditStmt, auditIf } from '../../../../_lib/pack.js';
import { canReadInvite, canWriteInvite, canDeleteInvite, emailKey } from '../../../../_lib/rules.js';
import { inviteOut } from './index.js';

function targetEmail(params) {
  let raw = params && params.email;
  if (typeof raw !== 'string') refuse(notFound());
  if (/%[0-9A-Fa-f]{2}/.test(raw)) { try { raw = decodeURIComponent(raw); } catch (e) { refuse(notFound()); } }
  const key = emailKey(raw);
  if (!key || key !== raw) refuse(notFound());
  return key;
}
const readInvite = (db, packId, email) =>
  db.prepare('SELECT email, role, invited_by_uid, invited_at FROM invites WHERE pack_id = ? AND email = ?').bind(packId, email).first();

async function get({ db, packId, role, user, params }) {
  const email = targetEmail(params);
  if (!canReadInvite(role, user.emailKey, email)) return forbidden();
  const row = await readInvite(db, packId, email);
  return json(200, row ? Object.assign({ exists: true }, inviteOut(row)) : { exists: false });
}

async function put({ request, db, packId, role, user, params }) {
  const email = targetEmail(params);
  const body = await readObject(request, 4096);
  for (const k of Object.keys(body)) if (k !== 'role' && k !== 'email') return forbidden();
  if (body.email !== undefined && body.email !== email) return forbidden();
  if (!canWriteInvite(role, body.role)) return forbidden();
  const now = Date.now();
  await db.batch([
    db.prepare('INSERT INTO invites (pack_id, email, role, invited_by_uid, invited_at) VALUES (?, ?, ?, ?, ?) ' +
      'ON CONFLICT (pack_id, email) DO UPDATE SET role = excluded.role, invited_by_uid = excluded.invited_by_uid, invited_at = excluded.invited_at')
      .bind(packId, email, body.role, user.uid, now),
    auditStmt(db, packId, user.uid, 'invite.write', { email, role: body.role }, now)
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
