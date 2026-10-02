// GET  /api/pack/:id/shift-reports   the storefront shift reports       (admin, editor, viewer, leader, parent)
//        leaders: { reports: [every report, in full], others: [], myShifts }
//        a parent: { reports: [their own, in full], others: [{ sfId, blockId, status }], myShifts }
//        myShifts: [{ sfId, blockId }], the caller's own scouts' shifts (see myShiftsAndLink below);
//        linked: whether the caller is linked to any scout at all (a yes/no, nothing else)
// GET /api/pack/:id/shift-reports?as=parent   (any approved role) exactly what a PARENT with the
//        caller's uid would get: their own reports in the parent shape, everyone else's as status
//        only (canConfirm where they may confirm), myShifts and linked — never a leader-only field.
//        The parent preview asks for this, so a leader who is also a parent sees, and sends, as
//        one (Keith, 2026-10-01). It only ever narrows what this role could read anyway.
// POST /api/pack/:id/shift-reports   send one: { sfId, blockId, teCents, cashCents, salesCashCents?, note?, attest: true }
//                                     (admin, editor, viewer, leader, parent — never pending)
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
//     signature box ticked (attest: true). S-5: the cash from popcorn sales still in hand
//     (salesCashCents) is optional, 0 when left out, and never more than the Trail's End amount
//     it is part of (migrations/0004_shift_report_sales_cash.sql).
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
import { ACCESS_TABLE } from '../../../../_lib/access.js';
import { canSubmitShiftReport, canReadAllShiftReports, shiftReportProblem, cleanReportNote, packToday, shiftOfView, shiftNeedsConfirm, reportSalesCash,
  shiftConfirmers, shiftParentUids, familiesOf, canConfirmShiftReport, daysBetween, SHIFT_REPORT_DAYS, SHIFT_REPORT_MAX_OPEN, SHIFT_REPORT_MAX_PER_DAY,
  SHIFT_REPORT_LEADER_DAYS } from '../../../../_lib/rules.js';

export const REPORT_COLS = 'id, sf_id, block_id, te_cents, cash_cents, note, submitted_by_uid, submitted_by_name, submitted_at, ' +
  'updated_at, status, reviewed_by_uid, reviewed_by_name, reviewed_at, review_note, stamp, needs_confirm, confirmed_by_uid, confirmed_by_name, ' +
  'confirmed_at, overridden, accepted_by_uid, accepted_by_name, accepted_at, accept_note, verified_by_leader, sales_cash_cents, ' +
  'sales_cash_outcome, sales_cash_by_uid, sales_cash_by_name, sales_cash_at';
