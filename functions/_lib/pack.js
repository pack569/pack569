// Pack 569 — who is asking, about which pack, as what.
//
// Every pack endpoint goes through withMember(): the account comes from the verified token,
// the pack id from the URL, and the role from that account's row in that pack's members
// table. Nothing in a request body can say who someone is or what role they hold.
//
// Configuration (wrangler.toml [vars], plus one secret; docs/cloudflare-setup.md):
//   DB                   the D1 binding: pack569-prod in production, pack569-preview otherwise.
//   DEPLOY_ENV           'prod' in production, 'preview' otherwise. Must match the bound
//                        database's own `deployment` row, or every request is a 503.
//   FIREBASE_PROJECT_ID  the Firebase project whose sign-ins we accept ('pack-569').
//   PACK_IDS             the pack ids this deployment serves, comma-separated. Anything else
//                        is 404: no one can start a new pack through this API (that is Phase 4,
//                        with its own limits).
//   OWNER_MODE           'fixed' (the default, and production): the pack's owner is the
//                        account in PACK_OWNER_UID and nobody else can claim it. 'first-signer'
//                        (previews only): the first Google sign-in claims an unowned pack, as
//                        Firestore's packmeta did.
//   PACK_OWNER_UID       (secret) the owner's Firebase account id, copied from Firestore's
//                        packmeta document. Unset in fixed mode means no owner and no import.
//                        It is written to packs.owner_uid only when that account signs in,
//                        and from then on it can never change.

import { verifyIdToken, TokenError } from './token.js';
import { refuse, unauthenticated, notFound, unavailable } from './http.js';
import { UID_RE } from './rules.js';

export const PACK_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

export function packIds(env) {
  return String((env && env.PACK_IDS) || '').split(/[\s,]+/).filter((s) => PACK_ID_RE.test(s));
}
// The pack id from the URL, if this deployment serves it; otherwise the request ends in a 404.
export function servedPack(env, id) {
  if (typeof id !== 'string' || !PACK_ID_RE.test(id) || packIds(env).indexOf(id) === -1) refuse(notFound());
  return id;
}
// The bound database, once it has said it belongs to this deployment; otherwise a 503.
// DEPLOY_ENV (wrangler.toml: 'prod' in production, 'preview' everywhere else) must match the
// one row of the database's `deployment` table (migrations/0002_deployment.sql), which the
// owner writes once by hand. A preview bound to the live database by mistake — a pasted id, a
// dashboard override — therefore answers nothing. No DEPLOY_ENV, no row, no table, or a
// mismatch: all 503, before any other table is touched. A match is remembered for the life of
// the isolate; a refusal is not, so seeding the row takes effect on the next request.
const DEPLOY_ENVS = ['prod', 'preview'];
const deploymentOk = new WeakMap();   // DB binding -> the DEPLOY_ENV it was checked against
export async function database(env) {
  if (!env || !env.DB || typeof env.DB.prepare !== 'function') refuse(unavailable('no-database'));
  const want = typeof env.DEPLOY_ENV === 'string' ? env.DEPLOY_ENV : '';
  if (DEPLOY_ENVS.indexOf(want) === -1) refuse(unavailable('no-deploy-env'));
  if (deploymentOk.get(env.DB) === want) return env.DB;
  let row = null;
  try { row = await env.DB.prepare('SELECT env FROM deployment WHERE id = 1').first(); }
  catch (e) { row = null; }   // no table yet: migration 0002 not applied
  if (!row) refuse(unavailable('deployment-unset'));
  if (row.env !== want) {
    console.error('api refused: DEPLOY_ENV is', want, 'but the bound database says', row.env);
    refuse(unavailable('wrong-database'));
  }
  deploymentOk.set(env.DB, want);
  return env.DB;
}

// Production's rule for who owns a pack (OWNER_MODE 'fixed', the default). Also what decides
// that a pack starts empty until the owner copies it in (api/pack/[id]/index.js PUT).
export const fixedOwnerMode = (env) => !(env && env.OWNER_MODE === 'first-signer');

// The owner an unowned pack gets, or null. See OWNER_MODE above. A caller who arrived on a
// sign-up link never claims a pack (the page: "a join-link visitor must NEVER claim ownership").
// In fixed mode the owner is written only when PACK_OWNER_UID ITSELF signs in (security review
// of stage A, finding 3). The owner is permanent once written (the packs_owner_is_permanent
// trigger), so writing it on anyone's sign-in would make a mistyped PACK_OWNER_UID permanent
// the first time a parent opened the page; this way a typo just means nobody is the owner yet,
// and correcting the secret fixes it.
export function ownerClaim(env, uid, viaJoinLink) {
  if (!fixedOwnerMode(env)) return viaJoinLink ? null : uid;
  const fixed = env && typeof env.PACK_OWNER_UID === 'string' ? env.PACK_OWNER_UID.trim() : '';
  return UID_RE.test(fixed) && uid === fixed ? fixed : null;
}

// The signed-in account, or a 401 (503 if Google's keys cannot be fetched).
export async function authenticate(request, env) {
  const h = request.headers.get('authorization') || '';
  const m = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(h);
  if (!m) refuse(unauthenticated('no-token'));
  try {
    return await verifyIdToken(m[1], env && env.FIREBASE_PROJECT_ID);
  } catch (e) {
    if (!(e instanceof TokenError)) throw e;
    if (e.reason === 'jwks-unavailable' || e.reason === 'no-project') refuse(unavailable(e.reason));
    return refuse(unauthenticated(e.reason));
  }
}

export function memberOf(db, packId, uid) {
  return db.prepare('SELECT uid, role, name, email, join_code, added_at FROM members WHERE pack_id = ? AND uid = ?')
    .bind(packId, uid).first();
}
// A member row as the page sees it (the Firestore member doc's field names).
export function memberOut(row) {
  if (!row) return null;
  const m = { uid: row.uid, role: row.role, name: row.name, email: row.email, addedAt: row.added_at };
  if (row.join_code) m.joinCode = row.join_code;
  return m;
}

// The handler gets { request, env, params, db, user, packId, member, role }.
export function withMember(handler) {
  return async function (context) {
    const user = await authenticate(context.request, context.env);
    const packId = servedPack(context.env, context.params && context.params.id);
    const db = await database(context.env);
    const member = await memberOf(db, packId, user.uid);
    return handler(Object.assign({}, context, { db, user, packId, member, role: member ? member.role : 'none' }));
  };
}

// An audit row, as a statement to put in the same batch as the change it records.
export function auditStmt(db, packId, uid, action, detail, at) {
  return db.prepare('INSERT INTO audit (pack_id, at, uid, action, detail) VALUES (?, ?, ?, ?, ?)')
    .bind(packId, at || Date.now(), uid, action, JSON.stringify(detail || {}));
}
// The same, written only if `whenSql` (bound with `whenArgs`) holds at that point in the batch.
export function auditIf(db, packId, uid, action, detail, at, whenSql, whenArgs) {
  return db.prepare('INSERT INTO audit (pack_id, at, uid, action, detail) SELECT ?, ?, ?, ?, ? WHERE ' + whenSql)
    .bind(packId, at || Date.now(), uid, action, JSON.stringify(detail || {}), ...whenArgs);
}
