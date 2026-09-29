// Pack 569 — checking a Firebase ID token, with WebCrypto and nothing else.
//
// The page keeps Firebase for one thing only: Google sign-in. Every API call carries the
// signed-in account's Firebase ID token (Authorization: Bearer …), and this file decides
// whether to believe it. It is the only thing that turns a request into a person, so it
// refuses anything it is not sure of:
//   - RS256 only, signed by one of Google's securetoken keys, found by the token's kid;
//   - aud is our Firebase project and iss is https://securetoken.google.com/<project>;
//   - exp in the future, iat and auth_time not in the future (SKEW seconds of clock slack);
//   - a non-empty sub (the account id) and an email;
//   - email_verified true, and firebase.sign_in_provider 'google.com'. Part C only ever
//     counted a member doc from a Google sign-in with an address Google verified (viaGoogle);
//     here that holds for every request, so an anonymous or password account never gets in.
//
// Google's public keys are cached: in the Workers Cache API where there is one (Google's
// response says how long to keep them, counting the Age it already had), and in memory for
// the life of the isolate either way. There is only ever one fetch of the key set under way,
// shared by every request waiting on it whatever kid it names, and the time it started is
// stamped as it starts. A kid we do not have, while the keys we hold are current, starts a
// fetch at most once a minute; with no current keys (a cold isolate, or keys past their life)
// a fetch starts at most once every ten seconds, and in between the answer is "Google's keys
// are unavailable". A failed fetch counts. A cached copy without a wanted kid is never taken
// as the answer. Tests swap the fetcher, or stub fetch and caches under the real one.
//
// Plain ES module: runs in Cloudflare Workers and in Node (the harness).

export const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const SKEW = 60;              // seconds of clock difference forgiven either way
const REFETCH_GAP = 60;       // seconds between fetches for an unknown kid while our keys are current
const MIN_GAP = 10;           // seconds between fetches when we have no current keys at all
const MAX_KEY_AGE = 6 * 3600; // never trust a cached key set longer than this

export class TokenError extends Error {
  constructor(reason) { super(reason); this.reason = reason; }
}
const bad = (reason) => { throw new TokenError(reason); };

function b64urlBytes(s) {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]*$/.test(s)) bad('malformed');
  let bin;
  try { bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)); }
  catch (e) { bad('malformed'); }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64urlJson(s) {
  let v;
  try { v = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(b64urlBytes(s))); }
  catch (e) { bad('malformed'); }
  if (!v || typeof v !== 'object' || Array.isArray(v)) bad('malformed');
  return v;
}

// When we fetched a copy from Google, stamped on the copy we put in the Cache API.
const FETCHED_AT = 'x-pack569-fetched-at';
// Seconds this copy of the key set is still good for: Google's max-age, less the Age it
// already had when Google sent it, less how long we have held it since (security review of
// stage A, finding 6: counting from max-age alone could keep a key set past its life).
function lifetimeOf(res) {
  const m = /max-age=(\d+)/.exec(res.headers.get('cache-control') || '');
  const maxAge = m ? Number(m[1]) : 3600;
  const age = Number(res.headers.get('age')) || 0;
  const at = Number(res.headers.get(FETCHED_AT)) || 0;
  const held = at > 0 ? Math.max(0, (Date.now() - at) / 1000) : 0;
  return Math.max(0, Math.floor(maxAge - age - held));
}
// Google's key set, as { keys: [jwk…], maxAge: seconds left, fromCache }. `fresh` skips the
// Cache API: it is set when a token names a kid we do not have while our keys are current,
// which is what a key rotation looks like, and a cached copy from before the rotation would
// not have it either (finding 6). `kids` is every kid the requests sharing this fetch are
// waiting for; it is read after the Cache API answers, so a request that joined in the
// meantime counts. A cold isolate asks without `fresh` and may be handed the Cache API's
// pre-rotation copy; if that copy lacks any wanted kid, this same fetch goes to Google, now,
// rather than refusing the token and then refusing to look again (security re-review of
// stage A, follow-up 4; review of eb504db..366f6c9, item 1).
async function defaultFetchJwks(opts) {
  const fresh = !!(opts && opts.fresh);
  const kids = opts && opts.kids;
  const cache = globalThis.caches && globalThis.caches.default;
  let res = null, fromCache = false;
  if (cache && !fresh) {
    try { res = await cache.match(JWKS_URL); } catch (e) { res = null; }
    if (res && lifetimeOf(res) <= 0) res = null;
    if (res && kids && kids.size) {
      let cached = null;
      try { cached = await res.clone().json(); } catch (e) { cached = null; }
      const held = cached && Array.isArray(cached.keys) ? cached.keys : [];
      for (const kid of kids) if (!held.some((k) => k && k.kid === kid)) { res = null; break; }
    }
    fromCache = !!res;
  }
  if (!res) {
    try { res = await fetch(JWKS_URL); } catch (e) { bad('jwks-unavailable'); }
    if (!res.ok) bad('jwks-unavailable');
    // The Cache API keeps a copy, stamped with when we fetched it. (On a *.pages.dev host the
    // Cache API may do nothing; the in-memory copy below still saves most fetches.)
    if (cache) {
      try {
        const h = new Headers(res.headers);
        h.set(FETCHED_AT, String(Date.now()));
        await cache.put(JWKS_URL, new Response(await res.clone().arrayBuffer(), { status: res.status, headers: h }));
      } catch (e) { /* in memory only */ }
    }
  }
  let body;
  try { body = await res.json(); } catch (e) { bad('jwks-unavailable'); }
  return { keys: body && Array.isArray(body.keys) ? body.keys : [], maxAge: lifetimeOf(res), fromCache };
}

