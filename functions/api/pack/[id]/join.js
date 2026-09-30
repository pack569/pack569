// GET /api/pack/:id/join   the sign-up link switch and its live code   (leaders)
// PUT /api/pack/:id/join   write it, whole                             (admins)
//   { open, code, showStandings, showAmounts, contact, mode? }
//
// Part C 'join.read': leaders only — the code is what makes the link a key, so a stranger who
// knows the pack id must not be able to look it up. 'join.write': admins only.
// REQUEST MODE (server-only; the page's joinMode()): the link only ever files a request an
// admin approves. mode is always stored as 'request'; a body asking for anything else is
// refused, not quietly corrected, so an old page writing 'auto' finds out.
// The write is whole, as the page's writeJoinConfig sends it: a missing switch is a 400, not
// a default, so a half-loaded card cannot turn standings or amounts back on.
// The audit row says whether the code changed, never what it is. Switching standings off also
// takes them out of the stored parent view, in the same batch.

import { route, json, readObject, refuse, forbidden, badRequest } from '../../../_lib/http.js';
import { withMember, auditStmt } from '../../../_lib/pack.js';
import { canReadJoin, canWriteJoin, JOIN_CODE_RE, cleanContactLine, PARENT_VIEW_STANDINGS_KEYS } from '../../../_lib/rules.js';

const KEYS = ['open', 'mode', 'code', 'showStandings', 'showAmounts', 'contact'];

function joinOut(row) {
  if (!row) return { exists: false };
  return { exists: true, open: row.open === 1, mode: 'request', code: row.code, showStandings: row.show_standings === 1,
    showAmounts: row.show_amounts === 1, contact: row.contact, updatedAt: row.updated_at };
}
const readJoin = (db, packId) => db.prepare('SELECT * FROM join_config WHERE pack_id = ?').bind(packId).first();

async function get({ db, packId, role }) {
  if (!canReadJoin(role)) return forbidden();
  return json(200, joinOut(await readJoin(db, packId)));
}

async function put({ request, db, packId, role, user }) {
  if (!canWriteJoin(role)) return forbidden();
  const b = await readObject(request, 4096);
  for (const k of Object.keys(b)) if (KEYS.indexOf(k) === -1) refuse(badRequest('unknown-field'));
  if (b.mode !== undefined && b.mode !== 'request') return forbidden();
  for (const k of ['open', 'showStandings', 'showAmounts']) if (typeof b[k] !== 'boolean') refuse(badRequest(k));
  if (typeof b.code !== 'string' || !JOIN_CODE_RE.test(b.code)) refuse(badRequest('code'));
  if (b.contact !== undefined && typeof b.contact !== 'string') refuse(badRequest('contact'));
  const prev = await readJoin(db, packId);
  const now = Date.now();
  await db.batch([
    db.prepare("INSERT INTO join_config (pack_id, open, mode, code, show_standings, show_amounts, contact, updated_at) " +
      "VALUES (?, ?, 'request', ?, ?, ?, ?, ?) ON CONFLICT (pack_id) DO UPDATE SET open = excluded.open, mode = 'request', " +
      'code = excluded.code, show_standings = excluded.show_standings, show_amounts = excluded.show_amounts, ' +
      'contact = excluded.contact, updated_at = excluded.updated_at')
      .bind(packId, b.open ? 1 : 0, b.code, b.showStandings ? 1 : 0, b.showAmounts ? 1 : 0, cleanContactLine(b.contact), now),
    auditStmt(db, packId, user.uid, 'join.write', { open: b.open, codeChanged: !prev || prev.code !== b.code,
      showStandings: b.showStandings, showAmounts: b.showAmounts }, now),
    // Standings switched off: the parent view already stored stops showing them now, not when
    // a leader's page next republishes it. The keys are the ones PUT /view then refuses.
    db.prepare('UPDATE parent_views SET payload = json_remove(payload, ' + PARENT_VIEW_STANDINGS_KEYS.map(() => '?').join(', ') +
      ') WHERE pack_id = ? AND ? = 0').bind(...PARENT_VIEW_STANDINGS_KEYS.map((k) => '$.' + k), packId, b.showStandings ? 1 : 0)
  ]);
  return json(200, joinOut(await readJoin(db, packId)));
}

export const onRequest = route({ GET: withMember(get), PUT: withMember(put) });
