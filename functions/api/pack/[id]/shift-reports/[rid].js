// GET   /api/pack/:id/shift-reports/:rid   one report, and everything that happened to it (Keith,
//        2026-10-08): ADMINS ONLY (rules.js canReadShiftReportHistory; an editor, a viewer or a
//        parent gets the one fixed 403, whether or not the report exists). Answers
//        { report, history, truncated }: the report as a leader reads it (reportOut, in full), and
//        its audit rows oldest first, at most SR_HISTORY_MAX (the newest; truncated says some
//        older ones were left out). See historyOut below for what each step carries.
// PATCH /api/pack/:id/shift-reports/:rid   change one shift report, by `action`:
//   { action: 'edit', teCents, cashCents, salesCashCents?, note?, inventory?, attest: true }   the sender, while it is waiting
//   { action: 'withdraw' }                                        the sender, while it is waiting
//   { action: 'confirm', teCents, cashCents, salesCashCents?, updatedAt, attest: true }  S-4: a parent from another family on the shift
//   { action: 'accept', teCents, cashCents, salesCashCents?, collected?, reviewNote?, override? }  admin or editor; not their own, nor one they confirmed
// S-5: salesCashCents, the cash from popcorn sales still in hand, is 0 when left out. A confirm
// or an accept names it with the other two figures, and lands only if the report still holds it.
// Followups round 1 (treasurer and security): what became of that cash is a leader's record, kept
// here and audited, not only on the pack record's block. 'salescash' sets outcome 'collected' (a
// leader has the cash) or 'converted' (the family converted it to credit after all), or null to
// undo either; it names the amount it is about. Audited shift.salescash.collected / .converted /
// .replaced / .undo. Only on an ACCEPTED report with cash from sales (a waiting one is not the
// pack's yet), or one sent back after it was accepted; 'replaced' (the same cash as the newer
// report on the shift) only on the sent-back kind.
//   { action: 'return', reviewNote }                              admin or editor; waiting or accepted
//   { action: 'salescash', outcome, salesCashCents }              admin or editor; an accepted report holding cash from sales
//   { action: 'amend', teCents, cashCents, salesCashCents?, wasTeCents, wasCashCents, wasSalesCashCents?, inventory?, wasInventory?, reason }
//                                                                 an ADMIN; an accepted report (Keith, 2026-10-07)
// The count of popcorn left on the table (Keith, 2026-10-08; migrations/0006): the sender's edit
// may change it (left out, it stays as it is; [] clears it); an admin's 'amend' may correct it,
// naming the count it was shown (wasInventory, both or neither), kept before and after in
// shift_report_amendments. A confirm and an accept leave it alone and never name it: it is
// information for the leaders, not part of the signed figures, and changes nothing in the pack.
// Products: those the stored view publishes for the report's storefront (an admin's correction
// may also keep a product the report already counts, for a storefront no longer published).
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
//   - Review round 1 (Keith, 2026-10-01):
//     · the confirmer is from a DIFFERENT FAMILY than the sender (rules.js shiftConfirmers), and
//       confirms only while the shift is in the view and the 14-day window, naming the figures
//       and the version (updatedAt) they were shown;
//     · WHO VERIFIED THE CASH. Two or more families: the confirming parent. One family: the
//       accepting leader, who says they collected and counted it (collected: true). Otherwise a
//       leader accepts only as an override, with a written reason, and nobody is the verifier.
//     · a leader who confirmed a report as a parent may not accept it (409 same-person);
//     · the accept is recorded once, in accepted_* and accept_note, which nothing later changes.
//   - Keith (2026-10-01): the accepting leader is from a DIFFERENT FAMILY than the sender (rules.js
//     sameFamily, from the stored pack record's parentUids, read per rev as the confirm reads it).
//     If they share one, a plain or collected accept is refused (409 same-family), and only an
//     override with a written reason is left, audited shift.accept.override with sameFamily: true.
//     The write lands only if the pack record's rev is still the one read (409 pack-moved if that is
//     all that changed: the page tries again). An account linked to no scout shares no family
//     (allowed, as before); a pack with no record decides nothing either, but a record that exists
//     and can't be read decides "same family" (fail closed, followups round 3).
//   - The same rule, and never the sender, for recording what became of the cash from sales
//     ('salescash', followups round 3). Undoing one is open to any admin or editor.
//   - Sending back needs a reason, and works on a waiting report or an accepted one (a leader
//     reopening a report that went in wrong). A family sends a corrected one as a new report.
//   - Correcting an accepted report (Keith, 2026-10-07; migrations/0005_shift_report_amendments.sql):
//     a family rained out of a storefront sold from a wagon and reported it as the storefront's
//     totals, so once Trail's End's figures came in the sales counted twice. An ADMIN (not an
//     editor: canAmendShiftReport) changes the figures of an ACCEPTED report in place, with a
//     written reason the family reads, and it stays accepted. The admin names the figures they
//     were shown (was*), and the edit lands only if the report still holds them. What it held
//     before is kept in shift_report_amendments, one row per edit, written in the same batch and
//     only if the edit landed, and audited shift.amend. The accept's own record (accepted_*) is
//     never touched. Never the sender, nor the parent who confirmed it, nor anyone in the
//     sender's family (the accept's own rule, the same record and rev in the write): an admin
//     does not correct their own family's credit. Cash from sales a leader has already recorded
//     as collected or converted keeps its amount (409 sales-cash-recorded: undo that first), and
//     is never more than the Trail's End amount, as when it was sent.
// Every change is compared in the write itself: the UPDATE names the state it was decided
// against (the row's stamp, its status, the figures) and the caller's role at that moment, and
// a change that finds anything moved writes nothing and answers 409 report-moved — so a leader
// accepting while another sends it back, or a family withdrawing as it is accepted, cannot both
// win. The audit row is in the same batch and lands only with its own change.

