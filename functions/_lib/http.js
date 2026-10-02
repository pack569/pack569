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
//   409 {error:'awaiting-import', code:'failed-precondition'} production's pack is empty until the
//        owner copies it in from Firestore (POST /import). A save, a first write from rev 0,
//        is refused until then. The page should say "waiting for the pack's owner to copy the
//        pack over" and stop pushing, NOT retry: nothing but the import changes the answer.
//   409 {error:'shift-reported', code:'failed-precondition', reason}  a storefront block already
//        has a report waiting for a leader (reason 'open') or accepted ('accepted'), so a second
//        one is not taken. The page should show the block as reported, not retry.
//   409 {error:'report-moved', code:'failed-precondition', status}  the shift report is no longer
//        what this change was made against: someone else withdrew, edited, accepted or sent it
//        back first (status is where it is now). The page should reload the reports.
//   409 {error:'same-person', code:'failed-precondition'}    a leader accepting their own shift
//        report: the second sign-off must be a different adult.
//   409 {error:'not-shift-parent', code:'failed-precondition'}  S-4: confirming a shift report
//        takes a parent of a scout on that shift (linked on the Members card), not the sender.
//   409 {error:'needs-confirm', code:'failed-precondition'}  S-4: accepting a report that needs a
//        second parent's confirmation and has none, without override: true and a reason.
//   409 {error:'not-collected', code:'failed-precondition'}  accepting a one-family shift's report
//        without collected: true (the leader collected and counted the cash) or an override.
//   409 {error:'too-many-open', code:'failed-precondition', reason}  'too-many-open': 3 reports
//        already waiting from this account; 'too-many-today': 20 sent in the last day.
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
export const awaitingImport = () => json(409, { error: 'awaiting-import', code: 'failed-precondition', reason: 'awaiting-import' });
export const shiftReported = (why) => json(409, { error: 'shift-reported', code: 'failed-precondition', reason: why });
export const reportMoved = (status) => json(409, { error: 'report-moved', code: 'failed-precondition', status: status || null });
export const samePerson = () => json(409, { error: 'same-person', code: 'failed-precondition' });
export const notShiftParent = () => json(409, { error: 'not-shift-parent', code: 'failed-precondition' });
export const needsConfirm = () => json(409, { error: 'needs-confirm', code: 'failed-precondition' });
export const notCollected = () => json(409, { error: 'not-collected', code: 'failed-precondition' });
// Keith (2026-10-01): the accepting leader is in the sender's family; only an override with a reason.
export const sameFamilyRefused = () => json(409, { error: 'same-family', code: 'failed-precondition' });
// The pack record moved between the server's read of it and the write that named its rev (a
// same-family decision rests on it): nothing written, and the page tries again rather than undo.
export const packMoved = () => json(409, { error: 'pack-moved', code: 'failed-precondition' });
export const tooManyReports = (why) => json(409, { error: 'too-many-open', code: 'failed-precondition', reason: why });
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
