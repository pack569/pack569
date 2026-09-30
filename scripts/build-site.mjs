#!/usr/bin/env node
// Pack 569 — the deploy build for Cloudflare Pages.
//
// The app has no build step in the authoring sense: index.html IS the app. This script
// exists for three reasons, and all three are boundaries rather than tooling:
//
//   1. WHAT IS SERVED. The repo is public, but the SITE serves only an allowlist: index.html,
//      the generated _headers, and plans.json, the den lesson plans that
//      scripts/lesson-plans.mjs generates from docs/lesson-plans/*.md (the page fetches it only
//      when a leader opens a plan). Not SETUP.md, not the design docs or the plan markdown,
//      not test/, not .claude/, not CNAME, and never the untracked .index.pre-*.html backups
//      sitting in a working copy. Anything that is not on ALLOWLIST cannot reach the output,
//      because nothing is copied by pattern — each file is written by name.
//   2. WHICH PACK A PREVIEW CAN REACH. A preview build rewrites FIREBASE_CONFIG and
//      PACK_DOC_ID to null, so a preview is device-only and cannot read or write the live
//      pack record, whoever opens it. The live values are then searched for in the output
//      and the build fails if any survived.
//      A STAGING build (staging.pack569.pages.dev) keeps the sign-in config and the pack id,
//      and rewrites BACKEND to 'api': its pack lives on this site's own server, which Pages
//      binds to the preview database there. Its CSP allows no Firestore host at all, so the
//      page could not reach the live Firestore pack even if the rewrite had not happened —
//      and the build and --verify both refuse a staging page that is not 'api'. It also
//      writes STAGING = true, which makes the page refuse the real move file (staging is for
//      made-up data only); every other page must say false. What staging
//      does NOT separate is sign-in (docs/cloudflare-setup.md, "One Firebase project").
//   3. NO 'unsafe-inline' FOR SCRIPTS. The page is one inline <script>. Its sha256 goes into
//      the Content-Security-Policy, so that script runs and no other inline script can.
//      Inline event-handler attributes (onclick="…") cannot be allowed by a hash, so the
//      build refuses a page that has any.
//
// Usage:
//   node scripts/build-site.mjs --target production|staging|preview [--out DIR]   (default: _site)
//   node scripts/build-site.mjs --verify DIR --target production|staging|preview
// Production is the committed index.html byte for byte, with whatever BACKEND it says: the
// switch to the pack's own server is a commit to that line, and the CSP follows it.
// --verify re-checks a built directory against index.html at this commit; the deploy
// preflight runs it on the downloaded artifact, so what ships is what was checked.
//
// Plain Node, no npm (the repo rule). test/harness.mjs imports the exports below.

import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, statSync, existsSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { plansJson, PlanError } from './lesson-plans.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const TARGETS = ['production', 'staging', 'preview'];
// Every file the site serves. Adding one here is a decision about what the public can fetch.
export const ALLOWLIST = ['_headers', 'index.html', 'plans.json'];

// The two declarations, exactly as index.html writes them (2-space indent, one per file).
// A comment line in the file quotes `var FIREBASE_CONFIG = { … }` too; the `^  var` anchor is
// what keeps it out. Each pattern must match exactly once, or the build stops.
const CONFIG_RE = /^  var FIREBASE_CONFIG = (\{[^{}]*\}|null);$/gm;
const DOC_ID_RE = /^  var PACK_DOC_ID = ('[0-9a-f]{64}'|null);$/gm;
// Where firestoreBackend.init() imports the SDK from. Production's script-src allows this exact path,
// not all of www.gstatic.com, so a version bump in index.html moves the CSP with it.
const SDK_BASE_RE = /^  var SYNC_SDK_BASE = '(https:\/\/[a-z0-9.-]+\/[A-Za-z0-9._\/-]*\/)';$/gm;
// Where the pack lives: 'firestore' (Firestore, the live page today) or 'api' (this site's /api).
const BACKEND_RE = /^  var BACKEND = '(firestore|api)';$/gm;
export const BACKENDS = ['firestore', 'api'];
// Whether this is the staging page. Only the staging build says true; index.html says false.
const STAGING_RE = /^  var STAGING = (true|false);$/gm;