import { route, json, readObject, refuse, forbidden, notFound, badRequest, reportMoved, samePerson, notShiftParent, needsConfirm,
  notCollected, sameFamilyRefused, packMoved, salesCashRecorded } from '../../../../_lib/http.js';
import { withMember, auditIf } from '../../../../_lib/pack.js';
import { canSubmitShiftReport, canReviewShiftReport, canAmendShiftReport, canReadAllShiftReports, canReadShiftReportHistory, shiftReportFiguresProblem, cleanReportNote, reportSalesCash,
  SHIFT_REPORT_NOTE_MAX, shiftConfirmers, sameFamily, canConfirmShiftReport, shiftOfView, daysBetween, packToday, SHIFT_REPORT_DAYS,
  shiftInventoryProblem, SHAPE_ONLY, viewProductIds, inventoryJson, inventoryList } from '../../../../_lib/rules.js';
import { reportOut, readReport, readReportAmendments, readPackRecord, readPackForFamily, STILL_MEMBER, SUBMIT_ROLES, SHIFT_REPORT_BODY_MAX,
  auditInventory } from './index.js';

// Is this leader in the sender's family, by the record read for it? An unreadable record says yes.
const familyOf = (famRec, uid, senderUid) => !!famRec && (famRec.unreadable === true || sameFamily(famRec.pack, uid, senderUid));

const REVIEW_ROLES = ['admin', 'editor'];
// What each action may carry, besides `action`.
const ACTION_KEYS = {
  edit: ['teCents', 'cashCents', 'salesCashCents', 'note', 'inventory', 'attest'],
  withdraw: [],
  confirm: ['attest', 'teCents', 'cashCents', 'salesCashCents', 'updatedAt'],
  accept: ['teCents', 'cashCents', 'salesCashCents', 'reviewNote', 'override', 'collected'],
  return: ['reviewNote'],
  salescash: ['outcome', 'salesCashCents'],
  amend: ['teCents', 'cashCents', 'salesCashCents', 'wasTeCents', 'wasCashCents', 'wasSalesCashCents', 'inventory', 'wasInventory', 'reason']
};
const AMEND_ROLES = ['admin'];
const RID_RE = /^[A-Za-z0-9-]{1,64}$/;

function reportId(params) {
  const r = params && params.rid;
  if (typeof r !== 'string' || !RID_RE.test(r)) refuse(notFound());
  return r;
}
// The products this report's storefront publishes for the count, from the stored view (none if
// it is not published), plus `keep`: the ids the report already counts, for an admin's correction.
async function allowedProducts(db, packId, row, keep) {
  const vrow = await db.prepare('SELECT payload FROM parent_views WHERE pack_id = ?').bind(packId).first();
  let view = null;
  try { view = vrow ? JSON.parse(vrow.payload) : null; } catch (e) { view = null; }
  const at = shiftOfView(view, row.sf_id, row.block_id);
  const ok = viewProductIds(at && at.ev);
  if (keep) inventoryList(row.inventory_json).forEach((x) => { ok[x.productId] = true; });
  return ok;
}
function reviewNote(v, required, why) {
  if (v !== undefined && v !== null && typeof v !== 'string') refuse(badRequest(why || 'review-note'));
  const n = cleanReportNote(v);
  if (n.length > SHIFT_REPORT_NOTE_MAX || (required && !n)) refuse(badRequest(why || 'review-note'));
  return n;
}

