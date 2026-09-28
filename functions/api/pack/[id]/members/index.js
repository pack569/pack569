// GET /api/pack/:id/members   the accounts in the pack: [{ uid, role, name, email, addedAt, joinCode? }]
//
// Part C 'members.read': the roster (every leader's, parent's and pending request's name and
// email) goes to leaders only. Anyone else reads their own record at /members/<their uid>,
// which is all a waiting or parent page needs. Members are created only by /api/session.

import { route, json, forbidden } from '../../../../_lib/http.js';
import { withMember, memberOut } from '../../../../_lib/pack.js';
import { canReadRoster } from '../../../../_lib/rules.js';

async function list({ db, packId, role }) {
  if (!canReadRoster(role)) return forbidden();
  const r = await db.prepare('SELECT uid, role, name, email, join_code, added_at FROM members WHERE pack_id = ? ORDER BY added_at, uid')
    .bind(packId).all();
  return json(200, { members: (r.results || []).map(memberOut) });
}

export const onRequest = route({ GET: withMember(list) });
