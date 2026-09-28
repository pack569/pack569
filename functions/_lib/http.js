// Pack 569 — responses, request bodies and a per-file method router for the API.
//
// Every answer is JSON and never cached. The status codes are a contract with the page:
//   401 {error:'unauthenticated', code:'unauthenticated'}   no token, or one we don't believe
//   403 {error:'forbidden', code:'permission-denied'}       ALWAYS exactly this body. The page
//        already branches on code 'permission-denied' (it is what Firestore said), and a
//        fixed body tells a caller nothing about why — not whether a member, invite or
//        pack exists.
//   409 {error:'conflict', code:'aborted', …remote}          the pack record moved on: here it is
//   409 {error:'last-admin', code:'failed-precondition'}     the change would leave no admin
//   413 {error:'too-large', code:'resource-exhausted'}       over the size limit
//   429 {error:'rate-limited', code:'resource-exhausted'}    too many sign-up link tries
//
// Pages' _headers file does not apply to Functions, so the safety headers are set here.

const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'"
};

// The pack record may be at most this many bytes (D1 allows 2 MB a row).
export const MAX_STATE_BYTES = 1.5 * 1024 * 1024;

// A body that is already JSON text is sent as it is; anything else is stringified.
export function json(status, body, extra) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return new Response(text, { status, headers: Object.assign({}, HEADERS, extra || {}) });
}

export const FORBIDDEN_BODY = Object.freeze({ error: 'forbidden', code: 'permission-denied' });
export const forbidden = () => json(403, FORBIDDEN_BODY);
export const unauthenticated = (reason) =>
  json(401, { error: 'unauthenticated', code: 'unauthenticated', reason: reason || 'no-token' },
    { 'www-authenticate': 'Bearer' });
export const badRequest = (why) => json(400, { error: 'bad-request', code: 'invalid-argument', reason: why || '' });
export const notFound = () => json(404, { error: 'not-found', code: 'not-found' });
export const tooLarge = () => json(413, { error: 'too-large', code: 'resource-exhausted' });
export const lastAdmin = () => json(409, { error: 'last-admin', code: 'failed-precondition' });
export const unavailable = (why) => json(503, { error: 'unavailable', code: 'unavailable', reason: why || '' });

// Thrown anywhere under a route; the router sends its response.
export class HttpError extends Error {
  constructor(response) { super('http ' + response.status); this.response = response; }
}
export const refuse = (response) => { throw new HttpError(response); };

// The body as text, refusing more than `limit` bytes before reading them all where it can.
export async function readText(request, limit) {
  const declared = request.headers.get('content-length');
  if (declared !== null && Number(declared) > limit) refuse(tooLarge());
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      try { await reader.cancel(); } catch (e) { /* already closed */ }
      refuse(tooLarge());
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.byteLength; }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(all); }
  catch (e) { return refuse(badRequest('not-utf8')); }
}

// A JSON object body. `optional` lets an empty body stand for {}.
export async function readObject(request, limit, optional) {
  const text = await readText(request, limit);
  if (!text.trim() && optional) return {};
  let v;
  try { v = JSON.parse(text); } catch (e) { refuse(badRequest('not-json')); }
  if (!v || typeof v !== 'object' || Array.isArray(v)) refuse(badRequest('not-an-object'));
  return v;
}

// One file, one path: { GET: fn, PUT: fn }. Anything unexpected is a plain 500 that says
// nothing about the database or the code; the detail goes to the Functions log.
export function route(methods) {
  return async function onRequest(context) {
    const handler = Object.prototype.hasOwnProperty.call(methods, context.request.method)
      ? methods[context.request.method] : null;
    if (!handler) return json(405, { error: 'method-not-allowed', code: 'unimplemented' }, { allow: Object.keys(methods).join(', ') });
    try {
      return await handler(context);
    } catch (e) {
      if (e instanceof HttpError) return e.response;
      console.error('api error', context.request.method, new URL(context.request.url).pathname, e && e.stack || e);
      return json(500, { error: 'internal', code: 'internal' });
    }
  };
}
