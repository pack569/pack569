// GET /api/pack/:id/view   the sanitized parent view: { exists, generatedAt, view }
//                           (admin, editor, viewer, parent — never pending)
// PUT /api/pack/:id/view   replace it with the JSON object a leader's page built  (admin, editor)
//
// Part C 'view.read' and 'view.write'. The view is what buildParentView (index.html) makes,
// an allowlist of what a family may see; the server stores what a leader's device sends and
// never builds one itself from the pack record. generatedAt is the server's clock.
// What it will store is held to buildParentView's shape (rules.js parentViewProblem): its
// top-level keys only, none of the standings keys while the pack has standings switched off,
// and no noteInternal anywhere. Anything else is a 400 and the stored view is left as it was.

import { route, json, readText, refuse, forbidden, badRequest, MAX_STATE_BYTES } from '../../../_lib/http.js';
import { withMember, standingsShown } from '../../../_lib/pack.js';
import { canReadView, canWriteView, parentViewProblem } from '../../../_lib/rules.js';

async function get({ db, packId, role }) {
  if (!canReadView(role)) return forbidden();
  const row = await db.prepare('SELECT payload, generated_at FROM parent_views WHERE pack_id = ?').bind(packId).first();
  if (!row) return json(200, { exists: false });
  // payload was checked to be a JSON object when it was written, so it is spliced in as is.
  return json(200, '{"exists":true,"generatedAt":' + Number(row.generated_at) + ',"view":' + row.payload + '}');
}

async function put({ request, db, packId, role }) {
  if (!canWriteView(role)) return forbidden();
  const text = await readText(request, MAX_STATE_BYTES);
  let v;
  try { v = JSON.parse(text); } catch (e) { refuse(badRequest('not-json')); }
  if (!v || typeof v !== 'object' || Array.isArray(v)) refuse(badRequest('not-an-object'));
  delete v.generatedAt;   // the page's Firestore write carries a server-time sentinel; ours is the clock
  const why = parentViewProblem(v, await standingsShown(db, packId));
  if (why) refuse(badRequest(why));
  const now = Date.now();
  await db.prepare('INSERT INTO parent_views (pack_id, payload, generated_at) VALUES (?, ?, ?) ' +
    'ON CONFLICT (pack_id) DO UPDATE SET payload = excluded.payload, generated_at = excluded.generated_at')
    .bind(packId, JSON.stringify(v), now).run();
  return json(200, { generatedAt: now });
}

export const onRequest = route({ GET: withMember(get), PUT: withMember(put) });
