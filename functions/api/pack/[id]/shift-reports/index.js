// GET  /api/pack/:id/shift-reports   the storefront shift reports       (admin, editor, viewer, parent)
//        leaders: { reports: [every report, in full], others: [] }
//        a parent: { reports: [their own, in full], others: [{ sfId, blockId, status }] }
// POST /api/pack/:id/shift-reports   send one: { sfId, blockId, teCents, cashCents, note?, attest: true }
//                                     (admin, editor, viewer, parent — never pending)
//
// Not a Part C rule: Firestore never had shift reports (migrations/0003_shift_reports.sql says
// what they are for). SETUP.md Part C, "Shift reports", is the same rules in prose.
//   - Who sends one: any approved member (rules.js canSubmitShiftReport). The uid, name and
//     time are the server's, from the member row; the body never says who sent it.
//   - Which shift: one the stored parent view publishes (a storefront event's sfId and one of
//     its shifts' blockId), dated today or within SHIFT_REPORT_DAYS before it, in the pack's
//     time zone (rules.js shiftReportProblem). So a family reports only a real shift they can
//     see, and never one in the future.
//   - The figures: whole cents, 0 to $10,000 each, a note of at most 300 characters, and the
//     signature box ticked (attest: true).
//   - One at a time: a block with a report waiting, or accepted, takes no second one (409
//     shift-reported). The insert re-checks that in the same statement, and the table's
//     partial unique index is the backstop, so two families sending at once cannot both land.
// What a parent reads: their own reports in full, and for every other block only whether it is
// reported and where that stands — never another family's amounts, name or note. Leaders read
// everything, as they read the ledger.

import { route, json, readObject, refuse, forbidden, badRequest, shiftReported } from '../../../../_lib/http.js';
import { withMember, auditIf } from '../../../../_lib/pack.js';
import { canSubmitShiftReport, canReadAllShiftReports, shiftReportProblem, cleanReportNote, packToday } from '../../../../_lib/rules.js';

export const REPORT_COLS = 'id, sf_id, block_id, te_cents, cash_cents, note, submitted_by_uid, submitted_by_name, submitted_at, ' +
  'updated_at, status, reviewed_by_uid, reviewed_by_name, reviewed_at, review_note, stamp';
// The statuses that hold a block: one waiting for a leader, or one a leader accepted.
export const HOLDS_BLOCK = "status IN ('submitted', 'accepted')";
const POST_KEYS = ['sfId', 'blockId', 'teCents', 'cashCents', 'note', 'attest'];

// A report as the page sees it. `uid` is the caller: `mine` says whether they sent it. A leader
// (`full`) also gets both account ids and the reviewer's whole name. A parent only ever reads
// their own reports, and gets the reviewing leader's FIRST name only ("Accepted by Sam"): the
// parent view leaves the leader roster out, names included. The stamp never leaves the server.
const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || null;
export function reportOut(row, uid, full) {
  const r = { id: row.id, sfId: row.sf_id, blockId: row.block_id, teCents: row.te_cents, cashCents: row.cash_cents,
    note: row.note, status: row.status, mine: row.submitted_by_uid === uid, submittedByName: row.submitted_by_name,
    submittedAt: row.submitted_at, updatedAt: row.updated_at,
    reviewedByName: full ? (row.reviewed_by_name || null) : firstName(row.reviewed_by_name),
    reviewedAt: row.reviewed_at || null, reviewNote: row.review_note };
  if (full) { r.submittedByUid = row.submitted_by_uid; r.reviewedByUid = row.reviewed_by_uid || null; }
  return r;
}
export const readReport = (db, packId, id) =>
  db.prepare('SELECT ' + REPORT_COLS + ' FROM shift_reports WHERE pack_id = ? AND id = ?').bind(packId, id).first();
// The report holding a block, if any.
const holder = (db, packId, blockId) =>
  db.prepare('SELECT status FROM shift_reports WHERE pack_id = ? AND block_id = ? AND ' + HOLDS_BLOCK).bind(packId, blockId).first();
