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
// S-4 (Keith, 2026-10-01) — ONE EXCEPTION, ON PURPOSE. A shift with scouts from two or more
// families needs a second parent to confirm the totals, and nobody can confirm figures they
// cannot see. So a waiting report that needs a confirmation, on a shift from the reporting
// window, shows its two amounts, its note and the sender's FIRST name to exactly the accounts
// that may confirm it: a parent from another family on that shift (shiftConfirmers, from the
// stored pack record), never the sender. Never an account id, never to anyone else, never once it is
// confirmed, accepted or closed. Everyone else sees only that it waits for a second parent.

import { route, json, readObject, refuse, forbidden, badRequest, shiftReported, tooManyReports } from '../../../../_lib/http.js';
import { withMember, auditIf } from '../../../../_lib/pack.js';
import { canSubmitShiftReport, canReadAllShiftReports, shiftReportProblem, cleanReportNote, packToday, shiftOfView, shiftNeedsConfirm,
  shiftConfirmers, canConfirmShiftReport, daysBetween, SHIFT_REPORT_DAYS, SHIFT_REPORT_MAX_OPEN, SHIFT_REPORT_MAX_PER_DAY,
  SHIFT_REPORT_LEADER_DAYS } from '../../../../_lib/rules.js';

export const REPORT_COLS = 'id, sf_id, block_id, te_cents, cash_cents, note, submitted_by_uid, submitted_by_name, submitted_at, ' +
  'updated_at, status, reviewed_by_uid, reviewed_by_name, reviewed_at, review_note, stamp, needs_confirm, confirmed_by_uid, confirmed_by_name, ' +
  'confirmed_at, overridden, accepted_by_uid, accepted_by_name, accepted_at, accept_note, verified_by_leader';
// The statuses that hold a block: one waiting for a leader, or one a leader accepted.
export const HOLDS_BLOCK = "status IN ('submitted', 'accepted')";
const POST_KEYS = ['sfId', 'blockId', 'teCents', 'cashCents', 'note', 'attest'];

