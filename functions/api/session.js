// POST /api/session?pack=<id>        body (optional): { "join": "<sign-up code>" }
//
// One call that does what the page's startAccounts + ensureMyMemberDoc did against Firestore
// (index.html startAccounts, ensureMyMemberDoc, joinCreateMemberDoc), in the same order:
//   1. An unowned pack gets its owner (OWNER_MODE; functions/_lib/pack.js). A caller who came
//      on a sign-up link never claims one.
//   2. Already a member: nothing changes — never overwrite a role (re-signing in as an
//      approved editor must not demote you) — except that the pack owner is always healed
//      back to admin ('members.update.owner').
//   3. Not a member: the owner becomes admin; an invitee becomes exactly the invited role, with
//      exactly the positions it gave (a 'leader' invite), and the invite is used up; a sign-up link visitor with the current code, while the link is
//      open, becomes 'pending'. Anyone else gets no row at all.
// Answers { uid, role, member, ownerUid, rejected }. role null means no access; rejected says
// why, with the page's own words for it: 'nolink' (no invite, no link), 'badcode' (a link
// with no usable code), 'closed' (the link is off, or its code is not the current one).
//
// Sign-up link tries are rate-limited per account (JOIN_MAX_TRIES per JOIN_WINDOW_MS). The
// code is ten random characters, so this is not what keeps it secret; it keeps one account
// from hammering the table.

import { route, json, readObject, refuse } from '../_lib/http.js';
import { servedPack, database, authenticate, ownerClaim, memberOf, memberOut, auditStmt, auditIf } from '../_lib/pack.js';
import { INVITE_ROW_ROLES, JOIN_CODE_RE, MEMBER_NAME_MAX } from '../_lib/rules.js';

export const JOIN_MAX_TRIES = 10;
export const JOIN_WINDOW_MS = 60 * 60 * 1000;