const heldAs = (h) => shiftReported(h && h.status === 'accepted' ? 'accepted' : 'open');
// The caller still holds one of `roles` at the moment of the write (a write's own re-check, so
// a member removed or sent back to pending between the role check and the write writes nothing).
export const STILL_MEMBER = (roles) => 'EXISTS (SELECT 1 FROM members WHERE pack_id = ? AND uid = ? AND role IN (' +
  roles.map(() => '?').join(', ') + '))';
export const SUBMIT_ROLES = ['admin', 'editor', 'viewer', 'parent'];

async function list({ db, packId, role, user }) {
  if (!canSubmitShiftReport(role)) return forbidden();
  const r = await db.prepare('SELECT ' + REPORT_COLS + ' FROM shift_reports WHERE pack_id = ? ORDER BY submitted_at DESC, id')
    .bind(packId).all();
  const rows = r.results || [];
  if (canReadAllShiftReports(role)) return json(200, { reports: rows.map((row) => reportOut(row, user.uid, true)), others: [] });
  // A parent: their own in full. For anyone else's, per block, only the report that holds it
  // (waiting or accepted) or else the latest — and of that only its block and status.
  const own = rows.filter((row) => row.submitted_by_uid === user.uid);
  const byBlock = {};
  for (const row of rows) {   // newest first
    const seen = byBlock[row.block_id];
    if (!seen || (!/^(submitted|accepted)$/.test(seen.status) && /^(submitted|accepted)$/.test(row.status))) byBlock[row.block_id] = row;
  }
  const others = Object.keys(byBlock).map((k) => byBlock[k]).filter((row) => row.submitted_by_uid !== user.uid)
    .map((row) => ({ sfId: row.sf_id, blockId: row.block_id, status: row.status }));
  return json(200, { reports: own.map((row) => reportOut(row, user.uid, false)), others });
}

async function submit({ request, db, packId, role, user, member }) {
  if (!canSubmitShiftReport(role)) return forbidden();
  const b = await readObject(request, 4096);
  for (const k of Object.keys(b)) if (POST_KEYS.indexOf(k) === -1) refuse(badRequest('unknown-field'));
  const vrow = await db.prepare('SELECT payload FROM parent_views WHERE pack_id = ?').bind(packId).first();
  let view = null;
  try { view = vrow ? JSON.parse(vrow.payload) : null; } catch (e) { view = null; }
  const why = shiftReportProblem(b, view, packToday());
  if (why) refuse(badRequest(why));
  const held = await holder(db, packId, b.blockId);
  if (held) return heldAs(held);
  const id = crypto.randomUUID(), stamp = crypto.randomUUID(), now = Date.now();
  const note = cleanReportNote(b.note);
  let res;
  try {
    res = await db.batch([
      db.prepare('INSERT INTO shift_reports (id, pack_id, sf_id, block_id, te_cents, cash_cents, note, submitted_by_uid, ' +
        "submitted_by_name, submitted_at, updated_at, status, review_note, stamp) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', '', ? " +
        'WHERE NOT EXISTS (SELECT 1 FROM shift_reports WHERE pack_id = ? AND block_id = ? AND ' + HOLDS_BLOCK + ') AND ' +
        STILL_MEMBER(SUBMIT_ROLES))
        .bind(id, packId, b.sfId, b.blockId, b.teCents, b.cashCents, note, user.uid, member.name || '', now, now, stamp,
          packId, b.blockId, packId, user.uid, ...SUBMIT_ROLES),
      auditIf(db, packId, user.uid, 'shift.report', { report: id, sfId: b.sfId, blockId: b.blockId, teCents: b.teCents,
        cashCents: b.cashCents }, now, 'EXISTS (SELECT 1 FROM shift_reports WHERE id = ? AND stamp = ?)', [id, stamp])
    ]);
  } catch (e) {
    // The partial unique index: another report took the block between the check and the write.
    const h = await holder(db, packId, b.blockId);
    if (h) return heldAs(h);
    throw e;
  }
  if (!(res[0].meta && res[0].meta.changes === 1)) {
    const h = await holder(db, packId, b.blockId);
    return h ? heldAs(h) : forbidden();   // no holder: the caller stopped being a member
  }
  return json(200, { report: reportOut(await readReport(db, packId, id), user.uid, canReadAllShiftReports(role)) });
}

export const onRequest = route({ GET: withMember(list), POST: withMember(submit) });
