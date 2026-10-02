// GET /api/pack/:id   the pack record: { exists, rev, device, updatedAt, json }  (leaders)
// PUT /api/pack/:id   replace it                                       (admin, leader)
//
// Part C 'pack.read': allow read: if isLeader();  — parents and pending users never receive
// the ledger; they read /view. 'pack.write': allow write: if myRole() in ['admin', 'editor'].
//
// PUT is compare-and-swap, because D1 has no transaction a client can hold open:
//   If-Match: <rev>      the rev this device last saw (0 when it has never seen a record)
//   X-Pack-Device: <id>  the writing device (the page's sync.deviceId), at most 128 chars
//   body                 the pack record, the page's JSON.stringify(state), at most 1.5 MB
// It lands only if the stored rev is still <rev>, and the new rev is <rev> + 1. Otherwise 409
// with the stored copy, the same shape as GET, so the page can run mergeRemoteAppendOnly on
// it and try again. The body is checked to be a JSON object and then stored as it came.
//
// SECTIONS (position-based access, stage 1, 2026-10-01). Below an admin, a save may change only
// the parts of the record the caller may edit: functions/_lib/access.js says which section owns
// each top-level key (and each kind of deletion mark in state.gone), and what the caller's role
// and positions may edit. The stored record — the one at the rev the save names, so the same
// copy the compare-and-swap is against — is compared with the body key by key, and a key that
// changed and that the caller may not edit refuses the whole save:
//   403 {error:'forbidden', code:'permission-denied', reason:'section', sections:[…]}
// A key changed is one whose value differs (objects compared whatever their key order, arrays in
// order), was added, or was removed; a key missing on one side and empty on the other ([], {},
// null) is not a change. The admin-only keys (archives, closedBooks, closedGone) are an admin's
// alone, and so is a key access.js does not know. A retired editor or viewer changes nothing. A
// Den Leader's den meeting changes (its adventure and notes) are checked event by event
// (access.js denMeetingChangeOk). Some parts say who did something, and are checked entry by
// entry against the caller's own uid, whoever may edit their section: the two logs are
// append-only and a line added is the caller's own (syncLog for anyone, ledgerLog for the ledger's
// editors, or a setting's for one who changed it; a ledgerLog line there stays exactly as it is,
// the ledger's editors included); a statement there stays as it is and one added
// is the caller's; a council settlement written is the caller's. Two slices of a section a leader may
// write without editing it: a shift report's fields on a storefront block (shiftVerify: the
// accept, its undo, its settle, each tied to the report's row in shift_reports, read here), and a deposit of storefront cash added to the ledger, flagged for
// the treasurer (the 'deposits' sub-section). An admin's save is not compared.
// A save from a stale rev is the 409 it always was, before anything is compared.
//
// AWAITING IMPORT (production, OWNER_MODE fixed): the pack record is created only by the
// owner's one-time import. Until then a PUT from rev 0 is 409 {error:'awaiting-import',
// code:'failed-precondition'} — not a conflict to merge and retry, but "the owner has not
// copied the pack over yet". GET answers {exists:false, rev:0} meanwhile. Previews create
// the record on the first save.

import { route, json, readText, refuse, forbidden, forbiddenSections, badRequest, awaitingImport, MAX_STATE_BYTES } from '../../../_lib/http.js';
import { withMember, fixedOwnerMode } from '../../../_lib/pack.js';
import { canReadPack, canWritePack, isAdmin } from '../../../_lib/rules.js';
import { effectiveAccess, effectiveActions, refusedSections, storefrontReportIds, canEditOwner, SECTIONS } from '../../../_lib/access.js';

function stateOut(row) {
  return row
    ? { exists: true, rev: row.rev, device: row.device, updatedAt: row.updated_at, json: row.json }
    : { exists: false, rev: 0 };
}
const readState = (db, packId) =>
  db.prepare('SELECT rev, json, device, updated_at FROM pack_state WHERE pack_id = ?').bind(packId).first();

async function get({ db, packId, role }) {
  if (!canReadPack(role)) return forbidden();
  return json(200, stateOut(await readState(db, packId)));
}

const conflict = (row) => json(409, Object.assign({ error: 'conflict', code: 'aborted' }, stateOut(row)));
// The sections refused, in the table's order, 'admin' last.
const sectionOrder = (list) => SECTIONS.concat(['shared', 'admin']).filter((s) => list.indexOf(s) !== -1);

