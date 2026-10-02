// GET /api/pack/:id/view   the sanitized parent view: { exists, generatedAt, view }
//                           (admin, editor, viewer, parent — never pending)
// PUT /api/pack/:id/view   replace it with the JSON object a leader's page built  (admin, editor,
//                          and a 'leader' who may edit at least one section: rules.js canWriteView)
//
// Part C 'view.read' and 'view.write'. The view is what buildParentView (index.html) makes,
// an allowlist of what a family may see; the server stores what a leader's device sends and
// never builds one itself from the pack record. generatedAt is the server's clock.
// What it will store is held to buildParentView's shape (rules.js parentViewProblem): its
// top-level keys only, none of the standings keys while the pack has standings switched off,
// and no noteInternal anywhere. Anything else is a 400 and the stored view is left as it was.
// The standings part is checked again inside the write itself, so it cannot race PUT /join.

import { route, json, readText, refuse, forbidden, badRequest, MAX_STATE_BYTES } from '../../../_lib/http.js';
import { withMember, standingsShown } from '../../../_lib/pack.js';
import { canReadView, canWriteView, parentViewProblem, PARENT_VIEW_STANDINGS_KEYS } from '../../../_lib/rules.js';

async function get({ db, packId, role }) {
  if (!canReadView(role)) return forbidden();
  const row = await db.prepare('SELECT payload, generated_at FROM parent_views WHERE pack_id = ?').bind(packId).first();
  if (!row) return json(200, { exists: false });
  // payload was checked to be a JSON object when it was written, so it is spliced in as is.
  return json(200, '{"exists":true,"generatedAt":' + Number(row.generated_at) + ',"view":' + row.payload + '}');
}

async function put({ request, db, packId, role, positions }) {
  if (!canWriteView(role, positions)) return forbidden();
  const text = await readText(request, MAX_STATE_BYTES);
  let v;
  try { v = JSON.parse(text); } catch (e) { refuse(badRequest('not-json')); }
  if (!v || typeof v !== 'object' || Array.isArray(v)) refuse(badRequest('not-an-object'));
  delete v.generatedAt;   // the page's Firestore write carries a server-time sentinel; ours is the clock
  const why = parentViewProblem(v, await standingsShown(db, packId));
  if (why) refuse(badRequest(why));
  // A view nested deeper than the runtime's stack can stringify is a leader's bad request, not
  // a server error (security re-review of stage A, follow-up 4).
  let payload;
  try { payload = JSON.stringify(v); } catch (e) { refuse(badRequest('view-too-deep')); }
  const now = Date.now();
  // The standings check above is repeated INSIDE the write (security re-review of stage A,
  // follow-up 2). PUT /join can switch standings off, and strip them from the stored view,
  // between that read and this write; checked only above, this write would then put them
  // back while standings are off. So a view carrying any standings key is written only if
  // the pack has no join config saying show_standings = 0 at the moment it is written.
  const hasStandings = PARENT_VIEW_STANDINGS_KEYS.some((k) => Object.prototype.hasOwnProperty.call(v, k)) ? 1 : 0;
  const r = await db.prepare('INSERT INTO parent_views (pack_id, payload, generated_at) SELECT ?, ?, ? ' +
    'WHERE ? = 0 OR NOT EXISTS (SELECT 1 FROM join_config WHERE pack_id = ? AND show_standings = 0) ' +
    'ON CONFLICT (pack_id) DO UPDATE SET payload = excluded.payload, generated_at = excluded.generated_at')
    .bind(packId, payload, now, hasStandings, packId).run();
  if (!(r && r.meta && r.meta.changes >= 1)) refuse(badRequest('view-standings-off'));
  return json(200, { generatedAt: now });
}

export const onRequest = route({ GET: withMember(get), PUT: withMember(put) });