// What the Content-Security-Policy lets the page talk to, per target.
// Production: the Firebase SDK is imported from its gstatic path; Google sign-in loads apis.google.com
// and frames the project's authDomain; Firestore and Auth are the googleapis hosts; weather
// is open-meteo. Preview: device-only, so loadBackend() is never called (syncStart and
// signInWithGoogle both return early, because backendConfigured() is false when
// FIREBASE_CONFIG is null) and no Google origin is needed at all. If the config ever slipped through, the browser would still block Firestore.
// The calendar-from-a-link fetch (submitIcsPaste) is deliberately NOT allowed on either: it
// fails like a CORS refusal and the dialog switches to "paste the calendar text instead".
const WEATHER = ['https://api.open-meteo.com', 'https://archive-api.open-meteo.com'];
// www.googleapis.com is a guess at what sign-in may call; drop it after the first real
// sign-in test on pack569.pages.dev if the Network tab shows nothing going there.
// BACKEND 'api': Google sign-in and this site's own /api ('self'), and no Firestore host at all.
// Every target also has 'self' for plans.json, the lesson plans the page fetches from its own
// site (loadAdventurePlans). On a Firestore page 'self' reaches nothing else the page uses.
const AUTH_CONNECT = ['https://identitytoolkit.googleapis.com', 'https://securetoken.googleapis.com', 'https://www.googleapis.com'];
const FIRESTORE_CONNECT = ['https://firestore.googleapis.com'];
const GOOGLE_CONNECT = FIRESTORE_CONNECT.concat(AUTH_CONNECT);
const SIGN_IN_SCRIPT = 'https://apis.google.com';

export class BuildError extends Error {}
function fail(msg) { throw new BuildError(msg); }

function countMatches(re, text) { return (text.match(re) || []).length; }
function lineOf(text, index) { return text.slice(0, index).split('\n').length; }