// A report as the page sees it. `uid` is the caller: `mine` says whether they sent it. A leader
// (`full`) also gets both account ids and the reviewer's whole name. A parent only ever reads
// their own reports, and gets the reviewing leader's FIRST name only ("Accepted by Sam"): the
// parent view leaves the leader roster out, names included. The stamp never leaves the server.
// A name as a parent reads it: the first word, and never an email address (youth-protection
// review 3: a Google account with no display name can carry its email as the member's name).
export const firstName = (n) => {
  const s = String(n || '').trim();
  return s && s.indexOf('@') === -1 ? s.split(/\s+/)[0] : null;
};
export function reportOut(row, uid, full) {
  const r = { id: row.id, sfId: row.sf_id, blockId: row.block_id, teCents: row.te_cents, cashCents: row.cash_cents,
    note: row.note, status: row.status, mine: row.submitted_by_uid === uid, submittedByName: row.submitted_by_name,
    submittedAt: row.submitted_at, updatedAt: row.updated_at,
    reviewedByName: full ? (row.reviewed_by_name || null) : firstName(row.reviewed_by_name),
    // A leader's note reaches a family only as the reason it was sent back (security review 3): an
    // accept's note is the leaders' record (accept_note), and never theirs to read.
    reviewedAt: row.reviewed_at || null, reviewNote: full || row.status === 'returned' ? row.review_note : '',
    // S-4: the second parent's sign-off (first name to a parent), and a leader's override.
    needsConfirm: row.needs_confirm === 1, confirmed: !!row.confirmed_by_uid,
    confirmedByName: full ? (row.confirmed_by_name || null) : firstName(row.confirmed_by_name),
    confirmedAt: row.confirmed_at || null, overridden: row.overridden === 1 };
  if (full) {
    r.submittedByUid = row.submitted_by_uid; r.reviewedByUid = row.reviewed_by_uid || null; r.confirmedByUid = row.confirmed_by_uid || null;
    // The accept, as it was made (written once): who, when, why if overridden, and whether the
    // accepting leader collected and counted the cash themselves.
    r.acceptedByUid = row.accepted_by_uid || null; r.acceptedByName = row.accepted_by_name || null; r.acceptedAt = row.accepted_at || null;
    r.acceptNote = row.accept_note || ''; r.collected = row.verified_by_leader === 1;
  }
  return r;
}
// The stored pack record, parsed, for the S-4 parent check: { rev, pack }, or null when there is
// none or it cannot be read (fail closed: nobody confirms). Up to MAX_STATE_BYTES of JSON, read
// once a request and only when a confirmation is in question. Never sent to the caller.
export async function readPackRecord(db, packId) {
  const row = await db.prepare('SELECT rev, json FROM pack_state WHERE pack_id = ?').bind(packId).first();
  if (!row || typeof row.json !== 'string' || row.json.length < 2) return null;
  let pack = null;
  try { pack = JSON.parse(row.json); } catch (e) { return null; }
  return pack && typeof pack === 'object' && !Array.isArray(pack) ? { rev: row.rev, pack } : null;
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
  // Leaders: the last SHIFT_REPORT_LEADER_DAYS days, and anything still waiting however old it is.
  // A parent's answer is built from every row, but sends only their own and a few words of the rest.
  const leader = canReadAllShiftReports(role);
  const r = await db.prepare('SELECT ' + REPORT_COLS + ' FROM shift_reports WHERE pack_id = ?' +
    (leader ? " AND (status = 'submitted' OR submitted_at > ?)" : '') + ' ORDER BY submitted_at DESC, id')
    .bind(...(leader ? [packId, Date.now() - SHIFT_REPORT_LEADER_DAYS * 86400000] : [packId])).all();
  const rows = r.results || [];
  if (leader) return json(200, { reports: rows.map((row) => reportOut(row, user.uid, true)), others: [] });
  // A parent: their own in full. For anyone else's, per block, only the report that holds it
  // (waiting or accepted) or else the latest — and of that only its block and status.
  const own = rows.filter((row) => row.submitted_by_uid === user.uid);
  const byBlock = {};
  for (const row of rows) {   // newest first
    const seen = byBlock[row.block_id];
    if (!seen || (!/^(submitted|accepted)$/.test(seen.status) && /^(submitted|accepted)$/.test(row.status))) byBlock[row.block_id] = row;
  }
  const theirs = Object.keys(byBlock).map((k) => byBlock[k]).filter((row) => row.submitted_by_uid !== user.uid);
  // S-4: which of those wait for a second parent, on a shift still in the published view and the
  // reporting window, and whether this account may be it. The view is read only if one waits; the
  // pack record (up to 1.5 MB) only if one of those is still in the window (security review 4).
  const today = packToday();
  let waiting = theirs.filter((row) => row.status === 'submitted' && row.needs_confirm === 1 && !row.confirmed_by_uid);
  let rec = null, view = null;
  if (waiting.length) {
    const vrow = await db.prepare('SELECT payload FROM parent_views WHERE pack_id = ?').bind(packId).first();
    try { view = vrow ? JSON.parse(vrow.payload) : null; } catch (e) { view = null; }
    waiting = waiting.filter((row) => {
      const at = shiftOfView(view, row.sf_id, row.block_id);
      const ago = at ? daysBetween(at.ev.date, today) : NaN;
      return ago >= 0 && ago <= SHIFT_REPORT_DAYS;
    });
    if (waiting.length) rec = await readPackRecord(db, packId);
  }
  const others = theirs.map((row) => {
    const o = { sfId: row.sf_id, blockId: row.block_id, status: row.status };
    if (row.needs_confirm !== 1) return o;
    o.needsConfirm = true;
    o.confirmed = !!row.confirmed_by_uid;
    if (row.status !== 'submitted' || row.confirmed_by_uid) return o;
    o.canConfirm = waiting.indexOf(row) !== -1 && !!rec &&
      canConfirmShiftReport(role, user.uid, row.submitted_by_uid, shiftConfirmers(rec.pack, row.sf_id, row.block_id, row.submitted_by_uid));
    // Exactly what a second parent needs to check, and only to one who may confirm (above).
    if (o.canConfirm) {
      o.id = row.id;
      o.teCents = row.te_cents;
      o.cashCents = row.cash_cents;
      o.note = row.note;
      o.submittedByName = firstName(row.submitted_by_name);
      o.updatedAt = row.updated_at;   // the confirm names the version it checked (security review 1)
    }
    return o;
  });
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
  // S-4: from the stored view, never the body, so a family cannot opt out of a second signature.
  const needsConfirm = shiftNeedsConfirm(shiftOfView(view, b.sfId, b.blockId).shift) ? 1 : 0;
  const held = await holder(db, packId, b.blockId);
  if (held) return heldAs(held);
  const now = Date.now();
  // Security review 6 — a few reports waiting at once per account, and a day's worth at most.
  const tooMany = async () => {
    const c = await db.prepare("SELECT sum(status = 'submitted') AS open, sum(submitted_at > ?) AS today FROM shift_reports " +
      'WHERE pack_id = ? AND submitted_by_uid = ?').bind(now - 86400000, packId, user.uid).first();
    if (c && (c.open || 0) >= SHIFT_REPORT_MAX_OPEN) return 'too-many-open';
    if (c && (c.today || 0) >= SHIFT_REPORT_MAX_PER_DAY) return 'too-many-today';
    return '';
  };
  const over = await tooMany();
  if (over) return tooManyReports(over);
  const id = crypto.randomUUID(), stamp = crypto.randomUUID();
  const note = cleanReportNote(b.note);
  let res;
  try {
    res = await db.batch([
      db.prepare('INSERT INTO shift_reports (id, pack_id, sf_id, block_id, te_cents, cash_cents, note, submitted_by_uid, ' +
        "submitted_by_name, submitted_at, updated_at, status, review_note, stamp, needs_confirm) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', '', ?, ? " +
        'WHERE NOT EXISTS (SELECT 1 FROM shift_reports WHERE pack_id = ? AND block_id = ? AND ' + HOLDS_BLOCK + ') AND ' +
        "(SELECT count(*) FROM shift_reports WHERE pack_id = ? AND submitted_by_uid = ? AND status = 'submitted') < ? AND " +
        '(SELECT count(*) FROM shift_reports WHERE pack_id = ? AND submitted_by_uid = ? AND submitted_at > ?) < ? AND ' +
        STILL_MEMBER(SUBMIT_ROLES))
        .bind(id, packId, b.sfId, b.blockId, b.teCents, b.cashCents, note, user.uid, member.name || '', now, now, stamp, needsConfirm,
          packId, b.blockId, packId, user.uid, SHIFT_REPORT_MAX_OPEN, packId, user.uid, now - 86400000, SHIFT_REPORT_MAX_PER_DAY,
          packId, user.uid, ...SUBMIT_ROLES),
      auditIf(db, packId, user.uid, 'shift.report', { report: id, sfId: b.sfId, blockId: b.blockId, teCents: b.teCents,
        cashCents: b.cashCents, needsConfirm: needsConfirm === 1 }, now, 'EXISTS (SELECT 1 FROM shift_reports WHERE id = ? AND stamp = ?)', [id, stamp])
    ]);
  } catch (e) {
    // The partial unique index: another report took the block between the check and the write.
    const h = await holder(db, packId, b.blockId);
    if (h) return heldAs(h);
    throw e;
  }
  if (!(res[0].meta && res[0].meta.changes === 1)) {
    const h = await holder(db, packId, b.blockId);
    if (h) return heldAs(h);
    const over2 = await tooMany();
    return over2 ? tooManyReports(over2) : forbidden();   // neither: the caller stopped being a member
  }
  return json(200, { report: reportOut(await readReport(db, packId, id), user.uid, canReadAllShiftReports(role)) });
}

export const onRequest = route({ GET: withMember(list), POST: withMember(submit) });