// The shift reports a booth leader's save names on the storefronts (access.js storefrontReportChangeOk
// ties each changed block to the server's own record of its report): id -> row, or {} when the save
// leaves the storefronts alone or the caller edits them anyway. null: too many to read (refused).
async function namedReports(db, packId, stored, parsed, access, actions) {
  if (canEditOwner(access, 'storefronts') || actions.shiftVerify !== true) return {};
  const ids = storefrontReportIds(stored.storefronts || [], parsed.storefronts || []);
  if (ids === null) return null;
  if (!ids.length) return {};
  const r = await db.prepare('SELECT id, sf_id, block_id, status, te_cents, cash_cents, sales_cash_cents, submitted_by_uid, submitted_by_name, ' +
    'confirmed_by_uid, confirmed_by_name, needs_confirm, accepted_by_uid, review_note, sales_cash_outcome, sales_cash_by_name, sales_cash_at ' +
    'FROM shift_reports WHERE pack_id = ? AND id IN (SELECT value FROM json_each(?))').bind(packId, JSON.stringify(ids)).all();
  const out = Object.create(null);
  (r.results || []).forEach((row) => { out[row.id] = row; });
  return out;
}

async function put({ request, env, db, packId, role, positions, user, member }) {
  if (!canWritePack(role)) return forbidden();
  const m = /^\s*"?(\d{1,15})"?\s*$/.exec(request.headers.get('if-match') || '');
  if (!m) refuse(badRequest('if-match'));
  const base = Number(m[1]);
  const device = request.headers.get('x-pack-device') || '';
  if (device.length > 128) refuse(badRequest('device'));
  const text = await readText(request, MAX_STATE_BYTES);
  let parsed;
  try { parsed = JSON.parse(text); } catch (e) { refuse(badRequest('not-json')); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) refuse(badRequest('not-an-object'));

  if (!isAdmin(role)) {
    // The record this save would replace: the one at rev `base`. Another rev is the conflict the
    // UPDATE below would find anyway, answered now, before anything is compared. No record and
    // a rev above 0 falls through to the same 409.
    const cur = await readState(db, packId);
    if (cur && cur.rev !== base) return conflict(cur);
    if (cur || base === 0) {
      let stored = {};
      if (cur) { try { stored = JSON.parse(cur.json); } catch (e) { stored = {}; } }
      const access = effectiveAccess(role, positions), actions = effectiveActions(role, positions);
      const reports = await namedReports(db, packId, stored, parsed, access, actions);
      const refused = refusedSections(stored, parsed, access, user.uid, actions,
        { reports: reports || {}, name: member && member.name, now: Date.now() });
      if (reports === null && refused.indexOf('storefronts') === -1) refused.push('storefronts');
      if (refused.length) return forbiddenSections(sectionOrder(refused));
    }
  }

  const now = Date.now();
  let r = await db.prepare('UPDATE pack_state SET rev = rev + 1, json = ?, device = ?, updated_at = ? WHERE pack_id = ? AND rev = ?')
    .bind(text, device, now, packId, base).run();
  if (!(r.meta && r.meta.changes === 1) && base === 0) {
    // In production the pack record is CREATED only by the import. Otherwise the first leader
    // to save after the switch — on an empty pack here, before the owner has copied it in —
    // would create a near-empty record, and import refuses any pack that has one, so the real
    // pack could never be brought across (security review of stage A, finding 4). So until
    // import_lock exists, the create is refused, in the same statement. Previews
    // (first-signer) create on the first save, as Firestore did.
    const fixed = fixedOwnerMode(env);
    r = await db.prepare('INSERT INTO pack_state (pack_id, rev, json, device, updated_at) SELECT ?, 1, ?, ?, ? ' +
      'WHERE ? = 0 OR EXISTS (SELECT 1 FROM import_lock WHERE pack_id = ?) ON CONFLICT (pack_id) DO NOTHING')
      .bind(packId, text, device, now, fixed ? 1 : 0, packId).run();
    if (!(r.meta && r.meta.changes === 1) && fixed) {
      const cur = await readState(db, packId);
      if (!cur) return awaitingImport();
      return conflict(cur);
    }
  }
  if (r.meta && r.meta.changes === 1) return json(200, { rev: base + 1, updatedAt: now });
  return conflict(await readState(db, packId));
}

export const onRequest = route({ GET: withMember(get), PUT: withMember(put) });
