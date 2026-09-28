// GET /api/pack/:id/rev   the cheap poll: { rev, viewAt } for leaders, { viewAt } for parents.
//
// A leader's page asks every few seconds whether the pack record moved on, and fetches it only
// when it has. rev is part of the pack record, so it goes only where the record does
// (Part C 'pack.read': leaders). viewAt, when the parent view was last written, goes to
// whoever may read the view ('view.read': never 'pending').

import { route, json, forbidden } from '../../../_lib/http.js';
import { withMember } from '../../../_lib/pack.js';
import { canReadPack, canReadView } from '../../../_lib/rules.js';

async function get({ db, packId, role }) {
  if (!canReadView(role)) return forbidden();
  const view = await db.prepare('SELECT generated_at FROM parent_views WHERE pack_id = ?').bind(packId).first();
  const out = { viewAt: view ? view.generated_at : null };
  if (canReadPack(role)) {
    const st = await db.prepare('SELECT rev FROM pack_state WHERE pack_id = ?').bind(packId).first();
    out.rev = st ? st.rev : 0;
  }
  return json(200, out);
}

export const onRequest = route({ GET: withMember(get) });