async function session(context) {
  const { request, env } = context;
  const user = await authenticate(request, env);
  const packId = servedPack(env, new URL(request.url).searchParams.get('pack'));
  const db = await database(env);
  const body = await readObject(request, 4096, true);
  const joinCode = typeof body.join === 'string' && body.join !== '' ? body.join : null;
  const now = Date.now();
  const name = user.name.slice(0, MEMBER_NAME_MAX);

  await db.prepare('INSERT INTO packs (id, created_at) VALUES (?, ?) ON CONFLICT (id) DO NOTHING').bind(packId, now).run();
  let pack = await db.prepare('SELECT owner_uid FROM packs WHERE id = ?').bind(packId).first();

  // 1. The owner claim — first writer wins, and never changes after (packmeta.create/immutable).
  if (!pack.owner_uid) {
    const claim = ownerClaim(env, user.uid, !!joinCode);
    if (claim) {
      const r = await db.prepare('UPDATE packs SET owner_uid = ? WHERE id = ? AND owner_uid IS NULL').bind(claim, packId).run();
      if (r.meta && r.meta.changes === 1) {
        await auditStmt(db, packId, user.uid, 'owner.claim', { owner: claim }, now).run();
      }
      pack = await db.prepare('SELECT owner_uid FROM packs WHERE id = ?').bind(packId).first();
    }
  }
  const ownerUid = pack.owner_uid || null;
  const isOwner = ownerUid === user.uid;
  let rejected = null;

  let me = await memberOf(db, packId, user.uid);
  if (me) {
    // 2. The owner is always an admin. Written whole, as the page does: role, name, their
    // own email, and no join code.
    if (isOwner && me.role !== 'admin') {
      await db.batch([
        db.prepare("UPDATE members SET role = 'admin', name = ?, email = ?, join_code = NULL WHERE pack_id = ? AND uid = ?")
          .bind(name, user.email, packId, user.uid),
        auditStmt(db, packId, user.uid, 'member.heal', { from: me.role, to: 'admin' }, now)
      ]);
      me = await memberOf(db, packId, user.uid);
    }
  } else if (isOwner) {
    // 3a. members.create.owner — the INSERT itself re-checks the owner.
    await db.batch([
      db.prepare("INSERT INTO members (pack_id, uid, role, name, email, join_code, added_at) " +
        "SELECT ?, ?, 'admin', ?, ?, NULL, ? WHERE EXISTS (SELECT 1 FROM packs WHERE id = ? AND owner_uid = ?) " +
        'ON CONFLICT (pack_id, uid) DO NOTHING').bind(packId, user.uid, name, user.email, now, packId, user.uid),
      auditIf(db, packId, user.uid, 'member.create', { via: 'owner', role: 'admin' }, now,
        "EXISTS (SELECT 1 FROM members WHERE pack_id = ? AND uid = ? AND role = 'admin' AND added_at = ?)", [packId, user.uid, now])
    ]);
    me = await memberOf(db, packId, user.uid);
  } else {
    // 3b. members.create.invite — exactly the invited role, taken from the invite row in the
    // same statement, and the invite deleted with it (single-use).
    const inv = await db.prepare('SELECT role FROM invites WHERE pack_id = ? AND email = ?').bind(packId, user.emailKey).first();
    // An editor or viewer invite from before the switch still lets its person in (read-only, needing
    // a position: rules.js RETIRED_ROLES).
    if (inv && INVITE_ROW_ROLES.indexOf(inv.role) !== -1) {
      await db.batch([
        db.prepare('INSERT INTO members (pack_id, uid, role, name, email, join_code, added_at) ' +
          'SELECT pack_id, ?, role, ?, ?, NULL, ? FROM invites WHERE pack_id = ? AND email = ? ' +
          "AND role IN ('editor', 'viewer', 'leader', 'parent') ON CONFLICT (pack_id, uid) DO NOTHING")
          .bind(user.uid, name, user.email, now, packId, user.emailKey),
        // The invite's positions, onto the account just made from it (before the invite, and its
        // positions with it, are deleted below).
        db.prepare('INSERT INTO member_positions (pack_id, uid, position, dens) SELECT pack_id, ?, position, dens FROM invite_positions ' +
          'WHERE pack_id = ? AND email = ? AND EXISTS (SELECT 1 FROM members WHERE pack_id = ? AND uid = ? AND added_at = ?)')
          .bind(user.uid, packId, user.emailKey, packId, user.uid, now),
        auditIf(db, packId, user.uid, 'invite.consume', { email: user.emailKey, role: inv.role }, now,
          'EXISTS (SELECT 1 FROM members WHERE pack_id = ? AND uid = ? AND added_at = ?)', [packId, user.uid, now]),
        db.prepare('DELETE FROM invites WHERE pack_id = ? AND email = ? AND EXISTS (SELECT 1 FROM members WHERE pack_id = ? AND uid = ?)')
          .bind(packId, user.emailKey, packId, user.uid)
      ]);
      me = await memberOf(db, packId, user.uid);
    }
    // 3c. members.create.join — only ever 'pending', only while open with the current code.
    // An invite that vanished underneath us falls through to here, as in the page.
    if (!me && joinCode) {
      const tries = await db.prepare('INSERT INTO join_attempts (pack_id, uid, window_start, attempts) VALUES (?, ?, ?, 1) ' +
        'ON CONFLICT (pack_id, uid) DO UPDATE SET ' +
        'attempts = CASE WHEN window_start <= ? THEN 1 ELSE attempts + 1 END, ' +
        'window_start = CASE WHEN window_start <= ? THEN excluded.window_start ELSE window_start END ' +
        'RETURNING attempts, window_start').bind(packId, user.uid, now, now - JOIN_WINDOW_MS, now - JOIN_WINDOW_MS).first();
      if (tries.attempts > JOIN_MAX_TRIES) {
        const wait = Math.max(1, Math.ceil((tries.window_start + JOIN_WINDOW_MS - now) / 1000));
        refuse(json(429, { error: 'rate-limited', code: 'resource-exhausted', retryAfter: wait }, { 'retry-after': String(wait) }));
      }
      if (!JOIN_CODE_RE.test(joinCode)) {
        rejected = 'badcode';
      } else {
        await db.batch([
          db.prepare('INSERT INTO members (pack_id, uid, role, name, email, join_code, added_at) ' +
            "SELECT pack_id, ?, 'pending', ?, ?, code, ? FROM join_config WHERE pack_id = ? AND open = 1 AND mode = 'request' AND code = ? " +
            'ON CONFLICT (pack_id, uid) DO NOTHING').bind(user.uid, name, user.email, now, packId, joinCode),
          auditIf(db, packId, user.uid, 'join.request', { role: 'pending' }, now,
            "EXISTS (SELECT 1 FROM members WHERE pack_id = ? AND uid = ? AND role = 'pending' AND added_at = ?)", [packId, user.uid, now])
        ]);
        me = await memberOf(db, packId, user.uid);
        if (!me) rejected = 'closed';
      }
    } else if (!me) {
      rejected = 'nolink';
    }
  }
  return json(200, { uid: user.uid, role: me ? me.role : null, member: memberOut(me), ownerUid, rejected: me ? null : rejected });
}

export const onRequest = route({ POST: session });
