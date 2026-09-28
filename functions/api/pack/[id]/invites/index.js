// GET /api/pack/:id/invites   every open invite: [{ email, role, invitedByUid, invitedAt }]  (admins)
//
// Part C 'invites.read': only admins list invites. An invitee reads their own at
// /invites/<their email>.

import { route, json, forbidden } from '../../../../_lib/http.js';
import { withMember } from '../../../../_lib/pack.js';
import { canListInvites } from '../../../../_lib/rules.js';

export function inviteOut(row) {
  return { email: row.email, role: row.role, invitedByUid: row.invited_by_uid, invitedAt: row.invited_at };
}

async function list({ db, packId, role }) {
  if (!canListInvites(role)) return forbidden();
  const r = await db.prepare('SELECT email, role, invited_by_uid, invited_at FROM invites WHERE pack_id = ? ORDER BY invited_at, email')
    .bind(packId).all();
  return json(200, { invites: (r.results || []).map(inviteOut) });
}

export const onRequest = route({ GET: withMember(list) });