let fetchJwks = defaultFetchJwks;
// `seq` numbers fetches in the order they started; the key set in memory is from fetch jwks.seq.
let seq = 0;
let jwks = { keys: [], expires: 0, seq: 0 };
let lastStart = -Infinity;    // when (token-clock seconds) the last fetch that could reach Google started
let pending = null;           // { seq, kids, promise }: the one fetch under way, or null
const imported = new Map();   // kid -> CryptoKey
// For the harness: serve keys from a local test key instead of Google. null restores Google.
// A fresh isolate, as far as this module knows: a fetch still under way from before is older
// than anything after, so it can neither overwrite the new key set nor clear the new fetch.
export function setJwksFetcher(fn) {
  fetchJwks = fn || defaultFetchJwks;
  seq++;
  jwks = { keys: [], expires: 0, seq };
  lastStart = -Infinity;
  pending = null;
  imported.clear();
}

// The one fetch of the key set (review of 5690c3a..20b4fd6, item 5; review of
// eb504db..366f6c9, item 1). A request that needs a fetch while one is under way waits for
// that one, adding its kid to the kids it wants, whatever kid it was started for. Its start
// time is stamped as it starts, success or not, so a stream of tokens naming made-up kids
// cannot turn an outage at Google, or a cold isolate, into one fetch per request. A fetch the
// Cache API answered never reached Google, so it gives the stamp back when it finishes.
function refreshJwks(kid, now) {
  if (pending) { pending.kids.add(kid); return pending.promise; }
  const mine = ++seq;
  const before = lastStart;
  lastStart = now;
  const kids = new Set([kid]);
  // Still-current keys without this kid: go to Google itself, not to the Cache API's copy.
  const fresh = now < jwks.expires;
  // Started on a later tick, so it is pending before it can finish (a fetcher that throws at
  // once would otherwise clear the entry before there was one, and leave the rejection in).
  const promise = Promise.resolve().then(async () => {
    try {
      const got = await fetchJwks({ fresh, kids });
      // Never older over newer: only a fetch that started after the one in memory replaces it.
      if (mine > jwks.seq) {
        const age = Math.max(0, Math.min(Number(got.maxAge) || 0, MAX_KEY_AGE));
        jwks = { keys: got.keys || [], expires: now + age, seq: mine };
        imported.clear();
      }
      if (got.fromCache && mine === seq) lastStart = before;
    } finally {
      if (pending && pending.seq === mine) pending = null;
    }
  });
  pending = { seq: mine, kids, promise };
  return promise;
}

async function keyFor(kid, now) {
  let jwk = now < jwks.expires ? jwks.keys.find((k) => k && k.kid === kid) : null;
  if (!jwk) {
    const current = now < jwks.expires;
    if (pending || now - lastStart >= (current ? REFETCH_GAP : MIN_GAP)) {
      await refreshJwks(kid, now);
      jwk = jwks.keys.find((k) => k && k.kid === kid);
    } else if (!current) bad('jwks-unavailable');   // no keys to check it with, and too soon to ask
  }
  if (!jwk || jwk.kty !== 'RSA' || typeof jwk.n !== 'string' || typeof jwk.e !== 'string') bad('unknown-key');
  if (!imported.has(kid)) {
    imported.set(kid, await crypto.subtle.importKey('jwk', { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']));
  }
  return imported.get(kid);
}

// Resolves to { uid, email, emailKey, name } or throws TokenError. `now` is seconds.
export async function verifyIdToken(token, projectId, now = Math.floor(Date.now() / 1000)) {
  if (typeof projectId !== 'string' || !projectId) bad('no-project');
  const parts = typeof token === 'string' ? token.split('.') : [];
  if (parts.length !== 3) bad('malformed');
  const header = b64urlJson(parts[0]);
  const c = b64urlJson(parts[1]);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) bad('bad-header');
  const key = await keyFor(header.kid, now);
  const signed = new TextEncoder().encode(parts[0] + '.' + parts[1]);
  if (!(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(parts[2]), signed))) bad('bad-signature');
  if (c.aud !== projectId) bad('wrong-audience');
  if (c.iss !== 'https://securetoken.google.com/' + projectId) bad('wrong-issuer');
  const num = (v) => typeof v === 'number' && isFinite(v);
  if (!num(c.exp) || c.exp <= now - SKEW) bad('expired');
  if (!num(c.iat) || c.iat > now + SKEW) bad('issued-in-future');
  if (!num(c.auth_time) || c.auth_time > now + SKEW) bad('auth-in-future');
  if (typeof c.sub !== 'string' || !c.sub || c.sub.length > 128) bad('no-subject');
  if (c.email_verified !== true) bad('email-not-verified');
  if (!c.firebase || c.firebase.sign_in_provider !== 'google.com') bad('not-google');
  if (typeof c.email !== 'string' || !c.email.trim() || c.email.length > 320) bad('no-email');
  return {
    uid: c.sub,
    email: c.email,
    // Part C myEmailKey(): the token's email, lowercased. Invites are keyed by it.
    emailKey: c.email.trim().toLowerCase(),
    name: typeof c.name === 'string' ? c.name : ''
  };
}