// The statuses that hold a block: one waiting for a leader, or one a leader accepted.
export const HOLDS_BLOCK = "status IN ('submitted', 'accepted')";
const POST_KEYS = ['sfId', 'blockId', 'teCents', 'cashCents', 'salesCashCents', 'note', 'attest'];

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
    salesCashCents: row.sales_cash_cents || 0, note: row.note, status: row.status, mine: row.submitted_by_uid === uid, submittedByName: row.submitted_by_name,
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
    // Followups round 1 — what became of the cash from sales (leaders only): 'collected',
    // 'converted' or null (still out), who recorded it and when.
    r.salesCashOutcome = row.sales_cash_outcome || null; r.salesCashByName = row.sales_cash_by_name || null;
    r.salesCashByUid = row.sales_cash_by_uid || null; r.salesCashAt = row.sales_cash_at || null;
  }
  return r;
}
// The stored pack record, parsed, for the S-4 parent check: { rev, pack }, or null when there is
// none or it cannot be read (fail closed: nobody confirms). Up to MAX_STATE_BYTES of JSON, read
// only when a confirmation is in question or (myShifts) a published shift is in the reporting
// window, and never sent to the caller.
// Security re-check (3): parsed once per pack per rev. A cheap SELECT of the rev comes first, and
// the record is read and parsed again only when the rev has moved. Cached per database binding,
// so a preview and production (or two test databases) never share an entry. Read-only use.
const packCache = new WeakMap();   // db -> Map(packId -> { rev, pack })
export async function readPackRecord(db, packId) {
  const head = await db.prepare('SELECT rev FROM pack_state WHERE pack_id = ?').bind(packId).first();
  if (!head) return null;
  let byPack = packCache.get(db);
  if (!byPack) { byPack = new Map(); packCache.set(db, byPack); }
  const hit = byPack.get(packId);
  if (hit && hit.rev === head.rev) return hit;
  const row = await db.prepare('SELECT rev, json FROM pack_state WHERE pack_id = ?').bind(packId).first();
  if (!row || typeof row.json !== 'string' || row.json.length < 2) return null;
  let pack = null;
  try { pack = JSON.parse(row.json); } catch (e) { return null; }
  if (!pack || typeof pack !== 'object' || Array.isArray(pack)) return null;
  const rec = { rev: row.rev, pack };
  byPack.set(packId, rec);
  return rec;
}
// Security re-check (followups round 3): for a FAMILY decision (rules.js sameFamily), a record that
// exists but can't be read decides "same family" — fail closed, so only an override with a reason
// gets through, as the confirm fails closed. Only a pack with no record at all decides nothing.
// { rev, pack, unreadable? } or null (no record).
export async function readPackForFamily(db, packId) {
  const rec = await readPackRecord(db, packId);
  if (rec) return rec;
  const head = await db.prepare('SELECT rev FROM pack_state WHERE pack_id = ?').bind(packId).first();
  return head ? { rev: head.rev, pack: null, unreadable: true } : null;
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
export const SUBMIT_ROLES = ['admin', 'editor', 'viewer', 'leader', 'parent'];
// The caller still holds an action of access.js (shiftVerify, shiftUndo) at the moment of the write:
// an admin, or a leader holding one of the positions it lists (member_positions, which only an admin
// writes). The SQL twin of rules.js canReviewShiftReport and canUndoShiftReport.
export const STILL_HOLDS = (action) => "EXISTS (SELECT 1 FROM members m WHERE m.pack_id = ? AND m.uid = ? AND (m.role = 'admin' OR " +
  "(m.role = 'leader' AND EXISTS (SELECT 1 FROM member_positions mp WHERE mp.pack_id = m.pack_id AND mp.uid = m.uid AND mp.position IN (" +
  ACCESS_TABLE.actions[action].map(() => '?').join(', ') + ')))))';
export const holdsArgs = (action, packId, uid) => [packId, uid, ...ACCESS_TABLE.actions[action]];
// A write's gate: its SQL (true while the caller may still do this) and the values it binds.
export const memberGate = (packId, uid, roles) => ({ sql: STILL_MEMBER(roles), args: [packId, uid, ...roles] });
export const holdsGate = (packId, uid, ...actions) => ({
  sql: '(' + actions.map((a) => STILL_HOLDS(a)).join(' OR ') + ')',
  args: [].concat(...actions.map((a) => holdsArgs(a, packId, uid)))
});

// Your scout's shifts first (Keith, 2026-10-01): the published storefront shifts in the reporting
// window (today or up to SHIFT_REPORT_DAYS back, as the family's card lists them) that have a scout
// assigned whose parentUids hold the caller's uid, in the stored pack record (shiftParentUids: a
// parent linked family-wide is on each sibling, so a shift with two of their children is listed
// once). IDS ONLY, and only ids the parent view already publishes: never a scout, a name or a link.
// The record is read only when a published shift is in the window, through the per-rev cache
// (`getRec`: one read per request, shared with the S-4 check below).
// FAIL CLOSED: no view, no record, anything unreadable, and the list is empty.
// myShifts, and whether the caller is linked to any scout (familiesOf: a yes/no, nothing of the
// link itself), read only when a published shift is in the window, as above. Fail closed: not linked.
async function myShiftsAndLink(getRec, uid, view) {
  const none = { myShifts: [], linked: false };
  try {
    const today = packToday();
    const inWindow = [];
    (view && Array.isArray(view.events) ? view.events : []).forEach((ev) => {
      if (!ev || ev.kind !== 'storefront' || typeof ev.sfId !== 'string' || !Array.isArray(ev.shifts)) return;
      const ago = daysBetween(ev.date, today);
      if (!(ago >= 0 && ago <= SHIFT_REPORT_DAYS)) return;
      ev.shifts.forEach((s) => { if (s && typeof s.blockId === 'string') inWindow.push({ sfId: ev.sfId, blockId: s.blockId }); });
    });
    if (!inWindow.length || !uid) return none;
    const rec = await getRec();
    if (!rec) return none;
    return {
      myShifts: inWindow.filter((x) => {
        const uids = shiftParentUids(rec.pack, x.sfId, x.blockId);
        return Array.isArray(uids) && uids.indexOf(uid) !== -1;
      }),
      linked: Object.keys(familiesOf(rec.pack, uid)).length > 0
    };
  } catch (e) {
    return none;
  }
}
const readView = async (db, packId) => {
  const vrow = await db.prepare('SELECT payload FROM parent_views WHERE pack_id = ?').bind(packId).first();
  try { return vrow ? JSON.parse(vrow.payload) : null; } catch (e) { return null; }
};

async function list({ request, db, packId, role, user }) {
  if (!canSubmitShiftReport(role)) return forbidden();
  // ?as=parent: the parent's answer, whatever the role (the parent preview). Nothing else is asked.
  const asParam = new URL(request.url).searchParams.get('as');
  if (asParam !== null && asParam !== 'parent') refuse(badRequest('as'));
  // Leaders: the last SHIFT_REPORT_LEADER_DAYS days, and anything still waiting however old it is.
  // A parent's answer is built from every row, but sends only their own and a few words of the rest.
  // A parent's answer only ever needs the reports holding a block, and closed ones from the last
  // 30 days (security re-check 3: bounded, not the pack's whole history on every family's poll).
  const leader = canReadAllShiftReports(role) && asParam !== 'parent';
  const r = await db.prepare('SELECT ' + REPORT_COLS + ' FROM shift_reports WHERE pack_id = ?' +
    (leader ? " AND (status = 'submitted' OR submitted_at > ?)" : " AND (status IN ('submitted', 'accepted') OR submitted_at > ?)") +
    ' ORDER BY submitted_at DESC, id')
    .bind(packId, Date.now() - (leader ? SHIFT_REPORT_LEADER_DAYS : 30) * 86400000).all();
  const rows = r.results || [];
  const view = await readView(db, packId);
  let recP = null;
  const getRec = () => recP || (recP = readPackRecord(db, packId));
  const { myShifts, linked } = await myShiftsAndLink(getRec, user.uid, view);
  if (leader) return json(200, { reports: rows.map((row) => reportOut(row, user.uid, true)), others: [], myShifts, linked });
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
  // reporting window, and whether this account may be it. The pack record (up to 1.5 MB) is read
  // only while a published shift is in the window: for myShifts above, and for this (security
  // review 4, widened by myShifts). Parsed once per rev, and read once per request.
  const today = packToday();
  let waiting = theirs.filter((row) => row.status === 'submitted' && row.needs_confirm === 1 && !row.confirmed_by_uid);
  let rec = null;
  if (waiting.length) {
    waiting = waiting.filter((row) => {
      const at = shiftOfView(view, row.sf_id, row.block_id);
      const ago = at ? daysBetween(at.ev.date, today) : NaN;
      return ago >= 0 && ago <= SHIFT_REPORT_DAYS;
    });
    if (waiting.length) rec = await getRec();
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
      o.salesCashCents = row.sales_cash_cents || 0;   // S-5: part of what they confirm
      o.note = row.note;
      o.submittedByName = firstName(row.submitted_by_name);
      o.updatedAt = row.updated_at;   // the confirm names the version it checked (security review 1)
    }
    return o;
  });
  return json(200, { reports: own.map((row) => reportOut(row, user.uid, false)), others, myShifts, linked });
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
  const salesCash = reportSalesCash(b);
  let res;
  try {
    res = await db.batch([
      db.prepare('INSERT INTO shift_reports (id, pack_id, sf_id, block_id, te_cents, cash_cents, note, submitted_by_uid, ' +
        "submitted_by_name, submitted_at, updated_at, status, review_note, stamp, needs_confirm, sales_cash_cents) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', '', ?, ?, ? " +
        'WHERE NOT EXISTS (SELECT 1 FROM shift_reports WHERE pack_id = ? AND block_id = ? AND ' + HOLDS_BLOCK + ') AND ' +
        "(SELECT count(*) FROM shift_reports WHERE pack_id = ? AND submitted_by_uid = ? AND status = 'submitted') < ? AND " +
        '(SELECT count(*) FROM shift_reports WHERE pack_id = ? AND submitted_by_uid = ? AND submitted_at > ?) < ? AND ' +
        STILL_MEMBER(SUBMIT_ROLES))
        .bind(id, packId, b.sfId, b.blockId, b.teCents, b.cashCents, note, user.uid, member.name || '', now, now, stamp, needsConfirm, salesCash,
          packId, b.blockId, packId, user.uid, SHIFT_REPORT_MAX_OPEN, packId, user.uid, now - 86400000, SHIFT_REPORT_MAX_PER_DAY,
          packId, user.uid, ...SUBMIT_ROLES),
      auditIf(db, packId, user.uid, 'shift.report', { report: id, sfId: b.sfId, blockId: b.blockId, teCents: b.teCents,
        cashCents: b.cashCents, salesCashCents: salesCash, needsConfirm: needsConfirm === 1 }, now, 'EXISTS (SELECT 1 FROM shift_reports WHERE id = ? AND stamp = ?)', [id, stamp])
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
