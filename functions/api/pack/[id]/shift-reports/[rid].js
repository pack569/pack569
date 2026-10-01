// PATCH /api/pack/:id/shift-reports/:rid   change one shift report, by `action`:
//   { action: 'edit', teCents, cashCents, note?, attest: true }   the sender, while it is waiting
//   { action: 'withdraw' }                                        the sender, while it is waiting
//   { action: 'confirm', attest: true }                           S-4: a second parent of a scout on the shift
//   { action: 'accept', teCents, cashCents, reviewNote?, override? }  admin or editor; not their own
//   { action: 'return', reviewNote }                              admin or editor; waiting or accepted
// Answers { report } as GET would show it to the caller.
//
// Not a Part C rule (see index.js beside this file, and SETUP.md Part C, "Shift reports").
//   - Only the person who sent a report may edit or withdraw it, and only while it waits for a
//     leader. An edit is signed again (attest: true), since the signature is on the figures.
//   - Accepting is the SECOND sign-off on the cash, so the leader who accepts may not be the
//     one who sent it (409 same-person; the page's blockCashCheck "same person" rule, held on
//     the server, and by a CHECK in the table too). The leader names the two figures they are
//     accepting, and the accept lands only if the report still says exactly those: a family's
//     edit a moment earlier is not signed for unseen.
//   - S-4 (Keith, 2026-10-01): a report on a shift with scouts from two or more families
//     (needs_confirm, set when it was sent) needs a SECOND parent to confirm it: an approved
//     member who is a parent of a scout on that block in the stored pack record (parentUids),
//     and not the sender (409 not-shift-parent / same-person). The check reads pack_state in this
//     request, and the write lands only if the pack record's rev is still the one read, so a link
//     removed in between cannot let it through. Nothing of the record is ever sent back. The
//     sender's edit clears a confirmation. A leader accepts an unconfirmed one only with
//     override: true and a written reason (409 needs-confirm otherwise; audited shift.accept.override).
//   - Sending back needs a reason, and works on a waiting report or an accepted one (a leader
//     reopening a report that went in wrong). A family sends a corrected one as a new report.
// Every change is compared in the write itself: the UPDATE names the state it was decided
// against (the row's stamp, its status, the figures) and the caller's role at that moment, and
// a change that finds anything moved writes nothing and answers 409 report-moved — so a leader
// accepting while another sends it back, or a family withdrawing as it is accepted, cannot both
// win. The audit row is in the same batch and lands only with its own change.

import { route, json, readObject, refuse, forbidden, notFound, badRequest, reportMoved, samePerson, notShiftParent, needsConfirm }
  from '../../../../_lib/http.js';
import { withMember, auditIf } from '../../../../_lib/pack.js';
import { canSubmitShiftReport, canReviewShiftReport, canReadAllShiftReports, shiftReportFiguresProblem, cleanReportNote,
  SHIFT_REPORT_NOTE_MAX, shiftParentUids, canConfirmShiftReport } from '../../../../_lib/rules.js';
import { reportOut, readReport, readPackRecord, STILL_MEMBER, SUBMIT_ROLES } from './index.js';

const REVIEW_ROLES = ['admin', 'editor'];
// What each action may carry, besides `action`.
const ACTION_KEYS = {
  edit: ['teCents', 'cashCents', 'note', 'attest'],
  withdraw: [],
  confirm: ['attest'],
  accept: ['teCents', 'cashCents', 'reviewNote', 'override'],
  return: ['reviewNote']
};
const RID_RE = /^[A-Za-z0-9-]{1,64}$/;

function reportId(params) {
  const r = params && params.rid;
  if (typeof r !== 'string' || !RID_RE.test(r)) refuse(notFound());
  return r;
}
function reviewNote(v, required) {
  if (v !== undefined && v !== null && typeof v !== 'string') refuse(badRequest('review-note'));
  const n = cleanReportNote(v);
  if (n.length > SHIFT_REPORT_NOTE_MAX || (required && !n)) refuse(badRequest('review-note'));
  return n;
}