async function patch({ request, db, packId, role, user, member, params }) {
  const rid = reportId(params);
  // Pending, and anyone with no member row, are refused before anything is read.
  if (!canSubmitShiftReport(role)) return forbidden();
  const b = await readObject(request, SHIFT_REPORT_BODY_MAX);
  const action = b.action;
  if (typeof action !== 'string' || !Object.prototype.hasOwnProperty.call(ACTION_KEYS, action)) refuse(badRequest('action'));
  for (const k of Object.keys(b)) if (k !== 'action' && ACTION_KEYS[action].indexOf(k) === -1) refuse(badRequest('unknown-field'));
  const reviewing = action === 'accept' || action === 'return' || action === 'salescash';
  if (reviewing && !canReviewShiftReport(role)) return forbidden();
  if (action === 'amend' && !canAmendShiftReport(role)) return forbidden();
  const row = await readReport(db, packId, rid);
  // The sender's own actions: anyone else gets the one fixed 403, whether or not it exists.
  if ((action === 'edit' || action === 'withdraw') && (!row || row.submitted_by_uid !== user.uid)) return forbidden();
  if (action === 'confirm' && !row) return forbidden();
  if (!row) return notFound();

  const now = Date.now(), stamp = crypto.randomUUID();
  const name = member.name || '';
  let update, roles, detail, audit;
  let famRec = null;   // the pack record a family decision was made against (accept, salescash, amend): its rev is in the write
  let amendRow = null;  // amend: the correction's own row, written only with it
  if (action === 'edit' || action === 'withdraw') {
    if (row.status !== 'submitted') return reportMoved(row.status);
    roles = SUBMIT_ROLES;
    if (action === 'edit') {
      const why = shiftReportFiguresProblem(b);
      if (why) refuse(badRequest(why));
      // The count: left out, it stays; given, it replaces the one there ([] clears it).
      let invJson = row.inventory_json || '';
      if (b.inventory !== undefined && b.inventory !== null) {
        const invWhy = shiftInventoryProblem(b.inventory, Array.isArray(b.inventory) && b.inventory.length ? await allowedProducts(db, packId, row, false) : {});
        if (invWhy) refuse(badRequest(invWhy));
        invJson = inventoryJson(b.inventory);
      }
      // S-4: changed figures are not what the second parent checked, so their confirmation goes.
      const salesCash = reportSalesCash(b);
      update = db.prepare('UPDATE shift_reports SET te_cents = ?, cash_cents = ?, sales_cash_cents = ?, note = ?, inventory_json = ?, updated_at = ?, stamp = ?, ' +
        'confirmed_by_uid = NULL, confirmed_by_name = NULL, confirmed_at = NULL ' +
        "WHERE pack_id = ? AND id = ? AND stamp = ? AND status = 'submitted' AND submitted_by_uid = ? AND " + STILL_MEMBER(roles))
        .bind(b.teCents, b.cashCents, salesCash, cleanReportNote(b.note), invJson, now, stamp, packId, rid, row.stamp, user.uid, packId, user.uid, ...roles);
      audit = 'shift.report.edit';
      detail = auditInventory({ report: rid, teCents: b.teCents, cashCents: b.cashCents, salesCashCents: salesCash, confirmationCleared: !!row.confirmed_by_uid }, invJson);
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
    // The figures and the version the confirmer was shown (security review 1): an edit since, and
    // this is not what they checked.
    const salesCash = reportSalesCash(b);
    if (!Number.isInteger(b.teCents) || !Number.isInteger(b.cashCents) || !Number.isInteger(salesCash) || !Number.isInteger(b.updatedAt)) {
      refuse(badRequest('figures'));
    }
    if (b.teCents !== row.te_cents || b.cashCents !== row.cash_cents || salesCash !== row.sales_cash_cents || b.updatedAt !== row.updated_at) {
      return reportMoved(row.status);
    }
    // Only while the shift is still published and in the reporting window (security review 5).
    const vrow = await db.prepare('SELECT payload FROM parent_views WHERE pack_id = ?').bind(packId).first();
    let view = null;
    try { view = vrow ? JSON.parse(vrow.payload) : null; } catch (e) { view = null; }
    const at = shiftOfView(view, row.sf_id, row.block_id);
    if (!at) refuse(badRequest('not-in-view'));
    const ago = daysBetween(at.ev.date, packToday());
    if (!(ago >= 0 && ago <= SHIFT_REPORT_DAYS)) refuse(badRequest('too-old'));
    // A parent from another family on this shift, from the stored pack record. Fail closed: no
    // record, no storefront, no block, or no link, and nobody confirms.
    const rec = await readPackRecord(db, packId);
    const confirmers = rec ? shiftConfirmers(rec.pack, row.sf_id, row.block_id, row.submitted_by_uid) : null;
    if (!canConfirmShiftReport(role, user.uid, row.submitted_by_uid, confirmers)) return notShiftParent();
    roles = SUBMIT_ROLES;
    update = db.prepare('UPDATE shift_reports SET confirmed_by_uid = ?, confirmed_by_name = ?, confirmed_at = ?, updated_at = ?, stamp = ? ' +
      "WHERE pack_id = ? AND id = ? AND stamp = ? AND status = 'submitted' AND needs_confirm = 1 AND confirmed_by_uid IS NULL " +
      'AND submitted_by_uid != ? AND te_cents = ? AND cash_cents = ? AND sales_cash_cents = ? AND updated_at = ? ' +
      'AND (SELECT rev FROM pack_state WHERE pack_id = ?) = ? AND ' + STILL_MEMBER(roles))
      .bind(user.uid, name, now, now, stamp, packId, rid, row.stamp, user.uid, b.teCents, b.cashCents, salesCash, b.updatedAt, packId, rec.rev,
        packId, user.uid, ...roles);
    audit = 'shift.confirm';
    detail = { report: rid, sfId: row.sf_id, blockId: row.block_id, teCents: row.te_cents, cashCents: row.cash_cents,
      salesCashCents: row.sales_cash_cents, confirmerName: name };
  } else if (action === 'accept') {
    if (row.status !== 'submitted') return reportMoved(row.status);
    if (row.submitted_by_uid === user.uid) return samePerson();
    // A leader who confirmed it as a parent may not also accept it (treasurer b, security 2).
    if (row.confirmed_by_uid && row.confirmed_by_uid === user.uid) return samePerson();
    // The figures the leader is signing for: whole cents, as the report must hold them.
    for (const k of ['teCents', 'cashCents']) if (!Number.isInteger(b[k]) || b[k] < 0) refuse(badRequest(k === 'teCents' ? 'te-cents' : 'cash-cents'));
    const salesCash = reportSalesCash(b);
    if (!Number.isInteger(salesCash) || salesCash < 0) refuse(badRequest('sales-cash-cents'));
    if (b.teCents !== row.te_cents || b.cashCents !== row.cash_cents || salesCash !== row.sales_cash_cents) return reportMoved(row.status);
    if (b.override !== undefined && typeof b.override !== 'boolean') refuse(badRequest('override'));
    if (b.collected !== undefined && typeof b.collected !== 'boolean') refuse(badRequest('collected'));
    // Who verified the cash. Two or more families: the confirming parent. One family: this leader,
    // who collected and counted it. Anything else is an override, with a written reason, and no
    // verifier: one parent's signature where two are needed, or a leader who did not collect it.
    famRec = await readPackForFamily(db, packId);
    const rec = famRec;
    const same = familyOf(famRec, user.uid, row.submitted_by_uid);
    const confirmed = row.needs_confirm === 1 && !!row.confirmed_by_uid;
    const collected = !same && row.needs_confirm === 0 && b.collected === true;
    const override = same || (!confirmed && !collected);
    if (override && b.override !== true) return same ? sameFamilyRefused() : row.needs_confirm === 1 ? needsConfirm() : notCollected();
    const note = reviewNote(b.reviewNote, override);
    roles = REVIEW_ROLES;
    update = db.prepare("UPDATE shift_reports SET status = 'accepted', reviewed_by_uid = ?, reviewed_by_name = ?, reviewed_at = ?, " +
      'review_note = ?, overridden = ?, accepted_by_uid = ?, accepted_by_name = ?, accepted_at = ?, accept_note = ?, verified_by_leader = ?, ' +
      "updated_at = ?, stamp = ? WHERE pack_id = ? AND id = ? AND stamp = ? AND status = 'submitted' AND accepted_by_uid IS NULL " +
      'AND submitted_by_uid != ? AND (confirmed_by_uid IS NULL OR confirmed_by_uid != ?) AND te_cents = ? AND cash_cents = ? ' +
      'AND sales_cash_cents = ? AND (needs_confirm = 0 OR confirmed_by_uid IS NOT NULL OR ? = 1) AND ' +
      (rec ? '(SELECT rev FROM pack_state WHERE pack_id = ?) = ? AND ' : '') + STILL_MEMBER(roles))
      .bind(user.uid, name, now, note, override ? 1 : 0, user.uid, name, now, note, collected ? 1 : 0, now, stamp, packId, rid, row.stamp,
        user.uid, user.uid, b.teCents, b.cashCents, salesCash, override ? 1 : 0, ...(rec ? [packId, rec.rev] : []), packId, user.uid, ...roles);
    audit = override ? 'shift.accept.override' : 'shift.accept';
    detail = { report: rid, sfId: row.sf_id, blockId: row.block_id, teCents: row.te_cents, cashCents: row.cash_cents, salesCashCents: row.sales_cash_cents,
      submittedBy: row.submitted_by_uid, submittedByName: row.submitted_by_name, reviewerName: name, reviewNote: note, collected };
    if (row.confirmed_by_uid) { detail.confirmedBy = row.confirmed_by_uid; detail.confirmedByName = row.confirmed_by_name || ''; }
    if (override) detail.reason = note;
    if (same) detail.sameFamily = true;
  } else if (action === 'salescash') {
    if (b.outcome !== null && b.outcome !== 'collected' && b.outcome !== 'converted' && b.outcome !== 'replaced') refuse(badRequest('outcome'));
    if (!Number.isInteger(b.salesCashCents) || b.salesCashCents <= 0) refuse(badRequest('sales-cash-cents'));
    // Treasurer re-check (followups round 3): an accepted report, or one a leader sent back AFTER
    // accepting it — its cash was reported, and may still be out. 'replaced' (the same cash as a
    // newer report on the shift, so it isn't counted twice) only on such a sent-back one.
    const wasAccepted = row.status === 'accepted' || (row.status === 'returned' && !!row.accepted_by_uid);
    if (!wasAccepted) return reportMoved(row.status);
    if (b.outcome === 'replaced' && row.status !== 'returned') refuse(badRequest('outcome'));
    if (!(row.sales_cash_cents > 0)) refuse(badRequest('no-sales-cash'));
    // The amount the leader was shown, and the state they saw: nothing recorded yet to set one, an
    // outcome to undo.
    if (b.salesCashCents !== row.sales_cash_cents) return reportMoved(row.status);
    const undo = b.outcome === null;
    if (undo ? !row.sales_cash_outcome : !!row.sales_cash_outcome) return reportMoved(row.status);
    // Security re-check (followups round 3): recording what became of the cash is a second adult's
    // word on it, as the accept is: never the sender, nor a leader in the sender's family (same
    // record, same rev in the write). An undo is open to any admin or editor.
    if (!undo) {
      if (row.submitted_by_uid === user.uid) return samePerson();
      // Nor the parent who confirmed it (security review of the parent preview: a leader-parent can now confirm).
      if (row.confirmed_by_uid && row.confirmed_by_uid === user.uid) return samePerson();
      famRec = await readPackForFamily(db, packId);
      if (familyOf(famRec, user.uid, row.submitted_by_uid)) return sameFamilyRefused();
    }
    roles = REVIEW_ROLES;
    update = db.prepare('UPDATE shift_reports SET sales_cash_outcome = ?, sales_cash_by_uid = ?, sales_cash_by_name = ?, sales_cash_at = ?, ' +
      "updated_at = ?, stamp = ? WHERE pack_id = ? AND id = ? AND stamp = ? AND (status = 'accepted' OR (status = 'returned' AND accepted_by_uid IS NOT NULL)) " +
      (b.outcome === 'replaced' ? "AND status = 'returned' " : '') + 'AND sales_cash_cents = ? AND ' +
      'sales_cash_outcome IS ' + (undo ? 'NOT NULL' : 'NULL') + ' AND ' + (undo ? '' : 'submitted_by_uid != ? AND (confirmed_by_uid IS NULL OR confirmed_by_uid != ?) AND ') +
      (famRec ? '(SELECT rev FROM pack_state WHERE pack_id = ?) = ? AND ' : '') + STILL_MEMBER(roles))
      .bind(undo ? null : b.outcome, undo ? null : user.uid, undo ? null : name, undo ? null : now, now, stamp, packId, rid, row.stamp,
        b.salesCashCents, ...(undo ? [] : [user.uid, user.uid]), ...(famRec ? [packId, famRec.rev] : []), packId, user.uid, ...roles);
    audit = 'shift.salescash.' + (undo ? 'undo' : b.outcome);
    detail = { report: rid, sfId: row.sf_id, blockId: row.block_id, salesCashCents: row.sales_cash_cents, byName: name };
    if (undo) detail.was = { outcome: row.sales_cash_outcome, byName: row.sales_cash_by_name || '', at: row.sales_cash_at };
  } else if (action === 'amend') {
    if (row.status !== 'accepted') return reportMoved(row.status);
    // The new figures, as a report's (whole cents in range; the cash from sales no more than the
    // Trail's End amount), and the figures the admin was shown.
    const why = shiftReportFiguresProblem(Object.assign({}, b, { attest: true, note: undefined }));
    if (why) refuse(badRequest(why));
    const salesCash = reportSalesCash(b);
    const wasSales = b.wasSalesCashCents !== undefined ? b.wasSalesCashCents : 0;
    for (const v of [b.wasTeCents, b.wasCashCents, wasSales]) if (!Number.isInteger(v)) refuse(badRequest('figures'));
    const note = reviewNote(b.reason, true, 'amend-reason');
    // The count (2026-10-08): both or neither of inventory and wasInventory; left out, it stays.
    const wasInv = row.inventory_json || '';
    let invJson = wasInv;
    if ((b.inventory === undefined) !== (b.wasInventory === undefined)) refuse(badRequest('inventory'));
    if (b.inventory !== undefined) {
      // What the admin was shown: a count of the right shape, whatever products it names.
      if (shiftInventoryProblem(b.wasInventory, SHAPE_ONLY)) refuse(badRequest('inventory'));
      const invWhy = shiftInventoryProblem(b.inventory, await allowedProducts(db, packId, row, true));
      if (invWhy) refuse(badRequest(invWhy));
      if (inventoryJson(b.wasInventory) !== wasInv) return reportMoved(row.status);
      invJson = inventoryJson(b.inventory);
    }
    if (b.wasTeCents !== row.te_cents || b.wasCashCents !== row.cash_cents || wasSales !== row.sales_cash_cents) return reportMoved(row.status);
    if (b.teCents === row.te_cents && b.cashCents === row.cash_cents && salesCash === row.sales_cash_cents && invJson === wasInv) refuse(badRequest('no-change'));
    if (row.sales_cash_outcome && salesCash !== row.sales_cash_cents) return salesCashRecorded();
    // A second adult's word on the money, as the accept is: never the sender, the confirmer, or
    // the sender's family.
    if (row.submitted_by_uid === user.uid || (row.confirmed_by_uid && row.confirmed_by_uid === user.uid)) return samePerson();
    famRec = await readPackForFamily(db, packId);
    if (familyOf(famRec, user.uid, row.submitted_by_uid)) return sameFamilyRefused();
    roles = AMEND_ROLES;
    update = db.prepare('UPDATE shift_reports SET te_cents = ?, cash_cents = ?, sales_cash_cents = ?, inventory_json = ?, updated_at = ?, stamp = ? ' +
      "WHERE pack_id = ? AND id = ? AND stamp = ? AND status = 'accepted' AND te_cents = ? AND cash_cents = ? AND sales_cash_cents = ? AND inventory_json = ? " +
      'AND (sales_cash_outcome IS NULL OR sales_cash_cents = ?) AND submitted_by_uid != ? AND (confirmed_by_uid IS NULL OR confirmed_by_uid != ?) AND ' +
      (famRec ? '(SELECT rev FROM pack_state WHERE pack_id = ?) = ? AND ' : '') + STILL_MEMBER(roles))
      .bind(b.teCents, b.cashCents, salesCash, invJson, now, stamp, packId, rid, row.stamp, row.te_cents, row.cash_cents, row.sales_cash_cents, wasInv,
        salesCash, user.uid, user.uid, ...(famRec ? [packId, famRec.rev] : []), packId, user.uid, ...roles);
    amendRow = db.prepare('INSERT INTO shift_report_amendments (pack_id, report_id, at, by_uid, by_name, reason, was_te_cents, was_cash_cents, ' +
      'was_sales_cash_cents, te_cents, cash_cents, sales_cash_cents, was_inventory_json, inventory_json) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? ' +
      'WHERE EXISTS (SELECT 1 FROM shift_reports WHERE pack_id = ? AND id = ? AND stamp = ?)')
      .bind(packId, rid, now, user.uid, name, note, row.te_cents, row.cash_cents, row.sales_cash_cents, b.teCents, b.cashCents, salesCash,
        wasInv, invJson, packId, rid, stamp);
    audit = 'shift.amend';
    // The count after, as every count-changing step records it (the history works out the before).
    detail = auditInventory({ report: rid, sfId: row.sf_id, blockId: row.block_id, byName: name, reason: note,
      was: { teCents: row.te_cents, cashCents: row.cash_cents, salesCashCents: row.sales_cash_cents },
      now: { teCents: b.teCents, cashCents: b.cashCents, salesCashCents: salesCash } }, invJson);
  } else {
    if (row.status !== 'submitted' && row.status !== 'accepted') return reportMoved(row.status);
    roles = REVIEW_ROLES;
    update = db.prepare("UPDATE shift_reports SET status = 'returned', reviewed_by_uid = ?, reviewed_by_name = ?, reviewed_at = ?, " +
      "review_note = ?, updated_at = ?, stamp = ? WHERE pack_id = ? AND id = ? AND stamp = ? AND status IN ('submitted', 'accepted') " +
      'AND ' + STILL_MEMBER(roles))
      .bind(user.uid, name, now, reviewNote(b.reviewNote, true), now, stamp, packId, rid, row.stamp, packId, user.uid, ...roles);
    audit = 'shift.return';
    detail = { report: rid, sfId: row.sf_id, blockId: row.block_id, from: row.status, reason: cleanReportNote(b.reviewNote), reviewerName: name };
  }

  const res = await db.batch([update, ...(amendRow ? [amendRow] : []),
    auditIf(db, packId, user.uid, audit, detail, now, 'EXISTS (SELECT 1 FROM shift_reports WHERE pack_id = ? AND id = ? AND stamp = ?)',
      [packId, rid, stamp])]);
  if (!(res[0].meta && res[0].meta.changes === 1)) {
    // Nothing written. Either the caller lost the role this needs a moment ago, or the report moved.
    const still = await db.prepare('SELECT 1 AS ok FROM members WHERE pack_id = ? AND uid = ? AND role IN (' +
      roles.map(() => '?').join(', ') + ')').bind(packId, user.uid, ...roles).first();
    if (!still) return forbidden();
    const now2 = await readReport(db, packId, rid);
    // Followups round 3 (treasurer 6a): the report is as it was, but the pack record the family
    // decision rested on moved — say so, so the page tries again instead of undoing an accept.
    if (famRec && now2 && now2.stamp === row.stamp) {
      const head = await db.prepare('SELECT rev FROM pack_state WHERE pack_id = ?').bind(packId).first();
      if (!head || head.rev !== famRec.rev) return packMoved();
    }
    return reportMoved(now2 ? now2.status : null);
  }
  return json(200, { report: reportOut(await readReport(db, packId, rid), user.uid, canReadAllShiftReports(role),
    await readReportAmendments(db, packId, rid)) });
}

// ---- One report's history (Keith, 2026-10-08) ----
// "A way for admins to see who makes the edits for shift reports." Every change to a report already
// writes an audit row in the same batch as the change (above, and index.js's POST), naming the
// report in its detail. This reads them back for one report, for an admin only.
//   - Rows of this pack, a shift-report action, whose detail names this report. A detail that is
//     not JSON is skipped (json_valid inside the CASE, so json_extract never sees it).
//   - The audit holds account ids, not names. Each step's name is the account's member name now,
//     else the name the detail kept when it was written, else (for the sender's own steps) the
//     name the report was sent under, else 'a former member'. Full names, as reportOut gives
//     leaders, and never an email address (leaderName). No account id is sent: nothing on the
//     page needs one, and the detail's own (submittedBy, confirmedBy) stay here.
//   - Each step carries only what is listed in historyOut, never the detail as it is.
//   - A sender's edit carries the figures before it (`was`), from the step before it in the
//     timeline, so the page can say "was → now"; an admin's edit kept its own `was`.
//   - The count of popcorn left (2026-10-08): a send carries it when there is one; an edit or an
//     admin's correction that changed it carries `wasInventory` (from the steps before; null when
//     not known) and `inventory`. A count too long for its audit row says only inventoryUnknown.
export const SR_HISTORY_MAX = 200;
export const SR_HISTORY_ACTIONS = ['shift.report', 'shift.report.edit', 'shift.report.withdraw', 'shift.confirm', 'shift.accept',
  'shift.accept.override', 'shift.return', 'shift.salescash.collected', 'shift.salescash.converted', 'shift.salescash.replaced',
  'shift.salescash.undo', 'shift.amend'];
const SR_SENDER_ACTIONS = ['shift.report', 'shift.report.edit', 'shift.report.withdraw'];
// The name the detail kept, by action: who did it, as their member name was at the time.
const SR_DETAIL_NAME = { 'shift.confirm': 'confirmerName', 'shift.accept': 'reviewerName', 'shift.accept.override': 'reviewerName',
  'shift.return': 'reviewerName', 'shift.amend': 'byName' };
// A name as a leader reads it: the whole name, trimmed, and never an email address.
export const leaderName = (n) => {
  const s = String(n == null ? '' : n).trim();
  return s && s.indexOf('@') === -1 ? s.slice(0, 120) : null;
};
const figuresOf = (d) => (d && Number.isInteger(d.teCents) && Number.isInteger(d.cashCents)
  ? { teCents: d.teCents, cashCents: d.cashCents, salesCashCents: Number.isInteger(d.salesCashCents) ? d.salesCashCents : 0 } : null);
const textOf = (v) => (typeof v === 'string' ? v.slice(0, 300) : '');
// A detail's count: a list, or null when the row says it was too long to keep, or undefined when
// the row has none (written before counts existed: nothing was counted).
const countOf = (d) => {
  if (Number.isInteger(d.inventoryCounted)) return null;
  if (!Array.isArray(d.inventory)) return undefined;
  return d.inventory.filter((p) => Array.isArray(p) && typeof p[0] === 'string' && Number.isInteger(p[1]))
    .map((p) => ({ productId: p[0].slice(0, 64), left: p[1] }));
};
const sameCount = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// The steps, oldest first. `rows` are audit rows (id, at, uid, action, detail), oldest first;
// `names` is { uid: member name } for the accounts still in the pack; `report` is the row.
export function historyOut(rows, names, report) {
  let fig = null;
  let inv = [];   // the count so far: [] until a step says otherwise, null when not known
  const out = [];
  for (const row of rows) {
    if (SR_HISTORY_ACTIONS.indexOf(row.action) === -1) continue;
    let d = {};
    try { d = JSON.parse(row.detail); } catch (e) { d = {}; }
    if (!d || typeof d !== 'object' || Array.isArray(d)) d = {};
    const a = row.action;
    const member = Object.prototype.hasOwnProperty.call(names, row.uid);
    const sender = SR_SENDER_ACTIONS.indexOf(a) !== -1 && row.uid === report.submitted_by_uid;
    const byName = (member && leaderName(names[row.uid])) ||
      leaderName(a.indexOf('shift.salescash.') === 0 ? d.byName : d[SR_DETAIL_NAME[a]]) ||
      (sender && leaderName(report.submitted_by_name)) || (member ? 'a pack member' : 'a former member');
    const e = { at: row.at, action: a, byName };
    const count = countOf(d);
    const counted = () => {
      if (count === undefined) return;
      if (count === null) { e.inventoryUnknown = true; inv = null; return; }
      if (inv !== null && sameCount(inv, count)) return;
      if (a !== 'shift.report') e.wasInventory = inv;
      e.inventory = count;
      inv = count;
    };
    if (a === 'shift.report') {
      e.figures = figuresOf(d);
      e.needsConfirm = d.needsConfirm === true;
      fig = e.figures;
      counted();
    } else if (a === 'shift.report.edit') {
      e.was = fig;
      e.figures = figuresOf(d);
      e.confirmationCleared = d.confirmationCleared === true;
      fig = e.figures;
      counted();
    } else if (a === 'shift.confirm') {
      e.figures = figuresOf(d);
      fig = e.figures || fig;
    } else if (a === 'shift.accept' || a === 'shift.accept.override') {
      e.figures = figuresOf(d);
      e.collected = d.collected === true;
      e.sameFamily = d.sameFamily === true;
      e.reason = textOf(a === 'shift.accept.override' ? d.reason : d.reviewNote);
      fig = e.figures || fig;
    } else if (a === 'shift.return') {
      e.reason = textOf(d.reason);
      e.from = d.from === 'accepted' ? 'accepted' : 'submitted';
    } else if (a === 'shift.amend') {
      e.was = figuresOf(d.was);
      e.figures = figuresOf(d.now);
      e.reason = textOf(d.reason);
      fig = e.figures || fig;
      counted();
    } else if (a.indexOf('shift.salescash.') === 0) {
      e.outcome = a.slice('shift.salescash.'.length);
      e.salesCashCents = Number.isInteger(d.salesCashCents) ? d.salesCashCents : 0;
      if (e.outcome === 'undo' && d.was && typeof d.was === 'object') {
        const w = d.was.outcome;
        e.undid = w === 'collected' || w === 'converted' || w === 'replaced' ? w : null;
      }
    }
    out.push(e);
  }
  return out;
}
// The audit rows that name report `rid`, as SQL bound with (packId, rid).
const HISTORY_WHERE = "pack_id = ? AND action LIKE 'shift.%' AND (CASE WHEN json_valid(detail) THEN json_extract(detail, '$.report') END) = ?";

async function read({ db, packId, role, user, params }) {
  // Anyone but an admin gets the one fixed 403 before anything is read, whatever the id.
  if (!canReadShiftReportHistory(role)) return forbidden();
  const rid = reportId(params);
  const row = await readReport(db, packId, rid);
  if (!row) return notFound();
  const r = await db.prepare('SELECT id, at, uid, action, detail FROM audit WHERE ' + HISTORY_WHERE + ' ORDER BY id DESC LIMIT ?')
    .bind(packId, rid, SR_HISTORY_MAX + 1).all();
  const rows = (r.results || []).slice(0, SR_HISTORY_MAX).reverse();
  // The names of the accounts in those rows that are still members. A subquery, not a list of ids:
  // D1 binds at most 100 values.
  const m = await db.prepare('SELECT uid, name FROM members WHERE pack_id = ? AND uid IN (SELECT uid FROM audit WHERE ' + HISTORY_WHERE + ')')
    .bind(packId, packId, rid).all();
  const names = {};
  for (const x of m.results || []) names[x.uid] = x.name;
  return json(200, { report: reportOut(row, user.uid, true, await readReportAmendments(db, packId, rid)),
    history: historyOut(rows, names, row), truncated: (r.results || []).length > SR_HISTORY_MAX });
}

export const onRequest = route({ GET: withMember(read), PATCH: withMember(patch) });
