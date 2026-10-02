// GET /api/pack/:id/invites   every open invite: [{ email, role, invitedByUid, invitedAt, positions? }]  (admins)
//
// Part C 'invites.read': only admins list invites. An invitee reads their own at
// /invites/<their email>.

import { route, json, forbidden } from '../../../../_lib/http.js';
import { withMember } from '../../../../_lib/pack.js';
import { canListInvites } from '../../../../_lib/rules.js';
import { POSITIONS, DENS } from '../../../../_lib/access.js';

// positions only when the invite gives any (a 'leader' invite always does).
export function inviteOut(row) {
  const v = { email: row.email, role: row.role, invitedByUid: row.invited_by_uid, invitedAt: row.invited_at };
  if (Array.isArray(row.positions) && row.positions.length) v.positions = row.positions.slice();
  if (Array.isArray(row.dens) && row.dens.length) v.dens = row.dens.slice();
  return v;
}
// Every invite's dens (own-den scope: the dens its Den Leader position will lead): email -> [den].
export async function inviteDens(db, packId, email) {
  const r = email === undefined
    ? await db.prepare('SELECT email, dens FROM invite_positions WHERE pack_id = ? AND dens IS NOT NULL').bind(packId).all()
    : await db.prepare('SELECT email, dens FROM invite_positions WHERE pack_id = ? AND email = ? AND dens IS NOT NULL').bind(packId, email).all();
  const by = Object.create(null);
  (r.results || []).forEach((x) => {
    let list = [];
    try { list = JSON.parse(x.dens); } catch (e) { list = []; }
    const had = by[x.email] || [];
    (Array.isArray(list) ? list : []).forEach((d) => { if (had.indexOf(d) === -1) had.push(d); });
    by[x.email] = had;
  });
  Object.keys(by).forEach((e) => { by[e] = DENS.filter((d) => by[e].indexOf(d) !== -1); });
  return by;
}
// Every invite's positions in a pack: email -> [position], in access.js's order.
export async function invitePositions(db, packId, email) {
  const r = email === undefined
    ? await db.prepare('SELECT email, position FROM invite_positions WHERE pack_id = ?').bind(packId).all()
    : await db.prepare('SELECT email, position FROM invite_positions WHERE pack_id = ? AND email = ?').bind(packId, email).all();
  const by = Object.create(null);
  (r.results || []).forEach((x) => { (by[x.email] = by[x.email] || []).push(x.position); });
  Object.keys(by).forEach((e) => { by[e] = POSITIONS.filter((p) => by[e].indexOf(p) !== -1); });
  return by;
}

async function list({ db, packId, role }) {
  if (!canListInvites(role)) return forbidden();
  const r = await db.prepare('SELECT email, role, invited_by_uid, invited_at FROM invites WHERE pack_id = ? ORDER BY invited_at, email')
    .bind(packId).all();
  const held = await invitePositions(db, packId), dens = await inviteDens(db, packId);
  return json(200, { invites: (r.results || []).map((row) => inviteOut(Object.assign(row, { positions: held[row.email] || [], dens: dens[row.email] || [] }))) });
}

export const onRequest = route({ GET: withMember(list) });