// Things a hash-based CSP would silently break, found by line. An inline handler or a
// javascript: URL needs 'unsafe-inline'; eval, new Function and string timers need
// 'unsafe-eval'; a created <script> needs its own allowance. None is allowed, so each fails
// the build rather than failing quietly in a leader's browser.
export function cspHazards(html) {
  const checks = [
    ['an inline event handler', /\son[a-z]+\s*=\s*\\?["']/gi],
    ['a javascript: URL', /javascript:/gi],
    ['eval()', /\beval\s*\(/g],
    ['new Function', /\bnew\s+Function\s*\(/g],
    ['a string setTimeout/setInterval', /\bset(?:Timeout|Interval)\s*\(\s*['"`]/g],
    ['a created <script>', /createElement\s*\(\s*['"`]script/gi]
  ];
  const found = [];
  for (const [what, re] of checks) {
    let m;
    while ((m = re.exec(html))) found.push({ what, line: lineOf(html, m.index) });
  }
  return found;
}

// The one inline script, and the CSP hash of its text. The hash covers the exact characters
// between <script> and </script>; the file has no CR, so the parser's newline normalisation
// cannot make the browser's hash differ from this one.
export function inlineScript(html) {
  const tags = countMatches(/<script\b/gi, html);
  if (tags !== 1) fail(`index.html must have exactly one <script> tag; found ${tags}`);
  const open = html.indexOf('<script>');
  if (open < 0) fail('the <script> tag has attributes; the build expects a bare <script>');
  const close = html.indexOf('</script>', open);
  if (close < 0 || html.indexOf('</script>', close + 1) >= 0) fail('index.html must have exactly one </script>');
  const text = html.slice(open + '<script>'.length, close);
  if (text.indexOf('\r') >= 0) fail('the script contains a carriage return; the CSP hash would not match');
  return { text, hash: createHash('sha256').update(text, 'utf8').digest('base64') };
}

// The live Firebase config and pack id, read out of index.html itself rather than written
// down a second time here. Returns null values when the file already has them as null.
export function liveConfig(html) {
  const cfg = [...html.matchAll(CONFIG_RE)];
  if (cfg.length !== 1) fail(`expected exactly one "  var FIREBASE_CONFIG = …;" declaration; found ${cfg.length}`);
  const doc = [...html.matchAll(DOC_ID_RE)];
  if (doc.length !== 1) fail(`expected exactly one "  var PACK_DOC_ID = …;" declaration; found ${doc.length}`);
  const config = vm.runInNewContext('(' + cfg[0][1] + ')', Object.create(null), { timeout: 100 });
  const docId = doc[0][1] === 'null' ? null : doc[0][1].slice(1, -1);
  const sdk = [...html.matchAll(SDK_BASE_RE)];
  const sdkBase = sdk.length === 1 ? sdk[0][1] : null;
  const be = [...html.matchAll(BACKEND_RE)];
  if (be.length !== 1) fail(`expected exactly one "  var BACKEND = 'firestore'|'api';" declaration; found ${be.length}`);
  const st = [...html.matchAll(STAGING_RE)];
  if (st.length !== 1) fail(`expected exactly one "  var STAGING = true|false;" declaration; found ${st.length}`);
  return { config, docId, sdkBase, backend: be[0][1], staging: st[0][1] === 'true' };
}

// Every value that would let a page reach the live pack. A preview must contain none of them.
function liveMarkers(live) {
  const out = [];
  if (live.config) {
    for (const k of Object.keys(live.config)) {
      const v = live.config[k];
      if (typeof v === 'string' && v.length >= 6) out.push({ what: 'FIREBASE_CONFIG.' + k, value: v });
    }
  }
  if (live.docId) out.push({ what: 'PACK_DOC_ID', value: live.docId });
  return out;
}

// The page as the target serves it. Production is byte-for-byte the committed file; staging is
// the committed file with BACKEND 'api' and STAGING true; preview is the committed file with no
// cloud at all.
export function transform(html, target) {
  if (TARGETS.indexOf(target) < 0) fail(`unknown target "${target}"; use ${TARGETS.join(', ')}`);
  const live = liveConfig(html);
  // Only a build makes a staging page; a committed page that says so is a mistake.
  if (live.staging) fail('index.html says STAGING = true; only the staging build may');
  if (target === 'production' || target === 'staging') {
    const c = live.config;
    if (!c || typeof c !== 'object') fail(`${target} needs FIREBASE_CONFIG set in index.html; it is null`);
    for (const k of ['apiKey', 'authDomain', 'projectId']) {
      if (typeof c[k] !== 'string' || !c[k]) fail(`${target} needs FIREBASE_CONFIG.${k}`);
    }
    if (!/^[a-z0-9.-]+$/.test(c.authDomain)) fail('FIREBASE_CONFIG.authDomain is not a plain host name');
    // BACKEND 'api' serves exactly the pack baked in as PACK_DOC_ID; without it the page is device-only.
    if (!live.docId) fail(`${target} needs PACK_DOC_ID set in index.html; it is null`);
    if (!live.sdkBase) fail(`${target} needs exactly one "  var SYNC_SDK_BASE = 'https://…/';" in index.html`);
    if (target === 'production') return { html, live };
    const out = html.replace(BACKEND_RE, "  var BACKEND = 'api';").replace(STAGING_RE, '  var STAGING = true;');
    return { html: out, live: Object.assign({}, live, { backend: 'api', staging: true }) };
  }
  const out = html
    .replace(CONFIG_RE, '  var FIREBASE_CONFIG = null;')
    .replace(DOC_ID_RE, '  var PACK_DOC_ID = null;');
  for (const m of liveMarkers(live)) {
    if (out.indexOf(m.value) >= 0) fail(`the preview still contains the live ${m.what}`);
  }
  return { html: out, live };
}

// What the page may connect to, for a signed-in build with this BACKEND.
export function connectFor(backend) {
  return ["'self'"].concat(backend === 'api' ? AUTH_CONNECT : GOOGLE_CONNECT, WEATHER);
}
// A preview's: its own site (plans.json) and the weather, and no Google origin at all.
export const PREVIEW_CONNECT = ["'self'"].concat(WEATHER);
// The CSP origins for a target. authDomain comes from the config, not from this file.
export function cspSources(target, live) {
  if (target === 'production' || target === 'staging') {
    return {
      SCRIPT_ORIGINS: [live.sdkBase, SIGN_IN_SCRIPT].join(' '),
      CONNECT: connectFor(live.backend).join(' '),
      FRAME: ['https://' + live.config.authDomain, 'https://apis.google.com'].join(' ')
    };
  }
  return { SCRIPT_ORIGINS: '', CONNECT: PREVIEW_CONNECT.join(' '), FRAME: "'none'" };
}

// Fill the _headers template. Comment lines are dropped from the output; they are for the
// people reading the template, and Pages does not need them.
export function renderHeaders(template, target, hash, live) {
  const vals = Object.assign({ HASH: hash, PREVIEW_ONLY: target !== 'production' ? '  X-Robots-Tag: noindex' : '' },
    cspSources(target, live));
  let out = template.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => {
    if (!(k in vals)) fail(`_headers has an unknown placeholder ${m}`);
    return vals[k];
  });
  out = out.split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .map((l) => l.replace(/ +;/g, ';').replace(/\s+$/, ''))
    .filter((l, i, a) => l !== '' || (i > 0 && a[i - 1] !== ''))
    .join('\n').replace(/^\n+/, '').replace(/\n*$/, '\n');
  if (/\{\{|\}\}/.test(out)) fail('_headers still has an unfilled placeholder');
  return out;
}

// The CSP line out of a built _headers.
export function cspOf(headers) {
  const lines = headers.split('\n').filter((l) => /^\s+Content-Security-Policy:/i.test(l));
  if (lines.length !== 1) fail(`_headers must have exactly one Content-Security-Policy; found ${lines.length}`);
  return lines[0].replace(/^\s+Content-Security-Policy:\s*/i, '');
}
// { 'script-src': ["'sha256-…'", 'https://…'], … }
export function cspDirectives(csp) {
  const out = {};
  for (const part of csp.split(';')) {
    const words = part.trim().split(/\s+/).filter(Boolean);
    if (words.length) out[words[0].toLowerCase()] = words.slice(1);
  }
  return out;
}

function listFiles(dir) {
  const out = [];
  (function walk(d) {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(dir, p).split(sep).join('/'));
    }
  })(dir);
  return out.sort();
}

// The output directory is emptied before each build, so refuse one that holds anything the
// build did not write: the repo, a folder above it, or a typo that names somewhere real.
// Only a missing directory, an empty one, or an earlier build's output is used.
function prepareOut(out, root) {
  const o = resolve(out);
  const rel = relative(o, root);
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
    fail(`refusing to build into ${o}: it contains the repo`);
  }
  if (existsSync(o)) {
    if (!statSync(o).isDirectory()) fail(`refusing to build into ${o}: it is a file`);
    const extra = listFiles(o).filter((f) => ALLOWLIST.indexOf(f) < 0);
    if (extra.length) fail(`refusing to build into ${o}: it holds files the build did not write (${extra.slice(0, 3).join(', ')})`);
    for (const f of ALLOWLIST) rmSync(join(o, f), { force: true });
  }
  mkdirSync(o, { recursive: true });
  return o;
}

// plans.json for this commit: the lesson plans parsed from docs/lesson-plans. A plan the parser
// cannot read stops the build with its file and line, like any other build error.
function plansFor(root) {
  try { return plansJson({ root }); } catch (e) {
    if (e instanceof PlanError) fail('the lesson plans: ' + e.message);
    throw e;
  }
}

export function build({ target, out = join(ROOT, '_site'), root = ROOT } = {}) {
  const src = readFileSync(join(root, 'index.html'), 'utf8');
  const plans = plansFor(root);
  const hazards = cspHazards(src);
  if (hazards.length) {
    fail('index.html has what the CSP would block: ' +
      hazards.map((h) => h.what + ' at line ' + h.line).join(', '));
  }
  const t = transform(src, target);
  const { hash } = inlineScript(t.html);
  const headers = renderHeaders(readFileSync(join(root, '_headers'), 'utf8'), target, hash, t.live);
  const dir = prepareOut(out, root);
  writeFileSync(join(dir, 'index.html'), t.html);
  writeFileSync(join(dir, '_headers'), headers);
  writeFileSync(join(dir, 'plans.json'), plans);
  return verify({ dir, target, root });
}

// Re-check a built directory. Independent of how it was built: it recomputes the expected
// page from index.html at this commit and compares bytes, then checks the headers.
export function verify({ dir, target, root = ROOT }) {
  if (TARGETS.indexOf(target) < 0) fail(`unknown target "${target}"; use ${TARGETS.join(', ')}`);
  if (!existsSync(dir)) fail(`no built site at ${dir}`);
  const files = listFiles(dir);
  if (files.join(',') !== ALLOWLIST.join(',')) {
    fail(`the site must be exactly ${ALLOWLIST.join(' + ')}; found ${files.join(', ') || 'nothing'}`);
  }
  const html = readFileSync(join(dir, 'index.html'), 'utf8');
  const headers = readFileSync(join(dir, '_headers'), 'utf8');
  const live = liveConfig(html);

  if (target === 'preview') {
    if (live.config !== null || live.docId !== null) {
      fail('this is not a preview build: FIREBASE_CONFIG / PACK_DOC_ID are not null');
    }
  } else if (!live.config || !live.docId) {
    fail(`this is not a ${target} build: FIREBASE_CONFIG / PACK_DOC_ID are null`);
  }
  // Staging runs on the pack's own server, never on Firestore: a staging link must not be a
  // second way into the live Firestore pack.
  if (target === 'staging' && live.backend !== 'api') fail("this is not a staging build: BACKEND is not 'api'");
  // Staging refuses the real move file because it says STAGING; nothing else may say it.
  if (target === 'staging' && !live.staging) fail('this is not a staging build: STAGING is not true');
  if (target !== 'staging' && live.staging) fail(`this is not a ${target} build: STAGING is true`);
  // Byte-for-byte what this commit's index.html becomes for this target.
  const expected = transform(readFileSync(join(root, 'index.html'), 'utf8'), target);
  if (html !== expected.html) fail(`index.html is not this commit's ${target} build`);
  // The same plans for every target, byte for byte what this commit's markdown makes.
  if (readFileSync(join(dir, 'plans.json'), 'utf8') !== plansFor(root)) fail('plans.json is not this commit’s lesson plans');
  if (target === 'preview') {
    for (const m of liveMarkers(expected.live)) {
      if (html.indexOf(m.value) >= 0 || headers.indexOf(m.value) >= 0) fail(`the preview contains the live ${m.what}`);
    }
  }
  if (cspHazards(html).length) fail('the built page has what the CSP would block');

  const { hash } = inlineScript(html);
  const csp = cspOf(headers);
  const hashes = csp.match(/'sha256-[A-Za-z0-9+/=]+'/g) || [];
  if (hashes.length !== 1 || hashes[0] !== `'sha256-${hash}'`) fail('the CSP hash is not the hash of the page’s script');
  const directives = cspDirectives(csp);
  if ((directives['default-src'] || []).join(' ') !== "'none'") fail("the CSP must start from default-src 'none'");
  for (const name of Object.keys(directives)) {
    const v = directives[name];
    if (v.indexOf("'unsafe-eval'") >= 0) fail(`the CSP allows 'unsafe-eval' in ${name}`);
    if (name !== 'style-src' && v.indexOf("'unsafe-inline'") >= 0) fail(`the CSP allows 'unsafe-inline' in ${name}`);
    if (v.some((s) => s === '*' || s === 'https:' || s === 'http:')) fail(`the CSP allows any origin in ${name}`);
  }
  const google = /gstatic|google|firebase/i.test(csp);
  const noindex = /^\s+X-Robots-Tag:\s*noindex\s*$/mi.test(headers);
  if (target === 'preview') {
    if (google) fail('the preview CSP allows a Google or Firebase origin');
    if (!/frame-src 'none'/.test(csp)) fail("the preview CSP must have frame-src 'none'");
    if ((directives['connect-src'] || []).join(' ') !== PREVIEW_CONNECT.join(' ')) fail("the preview CSP's connect-src is not its own site and the weather");
    if (!noindex) fail('the preview must send X-Robots-Tag: noindex');
  } else {
    const want = [live.sdkBase, SIGN_IN_SCRIPT, 'https://' + live.config.authDomain];
    for (const o of want) if (csp.indexOf(o) < 0) fail(`the ${target} CSP is missing ${o}`);
    // connect-src is exactly what this page's BACKEND needs: Firestore only for 'firestore',
    // Firebase Auth and no Firestore for 'api'; 'self' (plans.json, and /api) for both.
    if ((directives['connect-src'] || []).join(' ') !== connectFor(live.backend).join(' ')) {
      fail(`the ${target} CSP's connect-src is not what BACKEND '${live.backend}' needs`);
    }
    if (target === 'production' && noindex) fail('production must not send X-Robots-Tag: noindex');
    if (target === 'staging' && !noindex) fail('staging must send X-Robots-Tag: noindex');
  }
  const sizes = files.map((f) => ({ file: f, bytes: statSync(join(dir, f)).size }));
  return { target, dir, files: sizes, hash };
}

function parseArgs(argv) {
  const a = { target: null, out: null, verify: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--target' || k === '--out' || k === '--verify') {
      if (i + 1 >= argv.length) fail(`${k} needs a value`);
      a[k.slice(2)] = argv[++i];
    } else fail(`unknown argument "${k}"`);
  }
  if (!a.target) fail(`--target ${TARGETS.join('|')} is required`);
  if (a.verify && a.out) fail('--verify and --out do not go together');
  return a;
}

function main() {
  try {
    const a = parseArgs(process.argv.slice(2));
    const r = a.verify
      ? verify({ dir: resolve(a.verify), target: a.target })
      : build({ target: a.target, out: resolve(a.out || join(ROOT, '_site')) });
    const shown = relative(process.cwd(), r.dir);
    console.log(`${a.verify ? 'verified' : 'built'} ${r.target} → ${shown.startsWith('..') ? r.dir : shown || '.'}`);
    for (const f of r.files) console.log(`  ${f.file.padEnd(10)} ${f.bytes} bytes`);
    console.log(`  script   sha256-${r.hash}`);
  } catch (e) {
    if (!(e instanceof BuildError)) throw e;
    if (process.env.GITHUB_ACTIONS) console.log(`::error title=build-site::${e.message}`);
    console.error(`build-site: ${e.message}`);
    process.exit(1);
  }
}

const invoked = process.argv[1] ? pathToFileURL(realpathSync(resolve(process.argv[1]))).href : '';
if (import.meta.url === invoked) main();