async function patch({ request, db, packId, role, user, member, params }) {
  const rid = reportId(params);
  // Pending, and anyone with no member row, are refused before anything is read.
  if (!canSubmitShiftReport(role)) return forbidden();
  const b = await readObject(request, 4096);
  const action = b.action;
  if (typeof action !== 'string' || !Object.prototype.hasOwnProperty.call(ACTION_KEYS, action)) refuse(badRequest('action'));
  for (const k of Object.keys(b)) if (k !== 'action' && ACTION_KEYS[action].indexOf(k) === -1) refuse(badRequest('unknown-field'));
  const reviewing = action === 'accept' || action === 'return';
  if (reviewing && !canReviewShiftReport(role)) return forbidden();
  const row = await readReport(db, packId, rid);
  // The sender's own actions: anyone else gets the one fixed 403, whether or not it exists.
  if ((action === 'edit' || action === 'withdraw') && (!row || row.submitted_by_uid !== user.uid)) return forbidden();
  if (action === 'confirm' && !row) return forbidden();
  if (!row) return notFound();

  const now = Date.now(), stamp = crypto.randomUUID();
  const name = member.name || '';
  let update, roles, detail, audit;
  if (action === 'edit' || action === 'withdraw') {
    if (row.status !== 'submitted') return reportMoved(row.status);
    roles = SUBMIT_ROLES;
    if (action === 'edit') {
      const why = shiftReportFiguresProblem(b);
      if (why) refuse(badRequest(why));
      // S-4: changed figures are not what the second parent checked, so their confirmation goes.
      update = db.prepare('UPDATE shift_reports SET te_cents = ?, cash_cents = ?, note = ?, updated_at = ?, stamp = ?, ' +
        'confirmed_by_uid = NULL, confirmed_by_name = NULL, confirmed_at = NULL ' +
        "WHERE pack_id = ? AND id = ? AND stamp = ? AND status = 'submitted' AND submitted_by_uid = ? AND " + STILL_MEMBER(roles))
        .bind(b.teCents, b.cashCents, cleanReportNote(b.note), now, stamp, packId, rid, row.stamp, user.uid, packId, user.uid, ...roles);
      audit = 'shift.report.edit';
      detail = { report: rid, teCents: b.teCents, cashCents: b.cashCents, confirmationCleared: !!row.confirmed_by_uid };
    } else {
      update = db.prepare("UPDATE shift_reports SET status = 'withdrawn', updated_at = ?, stamp = ? " +
        "WHERE pack_id = ? AND id = ? AND stamp = ? AND status = 'submitted' AND submitted_by_uid = ? AND " + STILL_MEMBER(roles))
        .bind(now, stamp, packId, rid, row.stamp, user.uid, packId, user.uid, ...roles);
      audit = 'shift.report.withdraw';
      detail = { report: rid };
    }
  } else if (action === 'confirm') {
    if (row.status !== 'submitted' || row.confirmed_by_uid) return reportMoved(row.status);
    if (row.needs_confirm !== 1) return reportMoved(row.status);
    if (row.submitted_by_uid === user.uid) return samePerson();
    if (b.attest !== true) refuse(badRequest('attest'));
    // A parent of a scout on this shift, from the stored pack record. Fail closed: no record, no
    // storefront, no block, or no link, and nobody confirms.
    const rec = await readPackRecord(db, packId);
    const parents = rec ? shiftParentUids(rec.pack, row.sf_id, row.block_id) : null;
    if (!canConfirmShiftReport(role, user.uid, row.submitted_by_uid, parents)) return notShiftParent();
    roles = SUBMIT_ROLES;
    update = db.prepare('UPDATE shift_reports SET confirmed_by_uid = ?, confirmed_by_name = ?, confirmed_at = ?, updated_at = ?, stamp = ? ' +
      "WHERE pack_id = ? AND id = ? AND stamp = ? AND status = 'submitted' AND needs_confirm = 1 AND confirmed_by_uid IS NULL " +
      'AND submitted_by_uid != ? AND (SELECT rev FROM pack_state WHERE pack_id = ?) = ? AND ' + STILL_MEMBER(roles))
      .bind(user.uid, name, now, now, stamp, packId, rid, row.stamp, user.uid, packId, rec.rev, packId, user.uid, ...roles);
    audit = 'shift.confirm';
    detail = { report: rid, sfId: row.sf_id, blockId: row.block_id, teCents: row.te_cents, cashCents: row.cash_cents };
  } else if (action === 'accept') {
    if (row.status !== 'submitted') return reportMoved(row.status);
    if (row.submitted_by_uid === user.uid) return samePerson();
    // The figures the leader is signing for: whole cents, as the report must hold them.
    for (const k of ['teCents', 'cashCents']) if (!Number.isInteger(b[k]) || b[k] < 0) refuse(badRequest(k === 'teCents' ? 'te-cents' : 'cash-cents'));
    if (b.teCents !== row.te_cents || b.cashCents !== row.cash_cents) return reportMoved(row.status);
    if (b.override !== undefined && typeof b.override !== 'boolean') refuse(badRequest('override'));
    // S-4: one parent's signature where two are needed: only with a leader's written reason.
    const override = row.needs_confirm === 1 && !row.confirmed_by_uid;
    if (override && b.override !== true) return needsConfirm();
    const note = reviewNote(b.reviewNote, override);
    roles = REVIEW_ROLES;
    update = db.prepare("UPDATE shift_reports SET status = 'accepted', reviewed_by_uid = ?, reviewed_by_name = ?, reviewed_at = ?, " +
      "review_note = ?, overridden = ?, updated_at = ?, stamp = ? WHERE pack_id = ? AND id = ? AND stamp = ? AND status = 'submitted' " +
      'AND submitted_by_uid != ? AND te_cents = ? AND cash_cents = ? AND (needs_confirm = 0 OR confirmed_by_uid IS NOT NULL OR ? = 1) AND ' +
      STILL_MEMBER(roles))
      .bind(user.uid, name, now, note, override ? 1 : 0, now, stamp, packId, rid, row.stamp, user.uid, b.teCents, b.cashCents, override ? 1 : 0,
        packId, user.uid, ...roles);
    audit = override ? 'shift.accept.override' : 'shift.accept';
    detail = { report: rid, sfId: row.sf_id, blockId: row.block_id, teCents: row.te_cents, cashCents: row.cash_cents,
      submittedBy: row.submitted_by_uid };
    if (row.confirmed_by_uid) detail.confirmedBy = row.confirmed_by_uid;
    if (override) detail.reason = note;
  } else {
    if (row.status !== 'submitted' && row.status !== 'accepted') return reportMoved(row.status);
    roles = REVIEW_ROLES;
    update = db.prepare("UPDATE shift_reports SET status = 'returned', reviewed_by_uid = ?, reviewed_by_name = ?, reviewed_at = ?, " +
      "review_note = ?, updated_at = ?, stamp = ? WHERE pack_id = ? AND id = ? AND stamp = ? AND status IN ('submitted', 'accepted') " +
      'AND ' + STILL_MEMBER(roles))
      .bind(user.uid, name, now, reviewNote(b.reviewNote, true), now, stamp, packId, rid, row.stamp, packId, user.uid, ...roles);
    audit = 'shift.return';
    detail = { report: rid, sfId: row.sf_id, blockId: row.block_id, from: row.status };
  }

  const res = await db.batch([update,
    auditIf(db, packId, user.uid, audit, detail, now, 'EXISTS (SELECT 1 FROM shift_reports WHERE pack_id = ? AND id = ? AND stamp = ?)',
      [packId, rid, stamp])]);
  if (!(res[0].meta && res[0].meta.changes === 1)) {
    // Nothing written. Either the caller lost the role this needs a moment ago, or the report moved.
    const still = await db.prepare('SELECT 1 AS ok FROM members WHERE pack_id = ? AND uid = ? AND role IN (' +
      roles.map(() => '?').join(', ') + ')').bind(packId, user.uid, ...roles).first();
    if (!still) return forbidden();
    const now2 = await readReport(db, packId, rid);
    return reportMoved(now2 ? now2.status : null);
  }
  return json(200, { report: reportOut(await readReport(db, packId, rid), user.uid, canReadAllShiftReports(role)) });
}

export const onRequest = route({ PATCH: withMember(patch) });
