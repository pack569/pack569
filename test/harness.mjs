// Ideal Year of Scouting — test harness.
//
// Two comments in index.html have long assumed this file existed ("The Node harness asserts
// this with a source scan" at renderParentApp; "Pure (takes the state) so the Node harness
// can exercise it" at startHereVisible). It didn't. This is it.
//
// The app is one <script> IIFE that ends by touching the DOM, so we don't run the whole
// thing. Instead:
//   * SOURCE SCANS assert structural invariants (no `state` in the parent block, alias
//     coverage, attribute names) directly against the text.
//   * SLICED EVAL pulls named pure declarations out of the IIFE by their 2-space-indented
//     `function x(` / `var x =` header and evaluates just those in a bare sandbox.
//
// Run:  node test/harness.mjs
// Exit: 0 all green, 1 on any failure.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { execSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HTML = readFileSync(join(ROOT, 'index.html'), 'utf8');
const SCRIPT = HTML.slice(HTML.indexOf('<script>') + 8, HTML.lastIndexOf('</script>'));
// Some invariants live in the stylesheet, not the script.
const SCRIPT_CSS = HTML.slice(HTML.indexOf('<style>'), HTML.indexOf('</style>'));

/* ---------------- tiny assert kit ---------------- */
let pass = 0;
const fails = [];
function test(name, fn) {
  try { fn(); pass++; }
  catch (e) { fails.push(`${name}\n      ${e.message}`); }
}
function eq(actual, expected, what) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${what || 'value'}: expected ${b}, got ${a}`);
}
function ok(cond, msg) { if (!cond) throw new Error(msg); }

const BPV = () => {
  const m = /function buildParentView\(src, opts\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(m, 'buildParentView() not found');
  return m[0];
};
// Absence assertions ("this key is NEVER published") have to read CODE, not prose. The comments
// in buildParentView name the very things they forbid — "⚠ noteInternal NEVER publishes" — so a
// naive scan of the source finds the field and fails on the warning that exists to prevent it.
// Whole-line comments only: a trailing one is left alone, which errs towards a false FAILURE
// rather than a false pass.
const codeOnly = (src) => src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

/* ---------------- slicing ---------------- */
// Declarations inside the IIFE are indented exactly two spaces, so a declaration ends at the
// first line that is `  }` / `  };` / `  ];` at that same indent. Good enough, and it fails
// loudly (ReferenceError in the sandbox) rather than silently if the file's style drifts.
function slice(name) {
  const re = new RegExp(`^  (?:function ${name}\\(|var ${name} =)`, 'm');
  const m = re.exec(SCRIPT);
  if (!m) throw new Error(`harness: could not find declaration "${name}" in index.html`);
  const rest = SCRIPT.slice(m.index);
  const end = /^  (?:\}|\};|\];)$/m.exec(rest);
  if (!end) throw new Error(`harness: could not find the end of "${name}"`);
  return rest.slice(0, end.index + end[0].length);
}
function sandbox(names) {
  const ctx = vm.createContext({});
  vm.runInContext(names.map(slice).join('\n'), ctx);
  return ctx;
}

/* ================================================================
   Wave 21 — the jobs model
   ================================================================ */
const jobs = sandbox([
  'DENS', 'JOBS', 'JOB_PATTERNS', 'JOB_BY_ID', 'jobLabel', 'arrOf',
  'jobsFromRoleText', 'densFromRoleText'
]);
// JOB_BY_ID is populated by a forEach that lives outside the sliced declaration.
vm.runInContext('JOBS.forEach(function (j) { JOB_BY_ID[j.id] = j; });', jobs);

test('every JOBS entry has id, label and a home workspace', () => {
  const homes = new Set(['home', 'program', 'scouts', 'popcorn', 'money', 'pack']);
  for (const j of jobs.JOBS) {
    ok(j.id && j.label, `job missing id/label: ${JSON.stringify(j)}`);
    ok(homes.has(j.home), `job "${j.id}" has unknown home workspace "${j.home}"`);
  }
});

test('the three jobs every pack must have are present', () => {
  const ids = jobs.JOBS.map((j) => j.id);
  for (const req of ['chair', 'secretary', 'treasurer']) {
    ok(ids.includes(req), `missing required committee job "${req}"`);
  }
});

test('JOB_PATTERNS only reference real job ids', () => {
  for (const p of jobs.JOB_PATTERNS) {
    ok(jobs.JOB_BY_ID[p.id], `pattern for unknown job id "${p.id}"`);
    if (p.notWith) ok(jobs.JOB_BY_ID[p.notWith], `notWith references unknown job "${p.notWith}"`);
  }
});

// The migration is the risky part: it runs once over every existing ledger.
test('free-text role migrates to structured jobs', () => {
  const f = jobs.jobsFromRoleText;
  eq(f('Cubmaster'), ['cubmaster'], 'Cubmaster');
  eq(f('Treasurer'), ['treasurer'], 'Treasurer');
  eq(f('Popcorn Kernel'), ['kernel'], 'Popcorn Kernel');
  eq(f('Committee Chair'), ['chair'], 'Committee Chair');
  eq(f('Advancement Chair'), ['advancement'], 'Advancement Chair');
  eq(f('Activities Chair'), ['activities'], 'Activities Chair');
  eq(f('Pack Trainer'), ['trainer'], 'Pack Trainer');
  eq(f('Wolf Den Leader'), ['denleader'], 'Wolf Den Leader');
});

test('assistant roles suppress their principal', () => {
  const f = jobs.jobsFromRoleText;
  eq(f('Assistant Den Leader'), ['asstden'], 'Assistant Den Leader must not also be denleader');
  eq(f('Assistant Cubmaster'), ['asstcub'], 'Assistant Cubmaster must not also be cubmaster');
});

// Multi-job is the whole point: one person routinely holds two or three of these.
test('a person can hold several jobs at once', () => {
  const f = jobs.jobsFromRoleText;
  let got = f('Treasurer and Popcorn Kernel');
  ok(got.includes('treasurer') && got.includes('kernel'), `expected both, got ${JSON.stringify(got)}`);
  got = f('Assistant Cubmaster & Popcorn Kernel');
  ok(got.includes('asstcub') && got.includes('kernel'), `expected both, got ${JSON.stringify(got)}`);
  ok(!got.includes('cubmaster'), 'Assistant Cubmaster must not also yield cubmaster');
  got = f('Den Leader / Treasurer');
  ok(got.includes('denleader') && got.includes('treasurer'), `expected both, got ${JSON.stringify(got)}`);
});

test('the widened job list covers the roles a pack actually fills', () => {
  const f = jobs.jobsFromRoleText;
  eq(f('Pinewood Derby Chair'), ['derbychair'], 'Pinewood Derby Chair');
  eq(f('Camping Chair'), ['outdoors'], 'Camping Chair');
  eq(f('Webmaster'), ['comms'], 'Webmaster');
});

test('overlapping patterns do not double-assign', () => {
  // 'outdoor'/'camp' used to live on activities too; they must resolve to exactly one job.
  eq(jobs.jobsFromRoleText('Outdoor Chair'), ['outdoors'], 'Outdoor Chair');
  eq(jobs.jobsFromRoleText('Activities Chair'), ['activities'], 'Activities Chair');
});

test('there is no free-text role input left in the leader row', () => {
  // The picker is the single answer to "what do they do" — a text box would compete with it.
  ok(!/data-ch="ldr-role"/.test(SCRIPT), 'a data-ch="ldr-role" input still exists');
  ok(!/ch === 'ldr-role'/.test(SCRIPT), "a stale 'ldr-role' change handler still exists");
  // …but the stored field must survive, since it is what the migration reads.
  ok(/jobsFromRoleText\(l\.role\)/.test(SCRIPT), 'the migration no longer reads l.role');
});

test('migration never invents jobs from empty or unknown text', () => {
  eq(jobs.jobsFromRoleText(''), [], 'empty string');
  eq(jobs.jobsFromRoleText(undefined), [], 'undefined');
  eq(jobs.jobsFromRoleText('Snack coordinator'), [], 'unrelated free text');
});

test('den scope is extracted from the role text', () => {
  eq(jobs.densFromRoleText('Wolf Den Leader'), ['Wolf'], 'Wolf');
  eq(jobs.densFromRoleText('Arrow of Light den leader'), ['Arrow of Light'], 'Arrow of Light');
  eq(jobs.densFromRoleText('Cubmaster'), [], 'no den mentioned');
});

test('every den in a migrated scope is a real den', () => {
  for (const d of jobs.densFromRoleText('lion tiger wolf bear webelos arrow of light')) {
    ok(jobs.DENS.includes(d), `"${d}" is not in DENS`);
  }
});

test('arrOf guards every non-array', () => {
  eq(jobs.arrOf(undefined), [], 'undefined');
  eq(jobs.arrOf(null), [], 'null');
  eq(jobs.arrOf('nope'), [], 'string');
  eq(jobs.arrOf(['a']), ['a'], 'passthrough');
});

/* ================================================================
   Structural invariants (source scans)
   ================================================================ */

test('jobs are a lens, never a gate', () => {
  // myJobs() may only order/mark. If it ever appears next to a permission predicate, the
  // two concepts have been conflated — which is the drift the JOBS banner warns about.
  const bad = /(canEdit|isAdmin|MEMBER_ROLES)\s*\(\s*\)?\s*&&\s*(myJobs|hasJob)\(|(myJobs|hasJob)\([^)]*\)\s*&&\s*(canEdit|isAdmin)\(/;
  ok(!bad.test(SCRIPT), 'myJobs()/hasJob() is being combined with a permission check');
});

test('the parent render block never reads `state`', () => {
  // The invariant renderParentApp's own comment claims the harness asserts.
  const start = SCRIPT.indexOf('function renderParentApp(');
  ok(start > -1, 'renderParentApp not found');
  const after = SCRIPT.slice(start);
  const end = after.indexOf('function renderStorefrontList(');
  ok(end > -1, 'could not find the end of the parent block');
  const block = after.slice(0, end);
  const hit = /\bstate\./.exec(block);
  ok(!hit, `parent block reads state at: ${block.slice(Math.max(0, hit?.index - 60), hit?.index + 60)}`);
});

test('leaders[].jobs and [].dens are defaulted in the normalizer', () => {
  const start = SCRIPT.indexOf('function normalizeState(');
  const block = SCRIPT.slice(start, start + 4000);
  ok(/l\.jobs = jobsFromRoleText\(l\.role\)/.test(block), 'jobs are not seeded from the old role text');
  ok(/l\.dens = densFromRoleText\(l\.role\)/.test(block), 'dens are not seeded from the old role text');
  ok(/typeof l\.uid !== 'string'/.test(block), 'leaders[].uid is not defaulted');
});

test('the normalizer never bumps the version gate', () => {
  // Additive fields only — the whole migration strategy depends on this staying === 1.
  ok(/d\.version !== 1/.test(SCRIPT), 'the v1 gate is gone');
  ok(!/\bd\.version\s*=\s*[2-9]/.test(SCRIPT), 'something writes a version above 1');
});

test('add-leader seeds the new job fields', () => {
  const m = /state\.leaders\.push\(\{[^}]*\}\)/.exec(SCRIPT);
  ok(m, 'add-leader push not found');
  for (const k of ['jobs:', 'dens:', 'uid:']) ok(m[0].includes(k), `add-leader is missing ${k}`);
});

/* ================================================================
   Wave 21 — the six-workspace nav shell
   ================================================================ */
const nav = sandbox(['WORKSPACES', 'TAB_ALIAS']);

const OLD_TABS = ['calendar', 'storefronts', 'scouts', 'advancement', 'totals',
  'budget', 'inventory', 'derby', 'pack'];

test('TAB_ALIAS covers every one of the nine old tabs', () => {
  // This is what lets the data-tab="…" strings already embedded across index.html keep
  // working untouched. A miss here is a dead button, not a crash — hence the test.
  for (const id of OLD_TABS) ok(nav.TAB_ALIAS[id], `no alias for the old "${id}" tab`);
  eq(Object.keys(nav.TAB_ALIAS).sort(), [...OLD_TABS].sort(), 'alias keys');
});

test('every alias points at a workspace and section that exist', () => {
  const wsIds = new Set(nav.WORKSPACES.map((w) => w.id));
  for (const [old, dest] of Object.entries(nav.TAB_ALIAS)) {
    ok(wsIds.has(dest.tab), `alias "${old}" -> unknown workspace "${dest.tab}"`);
    const ws = nav.WORKSPACES.find((w) => w.id === dest.tab);
    ok(ws.sections.some((s) => s.id === dest.section),
      `alias "${old}" -> "${dest.section}" is not a section of "${dest.tab}"`);
  }
});

test('section ids are globally unique', () => {
  // SECTION_HOME is a flat id -> workspace map, so a duplicate would silently route a
  // section to the wrong workspace.
  const seen = new Set();
  for (const w of nav.WORKSPACES) {
    for (const s of w.sections) {
      ok(!seen.has(s.id), `section id "${s.id}" is used in more than one workspace`);
      seen.add(s.id);
    }
  }
});

test('Home is first, and is the first paint', () => {
  eq(nav.WORKSPACES[0].id, 'home', 'first workspace');
  ok(/^\s*tab: 'home',/m.test(SCRIPT), "ui.tab does not default to 'home'");
  ok(/^\s*sections: \{\}/m.test(SCRIPT), 'ui.sections is not initialised');
});

test('every old tab label survives as a section label', () => {
  // The migration promise: muscle memory maps 1:1, so no clever renames.
  const labels = new Set(nav.WORKSPACES.flatMap((w) => w.sections.map((s) => s.label)));
  for (const l of ['Calendar', 'Derby', 'Advancement', 'Standings', 'Budget', 'Inventory', 'Storefronts']) {
    ok(labels.has(l), `the old "${l}" label no longer appears as a section`);
  }
});

test('every renderer the dispatch names is reachable from some section', () => {
  const sectionIds = new Set(nav.WORKSPACES.flatMap((w) => w.sections.map((s) => s.id)));
  const dispatch = [...SCRIPT.matchAll(/sec === '([a-z]+)'/g)].map((m) => m[1]);
  ok(dispatch.length >= 8, `expected the section dispatch chain, found ${dispatch.length} branches`);
  for (const id of dispatch) ok(sectionIds.has(id), `dispatch handles "${id}", which is not a section`);
});

test('navigation funnels through gotoNav', () => {
  // Stray `ui.tab = …` assignments bypass section bookkeeping and the scroll reset.
  const strays = [...SCRIPT.matchAll(/ui\.tab = (?!'popcorn';\s*\/\/ Wave 21)/g)];
  const decl = /tab: 'home',/.test(SCRIPT);
  ok(decl, 'ui.tab declaration missing');
  ok(strays.length <= 1, `${strays.length} direct ui.tab assignments remain; navigation should go through gotoNav()`);
});

test('the section strip is not sticky chrome', () => {
  // It must be a SIBLING that follows a closed .topbar, on --ground — not a second row
  // inside it. Nested, sticky chrome grows from ~93px to ~136px, and on a phone with the
  // keyboard up that is most of what's left to type a budget line into.
  const shell = /<div class="topbar no-print">[\s\S]*?<main id="view"/.exec(HTML);
  ok(shell, 'could not find the app shell markup');
  // topbar-inner closes, then topbar closes, THEN the subnav opens.
  ok(/<\/div>\s*<\/div>\s*<div class="subnav-wrap no-print" id="subnav" hidden>/.test(shell[0]),
    'the section strip is not a sibling following a closed .topbar');
  const css = HTML.slice(0, HTML.indexOf('</style>'));
  ok(/\.subnav-wrap \{ background: var\(--ground\); \}/.test(css),
    'the section strip does not sit on --ground');
});

test('nav chrome never prints and is keyboard-escapable', () => {
  ok(/class="subnav-wrap no-print"/.test(HTML), 'the section strip is missing no-print');
  ok(/class="skip-link no-print" href="#view"/.test(HTML), 'no skip link past the nav strips');
  ok(/<main id="view" tabindex="-1">/.test(HTML), 'the skip target is not focusable');
});

test("SIG_ATTRS carries 'section' so focus survives a re-render", () => {
  const m = /var SIG_ATTRS = \[([^\]]+)\]/.exec(SCRIPT);
  ok(m, 'SIG_ATTRS not found');
  ok(m[1].includes("'section'"), "SIG_ATTRS is missing 'section'");
  ok(m[1].includes("'tab'"), "SIG_ATTRS lost 'tab'");
});

test('no in-content jump collides with a workspace strip button', () => {
  // findBySignature uses querySelector — first match in document order wins — so an
  // in-card data-act="tab" whose data-tab is also a workspace id would steal focus to
  // the topbar on every re-render.
  const wsIds = new Set(nav.WORKSPACES.map((w) => w.id));
  for (const m of SCRIPT.matchAll(/data-act="tab" data-tab="([a-z]+)"/g)) {
    ok(!wsIds.has(m[1]),
      `an in-content button uses data-act="tab" data-tab="${m[1]}", which collides with the workspace strip`);
  }
});

test('gold is never used as a marker on navy', () => {
  // --accent on --navy is 2.71:1 — fails 4.5:1 for text and 3:1 for a non-text indicator.
  const css = HTML.slice(0, HTML.indexOf('</style>'));
  const tabMine = /\.tab\.mine::before \{[^}]*\}/.exec(css);
  ok(tabMine, '.tab.mine::before not found');
  ok(/background: var\(--navy-ink\)/.test(tabMine[0]),
    'the "yours" marker on the navy strip must use --navy-ink, not --accent');
});

/* ================================================================
   Wave 21 — relocations
   ================================================================ */

test('Season setup is one card rendered in two workspaces', () => {
  // A section can't live in two workspaces; a card can. That's why it's a card.
  ok(/function seasonSetupCard\(opts\)/.test(SCRIPT), 'seasonSetupCard() not found');
  const calls = [...SCRIPT.matchAll(/seasonSetupCard\(/g)].length;
  ok(calls >= 3, `expected the definition plus two call sites, found ${calls} occurrences`);
  ok(/h \+= seasonSetupCard\(\{ collapsible: true \}\)/.test(SCRIPT), 'Popcorn does not render Season setup');
  ok(/var h = seasonSetupCard\(\)/.test(SCRIPT), 'Money does not render Season setup');
});

test('the pack name left Season setup for Pack', () => {
  const card = /function seasonSetupCard\(opts\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(card, 'seasonSetupCard body not found');
  ok(!/data-ch="pack-name"/.test(card[0]), 'the pack name is still inside Season setup');
  const sharing = /function renderPackSharing\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(sharing && /data-ch="pack-name"/.test(sharing[0]), 'the pack name is not on Pack · Sharing');
});


test('the Trail’s End file input exists exactly once', () => {
  // It used to be emitted from two places; whichever rendered second lost the id, so the
  // picker silently opened the wrong element.
  const n = [...HTML.matchAll(/id="teFile"/g)].length;
  eq(n, 1, 'teFile input count');
});

test('the importer is permanent, not empty-state-only', () => {
  const fn = /function teImportCard\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'teImportCard() not found');
  // Its three real destinations must be visible, since one button serves all three.
  for (const w of ['Storefront Shifts', 'Inventory Transactions', 'Sales Transactions']) {
    ok(fn[0].includes(w), `the importer does not name the "${w}" report`);
  }
  const list = /function renderStorefrontList\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok((list[0].match(/teImportCard\(\)/g) || []).length >= 2,
    'the importer is not rendered in both the empty and populated states');
});

test('no user-facing copy points at a tab that no longer exists', () => {
  // Comments are exempt; strings are not.
  const stale = [];
  for (const m of SCRIPT.matchAll(/'[^'\n]*\bthe (Budget|Storefronts|Standings|Totals|Inventory|Advancement|Derby) tab\b[^'\n]*'/g)) {
    stale.push(m[0].slice(0, 70));
  }
  ok(!stale.length, `stale tab references in copy: ${stale.join(' | ')}`);
});

test('the printable money map lists the same seams the UI does', () => {
  // main is display:none when printing, so handoff cards never reach paper and this list
  // is all a new treasurer gets. If they drift, the handoff document lies.
  const fn = /function renderPackSeason\(\) \{[\s\S]*?<\/ul><\/div>'/.exec(SCRIPT);
  ok(fn, 'the "Where the money lives" list was not found in renderPackSeason');
  for (const seam of ['Dues &amp; fees', 'Money · Ledger', 'Fundraisers', 'Past seasons']) {
    ok(fn[0].includes(seam), `the printable money map no longer mentions ${seam}`);
  }
  // The collect grids were replaced by charges in Phase 3b; the map kept pointing at them.
  ok(!/collect grids/.test(fn[0].replace(/^\s*\/\/.*$/gm, '')), 'the money map points at collect grids that no longer exist');
});

/* ================================================================
   Wave 21 — Home
   ================================================================ */
const home = sandbox(['TIER_ORDER', 'pickHomeTasks']);

test('the urgency rank is shared by every job', () => {
  // Per-job urgency scales would make a three-job person's Home incoherent.
  eq(Object.keys(home.TIER_ORDER).sort(), ['now', 'week', 'whenever'], 'tiers');
  ok(home.TIER_ORDER.now < home.TIER_ORDER.week, 'now must outrank week');
  ok(home.TIER_ORDER.week < home.TIER_ORDER.whenever, 'week must outrank whenever');
});

test('a noisy job cannot crowd a quiet one out', () => {
  // Kernel+Treasurer in November: five popcorn items and one dues item. Without
  // round-robin the treasurer never learns the app knows about dues.
  const tasks = [
    ...Array.from({ length: 5 }, (_, i) => ({ job: 'kernel', tier: 'now', title: `k${i}` })),
    { job: 'treasurer', tier: 'week', title: 't0' },
  ];
  const picked = home.pickHomeTasks(tasks, ['kernel', 'treasurer'], 5);
  eq(picked.length, 5, 'picked count');
  ok(picked.some((t) => t.job === 'treasurer'), 'the treasurer got no slot at all');
  ok(picked.filter((t) => t.job === 'kernel').length <= 4, 'the kernel took every slot');
});

test('the picked queue comes back in urgency order', () => {
  const tasks = [
    { job: 'a', tier: 'whenever', title: 'w' },
    { job: 'a', tier: 'now', title: 'n' },
    { job: 'b', tier: 'week', title: 'k' },
  ];
  const picked = home.pickHomeTasks(tasks, ['a', 'b'], 5);
  eq(picked.map((t) => t.tier), ['now', 'week', 'whenever'], 'tier order');
});

test('pickHomeTasks terminates on odd input', () => {
  eq(home.pickHomeTasks([], ['kernel'], 5).length, 0, 'no tasks');
  eq(home.pickHomeTasks([{ job: 'nobody', tier: 'now', title: 'x' }], ['kernel'], 5).length, 0,
    'a task whose job nobody holds must not be picked');
  eq(home.pickHomeTasks([{ job: 'kernel', tier: 'now', title: 'x' }], [], 5).length, 0, 'no jobs');
});

test('Home renders no inputs', () => {
  // The app re-renders on every keystroke; an input here would put computeBudget() and
  // computeScoutTotals() in the typing path.
  const fn = /function renderHome\(\) \{[\s\S]*?\n    return h;\n  \}/.exec(SCRIPT);
  ok(fn, 'renderHome() not found');
  ok(!/data-ch="/.test(fn[0]), 'renderHome emits a data-ch input');
  const flow = /function packFlow\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(!/data-ch="/.test(flow[0]), 'packFlow emits a data-ch input');
});

test('every Home task routes somewhere that exists', () => {
  // A task pointing at a dead section is a dead row — silent, and only found by tapping it.
  const fn = /function homeTasks\(\) \{[\s\S]*?\n    return out;\n  \}/.exec(SCRIPT);
  ok(fn, 'homeTasks() not found');
  const sectionIds = new Set(nav.WORKSPACES.flatMap((w) => w.sections.map((s) => s.id)));
  const wsIds = new Set(nav.WORKSPACES.map((w) => w.id));
  const calls = [...fn[0].matchAll(/'(\w+)',\s*'(\w+)'\);/g)];
  ok(calls.length >= 8, `expected many add() calls, found ${calls.length}`);
  for (const [, tab, section] of calls) {
    ok(wsIds.has(tab), `a task routes to unknown workspace "${tab}"`);
    ok(sectionIds.has(section), `a task routes to unknown section "${section}"`);
  }
});

test('every Home task names a real job', () => {
  const fn = /function homeTasks\(\) \{[\s\S]*?\n    return out;\n  \}/.exec(SCRIPT);
  for (const m of fn[0].matchAll(/add\('(\w+)',/g)) {
    ok(jobs.JOB_BY_ID[m[1]], `a task is owned by unknown job "${m[1]}"`);
  }
});

test('the Pack Flow map is real text, not SVG', () => {
  // SVG <text> does not wrap, ignores the reader's font size, and is not selectable.
  const fn = /function packFlow\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'packFlow() not found');
  ok(!/<svg/i.test(fn[0]), 'packFlow emits SVG');
  ok(/<ol class="flow">/.test(fn[0]), 'packFlow is not an ordered list');
  ok(/flow-step list-row/.test(fn[0]), 'flow stages do not reuse .list-row, so Enter/Space will not work');
});

test('the job pill is never coloured by urgency', () => {
  // The pill says who owns the item. A column of red job names reads as alarm, not
  // ownership — urgency gets its own quiet marker instead.
  const fn = /function homeTaskRow\(t\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'homeTaskRow() not found');
  ok(!/pill' \+ \(t\.tier/.test(fn[0]), 'the job pill is still styled by tier');
  ok(/<span class="urg"/.test(fn[0]), 'there is no separate urgency marker');
  ok(/visually-hidden/.test(fn[0]), 'the urgency marker is not announced to screen readers');
});

test('the moved notice is an additive, dismissible flag', () => {
  ok(/d\.movedNoticeDismissed = d\.movedNoticeDismissed === true/.test(SCRIPT),
    'movedNoticeDismissed is not defaulted in the normalizer');
  ok(/movedNoticeDismissed: false/.test(SCRIPT), 'movedNoticeDismissed is missing from freshState');
  ok(/act === 'moved-dismiss'/.test(SCRIPT), 'no dismiss action');
  ok(/act === 'moved-go'/.test(SCRIPT), 'using a row to navigate does not dismiss the notice');
});

test('Start here lives on Home, not Calendar', () => {
  const cal = /function renderCalendarTab\(\) \{[\s\S]*?\n    return h;\n  \}/.exec(SCRIPT);
  ok(cal, 'renderCalendarTab not found');
  ok(!/Start here<\/h2>/.test(cal[0]), 'the Start here card is still on the Calendar');
  const hm = /function renderHome\(\) \{[\s\S]*?\n    return h;\n  \}/.exec(SCRIPT);
  ok(/Start here<\/h2>/.test(hm[0]), 'the Start here card is not on Home');
});

/* ================================================================
   Wave 21 — handoff cards and den scoping
   ================================================================ */


test('a handoff renders only when it carries a live figure', () => {
  // The anti-banner-blindness rule is a RENDER rule, not styling: a handoff conditional
  // on data can never decay into decoration.
  const fn = /function handoffCard\([\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'handoffCard() not found');
  ok(/if \(!w \|\| !figure\) return '';/.test(fn[0]), 'handoffCard does not bail on a missing figure');
});

test('every handoff points at a section that exists', () => {
  const sectionIds = new Set(nav.WORKSPACES.flatMap((w) => w.sections.map((s) => s.id)));
  // Five seams. The sixth (Pack · People -> Popcorn two-deep gaps) went away with the
  // storefront adults roster — this pack sends a parent with each scout.
  const calls = [...SCRIPT.matchAll(/handoffCard\('([^']+)', '([^']+)', '(\w+)'/g)];
  ok(calls.length >= 5, `expected the five seams, found ${calls.length}`);
  for (const [, , , section] of calls) {
    ok(sectionIds.has(section), `a handoff routes to unknown section "${section}"`);
  }
});

test('handoffs never reach paper', () => {
  // main is display:none when printing. They carry no-print anyway, and the printable
  // counterpart is the "Where the money lives" list on Pack · Season.
  const fn = /function handoffCard\([\s\S]*?\n  \}/.exec(SCRIPT);
  ok(/class="handoff no-print"/.test(fn[0]), 'the handoff card is missing no-print');
});

test('the handoff is quieter than a card, not louder', () => {
  const css = HTML.slice(0, HTML.indexOf('</style>'));
  const rule = /\n  \.handoff \{[^}]*\}/.exec(css);
  ok(rule, '.handoff rule not found');
  ok(/background: var\(--surface-2\)/.test(rule[0]), '.handoff should sit on the recessed surface');
  ok(!/box-shadow/.test(rule[0]), '.handoff must not have a shadow — every .card has one');
  ok(/min-height: 44px/.test(rule[0]), '.handoff is below a comfortable phone target');
});

test('den scope distinguishes "untouched" from "all dens"', () => {
  // null = fall back to the signed-in leader's den; '' = they chose All dens. Collapsing
  // the two makes the All dens button do nothing.
  ok(/denFilter: null/.test(SCRIPT), 'ui.denFilter does not start as null');
  const uses = [...SCRIPT.matchAll(/ui\.denFilter === null \? myDens\(\) : \(ui\.denFilter \? \[ui\.denFilter\] : \[\]\)/g)];
  ok(uses.length >= 2, `the three-state check should guard both scoped screens, found ${uses.length}`);
  ok(/ui\.denFilter = el\.dataset\.name \|\| ''/.test(SCRIPT),
    'the den-filter action does not write an empty string for All dens');
});

test('den scope is a default, never a lock', () => {
  // A den leader covering for someone else must always be able to see the whole pack.
  const chips = [...SCRIPT.matchAll(/data-act="den-filter" data-name=""/g)];
  ok(chips.length >= 2, `every scoped screen needs an "All dens" escape, found ${chips.length}`);
});

test('den scope never gates a workspace', () => {
  // Scoping filters rows. It must not decide what someone can reach.
  ok(!/myDens\(\)[^;\n]*\?\s*'' :/.test(SCRIPT), 'myDens() is being used to hide a surface');
});

/* ================================================================
   Wave 21 — storefront shifts track scouts only
   ================================================================ */

test('nothing tracks adults on a storefront shift', () => {
  // Pack policy: a parent accompanies their scout, so adults are 1:1 with the scouts who
  // sign up. A separate roster would be data nobody ever fills in, and a two-deep warning
  // computed from it would fire on every shift forever.
  for (const dead of ['blockAdultLeaders', 'blockNeedsAdults', 'storefrontNeedsAdults', 'getLeader']) {
    ok(!SCRIPT.includes(dead + '('), `${dead}() is still referenced`);
  }
  for (const act of ['adult-assign', 'adult-remove']) {
    ok(!SCRIPT.includes(`'${act}'`), `the ${act} handler still exists`);
  }
  ok(!/adults: \[\]/.test(SCRIPT), 'a new block is still seeded with an adults array');
});

test('no surface still says a shift needs adults', () => {
  // String literals only — a comment explaining what was removed is legitimate history.
  const literals = [...SCRIPT.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)].map((m) => m[1]).join('\0');
  for (const phrase of ['needs adults', 'Needs two-deep', 'no adults', 'Adults on this block']) {
    ok(!literals.includes(phrase), `user-facing copy still reads "${phrase}"`);
  }
});

test('the glance pill flags an unfilled shift instead', () => {
  // An empty SHIFT is the real gap now — that is what leaves the table unstaffed.
  const fn = /function glanceStatus\(sf\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'glanceStatus() not found');
  ok(/storefrontCoverage\(sf\)/.test(fn[0]), 'glanceStatus no longer derives from shift coverage');
  ok(/shift' \+ /.test(fn[0]), 'the middle state does not report open shifts');
});

test('the RSVP adults count is untouched', () => {
  // Different feature: "how many adults are coming" on an RSVP, not shift staffing.
  ok(/adults: rVal === 'yes'/.test(SCRIPT), 'the RSVP adults tally was removed by mistake');
});

test('deleting a leader no longer cascades into storefronts', () => {
  const fn = /if \(act\.indexOf\('del-leader:'\) === 0\) \{[\s\S]*?\n    \}/.exec(SCRIPT);
  ok(fn, 'the del-leader handler was not found');
  ok(!/storefronts/.test(fn[0]), 'deleting a leader still walks the storefronts');
});

/* ================================================================
   Wave 21 — per-tier reward coverage
   ================================================================ */
// packCoverage() reads who earned what through tierEarnedMap(), so both come out of the
// source together. Since 2026-08-02 a threshold is COMMISSION, not sales, so the rate math is
// sliced in rather than stubbed — the conversion IS the thing under test. The stubs are only
// the tier list, the roster and the totals (deadline-aware — `asOf` selects a snapshot).
//
// A test writes a scout's sales as `tot(storefrontSales, onlineSales)` and may set RATE and
// ONLINE_RATE; RATE defaults to 100% so a test that does not care about the conversion can
// keep writing thresholds in the same units as the sales.
function coverageSandbox(setup) {
  const ctx = vm.createContext({});
  vm.runInContext(
    `function tot(store, online) {
       var on = online || 0;
       return { sales: (store || 0) + on, onS: on, onD: 0, storeD: 0, wagonD: 0 };
     }
     ${setup}
     ${slice('tierMakeupMap')}
     ${slice('tierEarnedMap')}
     ${slice('packCoverage')}
     ${slice('scoutCommissionOf')}
     ${slice('commissionRates')}
     ${slice('goalBaseOf')}
     ${slice('cashDonOf')}
     ${slice('cashScoutRate')}
     ${slice('cashCreditOn')}
     ${slice('cashScoutCredit')}
     var SALES_AT = typeof SALES_AT === 'undefined' ? {} : SALES_AT;
     var state = {
       commissionPct: typeof RATE === 'undefined' ? '100' : RATE,
       commissionPctOnline: typeof ONLINE_RATE === 'undefined' ? '' : ONLINE_RATE,
       cashScoutPct: typeof CASH_RATE === 'undefined' ? '' : CASH_RATE,
       cashThroughTrailsEnd: typeof CASH_VIA_TE === 'undefined' ? false : CASH_VIA_TE,
       // Make-up credit is derived from the ledger since 2026-09-04 — a test grants it by
       // writing a stamped payment into LEDGER, the way the app does.
       ledger: typeof LEDGER === 'undefined' ? [] : LEDGER
     };
     function sortedTiers() { return TIERS; }
     function arrOf(v) { return Array.isArray(v) ? v : []; }
     function computeScoutTotals(asOf) { return asOf ? SALES_AT[asOf] : SALES; }
     function activeScouts() { return Object.keys(SALES).map(function (id) { return { id: id }; }); }
     var EARNED = tierEarnedMap();
     var RESULT = packCoverage();`, ctx);
  return ctx;
}

test('coverage stacks up the tiers a scout has reached', () => {
  // A top seller must never end up with less than a lower seller, so a scout at tier 3
  // gets everything tiers 1-3 cover — not just tier 3's own list.
  const ctx = coverageSandbox(`
     var TIERS = [
       { id:'t1', thresholdCents: 30000, covers:['x1'] },
       { id:'t2', thresholdCents: 45000, covers:['act:a3'] },
       { id:'t3', thresholdCents: 90000, covers:[] }
     ];
     var SALES = { top: tot(50000), mid: tot(35000), low: tot(1000) };`);
  const r = ctx.RESULT;
  eq(Object.keys(r.x1).sort(), ['mid', 'top'], 'tier-1 charge covers everyone past tier 1');
  eq(Object.keys(r['act:a3']), ['top'], 'tier-2 charge covers only the scout past tier 2');
  ok(r.x1.top, 'the tier-2 scout must ALSO get what tier 1 covers');
  ok(!r.x1.low, 'a scout below every tier is covered for nothing');
});

test('a tier covering nothing is valid', () => {
  // Prizes, a pack shirt, a patch: a reward description with no budget line behind it.
  ok(/if \(!Array\.isArray\(tier\.covers\)\) tier\.covers = \[\]/.test(SCRIPT),
    'tier.covers is not defaulted in the normalizer');
  const add = /state\.rewardTiers\.tiers\.push\(\{[^}]*\}\)/.exec(SCRIPT);
  ok(add && add[0].includes('covers: []'), 'a new tier is not seeded with an empty covers list');
});

test('the pack covering a fee is lost income, not a new cost', () => {
  // The charge's own value is already in planned/actual (est x roster), so adding a lump
  // on top would double-count it. What changes is that the family no longer reimburses.
  const fn = /function addFeeItem\(item, colKey\) \{[\s\S]*?\n    \}/.exec(SCRIPT);
  ok(fn, 'addFeeItem() not found');
  // `planCovered` is the 2026-07-27 planning assumption: earned it, or the pack has decided
  // to plan on covering it. Either way the family is not billed and the pack absorbs it.
  ok(/if \(cov\[s\.id\] \|\| planCovered\) \{ feesAbsorbed \+= each; return; \}/.test(fn[0]),
    'a covered scout is not excluded from expected fee income');
  ok(!/actual \+= feesAbsorbed/.test(SCRIPT), 'absorbed fees are being double-counted into actual spent');
});

test('the legacy dues lump switches off once coverage is configured', () => {
  // Both applying at once would count the same dues twice.
  ok(/var rewardDues = tierCoverageConfigured\(\) \? 0 : reward\.rewardDues/.test(SCRIPT),
    'the old lump is still added after per-tier coverage is set up');
  const fn = /function tierCoverageConfigured\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn && /arrOf\(t\.covers\)\.length > 0/.test(fn[0]), 'tierCoverageConfigured() does not test for covers');
});


test('coverage is derived, never written into state.collected', () => {
  // The collect grids stay a record of what FAMILIES paid. Mixing the two is what would
  // let the same dues be counted as both a pack cost and family income.
  const fn = /function packCoverage\(\w*\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'packCoverage() not found');
  ok(!/state\.collected/.test(fn[0]), 'packCoverage writes or reads state.collected');
});

/* ---- the same coverage, broken back out by the rung that unlocked it ---- */
// coveredSharesByTier() is what the itemised block on a scout row renders. The stubs are the
// three things it reads: the ladder, who reached what, and the shares that exist.
function tierGroupSandbox(setup) {
  const ctx = vm.createContext({});
  vm.runInContext(
    `${setup}
     function arrOf(v) { return Array.isArray(v) ? v : []; }
     function sortedTiers() {
       return TIERS.slice().sort(function (a, b) { return a.thresholdCents - b.thresholdCents; });
     }
     function tierEarnedMap() { return EARNED; }
     function coverableShares() { return SHARES; }
     // The sibling rule only looks further for a per-family share; none of these are.
     function linePerFamily(l) { return !!(l && l.perFamily); }
     ${slice('coveredSharesByTier')}
     var RESULT = coveredSharesByTier('kid');`, ctx);
  return ctx;
}
const SHARES_STUB = `var SHARES = [
   { coverKey: 'dues', rate: 9600, who: 'scout', kind: 'expense', item: { name: 'Youth registration' } },
   { coverKey: 'act:g', rate: 2500, who: 'scout', kind: 'activity', item: { name: 'Gladiators' } },
   { coverKey: 'act:g#adult', rate: 2500, who: 'adult', kind: 'activity', item: { name: 'Gladiators' } },
   { coverKey: 'act:c', rate: 1800, who: 'scout', kind: 'activity', item: { name: 'Camping trip' } }
 ];`;

test('a covered fee is credited to the LOWEST rung that pays it', () => {
  // Coverage stacks, so Silver naming a line Bronze already covers adds nothing. Crediting it
  // to Silver would report a fee as newly won at a level where reaching it changed nothing —
  // the same set-difference rule the standings card's `unlocks` uses.
  const ctx = tierGroupSandbox(`
     ${SHARES_STUB}
     var TIERS = [
       { id: 'b', name: 'Bronze', thresholdCents: 10000, covers: ['dues'] },
       { id: 's', name: 'Silver', thresholdCents: 20000, covers: ['dues', 'act:g'] }
     ];
     var EARNED = { b: { kid: 'earned' }, s: { kid: 'earned' } };`);
  const g = ctx.RESULT;
  eq(g.map((x) => x.tier.id), ['b', 's'], 'the rungs come out lowest first');
  eq(g[0].lines.map((l) => l.coverKey), ['dues'], 'Bronze keeps the fee it unlocked');
  eq(g[1].lines.map((l) => l.coverKey), ['act:g'], 'Silver is credited only what it ADDED');
  eq(g[0].total + g[1].total, 12100, 'the groups add up to what the pack actually covers');
});

test('rows inside a rung run biggest fee first, name to break the tie', () => {
  // Which keeps a scout share and the adult share of the same event — identical rate, adjacent
  // names — side by side instead of scattered through the block.
  const ctx = tierGroupSandbox(`
     ${SHARES_STUB}
     var TIERS = [{ id: 'g', name: 'Gold', thresholdCents: 10000,
                    covers: ['act:c', 'act:g#adult', 'act:g', 'dues'] }];
     var EARNED = { g: { kid: 'earned' } };`);
  eq(ctx.RESULT[0].lines.map((l) => l.name),
    ['Youth registration', 'Gladiators', 'Gladiators · adult', 'Camping trip'],
    'the covered rows are not sorted');
});

test('an unreached rung claims nothing for the rungs above it', () => {
  const ctx = tierGroupSandbox(`
     ${SHARES_STUB}
     var TIERS = [
       { id: 'b', name: 'Bronze', thresholdCents: 10000, covers: ['dues'] },
       { id: 's', name: 'Silver', thresholdCents: 20000, covers: ['dues', 'act:g'] }
     ];
     var EARNED = { s: { kid: 'earned' } };`);
  const g = ctx.RESULT;
  eq(g.map((x) => x.tier.id), ['s'], 'a rung the scout never reached is on the list');
  eq(g[0].lines.map((l) => l.coverKey), ['dues', 'act:g'],
    'the fee a skipped rung named must fall to the rung that was actually reached');
});

test('a rung that unlocks nothing is still a reward earned', () => {
  // Prizes and a patch is a real thing to have reached, and a make-up payment says so.
  const ctx = tierGroupSandbox(`
     ${SHARES_STUB}
     var TIERS = [
       { id: 'p', name: 'Patch', thresholdCents: 5000, covers: [], reward: 'Pack patch' },
       { id: 'b', name: 'Bronze', thresholdCents: 10000, covers: ['dues'] }
     ];
     var EARNED = { p: { kid: 'earned' }, b: { kid: 'madeUp' } };`);
  const g = ctx.RESULT;
  eq(g.length, 2, 'a reward-only rung was dropped');
  eq(g[0].lines.length, 0, 'a reward-only rung invented a covered fee');
  eq(g[0].total, 0, 'a reward-only rung is worth money');
  eq(g[1].how, 'madeUp', 'how the rung was credited is not carried through');
});

test('a cover key with no share behind it is worth nothing', () => {
  // The line was deleted, or its rate went to zero. The tier keeps the key — restoring the
  // rate restores the coverage — but the block must not price a row it cannot name.
  const ctx = tierGroupSandbox(`
     ${SHARES_STUB}
     var TIERS = [{ id: 'b', name: 'Bronze', thresholdCents: 10000, covers: ['gone', 'dues'] }];
     var EARNED = { b: { kid: 'earned' } };`);
  eq(ctx.RESULT[0].lines.map((l) => l.coverKey), ['dues'], 'a dead cover key rendered a row');
  eq(ctx.RESULT[0].total, 9600, 'a dead cover key changed the total');
});

test('the scout row renders the covered block grouped, not flat', () => {
  const row = /function renderScoutRow\(s, t, covered\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(row, 'renderScoutRow() not found');
  ok(/coveredSharesByTier\(s\.id\)/.test(row[0]), 'the block no longer groups by tier');
  ok(!/coverableShares\(\)\.filter/.test(row[0]), 'the old flat, unsorted list is still being built');
  // The trailing "the pack pays these" line is only true where the pack is paying something —
  // a rung that was only ever prizes bills the family for nothing and saves them nothing.
  ok(/coveredCents > 0\s*\n?\s*\? 'The pack pays these/.test(row[0]),
    'the covered-fees sentence is shown for a reward-only tier');
});

test('a rung is set apart from its rows by more than a font weight', () => {
  // The first cut leaned on 700-against-600, which down a fourteen-row block made the tier
  // heading read as one more line item. Two structural separations replaced it, and both are
  // load-bearing: a different TYPEFACE, and the rows sitting on their own recessed ground.
  ok(/\.cov-tier-name \{[^}]*Rockwell/.test(SCRIPT_CSS),
    'the tier heading is no longer set in the display serif');
  // --surface, NOT --surface-2: the panel has to differ from the .block-card it sits inside,
  // and this pair inverts correctly in both themes (dark #202935 in #293442, light the reverse).
  ok(/\.cov-lines \{[^}]*background: var\(--surface\)/.test(SCRIPT_CSS),
    'the covered rows are not on their own inset ground');
  const row = /function renderScoutRow\(s, t, covered\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(/class="cov-group"/.test(row[0]) && /class="cov-lines"/.test(row[0]),
    'the rows of one rung are not wrapped, so nothing scopes them to it');
});

/* ================================================================
   Money redesign — Phase 0 (the ledger) and Phase 1 (actual = sum of ledger).
   See DESIGN-money.md sections 3.3 and 5.
   ================================================================ */

// The ledger math is deliberately pure — it takes (ledger, book) rather than reading
// `state` — precisely so it can be exercised here rather than by clicking around.
const LEDGER_FNS = ['ledgerSort', 'entrySignedCents', 'entryAfterOpening', 'ledgerBalance',
  'LEDGER_INCOME_SOURCES', 'entryIsRefund', 'entryRefundsFamily', 'lineIncomeCents', 'ledgerIncomeCents',
  'lineActualCents', 'entryWantsLine', 'ledgerTotals', 'entryOnStatement', 'reconcileTotals', 'runningBalances'];

function entry(o) {
  return Object.assign({ id: 'x', date: '2025-10-01', description: '', amountCents: 0,
    direction: 'out', lineId: '', method: '', ref: '', source: '', donor: '',
    scoutId: '', reconciled: false }, o);
}

test('money in and money out are the only sign — amounts are always positive', () => {
  const { entrySignedCents } = sandbox(LEDGER_FNS);
  eq(entrySignedCents(entry({ amountCents: 5000, direction: 'in' })), 5000, 'money in');
  eq(entrySignedCents(entry({ amountCents: 5000, direction: 'out' })), -5000, 'money out');
});

test('the bank balance is the opening figure plus what actually moved', () => {
  const { ledgerBalance } = sandbox(LEDGER_FNS);
  const book = { openingCents: 42000, openingDate: '2025-09-01' };
  const led = [
    entry({ id: 'a', date: '2025-09-15', amountCents: 10000, direction: 'out' }),
    entry({ id: 'b', date: '2025-10-02', amountCents: 273000, direction: 'in' })
  ];
  eq(ledgerBalance(led, book), 42000 - 10000 + 273000, 'balance');
});

test('an entry dated before the opening date never moves the bank balance', () => {
  // The opening figure is the bank's word for everything up to that date, so counting a
  // backfilled receipt again would double it. This is the whole reason both ways of
  // starting a ledger (opening balance / backfill) can share one mechanism.
  const { ledgerBalance, ledgerTotals } = sandbox(LEDGER_FNS);
  const book = { openingCents: 50000, openingDate: '2025-09-01' };
  const led = [
    entry({ id: 'old', date: '2025-08-14', amountCents: 9900, direction: 'out' }),
    entry({ id: 'new', date: '2025-09-14', amountCents: 9900, direction: 'out' })
  ];
  eq(ledgerBalance(led, book), 50000 - 9900, 'only the post-opening entry counts');
  eq(ledgerTotals(led, book).preOpening, 1, 'the pre-opening entry is reported, not hidden');
});

test('with no opening date set, every entry counts', () => {
  const { ledgerBalance } = sandbox(LEDGER_FNS);
  const led = [entry({ date: '2001-01-01', amountCents: 700, direction: 'in' })];
  eq(ledgerBalance(led, { openingCents: 0, openingDate: '' }), 700, 'balance');
});

test("a line's actual is money out against it, less anything refunded back", () => {
  const { lineActualCents } = sandbox(LEDGER_FNS);
  const led = [
    entry({ id: '1', lineId: 'L', amountCents: 102000, direction: 'out' }),
    entry({ id: '2', lineId: 'L', amountCents: 2000, direction: 'in' }),
    entry({ id: '3', lineId: 'OTHER', amountCents: 500000, direction: 'out' }),
    entry({ id: '4', lineId: '', amountCents: 1234, direction: 'out' })
  ];
  eq(lineActualCents(led, 'L'), 100000, 'actual for L');
  eq(lineActualCents(led, ''), 0, 'an empty lineId matches nothing, not everything');
});

test("a line's actual ignores the opening date", () => {
  // A backfilled receipt is still what the line cost, even though the opening balance
  // already accounts for the cash having left. Cost and cash position are separate
  // questions, which is the point of splitting them at all.
  const { lineActualCents } = sandbox(LEDGER_FNS);
  const led = [entry({ id: '1', date: '2025-08-01', lineId: 'L', amountCents: 4200, direction: 'out' })];
  eq(lineActualCents(led, 'L'), 4200, 'actual');
});

test('the running balance is computed in date order, not entry order', () => {
  const { runningBalances } = sandbox(LEDGER_FNS);
  const book = { openingCents: 10000, openingDate: '' };
  const led = [
    entry({ id: 'later', date: '2025-11-01', amountCents: 3000, direction: 'out' }),
    entry({ id: 'earlier', date: '2025-10-01', amountCents: 5000, direction: 'in' })
  ];
  const run = runningBalances(led, book);
  eq(run.earlier, 15000, 'earlier row');
  eq(run.later, 12000, 'later row');
});

test('a pre-opening entry has no place in the running balance', () => {
  const { runningBalances } = sandbox(LEDGER_FNS);
  const run = runningBalances(
    [entry({ id: 'old', date: '2025-01-01', amountCents: 100, direction: 'out' })],
    { openingCents: 0, openingDate: '2025-09-01' });
  eq(run.old, null, 'pre-opening row');
});

test('reconciling compares the TICKED entries to the statement', () => {
  const { reconcileTotals } = sandbox(LEDGER_FNS);
  const book = { openingCents: 10000, openingDate: '2025-09-01', statementCents: 12000 };
  const led = [
    entry({ id: 'cleared', date: '2025-09-10', amountCents: 5000, direction: 'in', reconciled: true }),
    entry({ id: 'outstanding', date: '2025-09-20', amountCents: 900, direction: 'out', reconciled: false })
  ];
  const rec = reconcileTotals(led, book);
  eq(rec.cleared, 15000, 'ticked balance excludes the outstanding entry');
  eq(rec.ticked, 1, 'ticked count');
  eq(rec.open, 1, 'outstanding count');
  eq(rec.difference, 12000 - 15000, 'difference is statement minus ticked');
});

/* ---- Phase 1 migration: totals identical before and after ---- */

// normalizeState is the single migration seam, so the migration is tested through it
// rather than through a reimplementation of it.
const NORMALIZE_FNS = ['PROGRAM_MONTHS', 'PROGRAM_TURN', 'PROGRAM_START_MONTH',
  'defaultProgramYear', 'freshBudget', 'programYearStartISO',
  // DENS: the event coercion rebuilds `dens` in rank order against it.
  'DENS',
  'programYearEndISO', 'EVENT_KINDS', 'freshEvent', 'ADV_RENAMES', 'dateToSlot',
  'ATT_MAX_HEADS', 'attHeads', 'freshAttendance', 'attEmpty', 'attTotals',
  'centsOf', 'freshLine', 'LINE_BASES', 'LINE_FUNDERS', 'freshCamping',
  'LINE_CATEGORIES', 'LINE_CATEGORY_KEYS', 'CHARGE_WHO',
  'linePerHead', 'linePlannedHeads', 'linePlannedCents',
  'LEDGER_METHODS', 'LEDGER_SOURCES', 'LEDGER_SOURCE_LABELS',
  'freshBook', 'TE_LINEUP', 'freshInventory', 'JOBS', 'arrOf', 'jobsFromRoleText',
  // Camping — normalizeState seeds the two council trips when the key is absent.
  'CAMP_SAFETY', 'CAMP_AGES', 'CAMP_WHY_COUNCIL', 'CAMP_FIRST_TIME',
  'freshTripSection', 'freshTrip', 'seedCampingTrips', 'freshCamping',
  'CAMP_SEED_REV', 'CAMP_OLD_SEED', 'campHash', 'refreshCampingSeed',
  'densFromRoleText', 'normalizeSeasonArchive', 'uid', 'pad2', 'todayISO',
  'parseLegacyTime', 'migrateTierMakeUp', 'normalizeState', 'LEDGER_INCOME_SOURCES', 'entryIsRefund',
  'lineActualCents', 'entryRefundsFamily', 'entrySignedCents',
  // Wave 22 — normalizeState shape-checks storefront weather against WEATHER_TAGS and
  // defaults packLoc from WX_DEFAULT_LOC, so both have to be in the sandbox with it.
  'WEATHER_TAGS', 'WX_DEFAULT_LOC', 'numOrNull'];

function preMigrationState() {
  // A pre-Phase-0 pack record, with the two shapes that matter: a flat line and a
  // per-scout line (whose actualCents was a RATE multiplied by the roster on every read).
  return {
    version: 1, packName: 'Pack 569',
    scouts: [
      { id: 's1', name: 'Ben' }, { id: 's2', name: 'Ivy' }, { id: 's3', name: 'Mae' },
      { id: 's4', name: 'Gus', archived: true }   // archived scouts were never multiplied
    ],
    budget: {
      programYear: 2025, startingBalance: 42000,
      activities: [
        { id: 'a1', slot: 1, name: 'Fall campout', date: '2025-10-18', estCents: 80000, actualCents: 102000, perScout: false, familyPays: false },
        { id: 'a2', slot: 9, name: 'Cub day camp', date: '', estCents: 14500, actualCents: 14500, perScout: true, familyPays: true },
        { id: 'a3', slot: 3, name: 'Not paid for yet', date: '', estCents: 5000, actualCents: 0, perScout: false, familyPays: false }
      ],
      expenses: [
        { id: 'e1', name: 'Charter fee', estCents: 10000, actualCents: 10000, perScout: false, familyPays: false },
        { id: 'e2', name: 'Pack dues', estCents: 8000, actualCents: 2500, perScout: true, familyPays: true }
      ]
    }
  };
}

// What computeBudget used to produce for "actual": rate x roster for a per-scout line.
function legacyActualTotal(d) {
  const n = d.scouts.filter(s => !s.archived).length;
  const sum = rows => rows.reduce((t, x) => t + (x.actualCents || 0) * (x.perScout ? n : 1), 0);
  return sum(d.budget.activities) + sum(d.budget.expenses);
}

test('Phase 1 migration: actual totals are identical before and after', () => {
  // This is THE migration test named in DESIGN-money.md section 5. If it ever fails, a
  // pack's books moved on their own during an upgrade, which is unforgivable in a
  // financial record however small.
  const ctx = sandbox(NORMALIZE_FNS);
  const before = preMigrationState();
  const expected = legacyActualTotal(before);
  const after = ctx.normalizeState(before);
  ok(after, 'normalizeState rejected the record');
  const rows = after.budget.activities.concat(after.budget.expenses);
  const got = rows.reduce((t, x) => t + ctx.lineActualCents(after.ledger, x.id), 0);
  eq(got, expected, 'total actual across every line');
});

test('Phase 1 migration: a per-scout rate becomes a total, once', () => {
  const ctx = sandbox(NORMALIZE_FNS);
  const after = ctx.normalizeState(preMigrationState());
  // 3 active scouts (the archived one never counted), $145 each.
  eq(ctx.lineActualCents(after.ledger, 'a2'), 14500 * 3, 'day camp');
  eq(ctx.lineActualCents(after.ledger, 'e2'), 2500 * 3, 'dues');
  eq(ctx.lineActualCents(after.ledger, 'a1'), 102000, 'a flat line is not multiplied');
});

test('Phase 1 migration: actualCents is deleted and never migrated twice', () => {
  const ctx = sandbox(NORMALIZE_FNS);
  const once = ctx.normalizeState(preMigrationState());
  const n = once.ledger.length;
  ok(once.budget.activities.every(a => !('actualCents' in a)), 'actualCents survived on an activity');
  ok(once.budget.expenses.every(e => !('actualCents' in e)), 'actualCents survived on an expense');
  // The field's ABSENCE is the marker that migration has run. Re-normalizing (which happens
  // on every load, every import and every sync adoption) must add nothing.
  const twice = ctx.normalizeState(JSON.parse(JSON.stringify(once)));
  eq(twice.ledger.length, n, 'ledger grew on a second normalize');
});

test('Phase 1 migration: a zero actual writes no entry', () => {
  const ctx = sandbox(NORMALIZE_FNS);
  const after = ctx.normalizeState(preMigrationState());
  ok(!after.ledger.some(e => e.lineId === 'a3'), 'an unpaid line got a $0 ledger entry');
  eq(after.ledger.length, 4, 'one entry per line that had an actual');
});

test('Phase 1 migration: entries land on the line, dated, and unreconciled', () => {
  const ctx = sandbox(NORMALIZE_FNS);
  const after = ctx.normalizeState(preMigrationState());
  const campout = after.ledger.find(e => e.lineId === 'a1');
  eq(campout.date, '2025-10-18', "a dated line keeps the event's date");
  eq(campout.direction, 'out', 'direction');
  eq(campout.description, 'Fall campout', 'description');
  ok(after.ledger.every(e => e.reconciled === false),
    'migrated money was marked reconciled — it has never been held next to a statement');
  const undated = after.ledger.find(e => e.lineId === 'e1');
  ok(/^\d{4}-\d{2}-\d{2}$/.test(undated.date), 'an undated line got no date at all');
  ok(undated.date <= '2026-08-31' && undated.date >= '2025-09-01',
    `an undated line landed outside its program year (${undated.date})`);
});

test('Phase 0: the ledger and book survive normalization additively', () => {
  const ctx = sandbox(NORMALIZE_FNS);
  const d = preMigrationState();
  d.ledger = [{ id: 'k', date: '2025-09-09', description: 'Deposit', amountCents: -500,
    direction: 'in', lineId: 'a1', method: 'nonsense', source: 'donation',
    donor: 'St Marks', scoutId: 's1', reconciled: true }];
  d.book = { openingCents: 12345.6, openingDate: '2025-09-01' };
  const after = ctx.normalizeState(d);
  const k = after.ledger.find(e => e.id === 'k');
  eq(k.amountCents, 500, 'a stored negative is folded into direction');
  eq(k.method, '', 'an unknown method is dropped');
  eq(k.source, 'donation', 'a known source is kept');
  eq(k.scoutId, 's1', 'scoutId is carried through for Phase 3');
  eq(after.book.openingCents, 12346, 'the opening figure is rounded to whole cents');
  eq(after.book.reconciledThrough, '', 'missing book fields are defaulted');
});

test('actual is no longer a field a budget row can type into', () => {
  // Phase 1's contract: actual is derived. A stray input would silently reintroduce the
  // second source of truth this whole redesign exists to remove.
  ok(!/data-ch="act-actual"/.test(SCRIPT), 'the activity row still has an Actual input');
  ok(!/data-ch="exp-actual"/.test(SCRIPT), 'the expense row still has an Actual input');
  ok(!/ch === 'act-actual'/.test(SCRIPT), 'act-actual is still handled');
  ok(!/ch === 'exp-actual'/.test(SCRIPT), 'exp-actual is still handled');
  // computeBudget must read the ledger, and must NOT multiply actual by the roster.
  const fn = /function computeBudget\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'computeBudget() not found');
  ok(/var spent = lineActualCents\(state\.ledger, a\.id\);/.test(fn[0]), 'activity actual is not ledger-derived');
  ok(/var spentE = lineActualCents\(state\.ledger, e\.id\);/.test(fn[0]), 'expense actual is not ledger-derived');
  // A paid-direct line is out of the PLAN but its ledger entries are still money that left the
  // pack — a tier reimbursing a council fee posts exactly that, and dropping it would overstate
  // the balance by whatever was paid back.
  ok(/if \(!lineThroughPack\(a\)\) \{ familyDirect \+= linePlanned\(a\); actActual \+= spent; return; \}/.test(fn[0]),
    'money really paid out on a paid-direct line never reaches actual');
  ok(!/actualCents \|\| 0\) \* /.test(fn[0]), 'computeBudget still multiplies an actual by the roster');
});

test('the year rollover clears the ledger and opens next year at the bank balance', () => {
  // The old entries point at line ids that no longer exist after the re-seed, so leaving
  // them would strand every one of them as uncategorised.
  const fn = /function rolloverYear\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'rolloverYear() not found');
  ok(/state\.ledger = \[\]/.test(fn[0]), 'the ledger is carried into the new year');
  ok(/var closingBank = bookBalance\(\)/.test(fn[0]), 'the closing bank balance is not captured');
  ok(/closingBank/.test(fn[0]) && /openingCents = closingBank/.test(fn[0]),
    "next year's book does not open at the closing bank balance");
  // Phase 3a — a per-head line keeps its RATES rather than back-deriving them from a total
  // that depended on who happened to turn up; only flat lines seed from the ledger.
  ok(/if \(linePerHead\(x\)\) return;/.test(fn[0]),
    'a per-head line is having its rates re-derived from last year\u2019s total');
  ok(/state\.events\.push\(ev\)/.test(fn[0]),
    'the rollover does not rebuild the calendar — the plan would come back unscheduled');
});

test('a divergence merge never drops a ledger entry', () => {
  // The append-only merge is the recovery path when two copies of a pack record diverge.
  // Popcorn sales are protected there; transactions must be too.
  const fn = /function mergeRemoteAppendOnly\(d\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'mergeRemoteAppendOnly() not found');
  ok(/unionById\(state\.ledger, remote\.ledger\)/.test(fn[0]),
    'ledger entries are not unioned on merge — one device could lose another device\'s transactions');
});

test('a record holding only a ledger does not read as empty', () => {
  // isStateEmpty gates whether a remote copy is adopted wholesale. A treasurer who opens
  // the books before anyone types a roster must not have that work adopted away.
  const fn = /function isStateEmpty\(s\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'isStateEmpty() not found');
  ok(/s\.ledger && s\.ledger\.length/.test(fn[0]), 'isStateEmpty ignores the ledger');
});

/* ================================================================
   Next reward tier — owner ask, 2026-08-02: "a view somewhere that tracks and shows each
   scout's progress towards earning their next rewards tier."
   ================================================================ */

const tpCtx = (() => {
  const ctx = vm.createContext({});
  vm.runInContext(`
    ${slice('tierProgressRows')}
    ${slice('earnedTierFor')}
    ${slice('tierIsClosed')}
    var TIERS = [], MAP = {}, SCOUTS = [], COMM = 0, NO_RATE = false, NO_SALES = false;
    var TOTALS_CALLS = [];
    function sortedTiers() { return TIERS; }
    var PLANNED = null;
    function plannedTier() { return PLANNED; }
    function tierRateMissing() { return NO_RATE; }
    function tierEarnedMap() { return MAP; }
    function activeScouts() { return SCOUTS; }
    var COMBINED = {};
    function computeScoutTotals(k) {
      TOTALS_CALLS.push(k);
      var m = {};
      SCOUTS.forEach(function (s) { m[s.id] = { combined: COMBINED[s.id] || 0 }; });
      return m;
    }
    function scoutCommissionOf() { return COMM; }
    function salesForCommission(c) { return NO_SALES ? null : (c ? Math.ceil(c / 0.30) : null); }
    // Two rates, so the row carries the shape the card now renders: biggest (safest) first.
    function sellingRoutes(c) {
      if (NO_SALES || !c) return [];
      return [{ sell: true, label: 'at a storefront or wagon', pct: 30, cents: Math.ceil(c / 0.30) },
              { sell: true, label: 'online', pct: 35, cents: Math.ceil(c / 0.35) }];
    }
    function tierCumulativeCoverCents(t) { return t.cover || 0; }
    function tierCoverCentsPerScout(t) { return t.fee == null ? (t.cover || 0) : t.fee; }
    function packCoverage() { return {}; }   // the sibling rule's input; the stubs above ignore it
    ${slice('arrOf')}
    // Values a key set: each stub tier declares covers:['k'] and KEY_VALUE prices them, so the
    // set-difference behaviour can be tested without a budget.
    var KEY_VALUE = {};
    function coverValueOfKeys(keys) {
      var c = 0; Object.keys(keys).forEach(function (k) { c += KEY_VALUE[k] || 0; }); return c;
    }
    function todayISO() { return '2026-08-02'; }
  `, ctx);
  return ctx;
})();

function tp(opts) {
  Object.assign(tpCtx, {
    TIERS: opts.tiers, MAP: opts.map || {}, SCOUTS: opts.scouts,
    COMM: opts.comm == null ? 0 : opts.comm,
    NO_RATE: !!opts.noRate, NO_SALES: !!opts.noSales,
    KEY_VALUE: opts.keyValue || {},
    PLANNED: opts.planned || null,
    COMBINED: opts.combined || {}
  });
  tpCtx.TOTALS_CALLS = [];
  return tpCtx.tierProgressRows();
}
// Each tier covers a DISTINCT key, priced by TP_KEYS — so "what does reaching this add" is a set
// difference over keys rather than a subtraction of two running totals.
const TP_TIERS = [
  { id: 'b', name: 'Bronze', thresholdCents: 5000, covers: ['neck'], fee: 2000 },
  { id: 's', name: 'Silver', thresholdCents: 15000, covers: ['dues'], fee: 7500 },
  { id: 'g', name: 'Gold', thresholdCents: 30000, covers: ['camp'], fee: 10500, dueBy: '2026-11-30' },
  { id: 'p', name: 'Platinum', thresholdCents: 50000, covers: ['uniform'], fee: 10000, dueBy: '2026-07-01' }
];
const TP_KEYS = { neck: 2000, dues: 7500, camp: 10500, uniform: 10000 };
const TP_ONE = [{ id: 'a', name: 'Ada' }];

test('progress is measured toward the next tier a scout can still reach', () => {
  const [r] = tp({ tiers: TP_TIERS, scouts: TP_ONE, map: { b: { a: 'earned' } }, comm: 13160, keyValue: TP_KEYS });
  eq(r.earned.name, 'Bronze', 'the tier already earned');
  eq(r.next.name, 'Silver', 'the tier being worked toward');
  eq(r.short, 1840, 'the gap, in commission');
  eq(r.pct, 88, 'percent of the way there');
  // The one figure a family can act on — nobody sells commission.
  eq(r.shortSales, Math.ceil(1840 / 0.30), 'the gap said in popcorn');
  // What REACHING it adds: the dues key Silver brings, not the neckerchief Bronze already gave.
  eq(r.unlocks, 7500, 'the incremental value of the next tier');
});

test('the bar runs to the planned tier, with the rungs below it notched in', () => {
  // Owner ask, 2026-08-31. Measured rung by rung, a scout who has just cleared Bronze and a scout
  // two dollars off Gold both show a nearly empty bar — the column cannot be read down at all,
  // which is the one thing a bar is for. One denominator makes the lengths comparable.
  const planned = TP_TIERS[2];                       // Gold, $300 of commission
  const [r] = tp({ tiers: TP_TIERS, scouts: TP_ONE, map: { b: { a: 'earned' } }, comm: 13160,
    keyValue: TP_KEYS, planned });
  eq(r.anchor.name, 'Gold', 'the bar is anchored somewhere other than the planned tier');
  eq(r.anchorPct, 44, '$131.60 of a $300 planned tier is 44%');
  // Still chasing Silver — the rung ahead is unchanged, only the bar's denominator moved.
  eq(r.next.name, 'Silver', 'anchoring the bar moved which tier is next');
  // Notches: every rung BELOW the anchor. Gold is the end of the bar, not a checkpoint on it,
  // and Platinum sits off the end of it.
  eq(r.marks, [{ name: 'Bronze', pct: 17, plan: false }, { name: 'Silver', pct: 50, plan: false }],
    'the checkpoints are not the rungs below the planned tier');
  // On the plan scale the planned tier IS the end of the bar, so it is never one of the notches
  // and nothing is ever flagged. The flag only means something on the stretch scale.
  eq(r.planPct, null, 'a plan-scale row was handed a stretch boundary');
  eq(r.pastPlan, false, 'a scout below the plan was put in the stretch cohort');
});

test('a scout past the planned tier is measured to the top rung instead', () => {
  // Owner ask, 2026-08-31. Pinned to the planned tier, a scout who cleared it read a full bar and
  // 100% for the rest of the season however much more they sold, and the rungs above the plan had
  // no notch to pass. Same track, rescaled: the plan stays filled, the rest fills beyond it.
  const planned = TP_TIERS[1];                       // Silver, $150; top is Platinum, $500
  const [r] = tp({ tiers: TP_TIERS, scouts: TP_ONE, map: { b: { a: 'earned' }, s: { a: 'earned' } },
    comm: 20000, keyValue: TP_KEYS, planned });
  eq(r.pastPlan, true, 'a scout past the plan is still on the plan scale');
  eq(r.anchor.name, 'Platinum', 'the bar is not rescaled to the top rung');
  eq(r.anchorPct, 40, '$200 of a $500 top rung is 40%');
  eq(r.planPct, 30, 'the plan boundary is not at $150 of $500');
  ok(r.planPct <= r.anchorPct, 'the stretch segment would be drawn with a negative width');
  // Every rung below the top is notched on this scale, and the planned one is flagged so the
  // renderers can draw the boundary between the two fills heavier than an ordinary notch.
  eq(r.marks, [{ name: 'Bronze', pct: 10, plan: false },
               { name: 'Silver', pct: 30, plan: true },
               { name: 'Gold', pct: 60, plan: false }],
    'the stretch scale does not notch every rung below the top, or does not flag the plan');
  // The plan is done; the ladder is not. Those stay different questions.
  ok(r.next && r.next.name === 'Gold', 'a scout past the plan is treated as finished');
  ok(r.short > 0, 'a scout with a rung ahead of them is shown no gap');
});

test('a make-up payment does not put a scout on the stretch scale', () => {
  // earnedTierFor counts a tier credited by a make-up payment, so such a scout HOLDS the planned
  // tier while their commission sits below its threshold. Anchoring them to the top rung would
  // put anchorPct below planPct and hand the renderer a negative-width segment. `pastPlan` is
  // measured on `base` for exactly this reason.
  const planned = TP_TIERS[1];                       // Silver, $150
  const [r] = tp({ tiers: TP_TIERS, scouts: TP_ONE, map: { b: { a: 'earned' }, s: { a: 'madeUp' } },
    comm: 9000, keyValue: TP_KEYS, planned });       // $90 earned — below Silver
  eq(r.earned.name, 'Silver', 'the make-up credit was lost');
  eq(r.pastPlan, false, 'a scout who paid rather than sold was put on the stretch scale');
  eq(r.planPct, null, 'a plan-scale row was handed a stretch boundary');
  eq(r.anchor.name, 'Silver', 'the bar was rescaled for a scout who did not sell past the plan');
});

test('no rung above the plan means no second scale at all', () => {
  // Planning on the TOP tier, and planning on nothing, both have to fall through to exactly the
  // single-scale bar the card drew before any of this.
  const onTop = tp({ tiers: TP_TIERS, scouts: TP_ONE, comm: 60000, keyValue: TP_KEYS,
    planned: TP_TIERS[3] })[0];                      // Platinum is the top rung
  eq(onTop.ladder.stretchOn, false, 'a stretch cohort was invented above the top rung');
  eq(onTop.pastPlan, false, 'a scout was put on a scale that does not exist');
  eq(onTop.planPct, null, 'a plan boundary was published with nothing beyond it');
  const none = tp({ tiers: TP_TIERS, scouts: TP_ONE, comm: 60000, keyValue: TP_KEYS })[0];
  eq(none.ladder.stretchOn, false, 'a stretch cohort appeared with no tier planned on');
  eq(none.anchor.name, 'Platinum', 'the fallback anchor is not the top rung');
});

test('with no tier planned on, a full bar is the top of the ladder', () => {
  // A bar has to mean something. "Everything there is" is the only other honest answer, and the
  // card names which one is in force rather than leaving a reader to guess.
  const [r] = tp({ tiers: TP_TIERS, scouts: TP_ONE, comm: 25000, keyValue: TP_KEYS });
  eq(r.anchor.name, 'Platinum', 'the fallback anchor is not the top rung');
  eq(r.anchorPct, 50, '$250 of a $500 top rung is 50%');
  eq(r.marks.map((m) => m.name), ['Bronze', 'Silver', 'Gold'], 'the lower rungs are not notched');
  const card = /function renderTierProgress\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  ok(/A full bar is <strong>/.test(card), 'the card never says what a full bar means');
  ok(/no tier is planned on yet/.test(card), 'the fallback anchor is presented as the planned tier');
  // The bar and the percentage beside it read off the same figure, or they contradict each other.
  // The bar's fill is still anchorPct, and the tail still carries anchorPct — but the tail now
  // NAMES it, because since 2026-08-31 it prints the next rung's percentage beside it and one
  // unlabelled figure could only ever have been one of the two.
  ok(/\(r\.planPct == null \? r\.anchorPct : r\.planPct\) \+ '%"/.test(card) &&
     /'<span class="tprog-pct">' \+ tierPctLabel\(r\)/.test(card),
    'the bar and its percentage are measured differently');
  const lbl = /function tierPctLabel\(r\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(lbl && /r\.anchorPct \+ '% of ' \+ esc\(anchorName\)/.test(lbl[0]),
    'the ladder half of the tail is measured against something other than the bar');
  // On the plan scale there is one fill and it runs to anchorPct, exactly as before.
  ok(/r\.planPct == null\s*\n?\s*\? ''/.test(card), 'a plan-scale row is drawn with a stretch segment');
});

test('a ladder with nothing to measure against draws no bar at all', () => {
  // A single tier at nought, or a threshold of nought: dividing by it would be Infinity, and an
  // empty track next to a scout who has done everything asked of them is a lie told by geometry.
  const [r] = tp({ tiers: [{ id: 'z', name: 'Free', thresholdCents: 0, covers: [] }],
    scouts: TP_ONE, comm: 5000 });
  eq(r.anchorPct, null, 'a bar was drawn against a threshold of nought');
  const card = /function renderTierProgress\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  ok(/r\.anchorPct == null\s*\n?\s*\? ''/.test(card), 'the bar is drawn even with nothing to measure');
});

test('a tier that covers what a scout already has adds nothing', () => {
  // Two tiers pointed at the same line is legal — Bronze and Silver both covering dues, say.
  // packCoverage unions the keys, so the second one covers nothing extra. Subtracting cumulative
  // per-tier totals (which is how tierBreakEven works, correctly, for its own question) would
  // have reported the second tier as worth another full fee.
  const overlap = [
    { id: 'b', name: 'Bronze', thresholdCents: 5000, covers: ['dues'], fee: 4000 },
    { id: 's', name: 'Silver', thresholdCents: 15000, covers: ['dues'], fee: 4000 }
  ];
  const [r] = tp({ tiers: overlap, scouts: TP_ONE, map: { b: { a: 'earned' } }, comm: 6000,
    keyValue: { dues: 4000 } });
  eq(r.next.name, 'Silver', 'the next tier');
  eq(r.unlocks, 0, 'reaching a tier that re-covers the same line is reported as worth another fee');
  // ...and a tier that adds something on top counts only the addition.
  const partial = [
    { id: 'b', name: 'Bronze', thresholdCents: 5000, covers: ['dues'], fee: 4000 },
    { id: 's', name: 'Silver', thresholdCents: 15000, covers: ['dues', 'camp'], fee: 9000 }
  ];
  const [r2] = tp({ tiers: partial, scouts: TP_ONE, map: { b: { a: 'earned' } }, comm: 6000,
    keyValue: { dues: 4000, camp: 5000 } });
  eq(r2.unlocks, 5000, 'only the newly covered share should count');
});

test('a CLOSED tier is never the next tier, and saying so is not the same as finishing', () => {
  // Platinum's deadline passed on 2026-07-01. Telling a family to chase it would be a lie, and
  // reporting Gold as the ceiling would be a different lie — they ran out of time, they did not
  // top the ladder.
  const [r] = tp({ tiers: TP_TIERS, scouts: TP_ONE,
    map: { b: { a: 'earned' }, s: { a: 'earned' }, g: { a: 'earned' } }, comm: 31000 });
  eq(r.next, null, 'a closed tier is being offered as reachable');
  eq(r.closedAhead, true, 'the closed tier above is not reported');
  eq(r.short, 0, 'a scout with no reachable tier has no gap');
  eq(r.pct, 100, 'the bar is not full for a scout with nothing left to reach');
});

test('a tier credited by a make-up payment is behind them, not ahead', () => {
  // tierEarnedMap marks these 'madeUp' rather than 'earned'. Either way the tier is settled, so
  // offering it as the next target would ask a family to buy something they already have.
  // This is carried by earnedTierFor (which honours any mark) plus the ascending threshold walk —
  // there is deliberately no separate check, because one was unreachable. Pinning the BEHAVIOUR
  // rather than the mechanism is what lets that stay true.
  const [r] = tp({ tiers: TP_TIERS, scouts: TP_ONE,
    map: { b: { a: 'earned' }, s: { a: 'madeUp' } }, comm: 6000 });
  eq(r.next.name, 'Gold', 'a made-up tier is being offered again');
});

test('the card refuses to guess when tiers cannot be measured', () => {
  // With no commission rate anywhere there is no way to turn what a scout brought in into what
  // the pack earned. Showing every scout at zero would report a rate problem as a sales problem.
  eq(tp({ tiers: TP_TIERS, scouts: TP_ONE, noRate: true }).length, 0, 'rows are built with no rate');
  eq(tp({ tiers: [], scouts: TP_ONE }).length, 0, 'rows are built with no tiers');
  // A missing GOAL rate is different: the commission gap is still true, so the row survives and
  // only the popcorn figure is withheld rather than invented.
  const [r] = tp({ tiers: TP_TIERS, scouts: TP_ONE, comm: 0, noSales: true });
  ok(r, 'the row disappears when only the sales conversion is unavailable');
  eq(r.shortSales, null, 'a sales figure was invented with no goal rate');
  eq(r.short, 5000, 'the commission gap is still reported');
});

/* ========================================================================
   A rung you have not reached yet is exactly the thing to look at — 2026-08-31
   ===================================================================== */

// Owner, on the bar shipped in ea1ffc2: "you can't see where the lower tier notches are until a
// scout actually passes it", and "you can no longer tell what a scout needs, or how close they are
// to their next tier."

test('a notch is a gap behind the fill and a mark ahead of it', () => {
  const ctx = sandbox(['tickClass']);
  const row = { anchorPct: 44, nextMarkPct: 50 };
  eq(ctx.tickClass({ pct: 17, plan: false }, row), 'tprog-tick',
    'a rung already passed is drawn as something other than a gap in the fill');
  eq(ctx.tickClass({ pct: 50, plan: false }, row), 'tprog-tick ahead is-next',
    'the rung being chased is not marked, or not marked as ahead');
  eq(ctx.tickClass({ pct: 80, plan: false }, row), 'tprog-tick ahead',
    'a rung further ahead is invisible on the empty track');
  // Exactly at the fill edge counts as passed — the fill is drawn over it either way.
  eq(ctx.tickClass({ pct: 44, plan: false }, row), 'tprog-tick', 'a notch under the fill edge is inked');
  // The plan notch keeps its own class alone. It only exists on a bar whose scout is already past
  // the plan, which puts it behind the fill, so it can never also be `ahead`.
  eq(ctx.tickClass({ pct: 30, plan: true }, { anchorPct: 40, nextMarkPct: 60 }), 'tprog-tick is-plan',
    'the plan boundary gained a treatment that fights the pale gap it is meant to be');
  // No next rung to chase, and nothing is singled out.
  eq(ctx.tickClass({ pct: 50, plan: false }, { anchorPct: 44, nextMarkPct: null }), 'tprog-tick ahead',
    'a rung is marked as the target when there is no target');
});

test('the next rung is never marked off the end of the bar', () => {
  // The make-up case, and the only way nextMarkPct can go wrong: a payment credits the planned
  // tier while `base` sits below it, so `next` is the rung ABOVE the anchor and its honest
  // position is 200%. A notch there would sit outside the track.
  const planned = TP_TIERS[1];                       // Silver $150; next would be Gold $300
  const [r] = tp({ tiers: TP_TIERS, scouts: TP_ONE, map: { b: { a: 'earned' }, s: { a: 'madeUp' } },
    comm: 9000, keyValue: TP_KEYS, planned });
  eq(r.anchor.name, 'Silver', 'the anchor moved for a scout who did not sell past the plan');
  eq(r.next.name, 'Gold', 'the rung ahead of a made-up tier is wrong');
  eq(r.nextMarkPct, null, 'a notch was placed past the end of the bar');
  // The ordinary case still gets a position.
  const [ok2] = tp({ tiers: TP_TIERS, scouts: TP_ONE, map: { b: { a: 'earned' } }, comm: 13160,
    keyValue: TP_KEYS, planned: TP_TIERS[2] });      // Gold $300 planned, Silver $150 next
  eq(ok2.nextMarkPct, 50, 'the next rung is not placed at its share of the anchor');
  eq(ok2.pct, 88, 'the distance to the next rung is wrong');
  // And it lands exactly on that rung's own notch, or the renderer marks the wrong one.
  ok(ok2.marks.some((m) => m.pct === ok2.nextMarkPct && m.name === 'Silver'),
    'the marked position does not coincide with the next rung’s notch');
});

test('the row prints one percentage when the rungs agree and two when they differ', () => {
  const ctx = sandbox(['esc', 'tierPctLabel']);
  const GOLD = { id: 'g', name: 'Gold' }, SILVER = { id: 's', name: 'Silver' };
  // The common case — heading straight for the tier the bar ends at. One figure; two identical
  // ones side by side would read as a mistake.
  eq(ctx.tierPctLabel({ anchor: SILVER, next: SILVER, pct: 70, anchorPct: 70 }), '70% to Silver',
    'a scout heading straight for the anchor is given the same figure twice');
  // A nearer rung than the anchor: both, each naming its own, the actionable one first.
  const split = ctx.tierPctLabel({ anchor: GOLD, next: SILVER, pct: 88, anchorPct: 44 });
  ok(/^88% to Silver/.test(split), 'the row does not lead with the rung being chased');
  ok(/44% of Gold/.test(split), 'the ladder reading lost the rung it is measured against');
  ok(split.indexOf('88% to Silver') < split.indexOf('44% of Gold'),
    'the ladder figure is printed ahead of the actionable one');
  // Top of the ladder: nothing to chase, so only the ladder reading, and it still names its rung.
  eq(ctx.tierPctLabel({ anchor: GOLD, next: null, anchorPct: 100 }),
    '<span class="muted">100% of Gold</span>', 'a finished scout is told they are 100% of nothing');
  // A tier name is escaped like everything else a leader typed.
  ok(/&lt;b&gt;/.test(ctx.tierPctLabel({ anchor: GOLD, next: { id: 'x', name: '<b>' }, pct: 5, anchorPct: 2 })),
    'a tier name goes into the row unescaped');
});

test('the standings row carries no deadline, and the deadline is still enforced', () => {
  // Owner, 2026-08-31: "we do not need the due by date on the standings." It is a property of the
  // TIER, not of the scout, so it repeated identically down every row chasing the same rung — and
  // it was the longest segment on the line.
  const card = /function renderTierProgress\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(card, 'renderTierProgress() not found');
  // codeOnly, because the ⚠ comment recording this ruling names the very field it forbids —
  // the same trap the absence assertions over buildParentView are built around.
  ok(!/dueBy/.test(codeOnly(card[0])), 'the deadline is back on the standings row');
  // ⚠ Dropped from THIS card only. It still has to reach a leader somewhere, and it still has to
  // decide who earned what — removing the display must not have quietly removed the rule.
  ok(/t\.dueBy \|\| ''/.test(/function tierEarnedMap\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0]),
    'tiers are no longer measured against their own deadline');
  ok(/tierDeadlineText\(t\)/.test(/function renderRewardTiers\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0]),
    'the rung itself no longer states its deadline on Popcorn · Rewards');
  ok(/dueBy \? esc\(fmtDate\(String\(t\.dueBy\)\)\) : '<span class="muted">any time/.test(SCRIPT),
    'the family ladder card lost its By column');
  ok(/dueBy: String\(t\.dueBy \|\| ''\)/.test(SCRIPT), 'the deadline is no longer published to families');
  // The printout is the family page now, and its ladder card keeps the By column — asserted just
  // above. There is no separate handout left to check.
});

test('the three notch treatments are three treatments, not three shades of one', () => {
  // No single colour survives all three backgrounds a notch lands on, and the failures are exactly
  // complementary: against the empty track / gold fill / stretch fill in light, --surface-2 is
  // 1.00 / 4.77 / 5.19 and --ink-soft is 4.60 / 1.04 / 1.13. So the notch is painted for the
  // ground it lands on, which anchorPct always tells us.
  ok(/\.tprog-tick \{[^}]*background: var\(--surface-2\)/.test(SCRIPT_CSS),
    'a notch behind the fill no longer reads as a gap in it');
  ok(/\.tprog-tick\.ahead \{[^}]*background: var\(--ink-soft\)/.test(SCRIPT_CSS),
    'a notch ahead of the fill is invisible on the empty track again');
  ok(/\.tprog-tick\.is-next \{[^}]*background: var\(--ink\)/.test(SCRIPT_CSS),
    'the rung being chased is not the strongest mark on the bar');
  ok(/\.tprog-tick\.is-next \{[^}]*width: 3px/.test(SCRIPT_CSS), 'the next rung is not drawn wider');
  // ⚠ --ink-soft and --ink are the two that clear 3:1 on the TRACK. --surface-2 there is 1.00:1,
  // which is the whole bug; anything painting an `ahead` notch in a surface token restores it.
  ok(!/\.tprog-tick\.ahead \{[^}]*var\(--surface/.test(SCRIPT_CSS),
    'a notch ahead of the fill is painted in a track colour, which is invisible on the track');
  // Both legends describe all three states — a mark nobody can name is decoration.
  // (The parent legend says it in a family's words since 2026-09-28 — "the darkest mark is the one
  // your scout is working toward next", "a light gap in the filled part" — so it is checked apart.)
  const pstand = slice('renderParentStandings');
  ok(/marks along the bar/.test(pstand) && /darkest mark is the one your scout is working toward next/.test(pstand) &&
    /light gap in the filled part/.test(pstand), 'renderParentStandings does not say what the three notch states mean');
  for (const fn of ['renderTierProgress']) {
    const src = new RegExp(`function ${fn}\\(\\w*\\) \\{[\\s\\S]*?\\n  \\}`).exec(SCRIPT);
    ok(src, `${fn}() not found`);
    ok(/gap<\/strong>/.test(src[0]) && /mark<\/strong>/.test(src[0]) && /chasing/.test(src[0]),
      `${fn} does not say what the three notch states mean`);
    // ⚠ NOT "pale" and "dark". --ink is #22303F in light and #ECE5D3 in dark, so a notch ahead of
    // the fill is dark on one theme and light on the other — the words were literally backwards
    // half the time. What IS true in every theme is that a passed rung reads as a gap in the fill
    // and one ahead reads as a mark on the track.
    ok(!/\bpale\b/.test(src[0]) && !/\bdark(est)?\b/.test(src[0]),
      `${fn} names a lightness that inverts between themes`);
    // Two WIDE notches exist now — the plan gap and the next-rung mark. "the heavy notch" no
    // longer identifies either of them.
    ok(!/the heavy notch/.test(src[0]), `${fn} still calls the plan boundary "the heavy notch"`);
  }
});

test('rows are ordered by what a scout has brought in, exactly as the family board is', () => {
  // Owner ask, 2026-08-31. It was closest-to-the-next-rung first, which made this card and the
  // family-facing board list the same scouts in two different orders — a leader reading one while
  // a parent read the other had to re-find every child.
  const scouts = [{ id: 'far', name: 'Far' }, { id: 'done', name: 'Done' }, { id: 'near', name: 'Near' }];
  const rows = tp({
    tiers: TP_TIERS, scouts,
    map: { b: { far: 'earned', near: 'earned', done: 'earned' },
           s: { near: 'earned', done: 'earned' },
           g: { done: 'earned' } },
    comm: 14000,
    combined: { far: 20000, done: 90000, near: 50000 }
  });
  eq(rows.map((r) => r.scout.name), ['Done', 'Near', 'Far'], 'the board is not ordered by what came in');
  eq(rows.map((r) => r.combined), [90000, 50000, 20000], 'the row does not carry the figure it is sorted on');
  // Same tiebreak as rankBy(), so no two rows swap places between renders.
  const tied = tp({
    tiers: TP_TIERS, scouts: [{ id: 'b', name: 'Bo' }, { id: 'a', name: 'Al' }],
    comm: 0, combined: { a: 5000, b: 5000 }
  });
  eq(tied.map((r) => r.scout.name), ['Al', 'Bo'], 'equal totals do not fall back to the name');
  // Unfiltered by any tier deadline — it is what they have brought in, not what counted toward
  // a rung that closed in November.
  const fn = /function tierProgressRows\(\w*\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(/combined: \(totalsFor\(''\)\[s\.id\] \|\| \{\}\)\.combined/.test(fn[0]),
    'the sort figure is measured against a deadline');
});

test('the tier-progress rows never recompute what "earned" means', () => {
  // tierEarnedMap's own comment: ONE map read by coverage, the waivers, the badges and the
  // deadline report, "so those four can never disagree about who earned what". This is the fifth
  // reader. A private threshold comparison here would let this card promise a tier the budget
  // does not waive fees for.
  const fn = /function tierProgressRows\(\w*\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'tierProgressRows() not found');
  ok(/tierEarnedMap\(\)/.test(fn[0]), 'it no longer reads the shared earned map');
  ok(/earnedTierFor\(/.test(fn[0]), 'it no longer uses the shared "highest tier reached" helper');
  ok(/tierIsClosed\(/.test(fn[0]), 'a closed tier can be offered as reachable again');
  // activeScouts, matching every other tier function — visibleScoutRows deliberately keeps an
  // archived scout who has sales, and history is not a future tier.
  ok(/activeScouts\(\)/.test(fn[0]), 'it no longer walks the active roster');
  ok(!/visibleScoutRows/.test(fn[0]), 'archived scouts are being offered future tiers');
  // Sorts what .map() just built. Sorting a stored array would reorder the saved record.
  ok(/\}\)\.sort\(function/.test(fn[0]), 'the sort is no longer applied to a freshly built array');
  ok(!/state\.scouts\.sort/.test(fn[0]), 'it sorts the stored roster in place');
});

test('a scout can cover the remaining cost out of pocket, at the capped amount', () => {
  // Owner ask, 2026-08-02. The mechanism already existed but was reachable only after a deadline.
  const rows = tp({ tiers: [{ id: 'b', name: 'Bronze', thresholdCents: 5000, cover: 2000, fee: 2000 }],
    scouts: TP_ONE, map: {}, comm: 4000 });
  eq(rows[0].short, 1000, 'the gap');
  eq(rows[0].makeup, 1000, 'the gap is payable when it is below the fee');
  // Capped at the fee: a scout $50 short of a tier that saves them $20 pays $20, not $50.
  const capped = tp({ tiers: [{ id: 'b', name: 'Bronze', thresholdCents: 5000, cover: 2000, fee: 2000 }],
    scouts: TP_ONE, map: {}, comm: 0 });
  eq(capped[0].short, 5000, 'the gap is the whole threshold');
  eq(capped[0].makeup, 2000, 'the makeup is not capped at the fee the tier buys');
  // A prize-only tier picks up no cost, so there is nothing to pay and no button to show.
  const prize = tp({ tiers: [{ id: 'b', name: 'Bronze', thresholdCents: 5000, cover: 0, fee: 0 }],
    scouts: TP_ONE, map: {}, comm: 0 });
  eq(prize[0].makeup, 0, 'a prize-only tier is offering something to pay for');
  // A scout with nothing ahead of them has nothing to buy.
  const done = tp({ tiers: TP_TIERS, scouts: TP_ONE,
    map: { b: { a: 'earned' }, s: { a: 'earned' }, g: { a: 'earned' } }, comm: 31000 });
  eq(done[0].makeup, 0, 'a scout at the ceiling is offered a payment');
});

test('the amount on the button is the amount written to the ledger', () => {
  // Two code paths compute it — the card, and the handler recomputing from tierShortfallRows on
  // click. If they ever disagree the button becomes a lie about a real payment, so both must be
  // the same expression over the same inputs.
  const prog = /function tierProgressRows\(\w*\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  const shortfall = /function tierShortfallRows\(t, map\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  ok(/makeup: next \? Math\.min\(short, cover\) : 0/.test(prog), 'the card no longer caps at the fee');
  ok(/makeup: Math\.min\(short, cover\)/.test(shortfall), 'the handler path no longer caps at the fee');
  // Both derive `short` the same way, from the same date basis.
  ok(/Math\.max\(0, need - base\)/.test(prog) || /Math\.max\(0, \(next\.thresholdCents \|\| 0\) - base\)/.test(prog),
    'the card computes the gap differently');
  ok(/Math\.max\(0, \(t\.thresholdCents \|\| 0\) - base\)/.test(shortfall), 'the handler path computes the gap differently');
  ok(/scoutCommissionOf\(/.test(prog) && /scoutCommissionOf\(/.test(shortfall),
    'one path measures commission and the other does not');
  // And the button carries the tier the card says is next, not some other tier. Built by
  // makeupBtn() since 2026-09-04 — the markup moved, the targeting did not.
  const card = /function renderTierProgress\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  ok(/makeupBtn\(\{\s*\n?\s*tierId: r\.next\.id, scoutId: r\.scout\.id/.test(card),
    'the pay button targets something other than the next tier and this scout');
  // Anchored to the BUTTON's own condition. A bare /r\.makeup > 0/ also matches the lead-in
  // paragraph's rows.some(...) check, so it passed while the button itself was ungated.
  ok(/\(r\.makeup > 0 && r\.unlocks > 0\s*\n?\s*\? makeupBtn\(\{/.test(card),
    'the button shows even when there is nothing to pay, or nothing to gain');
  // .tprog-pay survives the armed state, or the confirming tap — the one that actually spends
  // the money — drops from a 36px target to .btn.small's 32px.
  ok(/keep: 'tprog-pay'/.test(card), 'the armed pay button loses its 36px tap target');
  // Both halves matter. makeup>0 alone would offer a payment for a tier that re-covers a line the
  // scout already holds — the cap is justified as "the fee the tier saves you", so where it saves
  // nothing the amount is arbitrary.
  ok(/r\.unlocks > 0/.test(card), 'a tier that adds no coverage can be sold again');
  // It spends a family's money, so it takes the 36px floor rather than .btn.small's 32px.
  // The SELECTOR is the assertion, not just the declaration: `.btn.small` sets 32px at (0,2,0),
  // so a bare `.tprog-pay` rule at (0,1,0) loses and the button renders 32px while the stylesheet
  // claims 36. Measured in a browser to confirm; pinned here so it cannot silently regress.
  ok(/\.btn\.small\.tprog-pay \{[^}]*min-height: 36px/.test(SCRIPT_CSS),
    'the pay button rule no longer outranks .btn.small, so it is back to a 32px target');
});

test('paying the difference is money and a decision, and undo keeps the money', () => {
  // Re-pinned from the progress card's side: the handler is shared, so the new entry point must
  // not have introduced a second writer of tier credit. There is now exactly ONE — the stamp on
  // the ledger entry — and the count is of anything that stores a mark of its own.
  const writers = (SCRIPT.match(/\.madeUp = /g) || []).length;
  eq(writers, 0, 'tier credit is being stored again instead of derived from the payment');
  eq((SCRIPT.match(/tierMakeup: mkT\.id/g) || []).length, 1, 'more than one place grants tier credit');
  const mk = /if \(act\.indexOf\('tier-makeup:'\) === 0\) \{[\s\S]*?\n    \}/.exec(SCRIPT)[0];
  ok(/tierShortfallRows\(mkT\)/.test(mk), 'the handler no longer validates against the shared shortfall');
  ok(/if \(!mkRow \|\| mkRow\.makeup <= 0\) return;/.test(mk),
    'the handler would charge a scout who owes nothing');
  const un = /if \(act\.indexOf\('tier-unmakeup:'\) === 0\) \{[\s\S]*?\n    \}/.exec(SCRIPT)[0];
  ok(!/state\.ledger = state\.ledger\.filter/.test(un), 'undo deletes the payment');
  ok(/arm\(act,/.test(un), 'undo is a single tap');
});

test('a bought tier says so on the board, and can be taken back there', () => {
  // Owner report, 2026-09-04: "the ranking bar and text for that scout does not reset". A tier
  // credited by a payment sits at the same height on the bar as one that was sold for, so a row
  // that suddenly reads Gold had nothing on screen saying why — and the undo lived one tab away
  // on Popcorn · Rewards, findable only if you already knew it was there.
  const card = /function renderTierProgress\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  ok(/r\.earnedBy === 'madeUp' && r\.earned/.test(card), 'the row does not say how the tier was credited');
  ok(/paid for, not sold/.test(card), 'a bought tier reads exactly like one that was sold for');
  ok(/tinyDangerBtn\('tier-unmakeup:' \+ r\.earned\.id \+ ':' \+ r\.scout\.id/.test(card),
    'there is no way back from the board the credit shows on');
  // …and it comes off the shared map, not off a second calculation of its own.
  const rows = /function tierProgressRows\(\w*\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  ok(/earnedBy: earned \? \(\(map\[earned\.id\] \|\| \{\}\)\[s\.id\] \|\| ''\) : '',/.test(rows),
    'the row works out how a tier was credited on its own instead of reading the shared map');
  // The explanation has to outlive the offer: gated on `makeup` alone the paragraph vanished the
  // moment the last family paid, which is when somebody starts looking for the way out.
  ok(/\(r\.makeup > 0 && r\.unlocks > 0\) \|\| r\.earnedBy === 'madeUp'/.test(card),
    'the make-up explanation disappears once every family has paid');
  // Popcorn · Rewards lists the same scouts off the same map rather than a stored list.
  const rewards = /function renderRewardTiers\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  ok(/madeSet\[sid\] === 'madeUp'/.test(rewards), 'the Rewards card reads a stored list of who paid');
  ok(/tierMakeupPaidCents\(t\.id, s\.id\)/.test(rewards), 'it does not report what the family actually paid');
});

test('the tier-progress card states each reason it can say nothing', () => {
  const fn = /function renderTierProgress\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'renderTierProgress() not found');
  ok(/No reward tiers set yet/.test(fn[0]), 'no tiers is not explained');
  ok(/no commission rate set/.test(fn[0]), 'a missing rate is not explained');
  ok(/No active scouts/.test(fn[0]), 'an empty roster is not explained');
  // Owner ask, 2026-08-31: the card talks in SELLING. A tier is still defined in commission —
  // Popcorn · Rewards sets it there and the budget counts it there — but nobody sells commission,
  // and making a leader do that conversion on a phone call was the complication being removed.
  ok(/still has to ' \+\s*'<strong>sell<\/strong>/.test(fn[0]) || /has to <strong>sell<\/strong>/.test(fn[0]),
    'the card no longer says its figures are what a scout has to sell');
  ok(!/earned ' \+ fmt\(r\.base\) \+ ' of ' \+ fmt\(r\.need\) \+ '<\/span>/.test(fn[0]),
    'the commission running total is back on every row');
  // Each rate spelled out, so a scout can pick the cheaper road rather than being handed one number.
  ok(/r\.sellRoutes\.forEach\(routeSeg\)/.test(fn[0]), 'the card shows a single rate instead of each one');
  ok(/esc\(String\(rt\.pct\)\) \+ '%\)/.test(fn[0]), 'the rates are unnamed, so the two figures look arbitrary');
  ok(/Ordered by <strong>what they have brought in<\/strong>, same as the family board/.test(fn[0]),
    'the row order is unlabelled, so it reads as random');
  // Reuses the shared segment idiom rather than a private copy that can drift.
  ok(/class="bseg"/.test(fn[0]), 'the meta line no longer uses the shared .bseg segments');
  // The bar restates the percentage already in the text, so it must not be announced twice.
  ok(/<div class="bar tprog-bar" aria-hidden="true">/.test(fn[0]),
    'the progress bar is not hidden from screen readers');
  // The fill has to be visible against its own track in BOTH themes. --accent on --surface-2 is
  // 2.54:1 in light, under the 3:1 non-text floor — a progress bar you cannot read the length of.
  ok(/\.bar-fill \{[^}]*background: var\(--accent-text\)/.test(SCRIPT_CSS),
    'the bar fill is back on --accent, which is 2.54:1 on its own track in light mode');
  // It is on Popcorn · Standings, above the leaderboards.
  const rt = /function renderTotals\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(rt && /renderTierProgress\(\)/.test(rt[0]), 'the card is not rendered on Standings');
  const at = rt[0].indexOf('renderTierProgress()');
  const boards = rt[0].indexOf('Trail’s End standings');
  ok(at > -1 && boards > -1 && at < boards, 'the card is no longer above the leaderboards');
});

/* ================================================================
   Trail's End shift import — owner, 2026-08-02: "I just tried to import this file, but since the
   storefronts already exist, nothing got imported. What I want is for the shifts to populate from
   the report if they are not already set."
   ================================================================ */

const shiftCtx = (() => {
  const ctx = vm.createContext({});
  vm.runInContext(['detectReport', 'mapShiftReport', 'teParseShiftTime', 'teShiftMinutes',
    'teStorefrontKey', 'teMissingShifts', 'parseLegacyTime', 'pad2'].map(slice).join('\n'), ctx);
  return ctx;
})();
// The real report's shape: a row per SCOUT, so a shift two scouts signed up for appears twice.
const SHIFT_ROWS = [
  ['Master Shift Report'],
  ['Date', 'Site Name', 'Address Line 1', 'Shift', 'Scout Name'],
  ['2026-08-23', 'Kroger', '100 Main St', '10:00 AM - 12:00 PM US/Eastern', 'Beckett H'],
  ['2026-08-23', 'Kroger', '100 Main St', '10:00 AM - 12:00 PM US/Eastern', 'Piper H'],
  ['2026-08-23', 'Kroger', '100 Main St', '12:00 PM - 02:00 PM US/Eastern', 'Lorenzo K'],
  ['2026-08-29', 'Kroger', '200 Oak Ave', '10:00 AM - 12:00 PM US/Eastern', ''],
];

test('one block per SHIFT, not one per scout who signed up for it', () => {
  // The report prints a row per scout. Two sign-ups on one slot is not two shifts, and this used
  // to emit the 10:00 AM slot twice — two identical blocks on the schedule, every import.
  const mapped = shiftCtx.mapShiftReport(SHIFT_ROWS, shiftCtx.detectReport(SHIFT_ROWS));
  const first = mapped.storefronts[0];
  eq(first.shifts.map((s) => s.start), ['10:00 AM', '12:00 PM'], 'a shift was duplicated per scout');
  eq(mapped.totalShifts, 3, 'the shift count double-counts a shared slot');
  // Same site at two addresses is still disambiguated by address.
  eq(mapped.storefronts.map((sf) => sf.name),
    ['Kroger – 100 Main St', 'Kroger – 200 Oak Ave'], 'two addresses were merged');
});

test('an existing storefront gets the shifts it is missing, matched on start time', () => {
  const mapped = shiftCtx.mapShiftReport(SHIFT_ROWS, shiftCtx.detectReport(SHIFT_ROWS));
  const shifts = mapped.storefronts[0].shifts;
  // The owner's case: the storefront is on the schedule with no shifts set at all.
  eq(shiftCtx.teMissingShifts({ blocks: [] }, shifts).length, 2, 'an empty storefront gains nothing');
  // A storefront that already has one of them keeps it and gains only the other.
  const partial = { blocks: [{ start: '10:00', assignments: [{ scoutId: 's1' }], salesCents: 12345 }] };
  const miss = shiftCtx.teMissingShifts(partial, shifts);
  eq(miss.length, 1, 'a shift already on the schedule was going to be added again');
  eq(miss[0].start, '12:00 PM', 'the wrong shift was picked as missing');
  // ...and nothing about the block it already had was read as replaceable.
  eq(partial.blocks[0].salesCents, 12345, 'teMissingShifts mutated an existing block');
  // Re-importing the same file is a no-op, which is what makes this safe to run twice.
  const full = { blocks: shifts.map((sh) => ({ start: shiftCtx.parseLegacyTime(sh.start) })) };
  eq(shiftCtx.teMissingShifts(full, shifts).length, 0, 're-importing the same report duplicates blocks');
  // A shift with an unreadable time is skipped rather than added blind — it can never be matched
  // on a later import, so adding it would duplicate it every single time.
  eq(shiftCtx.teMissingShifts({ blocks: [] }, [{ start: 'whenever', end: '' }]).length, 0,
    'an unparseable shift time is added anyway, and will duplicate on every re-import');
});

test('a sign-up matches the roster on "First L", and refuses to guess', () => {
  // The report abbreviates: "Beckett H", not "Beckett Hartley". teMatchScouts, which the SALES import
  // uses, compares whole names and would match almost nobody here.
  const ctx = vm.createContext({});
  vm.runInContext([slice('teMatchShiftScout'), slice('teNameKey')].join('\n') +
    '\nvar ROSTER = []; function activeScouts() { return ROSTER; }', ctx);
  ctx.ROSTER = [{ id: 's1', name: 'Beckett Hartley' }, { id: 's2', name: 'Lorenzo Kessler' }];
  eq(ctx.teMatchShiftScout('Beckett H'), 's1', 'first name plus last initial does not match');
  eq(ctx.teMatchShiftScout('Beckett Hartley'), 's1', 'an exact full name does not match');
  eq(ctx.teMatchShiftScout('beckett  h'), 's1', 'case and spacing are not normalised');
  eq(ctx.teMatchShiftScout('Beckett H.'), 's1', 'a trailing full stop on the initial breaks it');
  // Assigning the wrong child to a shift is worse than assigning none: the shift is who turns up,
  // and once sales land on the block it is who gets the credit. So ambiguity refuses.
  ctx.ROSTER = [{ id: 'a', name: 'Beckett Hartley' }, { id: 'b', name: 'Beckett Hollis' }];
  eq(ctx.teMatchShiftScout('Beckett H'), null, 'it guessed between two scouts who both fit');
  ctx.ROSTER = [{ id: 'a', name: 'Beckett Hartley' }];
  eq(ctx.teMatchShiftScout('Casey T'), null, 'a name nobody on the roster fits was matched anyway');
  eq(ctx.teMatchShiftScout(''), null, 'an empty name matched something');
  eq(ctx.teMatchShiftScout('Beckett'), null, 'a bare first name was matched on its own');
});

test('sign-ups never re-split money that has already been recorded', () => {
  // blockShares divides a block's takings across its assignees by weight, so adding one to a block
  // that already holds sales silently changes what every scout on it earned. This is the guard
  // that makes importing sign-ups safe to do at any point in the season.
  const ctx = vm.createContext({});
  vm.runInContext([slice('teNewSignups'), slice('teMatchShiftScout'), slice('teNameKey')].join('\n') +
    '\nvar ROSTER = []; function activeScouts() { return ROSTER; }', ctx);
  ctx.ROSTER = [{ id: 's1', name: 'Beckett Hartley' }, { id: 's2', name: 'Piper Hartley' }];
  const shift = { start: '10:00 AM', scouts: ['Beckett H', 'Piper H'] };
  eq(ctx.teNewSignups({ assignments: [], salesCents: 0, donationsCents: 0 }, shift).length, 2,
    'an empty block did not take its sign-ups');
  eq(ctx.teNewSignups({ assignments: [], salesCents: 48000, donationsCents: 0 }, shift).length, 0,
    'a block with recorded SALES took a new assignee, re-splitting the money');
  eq(ctx.teNewSignups({ assignments: [], salesCents: 0, donationsCents: 2500 }, shift).length, 0,
    'a block with recorded DONATIONS took a new assignee');
  // Someone already on the block is not added twice, however many times the report is imported.
  eq(ctx.teNewSignups({ assignments: [{ scoutId: 's1', weight: 1 }], salesCents: 0, donationsCents: 0 }, shift)
    .map((m) => m.scoutId), ['s2'], 'a scout already signed up was added again');
  // A name that matches nobody is skipped rather than dropped in as a blank assignment.
  ctx.ROSTER = [{ id: 's1', name: 'Beckett Hartley' }];
  eq(ctx.teNewSignups({ assignments: [], salesCents: 0, donationsCents: 0 },
    { start: '10:00 AM', scouts: ['Nobody Q'] }).length, 0, 'an unmatched name became an assignment');
});

test('the shift report carries its sign-ups through the parser', () => {
  // The rows that used to be discarded as duplicate shifts ARE the sign-ups.
  const mapped = shiftCtx.mapShiftReport(SHIFT_ROWS, shiftCtx.detectReport(SHIFT_ROWS));
  const first = mapped.storefronts[0];
  eq(first.shifts[0].scouts, ['Beckett H', 'Piper H'], 'both scouts on one shift were not collected');
  eq(first.shifts[1].scouts, ['Lorenzo K'], 'the second shift lost its scout');
  eq(mapped.storefronts[1].shifts[0].scouts, [], 'an unstaffed shift invented a scout');
});

test('the preview discloses what the sign-up import will NOT do', () => {
  const fn = /function renderTePreview\(o\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  // Pin the CONDITIONS. Matching the strings alone passed while the branches were disabled — a
  // source scan cannot see reachability, so assert the thing that makes them reachable.
  // These two strings exist ONLY in the shifts branch. `o.unmatched` does not — the sales and
  // inventory branches have their own, so a guard aimed at it passed by matching theirs.
  //
  // ⚠ KNOWN LIMIT, stated rather than papered over: these assertions catch the copy being
  // DELETED, which is the regression that actually happens. They cannot catch the branch being
  // switched off — `if (false)` leaves every string in the file, and a source scan has no idea
  // what runs. Proving reachability needs the rendered output, and this harness has no DOM (see
  // the header). It was checked in a browser instead; if this ever needs to be automated it
  // belongs in test/scenario-browser.js, not here.
  ok(/Not signed up<\/span>/.test(fn), 'names that matched nobody are not surfaced');
  ok(/Left alone<\/span>/.test(fn), 'sign-ups skipped for landing on paid blocks are not surfaced');
  ok(/re-split money already/.test(fn), 'the reason a sign-up was held back is not given');
  ok(/refuses to guess/.test(fn), 'the preview does not say it declines ambiguous names');
  const build = /function teBuildShiftPreview\(mapped\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  ok(/signUps:/.test(build) && /unmatched:/.test(build) && /heldBack:/.test(build),
    'the preview data does not carry the sign-up outcome');
});

test('the shift import never edits a block that is already there', () => {
  // The old rule was "never edit an existing storefront", which is why a pack that had typed its
  // dates in imported nothing. The rule that actually matters is narrower: never touch an existing
  // BLOCK, because a block carries sign-ups and recorded sales.
  const fn = /function teCommitShiftImport\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'teCommitShiftImport() not found');
  ok(/teMissingShifts\(match, it\.shifts\)/.test(fn[0]), 'it no longer fills only the missing shifts');
  ok(/match\.blocks = \(match\.blocks \|\| \[\]\)\.concat\(/.test(fn[0]),
    'existing blocks are replaced rather than appended to');
  ok(!/match\.blocks = it\.shifts\.map/.test(fn[0]), 'an existing storefront has its blocks overwritten');
  // The dead skip that caused the whole complaint must not come back.
  ok(!/if \(existing\[key\]\) return;/.test(fn[0]),
    'an existing storefront is skipped whole again, so its shifts never import');
  // Both outcomes are reported, so "nothing happened" can never be silent again.
  // Anchored to the CONDITION, not just the string: a bare match on the message still passed when
  // the branch was disabled to `if (false)`. A source scan cannot see reachability, so pin the
  // guard that makes it reachable.
  ok(/if \(filled\) say\.push\('filled in ' \+ filled/.test(fn[0]),
    'filling shifts is not reported to the user');
  ok(/Every shift on this report is already on your schedule/.test(fn[0]),
    'a genuine no-op is not explained');
});

test('the shift preview says what it is about to do', () => {
  const fn = /function renderTePreview\(o\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  ok(/o\.fillCount/.test(fn), 'the preview does not count the shifts it will fill in');
  ok(/Everything here is already on your schedule/.test(fn),
    'the disabled button still claims the storefronts were the problem');
  // ⚠ This assertion used to read `No existing block is changed, renamed, moved or removed`, and
  // was CORRECTLY broken by the 2026-08-15 change that lets the report remove sign-ups. The old
  // sentence went on to promise "nothing you have recorded against one — sign-ups, sales,
  // donations — can be lost", which became a lie the moment a scout could come off. The promise
  // that survives is narrower and is the one that still holds: the BLOCK and its MONEY are safe.
  // Do not restore the old wording to make this pass.
  ok(/No existing block is renamed, moved, retimed or removed, and no sales or donations are/.test(fn),
    'the preview no longer promises that existing blocks and recorded money are safe');
  ok(!/can be lost by importing this/.test(fn),
    'the preview is back to promising sign-ups can never be lost, which removal made false');
  const build = /function teBuildShiftPreview\(mapped\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  ok(/addCount:/.test(build) && /fillCount:/.test(build), 'the preview data carries no fill counts');
});

/* ================================================================
   Owner, 2026-08-15: "it is only adding scouts from the report that are not on the website, it
   does not remove scouts from the website if no longer on the schedule from the report" — and,
   on which side wins: "The report from Trails Ends wins."
   ================================================================ */

const dropCtx = (() => {
  const ctx = vm.createContext({});
  vm.runInContext([slice('teDroppedSignups'), slice('teMatchShiftScout'), slice('teNameKey')].join('\n') +
    '\nvar ROSTER = []; function activeScouts() { return ROSTER; }', ctx);
  ctx.ROSTER = [{ id: 's1', name: 'Beckett Hartley' }, { id: 's2', name: 'Piper Hartley' },
    { id: 's3', name: 'Lorenzo Kessler' }];
  return ctx;
})();
const emptyBlock = (ids) => ({ assignments: ids.map((id) => ({ scoutId: id, weight: 1 })), salesCents: 0, donationsCents: 0 });

test('a scout the report has dropped comes off the block', () => {
  // The complaint: Lorenzo is on the block here, the report no longer has him on that shift, and
  // the import left him standing there. The block is who turns up on the day.
  const shift = { start: '10:00 AM', scouts: ['Beckett H', 'Piper H'] };
  eq(dropCtx.teDroppedSignups(emptyBlock(['s1', 's2', 's3']), shift).map((a) => a.scoutId), ['s3'],
    'a scout no longer on the report was left signed up');
  // A shift the report has emptied out clears the block — the modal case, since a blank Scout Name
  // row is exactly what a dropped shift looks like on the report.
  eq(dropCtx.teDroppedSignups(emptyBlock(['s1', 's2']), { start: '10:00 AM', scouts: [] }).length, 2,
    'a shift nobody is signed up for on the report kept its old sign-ups');
  // Nobody is removed when the report and the block already agree, so re-importing is a no-op.
  eq(dropCtx.teDroppedSignups(emptyBlock(['s1', 's2']), shift).length, 0,
    're-importing the same report churns the assignments');
  // A scout the report added but the block does not have yet is teNewSignups' job, not this one.
  eq(dropCtx.teDroppedSignups(emptyBlock([]), shift).length, 0, 'an empty block invented a removal');
});

test('removal never re-splits money that has already been recorded', () => {
  // Symmetric with teNewSignups' guard, and for the identical reason: blockShares divides takings
  // by weight, so taking somebody OFF a paid block changes what everybody left on it earned.
  const shift = { start: '10:00 AM', scouts: ['Beckett H'] };
  eq(dropCtx.teDroppedSignups({ assignments: [{ scoutId: 's3', weight: 1 }], salesCents: 48000, donationsCents: 0 }, shift).length, 0,
    'a block with recorded SALES lost an assignee, re-splitting the money');
  eq(dropCtx.teDroppedSignups({ assignments: [{ scoutId: 's3', weight: 1 }], salesCents: 0, donationsCents: 2500 }, shift).length, 0,
    'a block with recorded DONATIONS lost an assignee');
});

test('removal refuses on a shift carrying a name it could not resolve', () => {
  // "Beckett H" with two Beckett H's on the roster resolves to nobody — and the scout already on the
  // block may BE the one the report meant. Removing on a guess deletes a sign-up the report is
  // still asking for, and nothing here can tell the difference. So the whole shift is left alone.
  const ctx = vm.createContext({});
  vm.runInContext([slice('teDroppedSignups'), slice('teMatchShiftScout'), slice('teNameKey')].join('\n') +
    '\nvar ROSTER = []; function activeScouts() { return ROSTER; }', ctx);
  ctx.ROSTER = [{ id: 'a', name: 'Beckett Hartley' }, { id: 'b', name: 'Beckett Hollis' }];
  eq(ctx.teDroppedSignups(emptyBlock(['a']), { start: '10:00 AM', scouts: ['Beckett H'] }).length, 0,
    'an ambiguous name on the shift still removed somebody');
  // A name matching nobody at all is the same problem: it may be a roster spelling difference.
  ctx.ROSTER = [{ id: 'a', name: 'Beckett Hartley' }];
  eq(ctx.teDroppedSignups(emptyBlock(['a']), { start: '10:00 AM', scouts: ['Becket Hartley'] }).length, 0,
    'a name that matched nobody was treated as "the shift is empty" and cleared the block');
});

test('the commit removes as well as adds, and only where the report has an opinion', () => {
  const fn = /function teCommitShiftImport\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'teCommitShiftImport() not found');
  ok(/teDroppedSignups\(b, sh\)/.test(fn[0]), 'the commit never asks what the report has dropped');
  ok(/b\.assignments = \(b\.assignments \|\| \[\]\)\.filter\(/.test(fn[0]),
    'the dropped sign-ups are computed and then not actually removed');
  // A block whose start matches no shift on the report is skipped before any of this — the report
  // says nothing about that slot, so it has no opinion to win with.
  ok(/var sh = byStart\[b\.start\];\s*\n\s*if \(!sh\) return;/.test(fn[0]),
    'a block the report does not cover is reconciled anyway, so an unrelated shift loses its scouts');
  ok(/removed ' \+ dropped \+ ' scout/.test(fn[0]), 'removals happen silently, with no toast');
});

test('the preview discloses the removals before the button is pressed', () => {
  const fn = /function renderTePreview\(o\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  ok(/Coming off<\/span>/.test(fn), 'the scouts about to be removed are not surfaced');
  ok(/schedule of record/.test(fn), 'the preview does not say the report wins');
  ok(/Anything you added by hand that the report does not/.test(fn),
    'the preview hides that hand-typed sign-ups are removed too');
  ok(/o\.dropCount/.test(fn), 'the preview does not count the sign-ups it will remove');
  // The one thing worse than not removing is removing without saying so on the button.
  ok(/'remove ' : 'Remove '/.test(fn), 'the confirm button does not name the removals');
  const build = /function teBuildShiftPreview\(mapped\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  ok(/dropCount:/.test(build) && /dropHeld:/.test(build),
    'the preview data does not carry the removal outcome');
});

test('the parent view never carries the ledger', () => {
  // Parents get a sanitized calendar. The pack's transactions are not theirs to see, and
  // the published doc is world-readable to anyone the pack has approved as a parent.
  const fn = /function buildParentView\(src, opts\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'buildParentView() not found');
  ok(!/ledger/i.test(fn[0]), 'buildParentView references the ledger');
  ok(!/\bbook\b/.test(fn[0]), 'buildParentView references the book (opening/statement balances)');
});

test('a meeting\u2019s internal note never reaches ANY outbound surface', () => {
  // Owner ask, 2026-08-02: two notes on a meeting, one for parents and one for leaders only.
  // A meeting note leaves the app FOUR ways, and only one of them is the parent app — so
  // checking buildParentView alone would be checking a quarter of the boundary:
  //   buildParentView  the published doc parents read
  //   monthlyDigest    the copy-to-parents newsletter text
  //   the .ics export  imported into BAND, or subscribed in Google/Apple/Outlook
  //   agendaDetail     the printed leader sheet — the ONE place it is meant to appear
  const outbound = ['buildParentView', 'monthlyDigest'];
  outbound.forEach(function (name) {
    const fn = new RegExp('function ' + name + '\\([\\s\\S]*?\\n  \\}').exec(SCRIPT);
    ok(fn, name + '() not found');
    ok(!/noteInternal/.test(fn[0]), name + ' publishes the leaders-only note');
  });
  // The ICS builder is not a single named function, so scan the block that writes DESCRIPTION.
  const ics = /function buildICS\(\)[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(ics, 'buildICS() was not found — the ICS guard is not scanning anything');
  // Since B8 (2026-09) the .ics carries no note of either kind — see the next test.
  ok(/function buildICS\(\)/.test(ics[0]) && /LOCATION:/.test(ics[0]), 'this guard is aimed at the wrong code');
  ok(!/noteInternal/.test(ics[0]), 'the .ics export carries the leaders-only note');
  // ...and it DOES appear where it is supposed to: the leader-facing printable agenda.
  ok(/m\.noteInternal/.test(SCRIPT), 'the internal note is never rendered anywhere');
  ok(/line\('Leaders only', esc\(m\.noteInternal\)\)/.test(SCRIPT),
    'the printable agenda no longer shows the internal note');
  // The published field keeps its meaning. Flipping which field publishes would silently
  // un-publish every note already written — including the location parents rely on.
  const pv = /function buildParentView\(src, opts\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  ok(/detail: String\(e\.note \|\| ''\)/.test(pv), 'the published meeting detail is no longer e.note');
  // The handler must not route an unknown mtg-* key into the PUBLISHED note. It used to end in a
  // catch-all `else mtg.note = el.value`, which would have caught mtg-note-internal itself.
  const h = /if \(ch === 'mtg-kind'\)[\s\S]{0,700}/.exec(SCRIPT);
  ok(h, 'the meeting change handler was not found');
  ok(/else if \(ch === 'mtg-note'\) mtg\.note = el\.value;/.test(h[0]),
    'the published note is assigned from a catch-all else again');
  ok(/else if \(ch === 'mtg-note-internal'\) mtg\.noteInternal = el\.value;/.test(h[0]),
    'the internal note has no handler branch');
  // ...AND that it is reachable. The branch chain sits inside a gate that is itself an
  // allowlist of mtg-* keys, so the branch above can exist and never run. It did: the first
  // version of this change added the branch, not the gate, and typing in the field saved
  // nothing — while this very test passed on dead code. Assert the gate too.
  const gate = /if \(ch === 'mtg-kind' \|\|[\s\S]{0,240}?\) \{/.exec(SCRIPT);
  ok(gate, 'the meeting handler gate was not found');
  ok(/ch === 'mtg-note-internal'/.test(gate[0]),
    'mtg-note-internal is not in the handler gate, so its branch is unreachable');
  // Both fields say who reads them — the whole point of the split.
  ok(/Parents see this/.test(SCRIPT), 'the published note field does not name its audience');
  ok(/Leaders only \\u00b7 never published/.test(SCRIPT), 'the internal note field does not name its audience');
});

/* ================================================================
   Money redesign — Phase 2: events split out of the budget (DESIGN-money.md 3.1).
   ================================================================ */

function preSplitState() {
  return {
    version: 1, packName: 'Pack 569',
    scouts: [{ id: 's1', name: 'Ben' }, { id: 's2', name: 'Ivy' }],
    meetings: [
      { id: 'm1', kind: 'den', den: 'Wolf', date: '2025-09-10', time: '19:00', note: 'Library', adventure: 'Call of the Wild' },
      { id: 'm2', kind: 'pack', den: '', date: '2025-09-24', time: '18:30', note: '' }
    ],
    attendance: { m1: { s1: true, s2: true } },
    rsvps: {
      'mtg:m2': { s1: { s: 'yes', adults: 2 } },
      'act:a1': { s2: { s: 'maybe', adults: 0 } },
      'sf:sf1': { s1: { s: 'yes', adults: 1 } }
    },
    budget: {
      programYear: 2025, startingBalance: 0,
      activities: [
        { id: 'a1', slot: 1, name: 'Fall campout', date: '2025-10-18', time: '09:00', endTime: '15:00',
          location: 'Camp Rainey', note: 'Bring boots', sourceUid: 'band-77', estCents: 80000,
          actualCents: 0, perScout: false, familyPays: false },
        { id: 'a2', slot: 5, name: 'Blue & Gold', date: '', estCents: 30000, actualCents: 0, perScout: false, familyPays: false }
      ],
      expenses: []
    }
  };
}

test('Phase 2: every meeting and activity becomes an event', () => {
  const ctx = sandbox(NORMALIZE_FNS);
  const after = ctx.normalizeState(preSplitState());
  eq(after.events.length, 4, 'event count');
  eq(after.meetings.length, 0, 'meetings[] is emptied');
  ok(Array.isArray(after.meetings), 'meetings[] was deleted rather than emptied — an older build would crash');
  const kinds = after.events.map(e => e.kind).sort();
  eq(kinds, ['activity', 'activity', 'den', 'pack'], 'kinds');
});

test('Phase 2: the calendar fields leave the budget line, the money stays', () => {
  const ctx = sandbox(NORMALIZE_FNS);
  const after = ctx.normalizeState(preSplitState());
  const line = after.budget.activities.find(a => a.id === 'a1');
  ok(line, 'the budget line kept its own id — the ledger posts against it');
  eq(line.flatCents, 80000, 'the money stayed on the line');
  ['date', 'time', 'endTime', 'location', 'note', 'sourceUid', 'slot'].forEach(f => {
    ok(!(f in line), `calendar field "${f}" is still on the budget line`);
  });
  const ev = after.events.find(e => e.id === line.eventId);
  ok(ev, 'the line does not point at an event');
  eq(ev.date, '2025-10-18', 'event date');
  eq(ev.location, 'Camp Rainey', 'event location');
  eq(ev.sourceUid, 'band-77', 'ICS round-trip uid moved to the event');
  ok(!('estCents' in ev), 'the event carries money');
});

test('Phase 2: event ids are fresh, and never alias a budget line id', () => {
  // Reusing the old ids would have been cheaper but would leave event.id === line.id for
  // every migrated activity, aliasing two record types in one namespace forever.
  const ctx = sandbox(NORMALIZE_FNS);
  const after = ctx.normalizeState(preSplitState());
  const lineIds = new Set(after.budget.activities.map(a => a.id));
  after.events.forEach(e => ok(!lineIds.has(e.id), `event ${e.id} reuses a budget line id`));
  ok(!after.events.some(e => e.id === 'm1' || e.id === 'm2'), 'a meeting id was reused as an event id');
});

test('Phase 2: attendance is repointed onto the event, not lost', () => {
  // The single most destructive thing this migration could get wrong.
  const ctx = sandbox(NORMALIZE_FNS);
  const after = ctx.normalizeState(preSplitState());
  const den = after.events.find(e => e.kind === 'den');
  // Phase 2b turned each tick into a head count of one; the point here is that the marks
  // followed the meeting onto its new event id at all.
  eq(after.attendance[den.id],
    { s1: { scout: 1, adults: 0, siblings: 0 }, s2: { scout: 1, adults: 0, siblings: 0 } },
    'attendance followed the meeting');
  eq(Object.keys(after.attendance).length, 1, 'a stale meeting-keyed entry was left behind');
});

test('Phase 2: RSVPs collapse onto the bare event id, storefronts keep their prefix', () => {
  const ctx = sandbox(NORMALIZE_FNS);
  const after = ctx.normalizeState(preSplitState());
  const pack = after.events.find(e => e.kind === 'pack');
  const campout = after.events.find(e => e.name === 'Fall campout');
  eq(after.rsvps[pack.id], { s1: { s: 'yes', adults: 2 } }, 'meeting RSVP');
  eq(after.rsvps[campout.id], { s2: { s: 'maybe', adults: 0 } }, 'activity RSVP');
  eq(after.rsvps['sf:sf1'], { s1: { s: 'yes', adults: 1 } }, 'storefronts are not events and keep sf:');
  ok(!after.rsvps['mtg:m2'] && !after.rsvps['act:a1'], 'a prefixed key survived the migration');
});

test('Phase 2: a meeting keeps its den, adventure and note', () => {
  const ctx = sandbox(NORMALIZE_FNS);
  const after = ctx.normalizeState(preSplitState());
  const den = after.events.find(e => e.kind === 'den');
  eq(den.den, 'Wolf', 'den');
  eq(den.adventure, 'Call of the Wild', 'adventure drives the advancement mark-off');
  eq(den.note, 'Library', 'note');
  const pack = after.events.find(e => e.kind === 'pack');
  eq(pack.den, '', 'a pack meeting has no den');
  eq(pack.adventure, '', 'a pack meeting has no adventure');
});

test('Phase 2: a dated event takes its month from the date, an undated one keeps its slot', () => {
  const ctx = sandbox(NORMALIZE_FNS);
  const after = ctx.normalizeState(preSplitState());
  eq(after.events.find(e => e.name === 'Fall campout').slot, 3, 'October is slot 3 in a July-start year');
  // The fixture's slots are pre-July-rebase, so the undated one is remapped: old 5 (February
  // under a September start) becomes new 7 (February under a July one). Same month either way.
  eq(after.events.find(e => e.name === 'Blue & Gold').slot, 7, 'undated keeps its planning MONTH');
});

test('Phase 2: migration runs once', () => {
  const ctx = sandbox(NORMALIZE_FNS);
  const once = ctx.normalizeState(preSplitState());
  const twice = ctx.normalizeState(JSON.parse(JSON.stringify(once)));
  eq(twice.events.length, once.events.length, 'events grew on a second normalize');
  eq(Object.keys(twice.attendance).length, 1, 'attendance was repointed twice');
});

test('Phase 2: a budget line whose event vanished is unlinked, not left dangling', () => {
  const ctx = sandbox(NORMALIZE_FNS);
  const d = ctx.normalizeState(preSplitState());
  const line = d.budget.activities.find(a => a.id === 'a1');
  d.events = d.events.filter(e => e.id !== line.eventId);   // the event was deleted
  const after = ctx.normalizeState(JSON.parse(JSON.stringify(d)));
  eq(after.budget.activities.find(a => a.id === 'a1').eventId, '', 'the stale link survived');
  eq(after.budget.activities.find(a => a.id === 'a1').flatCents, 80000, 'the money was lost with the event');
});

test('importing a calendar no longer writes budget rows', () => {
  // DESIGN-money.md's very first listed symptom. The import path must touch state.events
  // and never state.budget.
  const fn = /function findExisting\(evt\) \{[\s\S]*?\n    \}/.exec(SCRIPT);
  ok(fn, 'findExisting() not found');
  ok(/state\.events/.test(fn[0]) && !/state\.budget/.test(fn[0]),
    'the ICS importer still matches against budget rows');
  const commit = /events\.forEach\(function \(evt\) \{[\s\S]*?\n    \}\);/.exec(SCRIPT);
  ok(commit, 'the ICS commit loop not found');
  ok(/state\.events\.push/.test(commit[0]), 'the importer does not create events');
  ok(!/state\.budget\.activities\.push/.test(commit[0]),
    'importing a calendar still creates budget rows — this is the bug Phase 2 exists to fix');
});

test('deleting a calendar event never deletes the budget line under it', () => {
  // The ledger posts against the line. Removing it to service a calendar edit would orphan
  // real transactions.
  const fn = /if \(act\.indexOf\('del-event:'\) === 0\) \{[\s\S]*?\n    \}/.exec(SCRIPT);
  ok(fn, 'the del-event handler not found');
  ok(/state\.events\.splice/.test(fn[0]), 'del-event does not remove the event');
  ok(!/budget\.activities\.splice/.test(fn[0]), 'del-event also deletes the budget line');
});

test('the parent view publishes the calendar and no money', () => {
  const fn = /function buildParentView\(src, opts\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'buildParentView() not found');
  ok(/state\.events\.forEach/.test(fn[0]), 'the parent view does not read events[]');
  ok(!/estCents|lineForEvent|budget\.activities/.test(fn[0]),
    'the parent view reads budget data — cost could leak into the published copy');
});

/* ================================================================
   Money redesign — Phase 2b: attendance is a head count (DESIGN-money.md 3.1).
   ================================================================ */

const ATT_FNS = ['ATT_MAX_HEADS', 'attHeads', 'freshAttendance', 'attEmpty', 'attTotals'];

test('Phase 2b: the old boolean tick becomes a head count of one', () => {
  const ctx = sandbox(NORMALIZE_FNS);
  const d = preSplitState();
  const after = ctx.normalizeState(d);
  const den = after.events.find(e => e.kind === 'den');
  eq(after.attendance[den.id].s1, { scout: 1, adults: 0, siblings: 0 }, 'migrated mark');
});

test('Phase 2b: head counts are clamped to sane whole numbers', () => {
  const { attHeads } = sandbox(ATT_FNS);
  eq(attHeads(2), 2, 'plain number');
  eq(attHeads('3'), 3, 'string from a number input');
  eq(attHeads(-4), 0, 'negative heads are nonsense');
  eq(attHeads(2.7), 2, 'fractional people are nonsense');
  eq(attHeads('abc'), 0, 'garbage');
  eq(attHeads(1e9), 99, 'clamped to ATT_MAX_HEADS');
});

test('Phase 2b: a family of zeros is pruned, not stored', () => {
  // "Absent from the map" has to keep meaning "did not come", exactly as the boolean did —
  // otherwise every scout who was ever unticked would read as a family that turned up with
  // nobody in it.
  const { attEmpty, attTotals } = sandbox(ATT_FNS);
  ok(attEmpty({ scout: 0, adults: 0, siblings: 0 }), 'all-zero is empty');
  ok(attEmpty(null), 'missing is empty');
  ok(!attEmpty({ scout: 0, adults: 2, siblings: 0 }), 'adults alone still counts as attendance');
  eq(attTotals({ s1: { scout: 0, adults: 0, siblings: 0 } }).heads, 0, 'a zero row contributes nothing');
});

test('Phase 2b: totals count families, scouts and heads separately', () => {
  // The worked example in DESIGN-money.md 3.4: 8 scouts, 13 adults, 5 siblings = 26 heads.
  const { attTotals } = sandbox(ATT_FNS);
  const marked = {};
  for (let i = 0; i < 8; i++) marked['s' + i] = { scout: 1, adults: 0, siblings: 0 };
  marked.s0.adults = 2; marked.s0.siblings = 1;
  marked.s1.adults = 2; marked.s1.siblings = 1;
  marked.s2.adults = 2; marked.s2.siblings = 1;
  marked.s3.adults = 2; marked.s3.siblings = 1;
  marked.s4.adults = 2; marked.s4.siblings = 1;
  marked.s5.adults = 1;
  marked.s6.adults = 1;
  marked.s7.adults = 1;
  const t = attTotals(marked);
  eq(t.scouts, 8, 'scouts');
  eq(t.adults, 13, 'adults');
  eq(t.siblings, 5, 'siblings');
  eq(t.heads, 26, 'heads');
  eq(t.families, 8, 'families');
});

test('Phase 2b: an unreadable attendance value is dropped, not coerced to a phantom head', () => {
  const ctx = sandbox(NORMALIZE_FNS);
  const d = preSplitState();
  d.attendance.m1.s2 = 'yes';       // garbage
  d.attendance.m1.s1 = { scout: 1, adults: '2', siblings: -3 };
  const after = ctx.normalizeState(d);
  const den = after.events.find(e => e.kind === 'den');
  ok(!after.attendance[den.id].s2, 'a garbage value became a head count');
  eq(after.attendance[den.id].s1, { scout: 1, adults: 2, siblings: 0 }, 'coerced in place');
});

test('Phase 2b: attendance migration runs once', () => {
  const ctx = sandbox(NORMALIZE_FNS);
  const once = ctx.normalizeState(preSplitState());
  const twice = ctx.normalizeState(JSON.parse(JSON.stringify(once)));
  const den = twice.events.find(e => e.kind === 'den');
  eq(twice.attendance[den.id].s1, { scout: 1, adults: 0, siblings: 0 }, 'stable across re-normalize');
});

test('a roster attendance percentage counts scouts, never total heads', () => {
  // Counting the parents who came would push the close-out average past 100%.
  const fn = /\/\/ Average attendance across[\s\S]*?\n    \}\);/.exec(SCRIPT);
  ok(fn, 'the close-out attendance average not found');
  ok(/attTotals\(state\.attendance\[m\.id\]\)\.scouts/.test(fn[0]),
    'the close-out average is not counting scouts');
});

test('the head-count grid is only asked for where heads cost something', () => {
  // A weekly den meeting keeps its plain roll-call; an activity is where the money is.
  const fn = /function renderAttendanceBlock\(m\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'renderAttendanceBlock() not found');
  ok(/var heads = m\.kind === 'activity'/.test(fn[0]), 'the grid does not distinguish activities from meetings');
  ok(/data-ch="att-adults"/.test(fn[0]) && /data-ch="att-siblings"/.test(fn[0]), 'head-count inputs missing');
});

/* ================================================================
   Money redesign — Phase 3a: how a line is priced, and whose money it is (3.2).
   ================================================================ */

const PRICE_FNS = ['centsOf', 'uid', 'freshLine', 'LINE_BASES', 'LINE_FUNDERS',
  // linePerHead: both per-head kinds price off the roster, and the planning math asks it.
  'linePerHead', 'linePlannedHeads', 'linePlannedCents'];

test('Phase 3a: the line-shape migration does not move a single total', () => {
  // Same discipline as Phase 1. Today's planned is estCents x roster for a per-scout line
  // and estCents flat otherwise; a migrated line must plan to exactly the same number.
  const ctx = sandbox(NORMALIZE_FNS);
  const scouts = 10;
  const before = {
    version: 1, scouts: Array.from({ length: scouts }, (_, i) => ({ id: 's' + i, name: 'S' + i })),
    budget: {
      programYear: 2025, startingBalance: 0,
      activities: [
        { id: 'a1', slot: 1, name: 'Campout', estCents: 80000, perScout: false, familyPays: false },
        { id: 'a2', slot: 9, name: 'Day camp', estCents: 14500, perScout: true, familyPays: true }
      ],
      expenses: [
        { id: 'e1', name: 'Charter', estCents: 10000, perScout: false, familyPays: false },
        { id: 'e2', name: 'Dues', estCents: 8000, perScout: true, familyPays: true }
      ]
    }
  };
  const legacy = [...before.budget.activities, ...before.budget.expenses]
    .reduce((t, x) => t + x.estCents * (x.perScout ? scouts : 1), 0);
  const after = ctx.normalizeState(JSON.parse(JSON.stringify(before)));
  const got = [...after.budget.activities, ...after.budget.expenses]
    .reduce((t, x) => t + ctx.linePlannedCents(x, scouts), 0);
  eq(got, legacy, 'total planned across every line');
});

test('Phase 3a: a per-scout line becomes a per-head line priced on the scout rate', () => {
  const ctx = sandbox(NORMALIZE_FNS);
  const d = ctx.normalizeState({
    version: 1, scouts: [{ id: 's1' }],
    budget: { programYear: 2025, activities: [], expenses: [
      { id: 'e1', name: 'Dues', estCents: 8000, perScout: true, familyPays: true },
      { id: 'e2', name: 'Charter', estCents: 10000, perScout: false, familyPays: false }
    ] }
  });
  const dues = d.budget.expenses.find(e => e.id === 'e1');
  eq(dues.basis, 'per-head', 'basis');
  eq(dues.scoutRateCents, 8000, 'the estimate became the SCOUT rate');
  eq(dues.adultRateCents, 0, 'no adult rate is invented');
  eq(dues.siblingRateCents, 0, 'no sibling rate is invented');
  eq(dues.includeLeaders, false, 'the pack is not signed up to pay for leaders by default');
  eq(dues.leaderRateCents, 0, 'no leader rate is invented');
  eq(dues.fundedBy, 'families', 'familyPays became fundedBy');
  const charter = d.budget.expenses.find(e => e.id === 'e2');
  eq(charter.basis, 'flat', 'basis');
  eq(charter.flatCents, 10000, 'flat cost');
  eq(charter.fundedBy, 'pack', 'the pack pays for its own charter');
  [dues, charter].forEach(l => {
    ok(!('estCents' in l) && !('perScout' in l) && !('familyPays' in l),
      'an old pricing field survived the migration');
  });
});

test('a family rate never reaches the pack’s plan', () => {
  // OWNER RULING 2026-07-27: the pack covers scouts and registered leaders, nobody else.
  // Parents and siblings pay their own way, so an adult or sibling rate is a BILLING rate —
  // it must not add a cent to what the pack plans to spend. This replaces the old
  // adultsPerScout assumption, which invented one parent per scout and charged the pack for
  // every one of them.
  const { linePlannedCents, linePlannedHeads, freshLine } = sandbox(PRICE_FNS);
  const bg = freshLine({ basis: 'per-head', scoutRateCents: 1500, adultRateCents: 1500, siblingRateCents: 800 });
  eq(bg.includeAdults, false, 'a new line must not plan for parents until somebody says so');
  eq(linePlannedHeads(bg, 10, 4), { scouts: 10, leaders: 0, adults: 0 }, 'planned heads');
  eq(linePlannedCents(bg, 10, 4), 15000, 'ten scouts at $15 — the parents are not the pack’s to plan');
  // OWNER ASK 2026-08-02: an event priced PER PERSON at the door can opt in, per line. The ruling
  // above is intact — what it forbade was inventing a parent on every line at once, and that is
  // exactly what this asserts is still off by default. A sibling rate is never planned either way.
  bg.includeAdults = true;
  eq(linePlannedHeads(bg, 10, 4), { scouts: 10, leaders: 0, adults: 10 }, 'one parent per SCOUT, not per family');
  eq(linePlannedCents(bg, 10, 4), 30000, 'ten scouts and ten parents at $15 — the sibling rate stays out');
  // A per-family fee is one fee for whoever comes, so it has no parent head to add even ticked.
  const fam = freshLine({ basis: 'per-family', scoutRateCents: 3500, adultRateCents: 9900, includeAdults: true });
  eq(linePlannedHeads(fam, 10, 4, 8), { scouts: 8, leaders: 0, adults: 0 }, 'a per-family fee gained a parent head');
  eq(linePlannedCents(fam, 10, 4, 8), 28000, 'eight families at $35, and nothing for the adult rate');
});

test('the pack plans for leaders only when it is paying for them', () => {
  // Registration is genuinely two prices, which is why leaders carry their own rate rather
  // than sharing the scout's.
  const { linePlannedCents, linePlannedHeads, freshLine } = sandbox(PRICE_FNS);
  const camp = freshLine({ basis: 'per-head', scoutRateCents: 2000 });
  eq(linePlannedCents(camp, 10, 4), 20000, 'unticked: scouts only');
  camp.includeLeaders = true; camp.leaderRateCents = 2000;
  eq(linePlannedHeads(camp, 10, 4), { scouts: 10, leaders: 4, adults: 0 }, 'planned heads');
  eq(linePlannedCents(camp, 10, 4), 28000, 'ticked: 10 scouts + 4 leaders at $20');
  const reg = freshLine({ basis: 'per-head', scoutRateCents: 8500, includeLeaders: true, leaderRateCents: 6500 });
  eq(linePlannedCents(reg, 10, 4), 111000, '$85 a scout and $65 a leader');
  // A leader count of zero is not a reason to plan nothing for the scouts.
  eq(linePlannedCents(reg, 10, 0), 85000, 'no leaders on the roster yet');
});

test('Phase 3a: a flat line ignores the roster entirely', () => {
  const { linePlannedCents, linePlannedHeads, freshLine } = sandbox(PRICE_FNS);
  const charter = freshLine({ basis: 'flat', flatCents: 10000, scoutRateCents: 999 });
  eq(linePlannedCents(charter, 50), 10000, 'a charter fee is a charter fee');
  eq(linePlannedHeads(charter, 50, 9), { scouts: 0, leaders: 0, adults: 0 }, 'no heads are counted');
});

test('Phase 3a: "the pack pays, but somebody else is paid directly" is not expressible', () => {
  // If the pack is paying, it goes through the pack's account. The UI must not offer the
  // combination and the model must not store it.
  const ctx = sandbox(NORMALIZE_FNS);
  const d = ctx.normalizeState({
    version: 1, scouts: [],
    budget: { programYear: 2025, activities: [], expenses: [
      { id: 'e1', name: 'Camp', basis: 'flat', flatCents: 100, fundedBy: 'pack', paidDirectTo: 'Council' }
    ] }
  });
  eq(d.budget.expenses[0].paidDirectTo, '', 'a pack-funded line kept a payee');
});

test('Phase 3a: council money never touches the pack balance, but is still visible', () => {
  // fundedBy: families + paidDirectTo: Council. No charge, no ledger entry, no effect on
  // the balance — and still counted in what the year costs a family.
  const fn = /function computeBudget\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'computeBudget() not found');
  ok(/if \(!lineThroughPack\(a\)\) \{ familyDirect \+=/.test(fn[0]),
    'paid-direct activities are still counted as pack spending');
  ok(/if \(!lineThroughPack\(e\)\) \{ familyDirect \+=/.test(fn[0]),
    'paid-direct expenses are still counted as pack spending');
  ok(/familyDirect: familyDirect/.test(fn[0]),
    'the true-cost-to-a-family figure is computed but never reported');
  const fee = /function addFeeItem\(item, colKey\) \{[\s\S]*?\n    \}/.exec(SCRIPT);
  ok(fee && /lineThroughPack\(item\)/.test(fee[0]),
    'a paid-direct line still raises family fee income the pack never handles');
});

test('Phase 3a: switching basis carries the money across rather than zeroing it', () => {
  const h = /if \(bk === 'basis'\) \{[\s\S]*?\n      \}/.exec(SCRIPT)
    || /\} else if \(bk === 'basis'\) \{[\s\S]*?\n      \}/.exec(SCRIPT);
  ok(h, 'the basis handler not found');
  ok(/bl\.scoutRateCents = bl\.flatCents/.test(h[0]) && /bl\.flatCents = bl\.scoutRateCents/.test(h[0]),
    'switching basis silently wipes the amount somebody typed');
});

test('one handler set serves every budget line, not parallel act-/exp- families', () => {
  ok(/if \(ch\.indexOf\('line-'\) === 0\)/.test(SCRIPT), 'the unified line- handler is missing');
  ["act-est", "exp-est", "act-perscout", "exp-perscout", "act-familypays", "exp-familypays"]
    .forEach(dead => ok(!SCRIPT.includes(`'${dead}'`), `${dead} is still handled`));
});

/* ================================================================
   Money redesign — Phase 3b: charges and family accounts (DESIGN-money.md 3.4).
   ================================================================ */

const CHARGE_FNS = ['CHARGE_WHO', 'centsOf', 'chargeKey', 'chargeRowsFor', 'chargeIsOpen',
  'entryPaysCharges', 'entryRefundsFamily', 'paymentsForScout', 'familyAccounts', 'familyOutstanding', 'chargeSetTotals', 'chargeTotals'];

function line3b(patch) {
  return Object.assign({
    id: 'L', name: 'Blue & Gold', basis: 'per-head', eventId: 'E',
    scoutRateCents: 1500, adultRateCents: 1500, siblingRateCents: 800,
    flatCents: 0, adultsPerScout: 1, fundedBy: 'families', paidDirectTo: ''
  }, patch);
}

test('Phase 3b: one charge per head, because that is how the cost is incurred', () => {
  // "A family that brought the scout, both parents and a younger sibling gets four charges
  // against that scout's account: one scout, two adult, one sibling."
  const { chargeRowsFor } = sandbox(CHARGE_FNS);
  const rows = chargeRowsFor(line3b(), { s1: { scout: 1, adults: 2, siblings: 1 } }, []);
  eq(rows.length, 4, 'charge count');
  eq(rows.filter(r => r.who === 'scout').length, 1, 'scout charges');
  eq(rows.filter(r => r.who === 'adult').length, 2, 'adult charges');
  eq(rows.filter(r => r.who === 'sibling').length, 1, 'sibling charges');
  eq(rows.reduce((t, r) => t + r.amountCents, 0), 1500 + 3000 + 800, 'total');
});

test('Phase 3b: the 3.4 worked example bills 26 heads, not 20', () => {
  // 8 scouts came, 13 adults, 5 siblings. scout $15, adult $15, sibling $8.
  const { chargeRowsFor } = sandbox(CHARGE_FNS);
  const marked = {};
  for (let i = 0; i < 8; i++) marked['s' + i] = { scout: 1, adults: i < 5 ? 2 : 1, siblings: i < 5 ? 1 : 0 };
  const rows = chargeRowsFor(line3b(), marked, []);
  const total = rows.reduce((t, r) => t + r.amountCents, 0);
  eq(rows.filter(r => r.who === 'scout').length, 8, 'scouts');
  eq(rows.filter(r => r.who === 'adult').length, 13, 'adults');
  eq(rows.filter(r => r.who === 'sibling').length, 5, 'siblings');
  eq(total, 8 * 1500 + 13 * 1500 + 5 * 800, 'charged $355.00');
  eq(total, 35500, 'charged, in cents');
});

test('Phase 3b: a line with no event charges the roster, not the attendance', () => {
  // Dues are owed by every registered scout whether or not they come to anything. Raising
  // them from attendance would bill nobody.
  const { chargeRowsFor } = sandbox(CHARGE_FNS);
  const dues = line3b({ id: 'D', name: 'Pack dues', eventId: '', scoutRateCents: 8000, adultRateCents: 0, siblingRateCents: 0 });
  const rows = chargeRowsFor(dues, null, [{ id: 's1' }, { id: 's2' }]);
  eq(rows.length, 2, 'one per scout on the roster');
  eq(rows.every(r => r.who === 'scout'), true, 'nobody is billed an adult for dues');
});

test('Phase 3b: a rate of zero raises no charge', () => {
  const { chargeRowsFor } = sandbox(CHARGE_FNS);
  const rows = chargeRowsFor(line3b({ siblingRateCents: 0 }), { s1: { scout: 1, adults: 0, siblings: 3 } }, []);
  eq(rows.length, 1, 'three free siblings raised three $0 charges');
});

test("a family's payment is income, not a refund of what the pack spent", () => {
  // Backfilled dues payments carry a lineId. Without this distinction a dues line reads as
  // negative spending and the pack's "actual spent" goes below zero.
  const { lineActualCents } = sandbox(LEDGER_FNS);
  const led = [
    entry({ id: '1', lineId: 'L', amountCents: 50000, direction: 'out' }),
    entry({ id: '2', lineId: 'L', amountCents: 8000, direction: 'in', scoutId: 's1', source: 'family' }),
    entry({ id: '3', lineId: 'L', amountCents: 8000, direction: 'in', scoutId: 's2', source: 'donation' }),
    entry({ id: '4', lineId: 'L', amountCents: 2000, direction: 'in', scoutId: '' })   // vendor refund
  ];
  eq(lineActualCents(led, 'L'), 48000, 'family money reduced the cost of the line');
});

test('Phase 3b: the four settlements are counted apart, never collapsed', () => {
  // A donation leaves the pack whole; a waiver or forgiveness does not. Collapsing any of
  // them into "paid" or "written off" would misstate the pack's position.
  const { chargeTotals } = sandbox(CHARGE_FNS);
  const charges = [
    { scoutId: 's1', amountCents: 1500, waivedBy: '', forgiven: null },   // paid below
    { scoutId: 's2', amountCents: 1500, waivedBy: 't1', forgiven: null }, // waived
    { scoutId: 's3', amountCents: 1500, waivedBy: '', forgiven: { reason: 'hardship' } },
    { scoutId: 's4', amountCents: 1500, waivedBy: '', forgiven: null }    // donated below
  ];
  const ledger = [
    { direction: 'in', scoutId: 's1', amountCents: 1500, source: 'family' },
    { direction: 'in', scoutId: 's4', amountCents: 1500, source: 'donation' },
    { direction: 'out', scoutId: '', amountCents: 9999, source: '' }
  ];
  const t = chargeTotals(charges, ledger);
  eq(t.raised, 6000, 'every charge was raised');
  eq(t.waived, 1500, 'waived');
  eq(t.forgiven, 1500, 'forgiven');
  eq(t.paid, 1500, 'paid by a family');
  eq(t.donated, 1500, 'covered by a donation');
  eq(t.standing, 3000, 'still standing after waiver and forgiveness');
  eq(t.outstanding, 0, 'everything standing has been settled by money');
});

test('Phase 3b: a donation settles a charge exactly as a family payment does', () => {
  const { familyOutstanding } = sandbox(CHARGE_FNS);
  const charges = [{ scoutId: 's1', amountCents: 8000, waivedBy: '', forgiven: null }];
  eq(familyOutstanding(charges, [{ direction: 'in', scoutId: 's1', amountCents: 8000, source: 'donation' }], 's1'),
    0, "St Mark's covered it — the family owes nothing");
  eq(familyOutstanding(charges, [], 's1'), 8000, 'unpaid');
});

test('Phase 3b: a waived or forgiven charge is not owed, and is not deleted', () => {
  const { familyOutstanding, chargeIsOpen } = sandbox(CHARGE_FNS);
  const waived = { scoutId: 's1', amountCents: 8000, waivedBy: 't1', forgiven: null };
  const forgiven = { scoutId: 's1', amountCents: 4000, waivedBy: '', forgiven: { reason: 'x' } };
  eq(familyOutstanding([waived, forgiven], [], 's1'), 0, 'neither is owed');
  ok(!chargeIsOpen(waived) && !chargeIsOpen(forgiven), 'both still read as settled');
  // They are still THERE — an auditor can read a marked charge; a missing one tells them nothing.
  eq([waived, forgiven].length, 2, 'a settled charge was deleted');
});

test('Phase 3b: a family is never shown as owing a negative amount', () => {
  const { familyOutstanding } = sandbox(CHARGE_FNS);
  const charges = [{ scoutId: 's1', amountCents: 1000, waivedBy: '', forgiven: null }];
  eq(familyOutstanding(charges, [{ direction: 'in', scoutId: 's1', amountCents: 5000 }], 's1'), 0, 'overpayment');
});

test('a tier waives a head other than the scout only where it NAMES that share', () => {
  // The rule was "a scout's fundraising buys the scout's seat, not the family's", enforced by
  // refusing to waive any charge but the scout's. Pack 569 wants a higher tier that buys an
  // ADULT pack shirt, so the refusal is now a DEFAULT rather than a prohibition: a bare cover
  // key is the scout share, and an adult share has to be named on a specific tier — where it
  // costs the plan real money (fundingSummary adds it to A).
  const fn = /function applyTierWaivers\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'applyTierWaivers() not found');
  ok(!/if \(c\.who !== 'scout'\) \{ c\.waivedBy = ''; return; \}/.test(fn[0]),
    'the blanket refusal is back, so a named adult share can never be honoured');
  ok(/var ck = coverKeyOf\(key, c\.who\);/.test(fn[0]) && /\(covered\[ck\] \|\| \{\}\)\[c\.scoutId\]/.test(fn[0]),
    'the waiver does not look up the charge’s own head kind');
  ok(/c\.waivedBy = et \? et\.id/.test(fn[0]),
    'the waiver does not record WHICH tier bought it — total waived stops being measurable');
  // And the default really is scout-only: a bare key must not resolve to an adult share.
  const { coverKeyOf, coverKeyParts } = sandbox(['COVER_WHO', 'coverKeyOf', 'coverKeyParts']);
  eq(coverKeyOf('L1', 'scout'), 'L1', 'the scout share must stay a bare key — nothing migrates');
  eq(coverKeyOf('L1', ''), 'L1', 'an unspecified head kind is the scout');
  eq(coverKeyOf('L1', 'adult'), 'L1#adult', 'an adult share needs its own key');
  eq(coverKeyParts('L1'), { key: 'L1', who: 'scout' }, 'an existing tier means the scout share');
  eq(coverKeyParts('act:A1#adult'), { key: 'act:A1', who: 'adult' }, 'an activity key survives the split');
  eq(coverKeyParts('L1#nonsense'), { key: 'L1', who: 'scout' }, 'an unknown head kind falls back to the scout');
});

test('a covered adult share is priced at the ADULT rate, and is new pack spending', () => {
  // One line, two prices, two rewards: the lower tier buys the scout's shirt, the higher one an
  // adult's. The scout share is already inside the line's planned cost, so covering it only
  // moves money out of expected fees; the adult rate is never planned, so covering THAT has to
  // add to A or the cost lands nowhere.
  const { lineRateForWho } = sandbox(['lineRateForWho']);
  const shirt = { scoutRateCents: 1200, adultRateCents: 1500, siblingRateCents: 800 };
  eq(lineRateForWho(shirt, 'scout'), 1200, 'scout rate');
  eq(lineRateForWho(shirt, 'adult'), 1500, 'adult rate');
  eq(lineRateForWho(shirt, 'sibling'), 800, 'sibling rate');
  eq(lineRateForWho(shirt, undefined), 1200, 'no head kind means the scout');
  const cost = /function coverCostForKeys\(keys\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(cost, 'coverCostForKeys() not found');
  // THREE destinations, not two. A scout share of a line the pack collects leaves B; an adult or
  // sibling share adds to A; and ANY share of a paid-direct line adds to A as a reimbursement,
  // the scout's included — the pack never collected it, so paying it back is spending. The last
  // two used to be summed and printed under one label reading "…for adults or siblings", which
  // described a council-fee refund as buying something for a parent.
  ok(/if \(reimb\) \{ extra \+= cents; extraReimburse \+= cents; \}/.test(cost[0]),
    'a reimbursement is not tracked apart from an adult or sibling share');
  // "Not planned" rather than "not the scout" since 2026-08-02: with one-parent-per-scout ticked,
  // that parent's fee IS in the plan, so covering it must reduce expected income like a scout
  // share rather than invent a second cost on top of the one already sitting in A.
  ok(/var planned = who === 'scout' \|\| \(who === 'adult' && r\.line\.includeAdults && !linePerFamily\(r\.line\)\);/.test(cost[0]),
    'the rule is not "did the plan count on income for this share?"');
  ok(/else if \(!planned\) \{ extra \+= cents; extraHeads \+= cents; \}/.test(cost[0]),
    'an unplanned adult or sibling share is not tracked as its own kind of pack spending');
  ok(/else fees \+= cents;/.test(cost[0]),
    'a covered scout share no longer leaves expected fees');
  ok(/extraHeads: extraHeads, extraReimburse: extraReimburse/.test(cost[0]),
    'the split is computed but not returned');
  ok(/lineRateForWho\(r\.line, who\) \* lineBillingRoster\(r\.line\)\.length/.test(cost[0]),
    'a share is not priced at its own rate across whoever the line actually bills');
  const fs2 = /function fundingSummary\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(/var tierCost = coverCostForKeys\(assumeCov\);\s*\n\s*var tierExtra = tierCost\.extra;\s*\n\s*expenses \+= tierExtra;/.test(fs2[0]),
    'a covered adult share never reaches A, so the pack plans to buy shirts with no money for them');
  ok(/tierExtra: tierExtra,/.test(fs2[0]), 'the figure is not reported for the worksheet to show');
  ok(/tierExtraHeads: tierCost\.extraHeads, tierExtraReimburse: tierCost\.extraReimburse,/.test(fs2[0]),
    'the worksheet cannot tell an adult share from a council-fee refund');
  // And the worksheet prints them as two separate, correctly-named rows.
  ok(/…of which reward tiers buy for adults or siblings<\/td>' \+\s*\n\s*'<td class="num money">' \+ fmt\(fs2\.tierExtraHeads\)/.test(SCRIPT),
    'the adults-or-siblings row still prints the combined figure');
  ok(/…of which reward tiers pay a council fee back to families/.test(SCRIPT),
    'a reimbursement has no row of its own, so it is reported as buying something for an adult');
  // The Budget card must agree with the worksheet about it.
  const cb = /function computeBudget\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(/var tierExtra = tierExtraPackCostCents\(\);\s*\n\s*var planned = actPlanned \+ expPlanned \+ tierExtra;/.test(cb[0]),
    "the Budget card's Planned leaves out what the worksheet added to A");
  // Only the shares a tier actually names are offered, and a rate of zero is not one of them.
  const shares = /function coverableShares\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(shares && /if \(who !== 'scout' && \(family \|\| !rate\)\) return;/.test(shares[0]),
    'an unpriced adult share is offered as something a tier can cover, or a per-family fee is split');
});

test('reconciling charges never removes one that has been settled or paid against', () => {
  // A book does not lose rows because somebody fixed a head count.
  const fn = /function syncCharges\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'syncCharges() not found');
  ok(/if \(c\.waivedBy \|\| c\.forgiven\) return true;/.test(fn[0]), 'a settled charge can be dropped');
  // M8 — money against THIS charge (chargePaidAllocation), not against the scout in general.
  ok(/return \(paidOn\[c\.id\] \|\| 0\) > 0;/.test(fn[0]),
    'a charge with money against it can be dropped');
  ok(/chargeIsOpen\(have\) && !\(paidOn\[have\.id\] > 0\)/.test(fn[0]),
    'a paid charge can be silently re-priced');
});

test('paid-direct lines raise no charges at all', () => {
  const fn = /function lineRaisesCharges\(l\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'lineRaisesCharges() not found');
  ok(/lineThroughPack\(l\)/.test(fn[0]), 'a council camp is billing families through the pack');
  ok(/lineFamilyFunded\(l\)/.test(fn[0]), 'a pack-funded line is billing families');
});

test('Phase 3b backfill: every collected tick becomes a payment, not a lost balance', () => {
  // Losing these would tell every square family they owe again.
  const ctx = sandbox(NORMALIZE_FNS);
  const after = ctx.normalizeState({
    version: 1, scouts: [{ id: 's1' }, { id: 's2' }],
    collected: { e2: { s1: true, s2: true }, 'act:a1': { s1: true } },
    budget: {
      programYear: 2025,
      activities: [{ id: 'a1', name: 'Camp', estCents: 4000, perScout: true, familyPays: true }],
      expenses: [{ id: 'e2', name: 'Dues', estCents: 8000, perScout: true, familyPays: true }]
    }
  });
  const pays = after.ledger.filter(e => e.direction === 'in' && e.scoutId);
  eq(pays.length, 3, 'one ledger payment per tick');
  eq(pays.reduce((t, e) => t + e.amountCents, 0), 8000 + 8000 + 4000, 'total collected');
  ok(pays.every(e => e.source === 'family'), 'backfilled money lost its source');
  eq(Object.keys(after.collected).length, 0, 'collected was not emptied — it would backfill twice');
});

test('Phase 3b backfill: runs once', () => {
  const ctx = sandbox(NORMALIZE_FNS);
  const once = ctx.normalizeState({
    version: 1, scouts: [{ id: 's1' }],
    collected: { e2: { s1: true } },
    budget: { programYear: 2025, activities: [], expenses: [{ id: 'e2', name: 'Dues', estCents: 8000, perScout: true, familyPays: true }] }
  });
  const twice = ctx.normalizeState(JSON.parse(JSON.stringify(once)));
  eq(twice.ledger.filter(e => e.direction === 'in').length, 1, 'the backfill ran again');
});

test('charges are reconciled on the one seam every mutation goes through', () => {
  const fn = /function commit\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'commit() not found');
  ok(/syncCharges\(\);/.test(fn[0]), 'charges are not reconciled on commit');
});

/* ================================================================
   Money redesign — Phase 4: categories and the funding summary (2, 3.2).
   ================================================================ */

test('Phase 4: existing lines default to "other" rather than being guessed at', () => {
  const ctx = sandbox(NORMALIZE_FNS);
  const d = ctx.normalizeState({
    version: 1, scouts: [],
    budget: { programYear: 2025, activities: [], expenses: [
      { id: 'e1', name: 'Charter fee', estCents: 10000, perScout: false },
      { id: 'e2', name: 'Nonsense', category: 'not-a-category', basis: 'flat', flatCents: 1 }
    ] }
  });
  eq(d.budget.expenses[0].category, 'other', 'a name is not a category');
  eq(d.budget.expenses[1].category, 'other', 'an unknown category is not kept');
});

test('Phase 4: the 510-278 category list is adopted whole', () => {
  const { LINE_CATEGORY_KEYS } = sandbox(['LINE_CATEGORIES', 'LINE_CATEGORY_KEYS']);
  ['registration', 'charter', 'advancement', 'recognition', 'events', 'activities',
    'camp', 'materials', 'training', 'uniforms', 'reserve', 'other', 'income']
    .forEach(k => ok(LINE_CATEGORY_KEYS.indexOf(k) !== -1, `category "${k}" is missing`));
});

test('Phase 4: the goal derives from the plan, and the hand-typed one is gone', () => {
  // "That last figure is currently typed in by hand. After this it is derived from the
  // plan, which is the entire point of the 510-278 worksheet."
  ok(!/data-act="use-budget-goal"/.test(SCRIPT), 'the manual "use this as the goal" button survived');
  ok(!/act === 'use-budget-goal'/.test(SCRIPT), 'the manual goal-sync handler survived');
  const fn = /function packGoalCents\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'packGoalCents() not found');
  ok(/state\.goalIsDerived/.test(fn[0]), 'the goal does not honour the derived flag');
  ok(/fundingSummary\(\)\.salesGoal/.test(fn[0]), 'the derived goal does not come from the plan');
  const totals = /function computePackTotals\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(/teGoal: teGoalNow/.test(totals[0]), 'computePackTotals still reports the raw stored goal');
});

test('Phase 4: a pack that already typed a goal keeps it', () => {
  const ctx = sandbox(NORMALIZE_FNS);
  const typed = ctx.normalizeState({ version: 1, scouts: [], goalCents: 500000, budget: { programYear: 2025, activities: [], expenses: [] } });
  eq(typed.goalIsDerived, false, 'a typed goal was silently replaced by a derived one');
  const fresh = ctx.normalizeState({ version: 1, scouts: [], budget: { programYear: 2025, activities: [], expenses: [] } });
  eq(fresh.goalIsDerived, true, 'a pack with no goal did not get the derived one');
});

test('Phase 4: the funding summary never depends on what has been sold', () => {
  // The goal feeds computePackTotals' teGoal, so if the summary read sales back it would be
  // circular — and the goal would move every time somebody recorded a storefront.
  const fn = /function fundingSummary\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'fundingSummary() not found');
  ok(!/computePackTotals/.test(fn[0]), 'fundingSummary reads sales totals — that is circular');
  ok(/Math\.max\(0, expenses - income\)/.test(fn[0]), 'C is not A - B, floored at zero');
});

test('Phase 4: paid-direct money is in neither A nor B', () => {
  const fn = /function fundingSummary\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(/if \(!lineThroughPack\(l\)\) \{ familyDirect \+= planned; return; \}/.test(fn[0]),
    'council money is being counted as a pack expense or as pack income');
});

test('Phase 4: an income-category line adds to B instead of A', () => {
  const fn = /function fundingSummary\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(/if \(l\.category === 'income'\) incomeLines \+= planned;\s*\n\s*else expenses \+= planned;/.test(fn[0]),
    'an income line is being budgeted as an expense');
});

test('Phase 4: a family-funded event counts as income before anyone has attended', () => {
  // Reading only charges would count a family-funded campout as pure cost until the day it
  // happens, inflating the popcorn goal by the whole of it — the pack would be told to
  // raise money it was never going to spend.
  const fn = /function fundingSummary\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'fundingSummary() not found');
  ok(/rows\.length \? chargeSetTotals\(rows\)\.standing : lineFamilyPlanned\(l\)/.test(fn[0]),
    'a family-funded line with no charges yet contributes nothing to income');
  // ...and the fallback is what FAMILIES would be billed, not the whole planned cost: a leader's
  // place is in linePlanned and no family is ever billed for one.
  // ...and the fallback is the scout share PLUS a planned parent where the line says one comes
  // (2026-08-02), never the whole planned cost: a leader's place is in linePlanned and no family
  // is ever billed for one.
  const famFn = /function lineFamilyPlanned\(l\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(famFn, 'lineFamilyPlanned() not found');
  ok(/linePlannedShare\(l, 'scout'\) \+ linePlannedShare\(l, 'adult'\)/.test(famFn[0]),
    'expected family income is not the scout share plus the planned parent');
  ok(!/leaderRateCents/.test(famFn[0]), 'what families are billed includes a leader rate');
  // And the planned parent only exists where the line says one comes.
  const shareFn = /function linePlannedShare\(l, who\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(shareFn && /l\.includeAdults && !linePerFamily\(l\)/.test(shareFn[0]),
    'a line that plans one parent per scout does not expect that parent’s fee as income');
});

test('Phase 4: the Budget card and the goal share one arithmetic', () => {
  // Repeating the A-B=C sum in computeBudget is how the card and the goal would drift.
  const fn = /function computeBudget\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(/var fund = fundingSummary\(\);/.test(fn[0]), 'computeBudget does not use fundingSummary');
  ok(/var teNeed = fund\.C;/.test(fn[0]), 'computeBudget recomputes the fundraising need');
  ok(/var salesGoal = fund\.salesGoal;/.test(fn[0]), 'computeBudget recomputes the sales goal');
});

/* ================================================================
   Audit regressions — four bugs that survived the phase work, all found by
   auditing rather than by the tests written alongside it.
   ================================================================ */

test('AUDIT: the year rollover clears charges', () => {
  // syncCharges deliberately KEEPS a settled charge, so without an explicit clear a waived
  // or forgiven row survives the rollover pointing at a line id that no longer exists — and
  // the new year opens reporting last year's forgiveness against a "Removed line".
  const fn = /function rolloverYear\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'rolloverYear() not found');
  ok(/state\.charges = \[\];/.test(fn[0]), "last year's charges are carried into the new year");
});

test('AUDIT: the rollover carries the 510-278 category', () => {
  // freshLine defaults category to 'other', so the whole grouping was silently reset every
  // year — and an 'income' line came back as an ordinary expense that bills families.
  const fn = /function rolloverYear\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'rolloverYear() not found');
  const carries = fn[0].match(/category: x\.category/g) || [];
  eq(carries.length, 2, 'both activities and expenses must carry their category');
});

test('AUDIT: deleting a budget line takes its charges with it, and Undo brings them back', () => {
  // Both halves of the budget now remove through ONE function, so the cascade is asserted
  // there — two copies of it is how they drifted apart in the first place.
  const fn = /function removeBudgetLine\(id\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'removeBudgetLine() not found');
  ok(/state\.charges = state\.charges\.filter\(function \(c\) \{ return c\.lineId !== id; \}\);/.test(fn[0]),
    "removing a line orphans its charges");
  ok(/chg\.forEach\(function \(c\) \{ state\.charges\.push\(c\); \}\);/.test(fn[0]),
    'Undo does not bring the charges back');
  ok(/arr\.splice\(Math\.min\(ix, arr\.length\), 0, gone\);/.test(fn[0]), 'Undo does not put the line back');
  // And both delete buttons route through the confirm rather than deleting on the tap.
  const ask = /if \(act\.indexOf\('del-activity:'\) === 0 \|\| act\.indexOf\('del-expense:'\) === 0\) \{[\s\S]*?\n    \}/.exec(SCRIPT);
  ok(ask, 'the two budget deletes no longer share one guarded handler');
  ok(/ui\.overlay = \{ kind: 'confirm-del-line', lineId: askId \};/.test(ask[0]),
    'a budget line can still be deleted on a single tap');
  ok(!/removeBudgetLine/.test(ask[0]), 'the ask handler deletes as well as asking');
  const go = /if \(act\.indexOf\('confirm-del-line:'\) === 0\) \{[\s\S]*?\n    \}/.exec(SCRIPT);
  ok(go && /removeBudgetLine\(daId\)/.test(go[0]) && /deleteWithUndo\(gone\.label, gone\.restore\)/.test(go[0]),
    'confirming does not remove the line, or drops the Undo');
});

test('the delete dialog says what goes and what stays', () => {
  // The point is not the extra tap, it is knowing what the tap costs. A treasurer deleting a
  // line needs to know charges go, the ledger does not, and the calendar entry survives.
  const fn = /if \(o\.kind === 'confirm-del-line'\) \{[\s\S]*?\n    \}/.exec(SCRIPT);
  ok(fn, 'the confirm-del-line overlay was not found');
  ok(/budgetLineDeleteFacts\(dl\)/.test(fn[0]), 'the dialog does not read the real figures');
  ok(/This goes:/.test(fn[0]) && /This stays:/.test(fn[0]), 'the dialog does not separate the two');
  ok(/money that really moved stays in the book/.test(fn[0]), 'it does not say the ledger survives');
  ok(/only the money side is removed/.test(fn[0]), 'it does not say the calendar entry survives');
  ok(/f\.paidAgainst/.test(fn[0]), 'it does not warn when a family has already paid something');
  const facts = /function budgetLineDeleteFacts\(l\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(facts && /paymentsForScout\(state\.ledger, c\.scoutId\) > 0/.test(facts[0]),
    'the paid-against warning is not computed from real payments');
});

test('a calendar activity with no budget line can be budgeted again', () => {
  // The way back from a deleted line. It existed on the calendar day-detail only, which is no
  // use to somebody looking at the Budget wondering where their activity went.
  const fn = /function unbudgetedActivities\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'unbudgetedActivities() not found');
  ok(/e\.kind === 'activity' && !lineForEvent\(e\.id\)/.test(fn[0]), 'it does not test for a missing line');
  const rb = /function renderBudget\(\) \{[\s\S]*?\n    return h;\n  \}/.exec(SCRIPT);
  ok(rb, 'renderBudget() not found');
  ok(/var unb = unbudgetedActivities\(\);/.test(rb[0]), 'the Budget never lists them');
  ok(/data-act="budget-this-event"/.test(rb[0]), 'there is no way to add the line back from the Budget');
  // The re-add must reuse the event, not make a second one.
  const add = /if \(act === 'budget-this-event'\) \{[\s\S]*?\n    \}/.exec(SCRIPT);
  ok(add && /eventId: btEv\.id/.test(add[0]), 'budgeting an event again does not reuse its calendar entry');
  ok(add && /lineForEvent\(btEv\.id\)\) return;/.test(add[0]), 'it would add a second line to the same event');
});

test('AUDIT: removing a scout strips their charges but keeps the money that moved', () => {
  // A settled charge would otherwise sit in the totals against a family who is not on the
  // roster. Their ledger entries stay — that money really did move.
  ok(/state\.charges = state\.charges\.filter\(function \(c\) \{ return c\.scoutId !== id; \}\);/.test(SCRIPT),
    "a removed scout's charges survive them");
  ok(/state\.ledger\.forEach\(function \(e\) \{ if \(e\.scoutId === id\) e\.scoutId = ''; \}\);/.test(SCRIPT),
    "a removed scout's payments still point at a scout who no longer exists");
});

test('AUDIT: an income-category line is never billed to families', () => {
  // Filing dues under "Income" is a plausible mistake, and it counted the same money twice
  // in B — once as fees owed, once as a budgeted income line.
  const fn = /function lineRaisesCharges\(l\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'lineRaisesCharges() not found');
  ok(/if \(l\.category === 'income'\) return false;/.test(fn[0]),
    'an income line still raises charges — B double-counts it');
});

test('AUDIT: the Budget card and the worksheet cannot disagree about family income', () => {
  const fn = /function computeBudget\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(/feeIncomeExpected = fundingSummary\(\)\.fees;/.test(fn[0]),
    'computeBudget computes expected family income its own way');
});

test('Home answers "what is coming" in exactly one place', () => {
  // Home used to carry two: a bare date in the stat row with no clue what it belonged to,
  // and a proper card below. They never appeared together, so the stat was only ever visible
  // in the state where it said least.
  const fn = /function renderHome\(\) \{[\s\S]*?\n    h \+= packFlow\(\);/.exec(SCRIPT);
  ok(fn, 'renderHome() not found');
  eq((fn[0].match(/<span class="l">Next up<\/span>/g) || []).length, 0, 'the bare-date stat is back');
  eq((fn[0].match(/<h2 class="section display" style="margin-bottom:0">This week<\/h2>/g) || []).length, 1,
    'Home should carry exactly one week card');
});

test('the week card always renders, and degrades in three useful steps', () => {
  const fn = /\/\/ This week — Monday to Sunday[\s\S]*?\n    h \+= '<\/div>';/.exec(SCRIPT);
  ok(fn, 'the week card not found');
  ok(/Nothing on the calendar this week/.test(fn[0]), 'no empty state');
  ok(/Next: <strong>/.test(fn[0]), 'an empty week does not say what IS coming');
  ok(/no date yet/.test(fn[0]), 'an empty calendar does not mention activities awaiting dates');
  ok(/data-tab="program" data-section="calendar"/.test(fn[0]), 'the empty state offers no way to fix it');
  ok(/wk-past/.test(fn[0]), 'days already past this week are not marked as done');
});

test('the week runs Monday to Sunday, and a Sunday belongs to the week that started', () => {
  // Sunday is the classic off-by-one: getDay() calls it 0, but in a Monday-start week it is
  // day SIX, so the week began six days ago rather than tomorrow.
  const { weekBounds } = sandbox(['pad2', 'weekBounds']);
  eq(weekBounds('2026-07-26'), { start: '2026-07-20', end: '2026-07-26' }, 'a Sunday');
  eq(weekBounds('2026-07-20'), { start: '2026-07-20', end: '2026-07-26' }, 'the Monday of that week');
  eq(weekBounds('2026-07-23'), { start: '2026-07-20', end: '2026-07-26' }, 'a Thursday mid-week');
});

test('a week straddling a month or a year still resolves', () => {
  const { weekBounds } = sandbox(['pad2', 'weekBounds']);
  eq(weekBounds('2026-09-01'), { start: '2026-08-31', end: '2026-09-06' }, 'across a month end');
  eq(weekBounds('2027-01-01'), { start: '2026-12-28', end: '2027-01-03' }, 'across a year end');
  eq(weekBounds('2028-02-29'), { start: '2028-02-28', end: '2028-03-05' }, 'a leap day');
  eq(weekBounds(''), { start: '', end: '' }, 'garbage in');
  eq(weekBounds('not-a-date'), { start: '', end: '' }, 'more garbage in');
});

test('the week list is ordered the way the week happens', () => {
  const fn = /function datedThingsInRange\(from, to\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'datedThingsInRange() not found');
  ok(/a\.date\.localeCompare\(b\.date\) \|\|/.test(fn[0]), 'not sorted by day first');
  ok(/a\.time \|\| '99:99'/.test(fn[0]),
    'an untimed thing sorts before timed ones — it should fall to the end of its day');
  ok(/state\.storefronts/.test(fn[0]) && /state\.events/.test(fn[0]),
    'the week must include storefronts as well as events');
});


test('a month heading never claims a year the event is not in', () => {
  // slotYear() takes the year from budget.programYear alone, so an event dated outside the
  // program year would be filed under a heading two years off with nothing to say so. The
  // realistic way to hit it is planning September before closing out the year in August.
  const { dateInProgramYear } = sandbox(['programYearStartISO', 'programYearEndISO', 'dateInProgramYear']);
  eq(dateInProgramYear('2025-07-01', 2025), true, 'first day of the program year');
  eq(dateInProgramYear('2026-06-30', 2025), true, 'last day of the program year');
  eq(dateInProgramYear('2025-06-30', 2025), false, 'the day before it starts');
  eq(dateInProgramYear('2026-07-01', 2025), false, 'next July, planned before the rollover');
  eq(dateInProgramYear('', 2025), false, 'undated');
});

test('an out-of-year line is grouped by its REAL month, not filed into the grid', () => {
  const inSlot = /function activitiesInSlot\(slot\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(inSlot, 'activitiesInSlot() not found');
  ok(/if \(ev\.date && !dateInProgramYear\(ev\.date, state\.budget\.programYear\)\) return false;/.test(inSlot[0]),
    'the month grid still swallows dates from another year');
  const stray = /function outOfYearActivities\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(stray, 'outOfYearActivities() not found');
  ok(/!dateInProgramYear\(ev\.date, state\.budget\.programYear\)/.test(stray[0]), 'wrong predicate');
  // ...and it must be rendered under monthLabel of its own date, with an explanation.
  ok(/monthLabel\(mk\)/.test(SCRIPT), 'the stray group is not labelled from its own month');
  ok(/Outside the/.test(SCRIPT), 'the stray group does not say why it is separate');
});

test('an out-of-year line appears exactly once', () => {
  // It must leave the slot grid when it joins the stray group, or the same money shows twice.
  const inSlot = /function activitiesInSlot\(slot\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  const stray = /function outOfYearActivities\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  const loose = /function unscheduledActivities\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  ok(/return false;/.test(inSlot), 'activitiesInSlot does not exclude anything');
  ok(/ev && ev\.date/.test(stray), 'outOfYearActivities would catch undated lines too');
  ok(/lineSlot\(a\) === -1/.test(loose), 'unscheduledActivities would catch dated lines too');
});

test('the budget hides gone-by months, but never one that carries a line', () => {
  // A budget is a plan for what is ahead. By February, seven empty month headings with
  // "+ Add activity" under each are noise. A month with a line in it always shows.
  const fn = /function renderBudget\(\) \{[\s\S]*?\n    return h;\n  \}/.exec(SCRIPT);
  ok(fn, 'renderBudget() not found');
  ok(/if \(!acts\.length && slotMonthKey\(slot\) < nowMk && !ui\.budgetShowPast\) \{ hiddenPast \+= 1; continue; \}/.test(fn[0]),
    'past months are not hidden, or a month with lines could be hidden');
  ok(/var nowMk = monthKey\(todayISO\(\)\)/.test(fn[0]), 'past is not measured against the current month');
});

test('nothing becomes unreachable — the hidden months can be shown again', () => {
  const fn = /function renderBudget\(\) \{[\s\S]*?\n    return h;\n  \}/.exec(SCRIPT);
  ok(/data-act="budget-toggle-past"/.test(fn[0]), 'no way to reveal the hidden months');
  ok(/Hide earlier months/.test(fn[0]), 'the toggle does not reverse');
  ok(/act === 'budget-toggle-past'/.test(SCRIPT), 'the toggle has no handler');
});

test('the budget points past spending at the ledger, where it can be back-dated', () => {
  const fn = /function renderBudget\(\) \{[\s\S]*?\n    return h;\n  \}/.exec(SCRIPT);
  ok(/back-date an entry/.test(fn[0]),
    'hiding past months without saying where already-spent money goes');
});

test('a ledger entry can be dated freely, forwards or back', () => {
  // The budget now hides gone-by months, so the ledger is the only route to recording
  // something that already happened. Nothing may constrain its date.
  const add = /if \(act === 'ledger-add'\) \{[\s\S]*?\n    \}/.exec(SCRIPT);
  ok(add, 'the ledger-add handler not found');
  ok(/if \(!dr\.date\)/.test(add[0]), 'a date is not required');
  ok(!/dr\.date >=|dr\.date <=|min="/.test(add[0]), 'the new-entry date is range-restricted');
  // Both the draft field and the per-entry field must be plain, unbounded date inputs.
  [/(<input type="date" data-ch="ledn-date"[^>]*>)/, /(<input type="date" data-ch="led-date"[^>]*>)/]
    .forEach(function (re) {
      const m = re.exec(SCRIPT);
      ok(m, 'a ledger date input is missing');
      ok(!/\bmin=|\bmax=/.test(m[1]), 'a ledger date input is bounded: ' + m[1]);
    });
});

/* ================================================================
   Season-over-season location comparison.
   ================================================================ */

const LOC_FNS = ['locationKey', 'arrOf', 'locationHistoryFrom'];

test('location names match across years despite case, spacing and punctuation', () => {
  // The join key is the name. A leader types "Kroger — Main St" one year and "kroger main
  // st." the next, and Trail's End spells its own sites differently again.
  const { locationKey } = sandbox(['locationKey']);
  const same = ['Kroger — Main St', 'kroger main st.', 'KROGER   MAIN ST', 'Kroger, Main St!'];
  const keys = new Set(same.map(locationKey));
  eq(keys.size, 1, 'these should all be one store: ' + [...keys].join(' | '));
  ok(locationKey('Kroger Main St') !== locationKey('Kroger Oak Ave'), 'two real stores collapsed into one');
  eq(locationKey('   '), '', 'whitespace is not a location');
  eq(locationKey(null), '', 'null is not a location');
});

test('a Trail’s End import and a close-out line up on the same store', () => {
  const { locationHistoryFrom } = sandbox(LOC_FNS);
  const h = locationHistoryFrom([
    { kind: 'trails-end', year: 2024, locations: [{ name: 'Kroger — Main St', tx: 40, cents: 124000 }] },
    { kind: 'season', year: 2025, fundraising: { locations: [{ name: 'kroger main st', salesCents: 140000, donCents: 18000 }] } }
  ], [{ name: 'Kroger Main St.', sales: 61000, don: 0 }], 2026);
  eq(h.years, [2024, 2025, 2026], 'years');
  eq(h.rows.length, 1, 'the same store came out as ' + h.rows.length + ' rows');
  eq(h.rows[0].by, { 2024: 124000, 2025: 158000, 2026: 61000 }, 'per-year money');
  eq(h.rows[0].name, 'Kroger Main St.', 'the newest spelling should be the one displayed');
});

test('each year is labelled with what its source actually knew', () => {
  // A close-out has sales AND cash; a Trail's End import has TE storefront sales only.
  // Reporting them as one number without saying which is how a pack concludes cash "fell".
  const { locationHistoryFrom } = sandbox(LOC_FNS);
  const h = locationHistoryFrom([
    { kind: 'trails-end', year: 2024, locations: [{ name: 'A', cents: 100 }] },
    { kind: 'season', year: 2025, fundraising: { locations: [{ name: 'A', salesCents: 100, donCents: 5 }] } }
  ], [{ name: 'A', sales: 10, don: 0 }], 2026);
  eq(h.sources, { 2024: 'trails-end', 2025: 'season', 2026: 'live' }, 'sources');
});

test('a close-out outranks a Trail’s End import for the same year', () => {
  // Both can exist for one year. The close-out knows more, so it names the year.
  const { locationHistoryFrom } = sandbox(LOC_FNS);
  const a = locationHistoryFrom([
    { kind: 'trails-end', year: 2025, locations: [{ name: 'A', cents: 100 }] },
    { kind: 'season', year: 2025, fundraising: { locations: [{ name: 'A', salesCents: 100, donCents: 5 }] } }
  ], [], 2026);
  eq(a.sources[2025], 'season', 'import order should not decide the label');
  const b = locationHistoryFrom([
    { kind: 'season', year: 2025, fundraising: { locations: [{ name: 'A', salesCents: 100, donCents: 5 }] } },
    { kind: 'trails-end', year: 2025, locations: [{ name: 'A', cents: 100 }] }
  ], [], 2026);
  eq(b.sources[2025], 'season', 'the other order gives a different answer');
});

test('the comparison survives junk archives without inventing a year', () => {
  const { locationHistoryFrom } = sandbox(LOC_FNS);
  const h = locationHistoryFrom([
    null,
    { kind: 'trails-end', year: null, locations: [{ name: 'A', cents: 100 }] },
    { kind: 'season', year: 2025, fundraising: null },
    { kind: 'season', year: 2025, fundraising: { locations: [{ name: '  ', salesCents: 900, donCents: 0 }] } }
  ], [], 2026);
  eq(h.years, [], 'a yearless or nameless row should contribute nothing');
  eq(h.rows.length, 0, 'rows');
});

test('the new-storefront list offers previous years, not just this one', () => {
  // Rollover clears storefronts, so before this the list was empty every September — the
  // one moment where picking last year's exact name matters most.
  const fn = /function knownLocationNames\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'knownLocationNames() not found');
  ok(/state\.storefronts/.test(fn[0]), 'this season is not offered');
  ok(/a\.kind === 'trails-end'/.test(fn[0]), "Trail's End imports are not offered");
  ok(/a\.kind === 'season'/.test(fn[0]), 'close-outs are not offered');
  ok(/id="locList">' \+ knownLocs/.test(SCRIPT), 'the datalist is not fed from knownLocationNames()');
  ok(!/state\.storefronts\.forEach\(function \(sf\) \{ locations\[sf\.name\.trim\(\)\] = 1; \}\);/.test(SCRIPT),
    'the old current-season-only list is still there');
});

test('a store skipped for a season is not "new" when it comes back', () => {
  // The change column compared the latest year to the year immediately before it, so a
  // store that ran in 2024, sat out 2025 and returned in 2026 was labelled new.
  const i = SCRIPT.indexOf('Compare to the most recent year this store ACTUALLY RAN');
  ok(i !== -1, 'the change column still compares only to last year');
  const blk = SCRIPT.slice(i, i + 1600);
  ok(/for \(var wi = hist\.years\.length - 2; wi >= 0; wi--\)/.test(blk),
    'it does not walk back to find the last year the store ran');
  ok(/first year/.test(blk), '"first year" should replace the misleading "new"');
  ok(/' vs ' \+ wasYear/.test(blk), 'a non-adjacent comparison does not say which year it is against');
});

test('a part-season is never compared to a full one without saying so', () => {
  // The live column is a season still running. Against a completed year it looks like a
  // collapse — the sort of number that is arithmetically right and reads as a lie.
  ok(/var latestIsLive = hist\.sources\[hist\.latest\] === 'live';/.test(SCRIPT),
    'the table does not know whether its latest column is still running');
  ok(/latestIsLive \? '<span class="muted"> so far<\/span>' : ''/.test(SCRIPT),
    'a change against a live season is not marked "so far"');
});

test('season-over-season reports money only, and says why', () => {
  // The units differ — a Trail's End import counts transactions, a close-out counts
  // storefront dates — so an average-per-event column would compare two different things.
  ok(SCRIPT.indexOf('Season over season') !== -1, 'the season-over-season card not found');
  ok(/hist\.years\.length > 1/.test(SCRIPT), 'the card shows with only one year of data');
  ok(/average per event across them would be comparing two different things/.test(SCRIPT),
    'the card does not explain why there is no per-event column');
  ok(/Where each year came from/.test(SCRIPT), 'the card does not name each year’s source');
  // And the model must not offer one either.
  const model = /function locationHistoryFrom\(archives, liveLocs, programYear\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(model && !/events|perEvent|avg/i.test(model[0].replace(/\/\/[^\n]*/g, '')),
    'locationHistoryFrom exposes an event count that could be averaged across mismatched units');
});

/* ================================================================
   Seeded registration — only what the app can work out for itself.
   ================================================================ */

const REG_FNS = ['centsOf', 'uid', 'freshLine', 'SA_FEES', 'SEED_EXPENSES',
  // linePerHead: both per-head kinds price off the roster, and the planning math asks it.
  'linePerHead', 'linePlannedHeads', 'linePlannedCents'];

test('the national fees live in one dated place, and the seed reads them', () => {
  const { SA_FEES } = sandbox(['SA_FEES']);
  eq(SA_FEES.youthCents, 8500, 'annual national youth registration');
  eq(SA_FEES.adultCents, 6500, 'annual national adult registration');
  eq(SA_FEES.unitCharterCents, 10000, 'unit charter fee');
  ok(/^\d{4}-\d{2}-\d{2}$/.test(SA_FEES.verified), 'the figures carry no verification date');
  const seed = /var SEED_EXPENSES = \[[\s\S]*?\n  \];/.exec(SCRIPT);
  ok(seed && !/\b8500\b|\b6500\b|\b10000\b/.test(seed[0]),
    'a fee is restated in the seed instead of read from SA_FEES — they would drift');
});

test('youth registration follows the roster', () => {
  const { SEED_EXPENSES, freshLine, linePlannedCents } = sandbox(REG_FNS);
  const youth = freshLine(SEED_EXPENSES.filter(e => e.name === 'Youth registration')[0]);
  eq(linePlannedCents(youth, 10, 4), 85000, 'ten scouts');
  eq(linePlannedCents(youth, 14, 4), 119000, 'four more scouts join');
  eq(linePlannedCents(youth, 0, 4), 0, 'an empty roster costs nothing');
});

test('adult registration follows the LEADER roster', () => {
  // This is the whole reason it can be seeded: the count is a number the pack already
  // keeps, so the line moves on its own as leaders join and leave.
  const { SEED_EXPENSES, freshLine, linePlannedCents, linePlannedHeads } = sandbox(REG_FNS);
  const adult = freshLine(SEED_EXPENSES.filter(e => e.name === 'Adult leader registration')[0]);
  eq(adult.includeLeaders, true, 'the seeded line does not include leaders');
  eq(adult.leaderRateCents, 6500, 'the leader fee is on the LEADER rate, not the family-adult rate');
  eq(adult.adultRateCents, 0, 'a leader is not a family adult — that rate bills a parent');
  eq(linePlannedCents(adult, 10, 6), 39000, 'six registered leaders at $65');
  eq(linePlannedCents(adult, 10, 7), 45500, 'a seventh leader registers');
  eq(linePlannedCents(adult, 40, 6), 39000, 'the scout count must not affect it');
  eq(linePlannedHeads(adult, 10, 6).leaders, 6, 'head count');
  eq(linePlannedCents(adult, 10, 0), 0, 'no leaders recorded yet');
});

test('an ordinary event does not pay for the leader roster', () => {
  // The leader count must never leak into a line that did not ask for it.
  const { freshLine, linePlannedCents, linePlannedHeads } = sandbox(REG_FNS);
  const bg = freshLine({ basis: 'per-head', scoutRateCents: 1500, adultRateCents: 1500 });
  eq(bg.includeLeaders, false, 'the default changed');
  eq(linePlannedHeads(bg, 10, 99).leaders, 0, 'the leader roster leaked into an event');
  eq(linePlannedCents(bg, 10, 99), 15000, 'ten scouts at $15, and not one adult');
});

test('the charter fee is flat — one unit, not one per scout', () => {
  const { SEED_EXPENSES, freshLine, linePlannedCents } = sandbox(REG_FNS);
  const chart = freshLine(SEED_EXPENSES.filter(e => e.name === 'Unit charter fee')[0]);
  eq(chart.basis, 'flat', 'basis');
  eq(linePlannedCents(chart, 30, 9), 10000, 'a bigger pack does not owe more charter fee');
});

test('nothing is seeded that the app cannot work out', () => {
  // A council fee or an optional subscription seeded at $0 looks planned-for and
  // understates the plan, which sets the popcorn goal too LOW.
  const { SEED_EXPENSES } = sandbox(REG_FNS);
  eq(SEED_EXPENSES.length, 3, 'the seed should be exactly the three derivable costs');
  const names = SEED_EXPENSES.map(e => e.name).sort();
  eq(names, ['Adult leader registration', 'Unit charter fee', 'Youth registration'], 'seeded lines');
  const seed = /var SEED_EXPENSES = \[[\s\S]*?\n  \];/.exec(SCRIPT)[0];
  ok(!/council/i.test(seed), 'a council program fee is being guessed at');
  ok(!/Scout Life/i.test(seed), 'an optional subscription is being seeded');
  ok(!/joining/i.test(seed), 'the $25 joining fee abolished in 2024 is being seeded');
});

test('seeding registration is idempotent, and independent of the activity slate', () => {
  const fn = /function seedStandardYear\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'seedStandardYear() not found');
  ok(/existingExp\[t\.name\.toLowerCase\(\)\]/.test(fn[0]), 'seeding twice would duplicate the registration lines');
  ok(/if \(added \|\| addedExp\)/.test(fn[0]),
    'a pack that already has the activities would be told nothing was added');
});

test('every planning call passes the leader count', () => {
  // A missed one silently plans adult registration at zero.
  // Walk each call balancing parens, so a nested activeScouts() does not fool the check.
  const bad = [];
  const NEEDLE = 'linePlannedCents(';
  for (let i = SCRIPT.indexOf(NEEDLE); i !== -1; i = SCRIPT.indexOf(NEEDLE, i + 1)) {
    if (/[.\w]/.test(SCRIPT[i - 1] || '')) continue;            // skip the declaration
    let depth = 0, args = [''], j = i + NEEDLE.length;
    for (; j < SCRIPT.length; j++) {
      const ch = SCRIPT[j];
      if (ch === '(') depth++;
      else if (ch === ')') { if (!depth) break; depth--; }
      if (!depth && ch === ',') { args.push(''); continue; }
      args[args.length - 1] += ch;
    }
    // 3 args, or 4 once the family count is passed for a per-family line. Fewer means somebody
    // dropped the leader count, which silently plans adult registration at zero.
    if (args.length !== 3 && args.length !== 4) bad.push(NEEDLE + args.join(',') + ')');
  }
  eq(bad, [], 'these calls omit the leader count: ' + bad.join(' | '));
  ok(/return linePlannedCents\(l, roster\.length, activeLeaders\(\)\.length, familiesOf\(roster\)\.length\);/.test(SCRIPT),
    'the state-reading wrapper does not pass the line roster, the ACTIVE leaders and the family count');
});

test('a leader who has moved on stops costing the pack money', () => {
  // state.leaders is every leader ever added. Counting it would keep paying registration
  // for people who left — and the line is seeded, so nobody would think to check it.
  ok(/function activeLeaders\(\) \{ return state\.leaders\.filter\(function \(l\) \{ return !l\.archived; \}\); \}/.test(SCRIPT),
    'there is no active-leader helper');
  ok(/l\.archived = l\.archived === true;/.test(SCRIPT), 'leaders cannot be archived');
  // Every place that asks "how many leaders" must count the ACTIVE ones. (The raw list is
  // still fine as a loop bound, an "any data at all" check, or a splice index — this checks
  // the places where the number is a HEAD COUNT.)
  //
  // computeBudget and fundingSummary no longer hold a leader count of their own: both plan
  // through linePlanned(), which is pinned to activeLeaders() by the test above. That is the
  // point of the single wrapper — one place to get it right — so what they are checked for
  // here is that they never went back to counting heads themselves.
  ['function computeBudget', 'function fundingSummary'].forEach(function (fname) {
    const re = new RegExp(fname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}');
    const fn = re.exec(SCRIPT);
    ok(fn, fname + '() not found');
    ok(!/state\.leaders\.length/.test(fn[0]), fname + ' counts archived leaders');
    ok(!/linePlannedCents\(/.test(fn[0]),
      fname + ' prices a line itself instead of going through linePlanned, so a den-limited '
      + 'event would be planned against the whole pack');
  });
  ['function lineOptionControls'].forEach(function (fname) {
    const re = new RegExp(fname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}');
    const fn = re.exec(SCRIPT);
    ok(fn, fname + '() not found');
    ok(!/state\.leaders\.length/.test(fn[0]), fname + ' counts archived leaders');
    ok(/activeLeaders\(\)\.length/.test(fn[0]), fname + ' does not count active leaders');
  });
});

test('an archived leader is not nagged about, and can come back', () => {
  ok(/activeLeaders\(\)\.forEach\(function \(l\) \{\s*\n\s*leaderStatus\(l\)/.test(SCRIPT),
    'Home still chases training for leaders who have left');
  ok(/act === 'archive-leader' \|\| act === 'restore-leader'/.test(SCRIPT), 'archiving is one-way or missing');
  ok(/data-act="toggle-leaders-archived"/.test(SCRIPT), 'archived leaders cannot be seen again');
});

test('a toast wraps instead of running off both edges of a phone', () => {
  // It is centred and position:fixed, so nowrap never gave anything to scroll — a long
  // message simply ran past both edges and lost text at each end. Several toasts are the
  // only place the app says what it just did.
  const css = /\.toast \{[\s\S]*?\n  \}/.exec(SCRIPT_CSS || '');
  const rule = css ? css[0] : (/\.toast \{[\s\S]*?\n  \}/.exec(HTML) || [''])[0];
  ok(rule, '.toast rule not found');
  ok(!/white-space: nowrap/.test(rule), 'a long toast still runs off the screen');
  ok(/white-space: normal/.test(rule), 'the toast does not wrap');
  ok(/max-width:/.test(rule), 'the toast has no width ceiling, so it can still overflow');
});

/* ================================================================
   Stretch goal — an aim above the minimum the plan already needs.
   ================================================================ */

test('a stretch goal only counts when it is above the minimum', () => {
  // At or below what the plan needs it is a typo, not an ambition — and showing it would
  // make the pack look further along than it is.
  const { stretchGoalOf } = sandbox(['stretchGoalOf']);
  eq(stretchGoalOf(800000, 607813), 800000, 'above the minimum');
  eq(stretchGoalOf(500000, 607813), 0, 'below the minimum is ignored');
  eq(stretchGoalOf(607813, 607813), 0, 'equal to the minimum is not a stretch');
  eq(stretchGoalOf(0, 607813), 0, 'unset');
  eq(stretchGoalOf(100, 0), 100, 'any stretch counts when no minimum is derived yet');
});

test('the stretch is reported apart from the minimum, never merged', () => {
  const fn = /function computePackTotals\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'computePackTotals() not found');
  ok(/stretchGoalOf\(state\.stretchGoalCents \|\| 0, teGoalNow\)/.test(fn[0]),
    'the stretch is not validated against the minimum');
  ok(/stretch: stretchNow/.test(fn[0]), 'the stretch is not reported');
  ok(/teGoal: teGoalNow/.test(fn[0]), 'the minimum stopped being the goal everything else uses');
});

test('the two goals get separate bars, on their own scales', () => {
  // Two scales on one bar is how "we are at 100%" and "we are at 76%" end up looking the same.
  // Anchor on the stretch bar itself — the "Trail's End goal" eyebrow appears in more than
  // one screen, and the first match was a different block entirely.
  const i = SCRIPT.indexOf('aria-label="Stretch goal ');
  ok(i !== -1, 'the stretch progress bar not found');
  const blk = SCRIPT.slice(Math.max(0, i - 1400), i + 900);
  // teBarGoal is teGoal plus a cash goal that runs through Trail's End (P3, 2026-09).
  ok(/pack\.teEligible \/ pack\.teBarGoal/.test(blk), 'the minimum bar is not measured against the minimum');
  // teBarStretch is the stretch plus the same cash goal (K2, 2026-09-28).
  ok(/pack\.teEligible \/ pack\.teBarStretch/.test(blk), 'the stretch bar is not measured against the stretch');
  ok(/beyond what the budget needs/.test(blk), 'the stretch does not say how far past the plan it reaches');
  ok(/of <span class="money">' \+ fmt\(pack\.teBarGoal\) \+ '<\/span> needed/.test(blk),
    'the minimum bar does not say the figure is what is NEEDED');
});

test('the stretch goal stays with the leaders', () => {
  // Chosen scope: it must not reach the published parent document or the family digest.
  //
  // ⚠ This guard used to be a bare /stretch/i scan, and it can no longer be: 2026-08-31 gave the
  // ladder a STRETCH TIER scale, which is a different thing entirely and is published on purpose.
  // The two have always been unrelated in code — stretchGoalOf/pack.stretch touch no tier function
  // and tierIsStretch touches no goal — so the guard now names the goal's own identifiers instead
  // of the word they happen to share.
  const GOAL = /stretchGoalCents|stretchGoalOf|pack\.stretch\b|\.stretch\s*>\s*0|Stretch goal/;
  const pv = /function buildParentView\(src, opts\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(pv, 'buildParentView() not found');
  ok(!GOAL.test(pv[0]), 'the stretch goal leaked into the parent view');
  const dg = /function monthlyDigest\(mk\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(dg, 'monthlyDigest() not found');
  ok(!GOAL.test(dg[0]), 'the stretch goal leaked into the family digest');
  // And the guard still has teeth: it fires on the real thing.
  ok(GOAL.test(/function renderTotals\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0]),
    'the goal guard no longer matches the stretch goal it is protecting');
  // The ladder's stretch block is a TIER scale — no money in it, only names and percentages.
  const lad = /ladderProg\.stretch = \{[\s\S]*?\n          \};/.exec(SCRIPT);
  ok(lad, 'the published ladder lost its stretch scale');
  ok(/topName:/.test(lad[0]) && /planPct:/.test(lad[0]), 'the stretch scale is published without its bounds');
  ok(!/Cents/.test(lad[0]), 'a money figure reached the published ladder');
});

test('Season setup says what the Trail’s End goal actually is', () => {
  // The question it kept raising: is this commission, or what we ring up?
  ok(/is <strong>what the pack sells<\/strong>, not what it keeps/.test(SCRIPT),
    'nothing explains that the goal is gross sales rather than commission');
  ok(/It is the <strong>minimum<\/strong>/.test(SCRIPT), 'nothing says the derived goal has no margin in it');
  ok(/stretch goal is below the minimum, so it’s ignored/.test(SCRIPT),
    'a stretch below the minimum is silently dropped with no explanation');
});

test('re-seeding never plans the same activity twice', () => {
  // del-event keeps the budget line when its event goes (the ledger posts against it), so
  // matching only event names let a re-seed re-create a name that was still budgeted for.
  const fn = /function seedStandardYear\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'seedStandardYear() not found');
  ok(/state\.events\.forEach\(function \(e\) \{ if \(e\.kind === 'activity'\) existing\[/.test(fn[0]),
    'event names are not checked');
  ok(/state\.budget\.activities\.forEach\(function \(a\) \{ existing\[/.test(fn[0]),
    'a budget line whose event was deleted would be seeded again — the same money twice');
});

/* ================================================================
   The program year starts in JULY, not September.
   ================================================================ */

const YEAR_FNS = ['PROGRAM_MONTHS', 'PROGRAM_TURN', 'PROGRAM_START_MONTH', 'pad2',
  'defaultProgramYear', 'programYearStartISO', 'programYearEndISO', 'dateToSlot',
  'slotMonthNumber'];

test('the twelve slots run July to June', () => {
  const { PROGRAM_MONTHS, slotMonthNumber } = sandbox(YEAR_FNS);
  eq(PROGRAM_MONTHS[0], 'July', 'slot 0');
  eq(PROGRAM_MONTHS[11], 'June', 'slot 11');
  eq(PROGRAM_MONTHS.length, 12, 'still twelve months');
  eq(PROGRAM_MONTHS.slice().sort().length, 12, 'no month repeated or dropped');
  // Slot → calendar month, across the turn of the calendar year.
  eq([0, 5, 6, 11].map(slotMonthNumber), [7, 12, 1, 6], 'Jul, Dec, Jan, Jun');
});

test('a date maps to its slot, and back, for every month', () => {
  const { dateToSlot, slotMonthNumber } = sandbox(YEAR_FNS);
  for (let m = 1; m <= 12; m++) {
    const iso = '2025-' + String(m).padStart(2, '0') + '-15';
    const slot = dateToSlot(iso);
    ok(slot >= 0 && slot <= 11, 'month ' + m + ' gave slot ' + slot);
    eq(slotMonthNumber(slot), m, 'month ' + m + ' did not round-trip');
  }
  eq(dateToSlot('2025-07-01'), 0, 'July is the first slot');
  eq(dateToSlot('2026-06-30'), 11, 'June is the last');
});

test('the program year window is July 1 to June 30', () => {
  const { programYearStartISO, programYearEndISO } = sandbox(YEAR_FNS);
  eq(programYearStartISO(2026), '2026-07-01', 'start');
  eq(programYearEndISO(2026), '2027-06-30', 'end');
});

test('the default program year turns over in July, not September', () => {
  // A pack opening the app in July is planning the year that starts NOW, not the one that
  // started eleven months ago.
  const ctx = sandbox(YEAR_FNS);
  const realDate = Date;
  function at(y, mZeroBased, d) {
    ctx.Date = class extends realDate {
      constructor() { super(); return new realDate(y, mZeroBased, d); }
    };
    const got = ctx.defaultProgramYear();
    ctx.Date = realDate;
    return got;
  }
  eq(at(2026, 6, 15), 2026, 'mid-July starts the new program year');
  eq(at(2026, 5, 30), 2025, 'the end of June is still the old one');
  eq(at(2026, 11, 1), 2026, 'December sits in the year that began in July');
  eq(at(2027, 0, 5), 2026, 'January belongs to the year before it');
});

test('an existing pack’s stored slots are rebased once, keeping their month', () => {
  // Slot 0 used to mean September and now means July, so every stored slot is two months
  // out. Rebasing twice would shift by four and nothing would look obviously wrong.
  const ctx = sandbox(NORMALIZE_FNS);
  const d = {
    version: 1, scouts: [],
    // Pre-rebase: 0=Sep, 3=Dec, 4=Jan, 11=Aug. No slotsRebased flag.
    events: [
      { id: 'a', kind: 'activity', name: 'Sep', date: '', slot: 0 },
      { id: 'b', kind: 'activity', name: 'Dec', date: '', slot: 3 },
      { id: 'c', kind: 'activity', name: 'Jan', date: '', slot: 4 },
      { id: 'e', kind: 'activity', name: 'Aug', date: '', slot: 11 }
    ],
    budget: { programYear: 2025, activities: [], expenses: [] }
  };
  const once = ctx.normalizeState(JSON.parse(JSON.stringify(d)));
  const slots = {};
  once.events.forEach(e => { slots[e.name] = e.slot; });
  eq(slots, { Sep: 2, Dec: 5, Jan: 6, Aug: 1 }, 'every slot should keep its calendar month');
  eq(once.budget.slotsRebased, true, 'the rebase is not marked done');
  const twice = ctx.normalizeState(JSON.parse(JSON.stringify(once)));
  const again = {};
  twice.events.forEach(e => { again[e.name] = e.slot; });
  eq(again, slots, 'the rebase ran a second time and shifted everything again');
});

test('a dated event ignores the rebase — its date already decides', () => {
  const ctx = sandbox(NORMALIZE_FNS);
  const after = ctx.normalizeState({
    version: 1, scouts: [],
    events: [{ id: 'a', kind: 'activity', name: 'Campout', date: '2025-10-18', slot: 0 }],
    budget: { programYear: 2025, activities: [], expenses: [] }
  });
  eq(after.events[0].slot, 3, 'October is slot 3, whatever was stored');
});

test('a brand new pack is born July-based and never rebases', () => {
  const { freshBudget } = sandbox(['PROGRAM_START_MONTH', 'defaultProgramYear', 'freshBudget']);
  eq(freshBudget().slotsRebased, true, 'a fresh budget would be rebased on first load');
});

test('the seeded slate keeps every activity in the month it was always in', () => {
  const { SEED_ACTIVITIES, PROGRAM_MONTHS } = sandbox(['PROGRAM_MONTHS', 'PROGRAM_TURN',
    'PROGRAM_START_MONTH', 'SA_FEES', 'SEED_EXPENSES', 'SEED_ACTIVITIES']);
  const month = n => PROGRAM_MONTHS[SEED_ACTIVITIES.filter(a => a.name.indexOf(n) === 0)[0].slot];
  eq(month('School Night'), 'September', 'School Night');
  eq(month('Popcorn kickoff'), 'September', 'Popcorn kickoff');
  eq(month('Fall family campout'), 'October', 'campout');
  eq(month('Holiday pack party'), 'December', 'holiday party');
  eq(month('Pinewood Derby'), 'January', 'derby');
  eq(month('Blue & Gold'), 'February', 'Blue & Gold');
  eq(month('Crossover'), 'May', 'crossover');
  eq(month('Day camp'), 'June', 'day camp');
  // The one deliberate move: a straight remap would have put resident camp in July, the
  // very month a pack is doing this planning.
  eq(month('Resident camp'), 'June', 'resident camp should sit at the END of the year');
  SEED_ACTIVITIES.forEach(a => ok(a.slot >= 0 && a.slot <= 11, a.name + ' has slot ' + a.slot));
});

test('the program-year constants are declared before load() reads them', () => {
  // This is the one the sliced-eval sandbox cannot catch, because it evaluates declarations
  // in whatever order the test lists them. In the real file `var` hoists the NAME but not
  // the VALUE, and both defaultProgramYear and dateToSlot run inside load() → normalizeState
  // while the page is initialising. Declared too far down, they were undefined at that
  // moment: dateToSlot returned NaN for every dated event (stored as null) and
  // defaultProgramYear quietly answered a year early.
  const at = (needle) => SCRIPT.indexOf(needle);
  const load = at('  var state = load();');
  ok(load !== -1, 'the load() call not found');
  ['var PROGRAM_MONTHS', 'var PROGRAM_TURN', 'var PROGRAM_START_MONTH'].forEach(function (decl) {
    const i = at('  ' + decl);
    ok(i !== -1, decl + ' not found');
    ok(i < load, decl + ' is declared after load() runs — it will be undefined during normalizeState');
  });
});

test('a budget row leads with the name and the money, not the settings', () => {
  // Every row used to lay eight controls of equal weight across two wrapped lines, so a
  // month of activities read as a wall of repeated "Flat cost / Other / Pack pays".
  const fn = /function budgetLineRow\(l, scoutN, opts\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'budgetLineRow() not found');
  // The primary line runs from brow-main to the line that closes it. `money` is built just
  // above and dropped in, so check the variable lands there and that it carries bmoney.
  const main = /brow-main[\s\S]*?\n      '<\/div>'/.exec(fn[0]);
  ok(main, 'the row has no primary line');
  ok(/class="bname"/.test(main[0]), 'the name is not on the primary line');
  ok(/\n\s*money \+/.test(main[0]), 'the money is not on the primary line');
  ok(/class="bmoney"|bmoney money/.test(fn[0]), 'nothing is marked up as the row money');
  ok(!/line-category|line-funded|line-basis/.test(main[0]),
    'a settings drop-down is back on the primary line');
});

test('the settings are still reachable, one tap away', () => {
  // Quieter must not mean gone.
  const fn = /function budgetLineRow\(l, scoutN, opts\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(/data-act="line-options"/.test(fn[0]), 'no disclosure for the settings');
  ok(/open \? lineOptionControls/.test(fn[0]), 'the settings never render');
  const opt = /function lineOptionControls\(l, scoutN, collectKey\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(opt, 'lineOptionControls() not found');
  ['line-basis', 'line-category', 'line-funded', 'line-scout-rate', 'line-include-leaders',
    'line-leader-rate', 'line-adult-rate', 'line-sibling-rate', 'line-direct']
    .forEach(function (ch) { ok(opt[0].indexOf('data-ch="' + ch + '"') !== -1, ch + ' is no longer editable'); });
  ok(/act === 'line-options'/.test(SCRIPT), 'the disclosure has no handler');
});

test('activities and expenses share one row shape', () => {
  // They had two near-identical renderers that drifted apart.
  ok(!/function lineMoneyControls/.test(SCRIPT), 'the old split renderer is still here');
  const rb = /function renderBudget\(\) \{[\s\S]*?\n    return h;\n  \}/.exec(SCRIPT);
  ok(rb, 'renderBudget() not found');
  ok(/budgetLineRow\(e, bud\.scouts/.test(rb[0]), 'expenses do not use the shared row');
  ok(/function activityLineRow\(a, scoutN\) \{[\s\S]*?budgetLineRow\(a, scoutN/.test(SCRIPT),
    'activities do not use the shared row');
});

test('the row does not repeat the month its group already states', () => {
  const fn = /function activityLineRow\(a, scoutN\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'activityLineRow() not found');
  ok(!/slotLabel\(ev\.slot\)/.test(fn[0]),
    'the row still prints "September 2026" under a heading that already says it');
  ok(/no date yet/.test(fn[0]), 'the row no longer says when there is no date');
});

/* ================================================================
   Making the budget list scannable — owner, 2026-08-02: "make our budget line list easier to
   read and scan, the way it currently looks, it's kind of hard on the eyes."

   Every test here pins a DECISION about the list, because each one is a change somebody could
   undo in good faith while tidying up. The first is not typography at all: no amount of it
   rescues a list whose ORDER is arbitrary.
   ================================================================ */

const inSlotCtx = (() => {
  const ctx = vm.createContext({});
  vm.runInContext(`
    ${slice('activitiesInSlot')}
    ${slice('dateInProgramYear')}
    ${slice('programYearStartISO')}
    ${slice('programYearEndISO')}
    ${slice('PROGRAM_START_MONTH')}
    ${slice('pad2')}
    function eventForLine(a) { return EVENTS.find(function (e) { return e.id === a.eventId; }) || null; }
    function lineSlot(a) { var ev = eventForLine(a); return ev ? ev.slot : -1; }
    var EVENTS = [];
    var state = { budget: { programYear: 2026, activities: [] } };`, ctx);
  return ctx;
})();

function inSlotNames(rows) {
  inSlotCtx.EVENTS = rows.map((r, i) => ({ id: 'e' + i, slot: r.slot === undefined ? 3 : r.slot, date: r.date }));
  inSlotCtx.state.budget.activities = rows.map((r, i) => ({ id: 'a' + i, name: r.name, eventId: 'e' + i }));
  return inSlotCtx.activitiesInSlot(3).map((a) => a.name);
}

test('a month lists its activities in DATE order, not the order they were added', () => {
  // A real pack's October, in the array order its record actually held it: the group read
  // "Oct 17, Oct 24, Oct 25, Oct 10, Oct 2".
  eq(inSlotNames([
    { name: 'Jamboree', date: '2026-10-17' },
    { name: 'Fishing Derby', date: '2026-10-24' },
    { name: 'Trunk or Treat', date: '2026-10-25' },
    { name: 'Corn Maze', date: '2026-10-10' },
    { name: 'Fall Camping', date: '2026-10-02' }
  ]), ['Fall Camping', 'Corn Maze', 'Jamboree', 'Fishing Derby', 'Trunk or Treat'],
  'the month group is still in whatever order the array happens to hold');
});

test('an undated line sorts after the dated ones, and ties are stable', () => {
  // Undated last matches unbudgetedActivities(). Same-date lines fall back to the NAME so the
  // order does not depend on which was typed first — two rows swapping places between renders
  // is its own kind of unreadable.
  eq(inSlotNames([
    { name: 'No date at all', date: '' },
    { name: 'Zebra', date: '2026-10-09' },
    { name: 'Apple', date: '2026-10-09' }
  ]), ['Apple', 'Zebra', 'No date at all'], 'undated/tied ordering is wrong');
});

test('sorting the month group does not reorder the stored budget', () => {
  // .filter() hands back a fresh array, so .sort() on it is safe — but only as long as it stays
  // a filter. Sorting state.budget.activities in place would silently reorder the saved record
  // and sync that reordering to every other leader.
  const fn = /function activitiesInSlot\(slot\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  ok(/state\.budget\.activities\.filter\(/.test(fn), 'no longer filters into a new array');
  ok(!/state\.budget\.activities\.sort\(/.test(fn), 'sorts the stored array in place');
});

test('the money is one column whether the row shows a figure or a field', () => {
  // These were a <span> and an <input> with different box geometry and an 11px padding fudge to
  // fake the alignment, so the right edge of the column moved from row to row.
  const rule = /\.brow \.bmoney \{[^}]*\}/.exec(SCRIPT_CSS);
  ok(rule, '.brow .bmoney rule not found');
  ok(/width:/.test(rule[0]) && /padding:/.test(rule[0]) && /text-align: right/.test(rule[0]),
    'the shared money box no longer sets width, padding and alignment in one place');
  ok(!/span\.bmoney \{[^}]*padding-right: 11px/.test(SCRIPT_CSS),
    'the padding fudge that faked the alignment is back');
  ok(/\.brow span\.bmoney \{[^}]*border: 1px solid transparent/.test(SCRIPT_CSS),
    'the figure does not reserve the border width the field spends, so they cannot line up');
});

test('the row fields are quiet at rest and reveal themselves on demand', () => {
  // A month of activities was ten bordered input boxes stacked up, and the boxes were the
  // highest-contrast marks on the card — louder than any figure inside them.
  ok(/\.brow input\.bname, \.brow input\.bmoney \{[^}]*border-color: transparent/.test(SCRIPT_CSS),
    'the name and cost fields are bordered at rest again');
  ok(/\.brow:hover input\.bname[^{]*\{[^}]*border-color: var\(--line\)/.test(SCRIPT_CSS),
    'hover no longer reveals that the row is editable');
  ok(/\.brow input\.bname:focus[^{]*\{[^}]*border-color: var\(--line\)/.test(SCRIPT_CSS),
    'focus no longer draws the field it is in — quiet must not mean invisible to the keyboard');
  // The one exception: an EMPTY name has no text to read, so on a touch screen (no hover) there
  // would be nothing at all to say it is a field.
  ok(/\.brow input\.bname:placeholder-shown \{[^}]*border-color: var\(--line\)/.test(SCRIPT_CSS),
    'a brand-new unnamed row gives no sign it can be typed into');
  ok(!/\.brow input\.bmoney:placeholder-shown/.test(SCRIPT_CSS),
    'every free activity is back to wearing a box around the word "Cost"');
});

test('the payer rail is legible in BOTH themes', () => {
  // --navy is a BACKGROUND token in dark mode — it is what the topbar is filled with — so
  // #1C2F47 on a #202935 card measured 1.08:1 and the rail simply did not exist on the theme
  // the app opens in by default. --good is a foreground token in both.
  ok(/\.brow\.pays-families::after \{[^}]*var\(--good\)/.test(SCRIPT_CSS),
    'the families-pay rail is painted in something other than --good');
  ok(!/\.brow\.pays-families::after \{[^}]*var\(--navy\)/.test(SCRIPT_CSS),
    'the rail is back on --navy, which is invisible on a dark card');
  // Solid vs dashed is what actually separates the two, because they are within 1.2:1 of each
  // other in luminance in both themes.
  ok(/\.brow\.pays-direct::after \{[^}]*dashed/.test(SCRIPT_CSS),
    'paid-direct is no longer told apart by anything but colour');
  // And pack-pays gets NO rail: it is the default and the majority, and a marker on every row
  // marks nothing.
  ok(!/\.brow\.pays-pack::after/.test(SCRIPT_CSS), 'the default arrangement has grown a marker');
  const fn = /function budgetLineRow\(l, scoutN, opts\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  ok(/lineFamilyFunded\(l\) \? \(l\.paidDirectTo \? ' pays-direct' : ' pays-families'\) : ''/.test(fn),
    'the rail no longer follows who actually pays');
  // Redundant encoding: the words stay in the sentence, so nothing here depends on colour.
  const sum = /function lineSummarySegments\(l\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  ok(/families pay the pack/.test(sum) && /pack pays/.test(sum),
    'who pays is now carried by the rail alone');
});

test('the summary breaks between facts, never through one', () => {
  // Unscoped, so a second surface (Next reward tier) builds the same sentence from the same
  // rules rather than a copy that can drift. Assert the RULE, not where it is scoped.
  ok(/\n  \.bseg \{[^}]*white-space: nowrap/.test(SCRIPT_CSS),
    'a segment can wrap inside itself again — "Activities & outings" comes apart');
  // The separator belongs to the segment AFTER it. Emitted between them it can end a line,
  // which leaves a dot pointing at nothing.
  ok(/\.bseg \+ \.bseg::before \{[^}]*content:/.test(SCRIPT_CSS),
    'the interpunct is not drawn inside the following segment');
  const fn = /function lineSummaryHtml\(l\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'lineSummaryHtml() not found');
  ok(!/join\(' <span class="bdot">/.test(fn[0]),
    'the segments are joined by a dot element again, which can dangle at a line break');
  // Segments are the single source and lineSummaryHtml is the only consumer. There is no
  // plain-text twin: splitting one sentence across two builders is how they drift, and keeping
  // an uncalled one alive behind a passing test is worse than not having it.
  ok(!/function lineSummaryText\(/.test(SCRIPT),
    'a second, uncalled builder for the same sentence is back');
});

test('the summary is sized so the actions never get pushed onto their own line', () => {
  // With flex-wrap on, a line breaks on items' hypothetical sizes BEFORE any of them is allowed
  // to shrink. A summary sized to its own content therefore pushed the whole action cluster down
  // and left a band of empty row beside it — worse than the ragged version it replaced.
  const rule = /\.brow-meta \.bsum \{[^}]*\}/.exec(SCRIPT_CSS);
  ok(rule, '.brow-meta .bsum rule not found');
  ok(/flex: 1 1 \d+px/.test(rule[0]),
    'the summary is back on a content-sized basis, so the actions will wrap away from it');
});

test('the three row actions travel as one cluster', () => {
  // Ragged is the enemy of scanning: five rows of "Record actual" starting at five different
  // x-positions read as five different things.
  const fn = /function budgetLineRow\(l, scoutN, opts\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  const acts = /<span class="bacts">[\s\S]*?<\/span>'/.exec(fn);
  ok(acts, 'the actions are no longer wrapped in one cluster');
  ok(/actualBtn\(l\.id\)/.test(acts[0]), 'Record actual left the cluster');
  ok(/data-act="line-options"/.test(acts[0]), 'Options left the cluster');
  ok(/tinyDangerBtn\(opts\.delAct/.test(acts[0]), 'the remove button left the cluster');
  ok(/\.brow-meta \.bacts \{[^}]*margin-left: auto/.test(SCRIPT_CSS),
    'the cluster no longer holds a column of its own');
  // ...and it goes back to the left edge on a phone, where the row is read down its left side.
  ok(/@media \(max-width: 520px\) \{[\s\S]*?\.brow-meta \.bacts \{[^}]*margin-left: -4px/.test(SCRIPT_CSS),
    'on a phone the actions are stranded at the far right of a full-width sentence');
});

test('destroying a line is not the loudest thing on the card', () => {
  // Red answers "am I about to destroy something?", which is a question asked on the way to the
  // control — not from across the page by five ✕s in a list where nothing is wrong.
  // In the BASE rule, so it reaches all 20 call sites and — critically — cannot outrank
  // `.btiny.armed`. A descendant copy at (0,3,0) beat `.btiny.armed { color: #FFF }` at (0,2,0)
  // and computed --bad on a --bad fill: the confirm step was invisible in light mode. Dark mode
  // survived on a (0,4,0) theme override, which is why it went unseen.
  ok(/\n  \.btiny \{[^}]*color: var\(--ink-soft\)/.test(SCRIPT_CSS),
    'the remove button is red at rest again');
  ok(/\.btiny:hover, \.btiny:focus-visible \{[^}]*color: var\(--bad\)/.test(SCRIPT_CSS),
    'reaching for it no longer turns it red');
  // The lookbehind is load-bearing: without it `border-color: var(--bad)` satisfies the pattern,
  // and .btiny.armed legitimately sets that. Only the INK is forbidden here.
  ok(!/\.btiny[^{]*\.armed \{[^}]*(?<![-\w])color: var\(--bad\)/.test(SCRIPT_CSS),
    'an .armed selector sets color:--bad again — that is --bad text on the --bad fill .armed draws');
  ok(/\.btiny\.armed \{[^}]*background: var\(--bad\)/.test(SCRIPT_CSS),
    '.armed no longer fills itself, so there is nothing to read the ink against');
  // No local copies left to drift or to re-open the specificity fight.
  ok(!/\.brow-meta \.btiny/.test(SCRIPT_CSS), 'a per-list copy of the rule is back');
  ok(!/\.adult-chip \.btiny \{[^}]*color:/.test(SCRIPT_CSS), 'the .adult-chip copy is back');
  // It is a destructive control and it keeps its 36px target.
  ok(/\n  \.btiny \{[^}]*min-height: 36px/.test(SCRIPT_CSS),
    'the delete target has been shrunk below the 36px the rest of the app uses');
});

test('a month heading reads as a label, not as another activity', () => {
  // At body size and body weight it was indistinguishable from an activity name, so the eye had
  // to work out which lines were headings. All four group headings use the one treatment.
  ok(/\.bmonth-head \.bmonth-name \{[^}]*text-transform: uppercase/.test(SCRIPT_CSS),
    'the group heading is no longer set apart from the rows under it');
  const rb = /function renderBudget\(\) \{[\s\S]*?\n    return h;\n  \}/.exec(SCRIPT)[0];
  eq((rb.match(/class="spread bmonth-head"/g) || []).length, 4,
    'not every budget group heading uses the shared treatment');
  ok(!/<div class="bmonth"><div class="spread" style="margin-bottom:4px">/.test(rb),
    'a group heading is back to a bare <strong> at body size');
});

/* ================================================================
   Den-limited events — Webelos Woods is not a bill for the Tigers
   ================================================================ */
// The helper run is a chain of one-line declarations, so slicing the first of them carries
// the rest through the end of eventRoster. That is how slice() works and it is what we want
// here: every helper in the group, evaluated together.
const dens = sandbox(['DENS', 'eventDens', 'denListLabel']);

test('an event is for the whole pack unless it says which dens', () => {
  const ctx = sandbox(NORMALIZE_FNS);
  eq(ctx.freshEvent().dens, [], 'a new event carries an empty den list');
  const d = ctx.normalizeState({
    version: 1, scouts: [],
    events: [{ id: 'ev1', kind: 'activity', name: 'Fall campout', date: '2025-10-04' }],
    budget: { programYear: 2025, activities: [], expenses: [] }
  });
  eq(d.events[0].dens, [], 'an existing event must migrate to "the whole pack"');
});

test('only an activity can be limited to dens', () => {
  // A den meeting already names its den and a pack meeting is everyone, so a den list on
  // either could only contradict the kind.
  const ctx = sandbox(NORMALIZE_FNS);
  const d = ctx.normalizeState({
    version: 1, scouts: [],
    events: [
      { id: 'ev1', kind: 'den', den: 'Wolf', date: '2025-10-01', dens: ['Tiger'] },
      { id: 'ev2', kind: 'pack', date: '2025-10-02', dens: ['Lion', 'Tiger'] },
      { id: 'ev3', kind: 'activity', name: 'Webelos Woods', date: '2025-10-03', dens: ['Webelos'] }
    ],
    budget: { programYear: 2025, activities: [], expenses: [] }
  });
  eq(d.events[0].dens, [], 'a den meeting kept a den list');
  eq(d.events[1].dens, [], 'a pack meeting kept a den list');
  eq(d.events[2].dens, ['Webelos'], 'an activity lost its den list');
});

test('a stored den list is rank-ordered, deduped, and free of junk', () => {
  // It is written from tick boxes in whatever order they were tapped, and it is read back
  // into printed labels — so one canonical shape, decided on the way in.
  const ctx = sandbox(NORMALIZE_FNS);
  const d = ctx.normalizeState({
    version: 1, scouts: [],
    events: [{ id: 'ev1', kind: 'activity', name: 'Woods', date: '2025-10-03',
      dens: ['Arrow of Light', 'Webelos', 'Webelos', 'Sixth Grade', 42] }],
    budget: { programYear: 2025, activities: [], expenses: [] }
  });
  eq(d.events[0].dens, ['Webelos', 'Arrow of Light'], 'den list');
});

test('a den-limited event narrows the roster; everything else does not', () => {
  const roster = [
    { id: 's1', name: 'Ada', den: 'Tiger' },
    { id: 's2', name: 'Ben', den: 'Webelos' },
    { id: 's3', name: 'Cal', den: 'Arrow of Light' },
    { id: 's4', name: 'Dee', den: '' }
  ];
  eq(dens.scoutsInDens(roster, []).length, 4, 'no restriction means the whole pack');
  eq(dens.scoutsInDens(roster, ['Webelos', 'Arrow of Light']).map(s => s.id), ['s2', 's3'], 'Webelos Woods');
  eq(dens.scoutsInDens(roster, ['Tiger']).map(s => s.id), ['s1'], 'Tiger Mania');
  // A scout with no den is in NO den's event. The UI says so out loud, because the
  // alternative is a family that quietly never gets billed.
  eq(dens.scoutsInDens(roster, ['Tiger', 'Webelos', 'Arrow of Light']).map(s => s.id), ['s1', 's2', 's3'],
    'a scout with no den set must not be swept into a den event');
});

test('a den list reads as English wherever it is printed', () => {
  eq(dens.denListLabel([]), '', 'no restriction says nothing');
  eq(dens.denListLabel(['Tiger']), 'Tiger', 'one den');
  eq(dens.denListLabel(['Webelos', 'Arrow of Light']), 'Webelos and Arrow of Light', 'two dens');
  eq(dens.denListLabel(['Tiger', 'Wolf', 'Bear']), 'Tiger, Wolf and Bear', 'three dens');
});

test('the restriction lives on the event, and the budget line reads it', () => {
  // Two fields holding "who is this for" is how they drift — the same reason the date left
  // the budget line in Phase 2.
  ok(/function lineDens\(l\) \{ return eventDens\(eventForLine\(l\)\); \}/.test(SCRIPT),
    'the budget line does not read the den list from its event');
  // The line must not grow a copy. (state.leaders[].dens is a different thing entirely —
  // which dens a LEADER leads — so this looks at the line's own shape, not at `l.dens`.)
  const fresh = /function freshLine\(patch\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fresh, 'freshLine() not found');
  ok(!/dens/.test(fresh[0]), 'a budget line has grown a den list of its own');
  const mig = /function migrateLineShape\(l\) \{[\s\S]*?\n    \}/.exec(SCRIPT);
  ok(mig, 'migrateLineShape() not found');
  ok(!/dens/.test(mig[0]), 'the line migration has started writing a den list');
});

test('a den-limited line bills only the dens it is for', () => {
  // Where the money actually narrows:
  //   * the plan            linePlanned → lineRoster        (pinned above)
  //   * expected fee income computeBudget → lineRoster      (what popcorn must cover)
  //   * raised charges      an EVENT line charges from attendance, and the attendance list
  //                         is narrowed by eventRoster — see the next test
  // syncCharges asks each line for its own roster too. For an event line that argument is
  // unused (charges come from attendance), and a line with no event is the whole roster by
  // definition — so today it can only ever equal activeScouts(). It is written this way so
  // that stays true by construction rather than by luck.
  const sc = /function syncCharges\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(sc, 'syncCharges() not found');
  // lineBillingRoster IS the line's own roster, narrowed again to one scout per family where the
  // fee is priced per family. Either way it is never the whole pack.
  ok(/chargeRowsFor\(r\.line, collapseMarkedToFamilies\(r\.line, marked\), lineBillingRoster\(r\.line\)\)/.test(sc[0]),
    'syncCharges raises roster charges against one pack-wide roster');
  ok(/function lineBillingRoster\(l\) \{[\s\S]*?if \(!linePerFamily\(l\)\) return roster;/.test(SCRIPT),
    'lineBillingRoster narrows a line that is not priced per family');
  ok(!/var roster = activeScouts\(\);/.test(sc[0]), 'syncCharges still holds one pack-wide roster');
  const cb = /function computeBudget\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(/lineBillingRoster\(item\)\.forEach/.test(cb[0]),
    'expected family income is counted against somebody other than whoever the line bills');
});

test('attendance and RSVP show the dens invited, and never hide a recorded reply', () => {
  const fn = /function eventRoster\(ev, recorded\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'eventRoster() not found');
  ok(/if \(recorded && recorded\[s\.id\]\) return true;/.test(fn[0]),
    'narrowing an event afterwards would hide a reply that was already given');
  ok(/ev\.kind === 'den' && ev\.den \? \[ev\.den\] : eventDens\(ev\)/.test(fn[0]),
    'a den meeting and a den-limited activity do not share one narrowing rule');
  ok(/var roster = eventRoster\(m, marked\);/.test(SCRIPT), 'attendance does not use eventRoster');
  ok(/var roster = eventRoster\(rsvpEv, map\);/.test(SCRIPT), 'the RSVP list does not use eventRoster');
  ok(/var roster = eventRoster\(getEvent\(evKey\), map\);/.test(SCRIPT),
    'the RSVP summary counts "no reply" against scouts who were never asked');
});

test('the rollover carries which dens an event was for', () => {
  // Webelos Woods is a Webelos event every year: the restriction is by den, not by the
  // scouts who happened to be in it. Losing it would quietly re-bill the whole pack.
  const fn = /function rolloverYear\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'rolloverYear() not found');
  ok(/dens: ev \? eventDens\(ev\)\.slice\(\) : \[\]/.test(fn[0]), 'the den list is not captured');
  ok(/freshEvent\(\{ kind: 'activity'[^)]*dens: c\.dens \}\)/.test(fn[0]), 'the den list is not carried');
});

test('parents are told an activity is not their den, and nothing more', () => {
  const fn = /function buildParentView\(src, opts\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'buildParentView() not found');
  ok(/detail: aDens \? aDens \+ ' only' : ''/.test(fn[0]),
    'the published activity does not say which dens it is for');
  ok(!/dens: /.test(fn[0]), 'the published shape grew a field instead of using the detail line');
});

/* ---------------- Families pay the council: three arrangements, one question ---------- */

test('the funding question offers all three arrangements', () => {
  // fundedBy + paidDirectTo stay two independent fields (DESIGN-money.md 3.2) — as CONTROLS
  // they made the commonest case in this pack reachable only by picking "Families pay" and
  // then noticing a text box appear underneath. Nobody found it.
  const fn = /function lineOptionControls\(l, scoutN, collectKey\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'lineOptionControls() not found');
  ['>Pack pays<', '>Families pay the pack<'].forEach((opt) => {
    ok(fn[0].includes(opt), 'the paid-by control is missing ' + opt);
  });
  ok(/value="direct"/.test(fn[0]), 'there is no way to say families pay somebody directly');
  // The third option names whoever is actually paid — a fixed "Council" label hid the vendor
  // case (a campground, the Scout Shop) from every pack that has one.
  ok(/>Families pay ' \+\s*\n?\s*esc\(l\.paidDirectTo \|\| 'the council or a vendor'\) \+ ' direct</.test(fn[0]),
    'the paid-directly option does not name the payee');
});

test("'direct' is a control, never a stored fundedBy value", () => {
  // A third fundedBy value reading 'council' was the wrong fix: it sounds like the council is
  // paying FOR the camp when the council is the one being paid.
  const { LINE_FUNDERS } = sandbox(['LINE_FUNDERS']);
  eq(LINE_FUNDERS, ['pack', 'families'], 'the stored funders');
  const { lineFundingMode } = sandbox(['lineFamilyFunded', 'lineFundingMode']);
  eq(lineFundingMode({ fundedBy: 'pack', paidDirectTo: '' }), 'pack', 'pack pays');
  eq(lineFundingMode({ fundedBy: 'families', paidDirectTo: '' }), 'families', 'families pay the pack');
  eq(lineFundingMode({ fundedBy: 'families', paidDirectTo: 'Council' }), 'direct', 'families pay the council');
  // The combination the model refuses to store must not be reachable from the control either.
  eq(lineFundingMode({ fundedBy: 'pack', paidDirectTo: 'Council' }), 'pack', 'pack-funded is pack-funded');
});

test('choosing "families pay Council direct" fills the payee in, and clearing it undoes it', () => {
  const fn = /if \(bk === 'name'\) \{[\s\S]*?\} else if \(bk === 'direct'\)/.exec(SCRIPT);
  ok(fn, 'the budget-line change handler was not found');
  ok(/if \(el\.value === 'direct'\) \{\s*\n\s*bl\.fundedBy = 'families';\s*\n\s*if \(!bl\.paidDirectTo\) bl\.paidDirectTo = 'Council';/.test(fn[0]),
    'picking the third option leaves the line with no payee, so it behaves as if the pack collects it');
  ok(/bl\.fundedBy = el\.value === 'families' \? 'families' : 'pack';\s*\n(\s*\/\/[^\n]*\n)*\s*bl\.paidDirectTo = '';/.test(fn[0]),
    'switching away from paid-direct leaves a stale payee behind');
});

/* ================================================================
   The pack covers scouts and leaders — owner ruling, 2026-07-27
   ================================================================ */

test('a per-leader fee migrates onto the leader rate, to the cent', () => {
  // adultsFrom:'leaders' meant "this adult rate is per REGISTERED LEADER" — the seeded adult
  // registration line. Moving it must not change a single planned figure.
  const ctx = sandbox(NORMALIZE_FNS);
  const d = ctx.normalizeState({
    version: 1, scouts: [],
    budget: { programYear: 2025, activities: [], expenses: [
      { id: 'e1', name: 'Adult leader registration', basis: 'per-head', category: 'registration',
        scoutRateCents: 0, adultRateCents: 6500, adultsFrom: 'leaders', adultsPerScout: 1 }
    ] }
  });
  const reg = d.budget.expenses[0];
  eq(reg.includeLeaders, true, 'the leader box should be ticked');
  eq(reg.leaderRateCents, 6500, 'the fee moved to the leader rate');
  eq(reg.adultRateCents, 0, 'it must not also read as a family-adult billing rate');
  eq(ctx.linePlannedCents(reg, 10, 6), 39000, 'six leaders at $65 — unchanged by the migration');
});

test('an assumed parent stops being planned, but is still billable', () => {
  // adultsFrom:'assumption' × adultsPerScout invented one parent per scout and charged the
  // PACK for every one. The rate survives as what a FAMILY owes; the plan drops it. Planned
  // figures on these lines fall on upgrade, and that is the correction being asked for.
  const ctx = sandbox(NORMALIZE_FNS);
  const d = ctx.normalizeState({
    version: 1, scouts: [],
    budget: { programYear: 2025, activities: [], expenses: [
      { id: 'e1', name: 'Blue & Gold', basis: 'per-head', category: 'events', fundedBy: 'families',
        scoutRateCents: 1500, adultRateCents: 1500, siblingRateCents: 800,
        adultsFrom: 'assumption', adultsPerScout: 1 }
    ] }
  });
  const bg = d.budget.expenses[0];
  eq(bg.includeLeaders, false, 'a family rate must not become a leader rate');
  eq(bg.leaderRateCents, 0, 'no leader rate is invented');
  eq(bg.adultRateCents, 1500, 'the family-adult rate survives — families still owe it');
  eq(bg.siblingRateCents, 800, 'the sibling rate survives');
  eq(ctx.linePlannedCents(bg, 10, 4), 15000, 'ten scouts at $15 and nobody else');
});

test('the old head-count fields are gone, and the migration runs once', () => {
  const ctx = sandbox(NORMALIZE_FNS);
  const once = ctx.normalizeState({
    version: 1, scouts: [],
    budget: { programYear: 2025, activities: [], expenses: [
      { id: 'e1', name: 'Camp', basis: 'per-head', scoutRateCents: 4000,
        adultRateCents: 4000, adultsFrom: 'leaders', adultsPerScout: 2 }
    ] }
  });
  const l1 = once.budget.expenses[0];
  ok(!('adultsFrom' in l1) && !('adultsPerScout' in l1), 'an old head-count field survived');
  const twice = ctx.normalizeState(JSON.parse(JSON.stringify(once)));
  const l2 = twice.budget.expenses[0];
  eq([l2.includeLeaders, l2.leaderRateCents, l2.adultRateCents], [true, 4000, 0],
    'running the migration twice moved the rate again');
});

test('family heads are charged from who came, never from the plan', () => {
  // The other half of the ruling: taking parents out of the PLAN must not take them out of
  // the BILL. §3.4's worked example — scout, both parents, one sibling — is unchanged.
  const { chargeRowsFor } = sandbox(['chargeRowsFor']);
  const line = { id: 'L1', eventId: 'E1', scoutRateCents: 1500, adultRateCents: 1500, siblingRateCents: 800 };
  const rows = chargeRowsFor(line, { s1: { scout: 1, adults: 2, siblings: 1 } }, []);
  eq(rows.length, 4, 'four heads, four charges');
  eq(rows.reduce((n, r) => n + r.amountCents, 0), 5300, '$15 + 2 × $15 + $8');
  eq(rows.filter(r => r.who === 'adult').length, 2, 'both parents');
});

test('ticking "include leaders" starts the leader rate at the scout rate', () => {
  // A campsite or a plate of food costs the same whoever it is for, so one tick should be
  // enough. Registration is the exception, and the field is right there.
  const fn = /if \(bk === 'name'\) \{[\s\S]*?\} else if \(bk === 'direct'\)/.exec(SCRIPT);
  ok(fn, 'the budget-line change handler was not found');
  ok(/bl\.includeLeaders = el\.checked;/.test(fn[0]), 'the checkbox does not set the flag');
  ok(/if \(bl\.includeLeaders && !bl\.leaderRateCents\) bl\.leaderRateCents = bl\.scoutRateCents \|\| 0;/.test(fn[0]),
    'ticking the box leaves the leader rate at zero, so it silently costs nothing');
});

test('the editor asks for a per-scout price, not a per-head guess', () => {
  const fn = /function lineOptionControls\(l, scoutN, collectKey\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'lineOptionControls() not found');
  ok(fn[0].includes('>per scout<'), 'the scout rate is not labelled per scout');
  ok(fn[0].includes('Include registered leaders'), 'there is no way to include leaders');
  // The July ruling killed `adultsFrom: 'assumption'` + `adultsPerScout` — a NUMBER of invented
  // parents, applied to every per-head line at once. A per-line CHECKBOX is the sanctioned way
  // back (owner ask, 2026-08-02: the Christmas party is priced per person), so this guard now
  // names the thing it forbids instead of matching the loose phrase "an assumption", which my own
  // explanatory comment tripped.
  ok(!/adultsPerScout|adultsFrom|adults\/scout/.test(fn[0]),
    'the invented-parents assumption is back in the editor');
  ok(!/data-ch="line-adults-per-scout"/.test(fn[0]), 'a per-scout adult COUNT input is back');
  ok(/type="checkbox" data-ch="line-include-adults"/.test(fn[0]),
    'the per-person option is not a checkbox — a count would be the old bug again');
  ok(fn[0].includes('One parent per scout'), 'there is no way to price a line per person');
  // The family rates are asked for on every line a family is billed for — whether the pack
  // collects it or the council does — but never on a per-family fee, which has no separate heads.
  const fam = /if \(\(mode === 'families' \|\| mode === 'direct'\) && !perFamily\) \{[\s\S]*?\n    \}/.exec(fn[0]);
  ok(fam, 'the family-heads group was not found, or is back to families-pay only');
  ok(/data-ch="line-adult-rate"/.test(fam[0]) && /data-ch="line-sibling-rate"/.test(fam[0]),
    'the family billing rates are outside that branch');
});

test('a scout’s name can be corrected', () => {
  // It was set once at add time and then fixed. A Trail's End import arrives with whatever
  // the parent typed into their own account, and a typo in a child's name is not something
  // anybody should have to live with.
  ok(/data-ch="scout-name"/.test(SCRIPT), 'there is no name field on the roster');
  ok(/if \(ch === 'scout-name'\) scEd\.name = el\.value\.trim\(\);/.test(SCRIPT),
    'the name field has no handler, or does not trim like a leader’s does');
  // Everything keys off the id, so a rename must not need to touch anything else.
  ok(!/scoutId === .*\.name|name === c\.scoutId/.test(SCRIPT), 'something is matching a scout by name');
});

/* ================================================================
   Reward tiers as a planning assumption — owner ask, 2026-07-27
   ================================================================ */

test('no tier is planned on until the pack names one', () => {
  // Planning on a tier is an optimistic claim about ten families. No pack record's goal may
  // move on its own because the app decided to be hopeful.
  const ctx = sandbox(NORMALIZE_FNS);
  const d = ctx.normalizeState({ version: 1, scouts: [], budget: { programYear: 2025, activities: [], expenses: [] } });
  eq(d.rewardTiers.planOnTierId, '', 'a tier is planned on by default');
  const kept = ctx.normalizeState({
    version: 1, scouts: [], rewardTiers: { duesCents: 0, tiers: [], planOnTierId: 'T2' },
    budget: { programYear: 2025, activities: [], expenses: [] }
  });
  eq(kept.rewardTiers.planOnTierId, 'T2', 'a pack that chose one loses the setting');
  // A stale id must not crash or silently plan on something: plannedTier resolves against the
  // real list and returns null when it does not match.
  ok(/function plannedTier\(\) \{[\s\S]*?return sortedTiers\(\)\.filter\(function \(t\) \{ return t\.id === id; \}\)\[0\] \|\| null;/.test(SCRIPT),
    'the planned tier is not resolved against the tier list');
});

test('the old "assume every tier" switch migrates to planning on the top one', () => {
  // Same figures the pack was already being shown, and from there it can pick a lower level.
  const ctx = sandbox(NORMALIZE_FNS);
  const on = ctx.normalizeState({
    version: 1, scouts: [],
    rewardTiers: { duesCents: 0, assumeAllEarn: true, tiers: [
      { id: 'T1', name: 'Dues', thresholdCents: 30000, covers: ['dues'] },
      { id: 'T2', name: 'Shirt', thresholdCents: 60000, covers: ['shirt'] },
      { id: 'T3', name: 'Prize', thresholdCents: 90000, covers: [] }
    ] },
    budget: { programYear: 2025, activities: [], expenses: [] }
  });
  eq(on.rewardTiers.planOnTierId, 'T2', 'the highest tier that COVERS something is the migration target');
  ok(!('assumeAllEarn' in on.rewardTiers), 'the old switch survived the migration');
  const off = ctx.normalizeState({
    version: 1, scouts: [],
    rewardTiers: { duesCents: 0, assumeAllEarn: false, tiers: [
      { id: 'T1', name: 'Dues', thresholdCents: 30000, covers: ['dues'] }
    ] },
    budget: { programYear: 2025, activities: [], expenses: [] }
  });
  eq(off.rewardTiers.planOnTierId, '', 'a pack that had it off must not start planning on a tier');
});

test('the assumption moves fees onto popcorn, and only ever raises the goal', () => {
  const fn = /function fundingSummary\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'fundingSummary() not found');
  ok(/var assumeCov = plannedCoverKeys\(\);/.test(fn[0]),
    'the fees loop does not consult the planned tier');
  // B falls by what the pack picks up, so C = A − B rises by the same amount. The subtraction
  // is floored against what is actually owed, so fees can never go negative and "raise the
  // goal" can never turn into "lower the goal".
  ok(/mine = Math\.min\(mine, owed\);/.test(fn[0]), 'the assumption could subtract more than is owed');
  ok(/tierAssumed \+= mine;/.test(fn[0]), 'what the assumption moved is not reported');
  ok(/tierAssumed: tierAssumed,/.test(fn[0]), 'tierAssumed is not returned for the worksheet to show');
});

test('a charge already waived is not taken off twice', () => {
  // A scout who really earned coverage left `standing` when the charge was waived. Counting
  // their share again would understate family income by that much a second time.
  const fn = /function fundingSummary\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(/return \(chargeIsOpen\(c\) && c\.who === who\) \? n \+ \(c\.amountCents \|\| 0\) : n;/.test(fn[0]),
    'the deduction counts settled charges, or charges for a head the tier did not cover');
  // With nothing charged yet, a covered share falls back to what the PLAN expects from it. That
  // used to be "the scout share or nothing", which was the same thing until a line could plan one
  // parent per scout — so this now asserts the behaviour rather than the old expression, and
  // linePlannedShare is what guarantees an UNPLANNED adult head still falls back to zero.
  ok(/: linePlannedShare\(r\.line, who\);/.test(fn[0]),
    'the fallback is not what the plan expects from that share');
  const shareCtx = vm.createContext({});
  vm.runInContext(
    `${slice('linePerHead')}\n${slice('linePerFamily')}\n${slice('linePlannedShare')}\n${slice('freshLine')}\n` +
    `${slice('uid')}\nfunction lineBillingRoster() { return [1, 2, 3]; }`, shareCtx);
  const linePlannedShare = shareCtx.linePlannedShare;
  const line = shareCtx.freshLine({ basis: 'per-head', scoutRateCents: 1200, adultRateCents: 1500, siblingRateCents: 800 });
  eq(linePlannedShare(line, 'adult'), 0,
    'an unrecorded adult head is being treated as forgone family income');
  eq(linePlannedShare(line, 'sibling'), 0, 'a sibling head is never planned income');
  ok(linePlannedShare(line, 'scout') > 0, 'the scout share must still have a planning figure');
});

test('the plan is priced at the CHOSEN tier, and checked against the sales that earn it', () => {
  // The first cut assumed the top covering tier, which for Pack 569 meant "if all 13 scouts
  // sell $350 each" — true, useless, and reported as short by $2,021.50. The pack names the
  // level it actually expects instead, and the check follows that choice.
  const fn = /function tierAssumption\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'tierAssumption() not found');
  ok(!/tiers\[tiers\.length - 1\]/.test(fn[0]), 'the check still assumes the top tier');
  ok(/var pt = plannedTier\(\);/.test(fn[0]), 'the check does not read the chosen tier');
  ok(/var commission = pt \? \(pt\.thresholdCents \|\| 0\) \* roster : 0;/.test(fn[0]),
    'the promise is not the chosen threshold × the roster');
  ok(/var sales = salesForCommission\(commission\);/.test(fn[0]),
    'the sales that back the promise are not derived from it');
  ok(/var pct = commissionRates\(\)\.goal;/.test(fn[0]),
    'the check values the sales at a rate other than the one the goal uses');
  ok(/net: commission - cost\.picked/.test(fn[0]), 'there is no self-funding verdict');
  ok(!/Math\.round\(sales \* pct \/ 100\)/.test(fn[0]),
    'the promise is still being derived from a rate rather than being the threshold');
  const cost = /function coverCostForKeys\(keys\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  ok(/coverableLines\(\)\.forEach/.test(cost),
    'the price walks lines that are not coverable at all');
  ok(/if \(!keys\[coverKeyOf\(r\.key, who\)\]\) return;/.test(cost),
    'the price includes shares no tier covers');
  const able = /function coverableLines\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(able && /lineRaisesCharges\(r\.line\) \|\| lineIsFamilyDirect\(r\.line\)/.test(able[0]),
    'a council-paid line cannot be covered, or a pack-funded line can');
  // The scout share is priced across the line's own roster — a den-limited line bills its dens.
  const share = /function tierScoutShareForLine\(r\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
});

test('the planned tier is also checked against the PLAN, not just against its own rewards', () => {
  // "I am confused on how the cost of leader is getting covered" (owner, 2026-08-31). It was
  // covered — inside C, carried by the goal — but the rewards card never said so, because
  // `net` only ever weighed the promise against itself. A pack could read "clears it, with $420
  // to spare" off a tier that left the year underfunded, and the leaders' places were the part
  // most likely to be sitting in that gap: they are in A, never in B, and no tier can cover them.
  const fn = /function tierAssumption\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'tierAssumption() not found');
  ok(/var fund = fundingSummary\(\);/.test(fn[0]), 'the check never reads what the plan needs');
  ok(/var planGap = pt \? fund\.C - commission : null;/.test(fn[0]),
    'the plan gap is not C minus the commission the tier earns');
  ok(/need: fund\.C,/.test(fn[0]), 'the figure the gap was measured against is not reported');
  ok(/planPerScout: roster > 0 \? Math\.round\(fund\.C \/ roster\) : fund\.C,/.test(fn[0]),
    'what the plan asks of ONE scout is not worked out, so the gap cannot be made actionable');
  ok(/leaderPlanned: fund\.leaderPlanned,/.test(fn[0]),
    'the leaders’ cost is not carried through, so the copy cannot name it');
  // Like `net`, this is commission on both sides — it must hold before a rate is ever set.
  ok(!/planGap[^;]*pct/.test(fn[0]), 'the plan gap is being routed through a commission rate');
});

test('fundingSummary() must never call tierAssumption() — the new check depends on it', () => {
  // tierAssumption() now calls fundingSummary(). That is only safe while the arrow points one
  // way, and nothing in the language stops somebody adding the return edge: fundingSummary is
  // where every tier figure already lands, so reaching for tierAssumption() there would look
  // natural and would hang the app on the next render.
  const fs = /function fundingSummary\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fs, 'fundingSummary() not found');
  ok(!/tierAssumption/.test(fs[0]), 'fundingSummary() calls tierAssumption() — that is a cycle');
  ok(!/computeBudget/.test(fs[0]), 'fundingSummary() calls computeBudget(), which calls it back');
});

test('the two verdicts stay separate, and the short one names the leaders', () => {
  // They answer different questions and can disagree without either being wrong: covering the
  // rewards is the smaller test, and the cost of the promise sits inside C, so clearing the plan
  // clears the rewards but not the reverse. Collapsing them back into one would put the pack
  // right back where it started.
  ok(/clears it|short by/.test(SCRIPT), 'the rewards verdict is gone');
  ok(/covers the rewards with/.test(SCRIPT),
    'the rewards verdict no longer says it is only about the rewards');
  ok(/funds the plan/.test(SCRIPT) && /plan still short by/.test(SCRIPT),
    'there is no verdict on whether the tier funds the plan');
  // ASCII only. index.html mixes literal punctuation with ’ / — escapes, and a regex
  // written with the character does not match the escape — so match the words between them.
  ok(/places is inside that/.test(SCRIPT),
    'a plan that is short never names the leaders’ places as part of the gap');
  ok(/no family is billed for those, so popcorn carries them/.test(SCRIPT),
    'nothing says WHY the leaders’ cost lands on popcorn rather than on a family');
  ok(/The plan asks <strong class="money">' \+ fmt\(ta\.planPerScout\)/.test(SCRIPT),
    'the gap is never restated as what the plan asks of one scout');
});

test('a tier can clear its rewards and still leave the plan short', () => {
  // The exact case the check exists for, run rather than pattern-matched: a sign error would
  // sail past every regex above.
  const ctx = vm.createContext({});
  vm.runInContext(
    `function arrOf(x) { return Array.isArray(x) ? x : []; }
     function sortedTiers() { return [{ id: 't1', thresholdCents: 15000, covers: ['dues'] }]; }
     function plannedTier() { return sortedTiers()[0]; }
     function plannedCoverKeys() { return { dues: true }; }
     function tierIsStretch() { return false; }
     function activeScouts() { return new Array(12); }
     function commissionRates() { return { goal: 30 }; }
     function salesForCommission(c) { return c ? Math.ceil(c / 0.30) : null; }
     // The rewards are cheap: $600 of dues against $1,800 of commission.
     function coverCostForKeys() {
       return { picked: 60000, fees: 60000, extra: 0, extraHeads: 0, extraReimburse: 0, lines: [] };
     }
     // ...but the plan needs $2,500, of which $520 is leaders' places nobody is billed for.
     function fundingSummary() { return { C: 250000, leaderPlanned: 52000 }; }
     ${slice('tierAssumption')}`, ctx);
  const ta = ctx.tierAssumption();
  eq(ta.commission, 180000, 'the tier earns the threshold across the roster');
  ok(ta.net >= 0, 'this fixture is meant to CLEAR its rewards — the case only bites when it does');
  eq(ta.net, 120000, 'the rewards verdict changed');
  eq(ta.planGap, 70000, 'the plan gap is not what the plan needs less what the tier earns');
  ok(ta.planGap > 0, 'a tier that clears its rewards is being reported as funding the plan');
  eq(ta.need, 250000, 'the plan figure is not reported');
  eq(ta.planPerScout, 20833, 'the per-scout ask is not C across the roster');
  ok(ta.planPerScout > ta.planned.thresholdCents,
    'the fixture must ask MORE of a scout than the tier does, or it proves nothing');
  eq(ta.leaderPlanned, 52000, 'the leaders’ cost is not carried through for the copy');
  // Closing the gap turns the verdict over, and never reads as short by a negative.
  vm.runInContext('function fundingSummary() { return { C: 100000, leaderPlanned: 52000 }; }', ctx);
  ok(ctx.tierAssumption().planGap <= 0, 'a tier that covers the plan is still reported as short');
});

test('the choice is per tier, one at a time, and the worksheet says why B dropped', () => {
  ok(/data-ch="tier-plan-on"/.test(SCRIPT), 'there is no per-tier control');
  ok(/data-ch="tier-plan-on" data-id="' \+ t\.id \+ '"/.test(SCRIPT),
    'the control does not carry the tier it belongs to');
  ok(/state\.rewardTiers\.planOnTierId = el\.checked \? \(el\.dataset\.id \|\| ''\) : '';/.test(SCRIPT),
    'choosing a tier does not replace the last choice, or unticking does not clear it');
  ok(/>Plan on this tier</.test(SCRIPT), 'the control is unlabelled');
  ok(/Not asked for &mdash; reward tiers cover it|Not asked for \u2014 reward tiers cover it/.test(SCRIPT),
    'B drops with no line on the worksheet to say why');
  // Both branches pinned by text unique to THIS verdict. It used to be /clears it|short by/,
  // which the plan verdict added in 2026-08-31 ("plan still short by") would satisfy on its own —
  // so the assertion would have gone on passing with the self-funding verdict deleted.
  ok(/clears it/.test(SCRIPT), 'the self-funding verdict is never shown');
  ok(/At this level the rewards cost more than the sales/.test(SCRIPT),
    'the self-funding verdict has no failing branch');
});

test('the worksheet says why A grew when a tier buys adult shirts', () => {
  // A covered adult share is real pack spending that no line's planned cost contains. It goes
  // into A — and A silently growing is exactly the sort of thing this document keeps refusing.
  ok(/of which reward tiers buy for adults or siblings/.test(SCRIPT),
    'A grows with nothing on the worksheet to explain it');
  ok(/fs2\.tierExtra/.test(SCRIPT), 'the worksheet never reads the figure');
});

test('tiers above the planned one are stretch, and judged at the margin', () => {
  // A stretch tier is honoured when earned but never budgeted, so the question is not "can the
  // pack afford it for everybody" — it is "does one scout getting there pay for itself".
  ok(/function tierIsStretch\(t\) \{[\s\S]*?return !!pt && t\.thresholdCents > pt\.thresholdCents;/.test(SCRIPT),
    'stretch is not defined as "above the planned tier"');
  const planned = /function plannedTiers\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(planned && /if \(t\.thresholdCents <= pt\.thresholdCents\) out\.push\(t\);/.test(planned[0]),
    'planning on a tier does not include the tiers below it, which coverage stacks onto');
  const keys = /function plannedCoverKeys\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(keys && /plannedTiers\(\)\.forEach/.test(keys[0]),
    'the budgeted keys come from somewhere other than the planned tiers');
  ok(!/sortedTiers\(\)\.forEach/.test(keys[0]), 'a stretch tier is still being budgeted for');
  const fn = /function tierAssumption\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(/stretch: sortedTiers\(\)\.filter\(tierIsStretch\)/.test(fn[0]), 'the stretch tiers are not reported');
  ok(/var gap = Math\.max\(0, \(t\.thresholdCents \|\| 0\) - \(below \? below\.thresholdCents \|\| 0 : 0\)\);/.test(fn[0]),
    'the margin is not the gap up from the tier below');
  // The gap between two thresholds IS the extra commission that level earns, so the margin is
  // a subtraction — no rate, and nothing for the copy to disagree with.
  ok(/tier: t, gap: gap, earns: gap,/.test(fn[0]),
    'the margin still converts the gap through a rate instead of being it');
  ok(/net: gap - perScout/.test(fn[0]), 'there is no per-scout margin verdict');
  ok(/>stretch</.test(SCRIPT) && /Stretch tiers/.test(SCRIPT), 'nothing on screen marks a tier as a stretch');
});

/* ================================================================
   Tier deadlines, and the two rates — owner asks, 2026-07-27
   ================================================================ */

test('a tier with a deadline is measured on sales dated up to it', () => {
  // "A hard deadline, where they either have to hit goal target by the date or pay the
  // difference." A sale on the 2nd cannot satisfy a deadline of the 1st.
  const ctx = coverageSandbox(`
     var TIERS = [{ id:'t1', thresholdCents: 30000, covers:['dues'], dueBy: '2025-11-01' }];
     var SALES    = { early: tot(40000), late: tot(40000), never: tot(5000) };   // season totals
     var SALES_AT = { '2025-11-01': { early: tot(35000), late: tot(10000), never: tot(5000) } };`);
  eq(Object.keys(ctx.RESULT.dues).sort(), ['early'],
    'the late seller was covered on money that arrived after the deadline');
  eq(ctx.EARNED.t1.early, 'earned', 'earned by selling');
  ok(!ctx.EARNED.t1.late, 'a season total must not satisfy a deadline');
});

test('a tier with no deadline still counts the whole season', () => {
  const ctx = coverageSandbox(`
     var TIERS = [{ id:'t1', thresholdCents: 30000, covers:['dues'], dueBy: '' }];
     var SALES = { a: tot(40000), b: tot(10000) };`);
  eq(Object.keys(ctx.RESULT.dues), ['a'], 'the no-deadline tier stopped working');
});

test('paying the difference counts as reaching the tier', () => {
  // The credit is the LEDGER ENTRY since 2026-09-04, not a stored list of ids — so the tier is
  // granted by a stamped payment, exactly as the handler writes one.
  const ctx = coverageSandbox(`
     var TIERS = [{ id:'t1', thresholdCents: 30000, covers:['dues'], dueBy: '2025-11-01' }];
     var LEDGER = [{ id:'L1', direction:'in', scoutId:'late', tierMakeup:'t1', amountCents: 2000 }];
     var SALES    = { early: tot(40000), late: tot(40000) };
     var SALES_AT = { '2025-11-01': { early: tot(35000), late: tot(10000) } };`);
  eq(Object.keys(ctx.RESULT.dues).sort(), ['early', 'late'], 'a makeup payment did not satisfy the tier');
  eq(ctx.EARNED.t1.late, 'madeUp', 'the two ways in are not told apart');
});

test('the tier credit follows the payment in BOTH directions', () => {
  // Owner, 2026-09-04: "the tier credit should probably be re-calculated on each load/refresh as
  // well as when values change in either direction." Every other rung is recomputed from sales, so
  // a correction moves it down as readily as up; the make-up mark used to be write-once, and
  // clearing the payment out of the book left a scout holding a tier nobody had bought.
  const setup = (ledger) => `
     var TIERS = [{ id:'t1', thresholdCents: 30000, covers:['dues'], dueBy: '' }];
     var LEDGER = ${ledger};
     var SALES = { late: tot(1000) };`;
  const paid = coverageSandbox(setup(`[{ id:'L1', direction:'in', scoutId:'late', tierMakeup:'t1', amountCents: 2000 }]`));
  eq(paid.EARNED.t1.late, 'madeUp', 'a stamped payment does not grant the tier');
  eq(Object.keys(paid.RESULT.dues), ['late'], 'the coverage does not follow the credit');
  // The entry deleted — the state this bug report was filed from.
  const gone = coverageSandbox(setup('[]'));
  ok(!gone.EARNED.t1.late, 'the credit outlives the payment that bought it');
  eq(gone.RESULT.dues, undefined, 'the pack is still covering a fee nobody paid for');
  // The entry kept but unstamped, which is what the ✕ does: money stays, credit goes.
  const unstamped = coverageSandbox(setup(`[{ id:'L1', direction:'in', scoutId:'late', tierMakeup:'', amountCents: 2000 }]`));
  ok(!unstamped.EARNED.t1.late, 'an unstamped family payment still buys a tier');
  // An entry pointing at another tier, or at nobody, must not leak across.
  const other = coverageSandbox(setup(`[{ id:'L1', direction:'in', scoutId:'late', tierMakeup:'t9', amountCents: 2000 },
                                        { id:'L2', direction:'in', scoutId:'', tierMakeup:'t1', amountCents: 2000 },
                                        { id:'L3', direction:'out', scoutId:'late', tierMakeup:'t1', amountCents: 2000 }]`));
  ok(!other.EARNED.t1.late, "another tier's payment, an unattributed one, or money OUT granted the tier");
});

test('the shortfall is the gap, capped at the fee it buys', () => {
  // Paying more to reach a tier than the tier saves you is not a rule anybody means.
  const fn = /function tierShortfallRows\(t, map\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'tierShortfallRows() not found');
  ok(!/function tierMissedRows/.test(SCRIPT),
    'the old name is back — a function called "missed" must not answer for a tier still open');
  ok(/var totals = computeScoutTotals\(t\.dueBy\);/.test(fn[0]), 'the shortfall is measured on the wrong date');
  ok(/short = Math\.max\(0, \(t\.thresholdCents \|\| 0\) - base\)/.test(fn[0]), 'the shortfall is not the gap to the tier');
  // On the commission basis the gap is money, so paying it leaves the pack exactly where the
  // selling would have. Measuring it in SALES is what would over-charge the family.
  ok(/var got = scoutCommissionOf\(\{ t: totals\[s\.id\] \}\);/.test(fn[0]),
    'the shortfall is measured in sales, so a family would be asked for more than the pack lost');
  ok(/makeup: Math\.min\(short, cover\)/.test(fn[0]), 'the makeup is not capped at the fee');
  // The gate `if (!t.dueBy) return []` used to live here, and its reason was sound: a tier that is
  // still open has not been MISSED by anybody, and a function named for missing one must not
  // answer for it. That requirement is unchanged — it is now met by the NAME (a shortfall is what
  // every scout below a threshold has, deadline or not) and by keeping the deadline framing at the
  // one call site that prints it. Pin those two things instead of the refusal, because the refusal
  // also blocked the owner's ask: let a scout cover the remaining cost out of pocket at any time.
  ok(!/if \(!t\.dueBy\) return \[\];/.test(fn[0]),
    'the deadline gate is back, so an open tier offers no shortfall to pay');
  const report = /Missed the ' \+ esc\(fmtDate\(t\.dueBy\)\)[\s\S]{0,80}/.exec(SCRIPT);
  ok(report, 'the deadline report heading was not found');
  ok(/if \(tierIsClosed\(t\) && tierCoverCentsPerScout\(t\) > 0\) \{/.test(SCRIPT),
    'the "Missed the deadline" report is no longer gated on the deadline having passed');
  const cover = /function tierCoverCentsPerScout\(t, scout, cov\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(cover && /return coverValueOfKeys\(keys, scout, cov\);/.test(cover[0]) &&
     /coverableLines\(\)\.forEach/.test(slice('coverValueOfKeys')),
    'the fee counts lines a tier cannot be pointed at in the first place');
});

test('making up the difference records money, and the money IS the decision', () => {
  const fn = /if \(act\.indexOf\('tier-makeup:'\) === 0\) \{[\s\S]*?\n    \}/.exec(SCRIPT);
  ok(fn, 'the makeup handler was not found');
  ok(/source: 'family'/.test(fn[0]), 'the payment is not recorded as family money');
  ok(/scoutId: mkS\.id/.test(fn[0]), "the payment does not settle that scout's account");
  ok(/amountCents: mkRow\.makeup/.test(fn[0]), 'it records something other than the capped shortfall');
  // ONE write. The tier the payment bought rides on the entry, so there is no second record to
  // fall out of step with it — that drift is the bug this replaced.
  ok(/tierMakeup: mkT\.id/.test(fn[0]), 'the payment does not name the tier it bought');
  ok(!/\.madeUp/.test(fn[0]), 'the handler still writes a stored tier mark alongside the payment');
  ok(/if \(!mkRow \|\| mkRow\.makeup <= 0\) return;/.test(fn[0]),
    'a scout who did not miss the tier, or owes nothing, can still be charged a makeup');
  // It asserts a family handed over money, on a board that is otherwise read-only. Two taps.
  ok(/arm\(act, function \(\) \{/.test(fn[0]), 'a single stray tap writes a payment to the ledger');
  ok(/arm\(act, function \(\) \{[\s\S]*state\.ledger\.push/.test(fn[0]),
    'the ledger write happens outside the confirm');
  // Undoing the credit must never delete the money: it unstamps the entry and leaves it standing
  // as an ordinary family payment.
  const un = /if \(act\.indexOf\('tier-unmakeup:'\) === 0\) \{[\s\S]*?\n    \}/.exec(SCRIPT);
  ok(un, 'there is no way to undo a makeup');
  ok(!/state\.ledger\s*=|splice|filter\(function \(e\)/.test(un[0]),
    'undoing a makeup removes the payment from the ledger instead of unstamping it');
  ok(/e\.tierMakeup = ''/.test(un[0]), 'undo no longer unstamps the entry');
  ok(/arm\(act,/.test(un[0]),
    'undo arms on a key no button carries, so the confirm state never shows');
});

test('the deadline drives coverage, waivers, badges and the counts from ONE map', () => {
  // Four screens disagreeing about who earned what is the failure mode here.
  ['function packCoverage', 'function applyTierWaivers', 'function rewardTierSummary'].forEach((f) => {
    const re = new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}');
    const fn = re.exec(SCRIPT);
    ok(fn, f + '() not found');
    ok(/tierEarnedMap\(\)/.test(fn[0]), f + ' works out who earned a tier on its own');
  });
  // A caller may hand it the sales-only VIEW of the same map (salesOnlyTierMap), never its own.
  ok(/var et = earnedTierFor\(r\.id, tiers, map \|\| tierEarnedMap\(\)\);/.test(SCRIPT),
    'the standings badge still uses live sales, so it would show a tier somebody missed');
  ok(/function earnedTierFor\(scoutId, tiers, map\)/.test(SCRIPT), 'earnedTierFor() not found');
});

test('a blank online rate means the same rate, so nothing moves on upgrade', () => {
  // commissionRates() reads `state`, so it is exercised in a sandbox with one supplied.
  const ctx = vm.createContext({ state: {} });
  vm.runInContext(slice('commissionRates') + slice('cashScoutRate') + slice('cashCreditOn'), ctx);
  const run = (base, online) => {
    ctx.state.commissionPct = base; ctx.state.commissionPctOnline = online;
    return vm.runInContext('commissionRates()', ctx);
  };
  eq(run('32', ''), { base: 32, online: 32, split: false, goal: 32, goalIsOnline: false, cash: null },
    'blank must mean "the same"');
  eq(run('32', '32'), { base: 32, online: 32, split: false, goal: 32, goalIsOnline: false, cash: null },
    'the same figure typed twice is not a split');
  eq(run('', ''), { base: null, online: null, split: false, goal: null, goalIsOnline: false, cash: null },
    'no rate set at all');
  // A rate typed only for online still leaves the storefront rate unset rather than guessing.
  eq(run('', '50'), { base: null, online: 50, split: true, goal: 50, goalIsOnline: false, cash: null }, 'online-only');
});

test('the goal is worked out at the LOWER of the two rates', () => {
  // Pack 569 earns 35% at a storefront and 30% online — the opposite way round from the usual
  // assumption. A goal derived at the storefront rate would be short by 5% of every dollar that
  // came in online, which is the one direction a MINIMUM must never be wrong in. The lower rate
  // is the only choice that stays right whichever way the two fall.
  const ctx = vm.createContext({ state: {} });
  vm.runInContext(slice('commissionRates') + slice('cashScoutRate') + slice('cashCreditOn'), ctx);
  const run = (base, online) => {
    ctx.state.commissionPct = base; ctx.state.commissionPctOnline = online;
    return vm.runInContext('commissionRates()', ctx);
  };
  eq(run('35', '30').goal, 30, "Pack 569's own rates: the goal must use the online 30%");
  eq(run('35', '30').goalIsOnline, true, 'the screens cannot say which rate it used');
  eq(run('32', '50').goal, 32, 'when online pays better, the storefront rate is the floor');
  eq(run('32', '50').goalIsOnline, false, 'it named the wrong channel');
  // The goal itself must fall out of that rate, not out of state.commissionPct.
  const fn = /function fundingSummary\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'fundingSummary() not found');
  ok(/var rates = commissionRates\(\);[\s\S]*\n\s*var pct = rates\.goal;/.test(fn[0]),
    'the sales goal is still derived from the storefront rate alone');
  ok(!/parseFloat\(state\.commissionPct\)/.test(fn[0]), 'fundingSummary reads a raw rate of its own');
  // And nothing may claim online is the better one — Pack 569's is not.
  ok(!/online sales earn more|gets the pack there faster/.test(SCRIPT),
    'the copy still assumes online pays better than storefront');
});

test('the two rates are applied to their own channel and rounded apart', () => {
  const fn = /function computePackTotals\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'computePackTotals() not found');
  ok(/if \(e\.kind === 'online'\) \{ onlineDon \+= e\.donationsCents; onlineSales \+= e\.salesCents; \}/.test(fn[0]),
    'online sales are not separated from the rest');
  ok(/var onlineEligible = onlineSales \+ onlineDon;/.test(fn[0]), 'the online base is wrong');
  ok(/var otherEligible = teEligible - onlineEligible;/.test(fn[0]),
    'the storefront/wagon base is not the remainder, so cash donations could fall through a gap');
  ok(/Math\.round\(onlineEligible \* rates\.online \/ 100\)/.test(fn[0]) &&
     /Math\.round\(otherEligible \* pct \/ 100\)/.test(fn[0]),
    'the two halves are not rounded separately');
  ok(/\(commissionOnline \|\| 0\) \+ \(commissionOther \|\| 0\)/.test(fn[0]), 'the total is not the sum of the two');
  // A pack that never sets an online rate must see exactly what it saw before.
  ok(/d\.commissionPctOnline = typeof d\.commissionPctOnline === 'string' \? d\.commissionPctOnline : '';/.test(SCRIPT),
    'the online rate is not migrated to "same as the main rate"');
  ok(/data-ch="commission-online"/.test(SCRIPT), 'there is no field for the online rate');
  ok(/if \(ch === 'commission-online'\)/.test(SCRIPT), 'the online rate field has no handler');
});

test('what families pay directly is split by who they pay', () => {
  const fn = /function familyDirectByPayee\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'familyDirectByPayee() not found');
  ok(/if \(lineThroughPack\(l\)\) return;/.test(fn[0]), 'it counts money the pack actually handles');
  ok(/by\[l\.paidDirectTo\]/.test(fn[0]), 'it does not group by payee');
  ok(/return b\.cents - a\.cents \|\| a\.payee\.localeCompare\(b\.payee\)/.test(fn[0]), 'the split is in no order');
});

/* ================================================================
   Break-even sales, and reimbursing a council fee — owner asks, 2026-07-27
   ================================================================ */

test('a tier says what its threshold is worth in sales AND in commission', () => {
  // Owner ruling 2026-08-02: the threshold IS the commission, so "what the pack gets" needs no
  // rate at all and "does it pay for itself" is a subtraction. What still needs converting is
  // the number a scout can act on — nobody sells commission.
  const fn = /function tierBreakEven\(t\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'tierBreakEven() not found');
  ok(/var earns = t\.thresholdCents \|\| 0;/.test(fn[0]),
    'what the tier earns the pack is being derived from a rate instead of being the threshold');
  ok(/needSales: salesForCommission\(earns\)/.test(fn[0]),
    'it does not work out the sales that reach the threshold');
  ok(!/\* pct \/ 100/.test(fn[0]), 'the break-even still multiplies the threshold by a rate');
  // Cumulative, because the tiers stack and so does what a scout at that level walks away with —
  // and UNIONED, not summed. ⚠ This test used to require the sum (`cents += tierCoverCentsPerScout`),
  // which counts a line named on two rungs twice: Pack 569's break-even claimed $629 handed back
  // against a real $582, $47 of coverage the pack was asked to fund twice.
  const cum = /function tierCumulativeCoverCents\(t\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(cum && /if \(o\.thresholdCents <= t\.thresholdCents\) arrOf\(o\.covers\)/.test(cum[0]),
    'the break-even ignores what the tiers below already hand out');
  ok(cum && /return coverValueOfKeys\(keys\);/.test(cum[0]),
    'the break-even sums per-rung figures, double-counting a line two rungs both name');
  ok(/A scout gets there on/.test(SCRIPT), 'the sales figure is never shown');
  // Converted at the same rate as the goal, so the two cannot disagree.
  const conv = /function salesForCommission\(cents\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(conv, 'salesForCommission() not found');
  ok(/salesAtRate\(cents, commissionRates\(\)\.goal\)/.test(conv[0]),
    'the sales figure uses a different rate from the goal');
  // The arithmetic moved to salesAtRate when the progress card started quoting every rate.
  // Both readers round the same way or a scout lands a cent short of the tier at one of them.
  const rate = /function salesAtRate\(cents, pct\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(rate, 'salesAtRate() not found');
  ok(/Math\.ceil\(cents \/ \(pct \/ 100\)\)/.test(rate[0]),
    'a minimum is being rounded down, which can land a scout a cent short of the tier');
  ok(/if \(pct == null \|\| pct <= 0 \|\| !cents\) return null;/.test(rate[0]),
    'a rate of nought would divide by zero rather than declining to answer');
});

/* ========================================================================
   A commission gap, said in selling — 2026-08-31
   ===================================================================== */

// Owner ask: "instead of showing what they need to earn in commission, just show what they need
// to sell, at each commission rate." sellingRoutes is that conversion.
function routesCtx(base, online, cashPct, viaTE) {
  const ctx = vm.createContext({
    state: { commissionPct: base, commissionPctOnline: online, cashScoutPct: cashPct, cashThroughTrailsEnd: !!viaTE }
  });
  vm.runInContext(slice('commissionRates') + slice('cashScoutRate') + slice('cashCreditOn') +
    slice('salesAtRate') + slice('sellingRoutes'), ctx);
  return (cents) => vm.runInContext(`sellingRoutes(${cents})`, ctx);
}

test('a gap is quoted at every rate the pack earns at, safest figure first', () => {
  // $60 of commission short. At 30% that is $200 of popcorn; at 35%, $171.43 — and the bigger
  // number leads, because it is the one that gets there whatever the scout sells.
  const routes = routesCtx(30, 35, '', false)(6000);
  eq(routes.map((r) => r.cents), [20000, 17143], 'the shortcut is quoted ahead of the safe figure');
  eq(routes.map((r) => r.pct), [30, 35], 'the rates do not match their figures');
  eq(routes.map((r) => r.label), ['at a storefront or wagon', 'online'],
    'the channels are unnamed, so two bare figures look arbitrary');
  // Same floor as the goal conversion: a minimum that lands a cent short is not a minimum.
  ok(routes[1].cents * 0.35 >= 6000, 'the online figure rounds down, landing a scout short of the tier');
});

test('one rate is one figure, and the row says so instead of repeating it', () => {
  const routes = routesCtx(30, 30, '', false)(6000);
  eq(routes.length, 1, 'a pack with one rate is offered a choice it does not have');
  eq(routes[0].label, 'in popcorn', 'the single-rate label reads as a channel');
  eq(routes[0].pct, 30, 'the rate is wrong');
  // A pack that typed only an online rate earns nothing at a storefront, so calling that figure
  // "in popcorn" would send a scout to the wrong shift.
  const onlineOnly = routesCtx('', 40, '', false)(6000);
  eq(onlineOnly.map((r) => [r.label, r.cents]), [['online', 15000]],
    'an online-only pack is told to work a storefront');
});

test('which channel pays better is derived, never assumed to be online', () => {
  // Owner correction, 2026-08-31: this pack's ONLINE rate is the LOWER of the two, and copy that
  // told a scout to sell online to arrive sooner was sending them the slower way round. The app
  // already knew — commissionRates().goalIsOnline is true exactly when online is the lower rate —
  // the prose just was not asking.
  const tiers = /function renderRewardTiers\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(tiers, 'renderRewardTiers() not found');
  ok(/be\.goalIsOnline \? 'at a storefront or on a wagon' : 'online'/.test(tiers[0]),
    'the better-rate sentence names a channel without checking which one it is');
  // tierBreakEven has to carry the flag, or the branch above is reading undefined and always
  // taking the same side — which is the bug, silently restored.
  const be = /function tierBreakEven\(t\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(be && /goalIsOnline: rates\.goalIsOnline/.test(be[0]), 'the break-even drops the flag the copy branches on');
  // And nowhere on these surfaces is "online" hard-wired to the encouraging half of a sentence.
  for (const fn of ['renderRewardTiers', 'renderTierProgress', 'sellingRoutes']) {
    const src = new RegExp(`function ${fn}\\(\\w*\\) \\{[\\s\\S]*?\\n  \\}`).exec(SCRIPT);
    ok(!/online[^']*(sooner|faster|better|ahead)/i.test(codeOnly(src[0])),
      `${fn} still promises that selling online gets a scout there sooner`);
  }
  // The progress card's own two figures are ordered by SIZE, not by channel, so the safe one
  // leads whichever rate happens to be lower.
  const routes = routesCtx(35, 30, '', false)(6000);   // online the LOWER rate, as this pack has it
  eq(routes.map((r) => r.label), ['online', 'at a storefront or wagon'],
    'the bigger figure does not lead when online is the lower rate');
  eq(routes[0].cents, 20000, 'the safe figure is not the one worked out at the lower rate');
});

test('the cash credit rate is never quoted as a rate of its own', () => {
  // Owner ruling, 2026-08-31: it is always set to the storefront rate, so a third line quoting
  // the same figure under another name is clutter — and worse, it implies a difference that
  // never exists. The credit itself is untouched; only the copy is.
  eq(routesCtx(30, 35, 50, false)(6000).map((r) => r.label), ['at a storefront or wagon', 'online'],
    'cash is quoted as a route of its own');
  eq(routesCtx(30, 30, 50, false)(6000).length, 1, 'cash reappears as a second route on a one-rate pack');
  ok(routesCtx(30, 35, 50, false)(6000).every((r) => r.sell),
    'a non-selling route is being handed to the card, which takes its headline from the first entry');
  // Nor anywhere else on the tier surfaces. The forbidden thing is the RATE, not the word: the
  // channel is still called "cash donations" wherever the pack runs it through Trail's End, and
  // cashScoutCredit still pays the credit. Reads CODE, not prose — the warning comments that
  // record this ruling name the very field they forbid.
  for (const fn of ['renderRewardTiers', 'sellingRoutes', 'renderTierProgress']) {
    const src = new RegExp(`function ${fn}\\(\\w*\\) \\{[\\s\\S]*?\\n  \\}`).exec(SCRIPT);
    ok(src, `${fn}() not found`);
    ok(!/\.cash\b|cashScoutRate|cashScoutPct/.test(codeOnly(src[0])),
      `${fn} still quotes the cash credit rate`);
  }
});

test('a pack with no usable rate is offered no figure at all, rather than a wrong one', () => {
  eq(routesCtx('', '', '', false)(6000), [], 'a sell figure was invented with no rate to derive it from');
  // 0% divides to Infinity. tierRateMissing() does NOT catch this — 0 is a rate that was typed —
  // so the routes list is the thing that has to decline, and the card falls back to commission.
  eq(routesCtx(0, 0, '', false)(6000), [], 'a nought rate produced a figure');
  const card = /function renderTierProgress\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  ok(/if \(!r\.routes\.length\) segs\.push/.test(card), 'the row says nothing at all when no rate can convert the gap');
  ok(/r\.sellRoutes\.length \? r\.sellRoutes\[0\]\.cents : r\.short/.test(card),
    'the headline figure has no fallback, so it prints a dash for a pack with a nought rate');
});

test('sales-to-reach-a-tier is quoted at the rate a scout can always beat', () => {
  // The conversion has to be a floor, not an estimate: sell this much and you are there
  // whatever the channel mix, because every other channel earns more per dollar.
  const ctx = vm.createContext({ state: {} });
  vm.runInContext(slice('commissionRates') + slice('cashScoutRate') + slice('cashCreditOn') + slice('salesForCommission') + slice('salesAtRate'), ctx);
  const need = (base, online, cents) => {
    ctx.state.commissionPct = base; ctx.state.commissionPctOnline = online;
    return vm.runInContext(`salesForCommission(${cents})`, ctx);
  };
  // Pack 569's own rates, 35% storefront / 30% online. $150 of commission is $500 of popcorn
  // at the worse rate — quoting the storefront rate would promise the tier at $428.58 and then
  // not deliver it to a scout who sold online.
  eq(need('35', '30', 15000), 50000, 'the lower of the two rates must set the figure');
  eq(need('35', '', 15000), 42858, 'one rate: $150 / 35%, rounded up so it is never short');
  eq(need('', '', 15000), null, 'no rate set at all');
  eq(need('35', '30', 0), null, 'a tier that earns nothing has no sales figure');
  // The floor property, stated as arithmetic rather than as a comment.
  for (const cents of [15000, 25000, 30000, 33333, 99999]) {
    const sold = need('35', '30', cents);
    ok(Math.round(sold * 30 / 100) >= cents, `${sold} sold online must still reach ${cents}`);
    ok(Math.round(sold * 35 / 100) >= cents, `${sold} sold at a storefront must still reach ${cents}`);
  }
});

test('a scout earns a tier at each channel’s own rate', () => {
  // What the pack actually got, not an average — which means two scouts with identical sales
  // can land either side of a tier. That is the thing being measured, so it is pinned here.
  const ctx = coverageSandbox(`
     var RATE = '35', ONLINE_RATE = '30';
     var TIERS = [{ id:'t1', thresholdCents: 15000, covers:['dues'] }];
     var SALES = {
       storefront: tot(45000, 0),      // $450 at 35% = $157.50 — in
       online:     tot(0, 45000),      // $450 at 30% = $135.00 — out
       mixed:      tot(30000, 20000)   // $105.00 + $60.00 = $165.00 — in
     };`);
  eq(Object.keys(ctx.RESULT.dues).sort(), ['mixed', 'storefront'],
    'the tier is not being measured on what each channel actually earned');
  ok(!ctx.EARNED.t1.online, 'the same sales sold online do not earn the same commission');
  // And the split is rounded per channel, exactly as computePackTotals does it.
  const fn = /function scoutCommissionOf\(r\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'scoutCommissionOf() not found');
  ok(/Math\.round\(online \* \(rates\.online \|\| 0\) \/ 100\)\s*\n?\s*\+ Math\.round\(other \* \(rates\.base \|\| 0\) \/ 100\)/.test(fn[0]),
    'the two channels are not rounded apart');
  ok(/var other = goalBaseOf\(r\) - online;/.test(fn[0]),
    'the non-online remainder is not taken from the goal base, so cash could fall through a gap');
});

test('with no commission rate nothing is earned, and the card says why', () => {
  // A threshold in commission is unmeasurable without a rate. Silently showing every tier at
  // nought scouts would read as "nobody sold anything".
  const ctx = coverageSandbox(`
     var RATE = '', ONLINE_RATE = '';
     var TIERS = [{ id:'t1', thresholdCents: 15000, covers:['dues'] }, { id:'t0', thresholdCents: 0, covers:['patch'] }];
     var SALES = { big: tot(500000) };`);
  ok(!ctx.EARNED.t1.big, 'a tier was earned with no rate to measure it by');
  ok(ctx.EARNED.t0.big, 'a zero-threshold prize tier should still be reached by everybody');
  const fn = /function tierRateMissing\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'tierRateMissing() not found');
  ok(/No commission rate set, so nothing can be measured/.test(SCRIPT),
    'the card never explains why every tier sits at nought scouts');
});

test('a council-paid fee can be covered, and only ever as a reimbursement', () => {
  // Spring and fall camping: the parents pay the council directly, so there is no charge to
  // waive and the pack can only give the money back afterwards.
  const fn = /function lineIsFamilyDirect\(l\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'lineIsFamilyDirect() not found');
  ok(/linePerHead\(l\) && lineFamilyFunded\(l\) && !lineThroughPack\(l\)/.test(fn[0]),
    'it does not describe a line families pay somebody else for');
  const rows = /function tierReimbursements\(map\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(rows, 'tierReimbursements() not found');
  // Read across the whole family since 2026-09 (P5), so `ids` rather than one scout id.
  ok(/e\.direction === 'out' && e\.lineId === s\.item\.id && ids\[e\.scoutId\]/.test(rows[0]),
    'what has already been paid back is not read from the ledger');
  ok(/left: Math\.max\(0, s\.rate - paid\)/.test(rows[0]), 'a part-paid reimbursement is not tracked');
  // The payment is a ledger entry OUT that carries the scout — that is what makes "who has been
  // paid back" answerable from the book. It must never be counted as family money coming IN.
  const act = /if \(act\.indexOf\('tier-reimburse:'\) === 0\) \{[\s\S]*?\n    \}/.exec(SCRIPT);
  ok(act, 'the reimburse handler was not found');
  ok(/direction: 'out'/.test(act[0]), 'a reimbursement is being recorded as money coming in');
  ok(/scoutId: rbS\.id/.test(act[0]), 'the entry does not say who was paid back');
  ok(/source: ''/.test(act[0]), 'a payment OUT is carrying an income source');
  ok(/Reimbursed /.test(act[0]), 'the entry does not describe itself as a reimbursement');
  ok(/receipt/.test(act[0]), 'nothing reminds the treasurer to keep the council receipt');
  // Money in is what settles a family's account; money out must not touch it.
  const pay = /function paymentsForScout\(ledger, scoutId\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  const pays = /function entryPaysCharges\(e\) \{[^\n]*\}/.exec(SCRIPT);
  ok(pay && /entryPaysCharges\(e\) && e\.scoutId === scoutId/.test(pay[0]) &&
    pays && /e\.direction === 'in'/.test(pays[0]),
    'a reimbursement OUT would be counted as a payment from the family');
});

test('the guidance is quoted where the decision is made, not buried', () => {
  // Scouting America's Unit Budgeting Guidelines, on the two things this feature sits between.
  ok(/At no point can a unit/.test(SCRIPT) && /t write a check to a Scout or their family/.test(SCRIPT),
    'the rule against paying a family is not stated where a pack would act on it');
  ok(/Expenses can be reimbursed/.test(SCRIPT), 'the exception that makes this legitimate is not stated');
  ok(/have the PACK register and pay/.test(SCRIPT), 'the cleaner arrangement is not suggested');
  // And the pack's own numbers, against the guidance's own test.
  const pb = /function privateBenefitCheck\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(pb, 'privateBenefitCheck() not found');
  ok(/over: net != null && net > 0 && back > net \/ 2/.test(pb[0]),
    'the majority-of-net test is not applied to the pack’s own figures');
  ok(/majority of the NET PROCEEDS/.test(SCRIPT), 'the sentence the check comes from is not quoted');
});

/* ================================================================
   Per-family pricing, and the split on every line — owner asks, 2026-07-27
   ================================================================ */

test('a per-family fee is one price for whoever the family brings', () => {
  // Council camping is priced per family, not per head: no adult price, no sibling price, and
  // nothing for a higher tier to cover separately because there is nothing separate.
  const { LINE_BASES, linePerHead, linePerFamily, linePlannedCents, freshLine } =
    sandbox(['LINE_BASES', 'linePerHead', 'linePerFamily', 'linePlannedHeads', 'linePlannedCents',
      'centsOf', 'uid', 'freshLine', 'LINE_FUNDERS']);
  ok(LINE_BASES.indexOf('per-family') !== -1, 'per-family is not a basis a line can have');
  const camp = freshLine({ basis: 'per-family', scoutRateCents: 7500, fundedBy: 'families', paidDirectTo: 'Council' });
  ok(linePerFamily(camp), 'linePerFamily does not recognise it');
  // It shares ALL the per-head math — one charge per scout, planned = rate x roster — so nothing
  // downstream has to learn a third shape.
  ok(linePerHead(camp), 'a per-family line is not treated as per-head by the planning math');
  eq(linePlannedCents(camp, 13, 4), 97500, 'thirteen families at $75');
  // An adult rate on it is meaningless, and switching a line to per-family clears any it had.
  const fn = /\} else if \(bk === 'basis'\) \{[\s\S]*?\n      \}/.exec(SCRIPT);
  ok(fn, 'the basis handler was not found');
  ok(/if \(bl\.basis === 'per-family'\) \{\s*\n\s*bl\.adultRateCents = 0; bl\.siblingRateCents = 0;/.test(fn[0]),
    'switching to per-family leaves a stale adult rate behind for a tier to cover');
  ok(/bl\.basis = LINE_BASES\.indexOf\(el\.value\) === -1 \? 'flat' : el\.value;/.test(fn[0]),
    'the basis select cannot reach per-family');
});

test('a per-family fee counts FAMILIES, and a link is what makes that possible', () => {
  // It used to count one per scout and say so, because there was no family link. Now there is,
  // and the count follows it.
  const fam = sandbox(['familyKeyOf', 'familiesOf']);
  const roster = [
    { id: 'a', name: 'Ada Porter' },
    { id: 'b', name: 'Ben Porter', familyId: 'a' },
    { id: 'c', name: 'Cal Smith' }
  ];
  eq(fam.familiesOf(roster).length, 2, 'two Porters and a Smith is two families');
  eq(fam.familiesOf(roster).map((f) => f.members.map((s) => s.id)), [['a', 'b'], ['c']], 'membership');
  eq(fam.familyKeyOf({ id: 'z' }), 'z', 'an unlinked scout is a family of one');
  eq(fam.familyKeyOf({ id: 'b', familyId: 'a' }), 'a', 'a linked scout takes the family key');
  // The plan counts families for a per-family line, and scouts for everything else.
  const { linePlannedCents, freshLine } = sandbox(['centsOf', 'uid', 'freshLine', 'LINE_BASES',
    'LINE_FUNDERS', 'linePerHead', 'linePerFamily', 'linePlannedHeads', 'linePlannedCents']);
  const camp = freshLine({ basis: 'per-family', scoutRateCents: 7500 });
  eq(linePlannedCents(camp, 13, 4, 11), 82500, 'eleven families, not thirteen scouts');
  eq(linePlannedCents(camp, 13, 4), 97500, 'with no family count it falls back to one per scout');
  const dues = freshLine({ basis: 'per-head', scoutRateCents: 8000 });
  eq(linePlannedCents(dues, 13, 4, 11), 104000, 'a per-head line still counts every scout');
});

test('linking scouts pools the family fee and NOTHING else', () => {
  // Owner rule, 2026-07-27: "if a family has two scouts, each scout is allowed a parent, so both
  // parents are still eligible". The link exists for family-priced fees; every per-head
  // entitlement stays per scout.
  const fn = /function collapseMarkedToFamilies\(line, marked\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'collapseMarkedToFamilies() not found');
  ok(/if \(!marked \|\| !linePerFamily\(line\)\) return marked;/.test(fn[0]),
    'a line that is not priced per family is having its attendance collapsed');
  ok(/\/\/ The scout mark moves to the family's billing scout; the heads they brought do not move\./.test(fn[0]),
    'the rule that heads stay put is not stated where it is enforced');
  ok(/out\[sid\]\.adults \+= r\.adults \|\| 0;/.test(fn[0]),
    'a parent recorded against one sibling is being merged onto the other — two scouts, two parents');
  ok(!/out\[to\]\.adults/.test(fn[0]), 'adult heads are still being pooled onto the billing scout');
  // And the roster says the same thing where a leader does the linking.
  ok(/place, their own dues and their own parent/.test(SCRIPT),
    'the roster does not say what linking leaves alone');
});

test('the scout/adult split is available on every billed line, not just shirts', () => {
  // It was only ever asked for where the pack collects, which quietly made it a feature of
  // shirts and dinners: a council-paid campout had nowhere to put an adult price, so no tier
  // could cover an adult's place at one.
  const fn = /function lineOptionControls\(l, scoutN, collectKey\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(/if \(\(mode === 'families' \|\| mode === 'direct'\) && !perFamily\) \{/.test(fn[0]),
    'a council-paid line still has nowhere to enter an adult price');
  ok(/straight to/.test(fn[0]), 'the direct case does not say who the family pays');
  // And a line with no adult price yet says what setting one would buy you.
  ok(/gives a reward tier something separate to cover/.test(fn[0]),
    'nothing tells a pack that setting an adult price makes it coverable');
});

test('a family link is one field, and survives the scout it points at leaving', () => {
  // The smallest model that fixes the double count: no family entity to create, name, rename or
  // leave orphaned. normalizeState never resolves references, so a link to a scout who left
  // simply stops matching anybody and they are a family of one again.
  const ctx = sandbox(NORMALIZE_FNS);
  const d = ctx.normalizeState({
    version: 1, scouts: [{ id: 'a', name: 'Ada' }, { id: 'b', name: 'Ben', familyId: 'a' }],
    budget: { programYear: 2025, activities: [], expenses: [] }
  });
  eq(d.scouts[0].familyId, '', 'an unlinked scout must migrate to no link');
  eq(d.scouts[1].familyId, 'a', 'a link that was set is lost');
  ok(!/familyId.*=.*getScout|resolve/.test(/if \(typeof s\.familyId !== 'string'\) s\.familyId = '';/.exec(SCRIPT)[0]),
    'the migration is resolving a reference');
  // Joining somebody joins their family, so a third scout linked to either sibling joins both.
  // Every change goes through the two helpers — never a bare familyId write in a handler.
  const add = /if \(ch === 'scout-family-add'\) \{[\s\S]*?\n    \}/.exec(SCRIPT);
  ok(add, 'the add-a-sibling handler was not found');
  ok(/joinFamily\(state\.scouts, famTo, famNew\);/.test(add[0]),
    'adding a sibling does not go through joinFamily');
  const rm = /if \(act === 'scout-family-remove'\) \{[\s\S]*?\n    \}/.exec(SCRIPT);
  ok(rm, 'the take-out-of-family handler was not found');
  ok(/leaveFamily\(state\.scouts, famOut\);/.test(rm[0]),
    'taking a scout out of a family does not go through leaveFamily');
  ok(/addCh: 'scout-family-add'/.test(SCRIPT), 'there is no way to link two scouts');
  ok(!/data-ch="scout-family"/.test(SCRIPT), 'the old one-sibling select is still on the page');
});

test('a family can be any size, and any one of them can leave it', () => {
  // Owner ask, 2026-09-26: a family of three and a family of five. The model always allowed it;
  // the single select did not, and the scout whose id IS the key could never be taken out.
  const f = sandbox(['familyKeyOf', 'familiesOf', 'leaveFamily', 'joinFamily']);
  const mk = (ids) => ids.map((id) => ({ id, name: id.toUpperCase(), familyId: '' }));
  const groups = (list) => f.familiesOf(list).map((x) => x.members.map((s) => s.id));
  const by = (list) => Object.fromEntries(list.map((s) => [s.id, s]));

  // Five, one at a time, each added from a different sibling's page.
  let r = mk(['a', 'b', 'c', 'd', 'e']); let s = by(r);
  f.joinFamily(r, s.a, s.b); f.joinFamily(r, s.b, s.c); f.joinFamily(r, s.c, s.d); f.joinFamily(r, s.a, s.e);
  eq(groups(r), [['a', 'b', 'c', 'd', 'e']], 'five siblings are one family of five');

  // The scout whose id is the key leaves: the other four stay together, and a really is alone.
  f.leaveFamily(r, s.a);
  eq(groups(r), [['a'], ['b', 'c', 'd', 'e']], 'taking out the first-linked scout broke up the family');

  // Moving a scout out of a family of three leaves the two behind together.
  r = mk(['a', 'b', 'c', 'x']); s = by(r);
  f.joinFamily(r, s.a, s.b); f.joinFamily(r, s.a, s.c);
  f.joinFamily(r, s.x, s.a);
  eq(groups(r), [['a', 'x'], ['b', 'c']], 'the two left behind were split up');

  // Two scouts, one leaves: two families of one.
  r = mk(['a', 'b']); s = by(r);
  f.joinFamily(r, s.a, s.b); f.leaveFamily(r, s.b);
  eq(groups(r), [['a'], ['b']], 'a family of two did not come apart');
  f.joinFamily(r, s.a, s.b); f.leaveFamily(r, s.a);
  eq(groups(r), [['a'], ['b']], 'the key-holder of two could not leave');

  // A family of two and a family of three become one family of five, one scout at a time.
  r = mk(['a', 'b', 'c', 'd', 'e']); s = by(r);
  f.joinFamily(r, s.a, s.b);
  f.joinFamily(r, s.c, s.d); f.joinFamily(r, s.c, s.e);
  ['c', 'd', 'e'].forEach((id) => f.joinFamily(r, s.a, s[id]));
  eq(groups(r), [['a', 'b', 'c', 'd', 'e']], 'two families could not be combined');

  // An archived sibling pointing at the leaver moves with the others rather than staying on a
  // key the leaver still answers to.
  r = mk(['a', 'b', 'c']); s = by(r); s.c.archived = true;
  f.joinFamily(r, s.a, s.b); f.joinFamily(r, s.a, s.c);
  f.leaveFamily(r, s.a);
  eq(f.familyKeyOf(s.b) === f.familyKeyOf(s.c) && f.familyKeyOf(s.a) !== f.familyKeyOf(s.c), true,
    'an archived sibling was left answering to the scout who left');
  // A scout cannot be linked to themselves.
  f.joinFamily(r, s.a, s.a);
  eq(s.a.familyId, '', 'a scout was linked to themselves');
});

test('a parent account links to scouts, and that link never leaves the pack record', () => {
  // Owner ask, 2026-09-26: record which approved account is whose parent. Record only — the
  // parent app does not change, so the field must never reach the published parent view.
  const ctx = sandbox(NORMALIZE_FNS);
  const d = ctx.normalizeState({
    version: 1,
    scouts: [{ id: 'a', name: 'Ada' }, { id: 'b', name: 'Ben', parentUids: ['u1', 'u1', '', 7, 'u2'] }],
    budget: { programYear: 2025, activities: [], expenses: [] }
  });
  eq(d.scouts[0].parentUids, [], 'a scout with no parents must migrate to an empty list');
  eq(d.scouts[1].parentUids, ['u1', 'u2'], 'parent links are not deduplicated and cleaned');
  ok(!/parentUids/.test(codeOnly(BPV())), 'the parent view publishes which account is whose parent');
  ok(/addCh: 'member-scout-add'/.test(SCRIPT), 'the Members card has no way to link a parent');
  const add = /if \(ch === 'member-scout-add'\) \{[\s\S]*?\n    \}/.exec(SCRIPT);
  ok(add && /linkParentToFamily\(/.test(add[0]), 'linking a parent to one scout does not bring the siblings');
  ok(add && /isAdmin\(\)/.test(add[0]), 'a non-admin can link parents');
  // 2026-09-27 — a scout has as many parents as they have, linked from the scout's own page too.
  ok(/addCh: 'scout-parent-add'/.test(SCRIPT), 'the scout page has no way to link a parent');
  const padd = /if \(ch === 'scout-parent-add'\) \{[\s\S]*?\n    \}/.exec(SCRIPT);
  ok(padd && /isAdmin\(\)/.test(padd[0]) && /linkParentToFamily\(/.test(padd[0]),
    'linking a parent from the scout page skips the admin check or the siblings');
  const lpf = /function linkParentToFamily\(uid, sc\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(lpf && /familyMembers\(sc\)/.test(lpf[0]) && /concat\(\[uid\]\)/.test(lpf[0]),
    'a second parent replaces the first instead of joining the list');
  const rmm = /function removeMember\(memberUid\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(rmm && /parentUids/.test(rmm[0]), 'removing a member leaves them linked as somebody’s parent');
  ok((SCRIPT.match(/familyId: '', parentUids: \[\] \}\);/g) || []).length === 2,
    'a newly added scout is not seeded with the family and parent fields');
});

test('a scout keeps every parent linked to them, and so do their brothers and sisters', () => {
  // Owner ask, 2026-09-27: link multiple parents to a scout. Mum and Dad both, from either page.
  const f = sandbox(['arrOf', 'familyKeyOf', 'familyMembers', 'familyLabel', 'joinFamily', 'leaveFamily', 'linkParentToFamily']);
  const toasts = [];
  f.showToast = (m) => toasts.push(m);
  const a = { id: 'a', name: 'Ada', familyId: '', parentUids: [] };
  const b = { id: 'b', name: 'Ben', familyId: '', parentUids: [] };
  const c = { id: 'c', name: 'Cal', familyId: '', parentUids: [] };
  f.state = { scouts: [a, b, c] };
  f.activeScouts = () => f.state.scouts;
  f.joinFamily(f.state.scouts, a, b);
  f.linkParentToFamily('mum', a);
  f.linkParentToFamily('dad', b);
  f.linkParentToFamily('dad', a);
  eq([...a.parentUids], ['mum', 'dad'], 'the second parent did not join the first on the scout');
  eq([...b.parentUids], ['mum', 'dad'], 'a sibling did not get both parents');
  eq([...c.parentUids], [], 'a parent was linked to a scout outside the family');
  f.linkParentToFamily('gran', c);
  eq([...c.parentUids], ['gran'], 'a scout on their own could not be given a parent');
});

/* ================================================================
   Covering the leaders, and the deadline box — 2026-07-28
   ================================================================ */

test('a leader’s place is the pack’s cost, never family income', () => {
  // The bug this pins: with no charges raised yet, expected family income fell back to the whole
  // planned cost — leaders included. A pack covering its leaders was told to raise LESS than it
  // needed by exactly what the leaders cost, which is the one direction that leaves it short.
  const fn = /function fundingSummary\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'fundingSummary() not found');
  ok(/: lineFamilyPlanned\(l\);/.test(fn[0]), 'the fees fallback is not the family share');
  ok(!/: linePlanned\(l\);/.test(fn[0]), 'the fees fallback still counts the leaders’ places');
  // It became a block when it learned about a planned parent, so match to its own closing brace
  // at function indent — the previous single-line match would now silently find nothing.
  const fam = /function lineFamilyPlanned\(l\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fam, 'lineFamilyPlanned() not found');
  ok(/linePlannedShare\(l, 'scout'\)/.test(fam[0]) && !/leaderRateCents/.test(fam[0]),
    'what families are billed includes a leader rate');
  const shareBlk = /function linePlannedShare\(l, who\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(shareBlk && !/leaderRateCents/.test(shareBlk[0]), 'a planned SHARE includes a leader rate');
  // A is still the whole cost — the pack really is spending it.
  const cb = /function computeBudget\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(/actPlanned \+= linePlanned\(a\);/.test(cb[0]), 'the planned figure stopped counting the leaders');
});

test('covering the leaders is shown, and priced per scout on the goal', () => {
  // "Split those costs amongst each scout" is what the plan already does — popcorn carries what
  // families are not billed for — but a pack cannot act on that unless it can see the number.
  const fn = /function leaderPlannedCents\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'leaderPlannedCents() not found');
  ok(/if \(!lineThroughPack\(r\.line\) \|\| !r\.line\.includeLeaders\) return;/.test(fn[0]),
    'it counts lines that do not include leaders, or money the pack never handles');
  ok(/\(r\.line\.leaderRateCents \|\| 0\) \* activeLeaders\(\)\.length/.test(fn[0]),
    'the leader cost is not the leader rate across the ACTIVE leader roster');
  ok(/leaderPerScout: \(salesGoal != null && scouts > 0 && leaderPlanned > 0\)/.test(SCRIPT),
    'the per-scout share of the leaders’ cost is not worked out');
  ok(/of which leaders/.test(SCRIPT), 'the worksheet never shows it');
  // Was /a scout on the goal/. That wording is gone on purpose: it described a COST figure
  // using the words of the SALES goal four rows below it. The row now prints both units and
  // labels each, so the assertion is that BOTH are there — a cost per scout, and the sales
  // that cost takes. Dropping either one puts the ambiguity straight back.
  ok(/leaderPerScoutSales: \(salesGoal != null && scouts > 0 && leaderPlanned > 0\)/.test(SCRIPT),
    'the leaders’ cost is never converted into the unit the goal is actually in');
  ok(/fmt\(fs2\.leaderPerScout\) \+ ' a scout'/.test(SCRIPT),
    'the per-scout COST is not printed, or is not labelled as being per scout');
  ok(/of their sales goal/.test(SCRIPT),
    'the sales figure is not named as sales, so it reads as another cost');
  // codeOnly, because the comments explaining the change necessarily QUOTE the old wording —
  // the same trap the buildParentView absence tests hit, and the reason that helper exists.
  ok(!/a scout on the goal/.test(codeOnly(SCRIPT)),
    'the old wording is back — a cost figure described as part of the sales goal');
});

test('a line shows the arithmetic behind its total, and the parts sum to it', () => {
  // The Budget showed heads, and rates, and a total, and never multiplied them out — so ticking
  // "Include registered leaders" moved the total with nothing on screen saying by how much.
  const ctx = vm.createContext({});
  vm.runInContext(
    `${slice('linePerHead')}\n${slice('linePerFamily')}\n${slice('linePlannedHeads')}\n` +
    `${slice('linePlannedCents')}\n${slice('linePlannedPartsOf')}\n${slice('freshLine')}\n${slice('uid')}`, ctx);
  const line = ctx.freshLine({
    basis: 'per-head', scoutRateCents: 8500, leaderRateCents: 6500,
    includeLeaders: true, adultRateCents: 0
  });
  const parts = ctx.linePlannedPartsOf(line, 12, 5, 12);
  eq(parts.map((p) => p.who), ['scout', 'leader'], 'the head classes are wrong or out of order');
  eq(parts.map((p) => p.cents), [102000, 32500], 'a part is not heads × rate');
  eq(parts.map((p) => p.label), ['12 scouts', '5 leaders'], 'the head labels do not pluralise');
  // THE INVARIANT: the parts are the total, broken up. If these ever drift the screen is lying.
  eq(parts.reduce((n, p) => n + p.cents, 0), ctx.linePlannedCents(line, 12, 5, 12),
    'the breakdown does not add up to the total it claims to explain');
  // A rate of nought is NOT PRICED, not "zero dollars" — or every line grows empty rows.
  const noLeader = ctx.freshLine({ basis: 'per-head', scoutRateCents: 8500, includeLeaders: false });
  eq(ctx.linePlannedPartsOf(noLeader, 12, 5, 12).map((p) => p.who), ['scout'],
    'a line that does not include leaders is still pricing them');
  eq(ctx.linePlannedPartsOf(ctx.freshLine({ basis: 'flat', flatCents: 5000 }), 12, 5, 12), [],
    'a flat line has heads to multiply out');
  // A per-family fee is ONE fee for whoever the family brings — one part, never three.
  const fam = ctx.freshLine({ basis: 'per-family', scoutRateCents: 4000, includeLeaders: true, leaderRateCents: 6500 });
  eq(ctx.linePlannedPartsOf(fam, 12, 5, 9).map((p) => [p.who, p.n]), [['family', 9]],
    'a per-family line splits into head classes it does not have');
});

test('the breakdown is only shown where it adds something', () => {
  const fn = /function linePlannedBreakdown\(l\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'linePlannedBreakdown() not found');
  ok(/if \(parts\.length < 2\) return '';/.test(fn[0]),
    'a single-part line restates its own total as arithmetic, which is noise');
  // Reads as a sum the caller can close with "= <total> planned". It used to put an "=" inside
  // each part, which gave "… = $325.00 = $1,345.00 planned" — one broken-looking equation.
  ok(/fmt\(p\.cents\) \+ ' \(' \+ p\.label \+ ' × ' \+ fmt\(p\.rate\) \+ '\)'/.test(fn[0]),
    'a part does not lead with what it comes to, or drops its working');
  ok(/\.join\(' \+ '\)/.test(fn[0]), 'the parts do not read as a sum');
  ok(/linePlannedBreakdown\(l\)/.test(SCRIPT), 'nothing on the Budget renders it');
  // Reachable from the collapsed row as well as from the expanded options.
  ok(/esc\(linePlannedBreakdown\(l\) \|\| 'Planned — set the rates in Options'\)/.test(SCRIPT),
    'the total’s tooltip does not carry the breakdown, or lost its fallback hint');
});

test('ticking "include registered leaders" says where that money goes', () => {
  // The parent's place had a sentence either way; the leader's had none, and the branch was an
  // else-if chain so a leaders-and-no-parents line fell through it in silence. That silence is
  // what produced "I am confused on how the cost of leader is getting covered".
  const blk = /var counted = \[scoutN \+ denWord[\s\S]*?return head;/.exec(SCRIPT);
  ok(blk, 'the budget line head-count note not found');
  ok(/if \(l\.includeLeaders\) \{/.test(blk[0]), 'the leaders still have no sentence of their own');
  ok(/No family is ever billed for a leader/.test(blk[0]),
    'it does not say that a leader’s place is never family income');
  ok(/it lands in A and never in B, and the fundraising goal is what pays for it/.test(blk[0]),
    'it does not say what DOES pay for a leader’s place');
  // Both boxes ticked must produce BOTH sentences, so the chain must not be else-if any more.
  ok(!/\} else if \(l\.includeAdults && lineFamilyFunded\(l\)\) \{/.test(blk[0]),
    'the branches are still exclusive, so a line with leaders AND parents drops one of them');
  ok(/Families pay, so the parent/.test(blk[0]) && /The pack is paying for those parents/.test(blk[0]),
    'the parent’s two sentences were lost in the restructure');
  // Two clauses that each appended their own '. ' produced "…pays for it.. Families pay…" on a
  // line with both boxes ticked. They are joined now, and no clause carries a leading separator.
  ok(/if \(tail\.length\) head \+= '\. ' \+ tail\.join\(' '\);/.test(blk[0]),
    'the clauses are not joined, so two of them run their punctuation together');
  ok(!/tail\.push\('\. /.test(blk[0]) && !/head \+= '\. No family/.test(blk[0]),
    'a clause still carries its own leading full stop');
});

test('a tier with no deadline shows no date box', () => {
  // A native date input that has been touched can sit there showing a date the tier does not
  // have. No deadline, no box — and the box comes back the moment somebody asks for one.
  ok(/\(\(t\.dueBy \|\| ui\.tierDueOpen\[t\.id\]\)/.test(SCRIPT),
    'the date box renders whether or not there is a deadline');
  ok(/data-act="tier-due-open:/.test(SCRIPT), 'there is no way to add a deadline');
  ok(/data-act="tier-due-clear:/.test(SCRIPT), 'there is no way to take one off');
  const clear = /if \(act\.indexOf\('tier-due-clear:'\) === 0\) \{[\s\S]*?\n    \}/.exec(SCRIPT);
  ok(clear && /dcT\.dueBy = '';/.test(clear[0]), 'clearing does not clear the deadline');
  ok(clear && /ui\.tierDueOpen\[dcId\] = false;/.test(clear[0]),
    'clearing leaves the empty box behind, which is the thing being fixed');
  ok(/tierDueOpen: \{\},/.test(SCRIPT), 'the open-box flag is not part of ui state');
});

/* ========================================================================
   Cash donations can earn a scout something — 2026-08-02
   ===================================================================== */

test('a kept cash donation credits the scout, and only while the pack keeps it', () => {
  const ctx = vm.createContext({ state: {} });
  vm.runInContext(slice('cashScoutRate') + slice('cashCreditOn') + slice('cashScoutCredit'), ctx);
  const credit = (pct, viaTE, cents) => {
    ctx.state.cashScoutPct = pct; ctx.state.cashThroughTrailsEnd = viaTE;
    return vm.runInContext(`cashScoutCredit(${cents})`, ctx);
  };
  eq(credit('30', false, 50000), 15000, '30% of $500');
  eq(credit('', false, 50000), 0, 'no rate set means cash earns a scout nothing');
  eq(credit('0', false, 50000), 0, 'zero is the same as blank');
  eq(credit('30', false, 0), 0, 'nothing in, nothing credited');
  eq(credit('33.3', false, 10000), 3330, 'a fractional rate rounds to the cent');
  eq(credit('150', false, 10000), 10000, 'a scout cannot be credited more than the pack was given');
  // The one that matters: with the toggle ON that same cash is already earning real commission.
  eq(credit('30', true, 50000), 0, 'a donation run through Trail’s End is being credited twice');
});

test('the cash credit lands in what a scout earned, not in what they sold', () => {
  // A scout who hands over $500 in cash at a table earned the pack more than one who rang up
  // $500 of product — and until this rate existed the board had them at $175 and $0.
  const donor = "{ sales: 0, onS: 0, onD: 0, storeD: 50000, wagonD: 0 }";
  const on = coverageSandbox(`
     var RATE = '35', ONLINE_RATE = '30', CASH_RATE = '30';
     var TIERS = [{ id:'t1', thresholdCents: 15000, covers:['dues'] }];
     var SALES = { seller: tot(50000), donor: ${donor} };`);
  ok(on.EARNED.t1.seller, '$500 of storefront popcorn at 35% is $175, which clears $150');
  ok(on.EARNED.t1.donor, '$500 of cash at a 30% credit is $150, which reaches it too');
  eq(vm.runInContext('goalBaseOf({ t: SALES.donor })', on), 0,
    'the donation leaked into the sales base, so the Trail’s End goal thinks it was sold');
  const off = coverageSandbox(`
     var RATE = '35', ONLINE_RATE = '30';
     var TIERS = [{ id:'t1', thresholdCents: 15000, covers:['dues'] }];
     var SALES = { donor: ${donor} };`);
  ok(!off.EARNED.t1.donor, 'with no credit rate set, a donation still earned a tier');
});

test('cash run through Trail’s End is never paid for twice', () => {
  // Toggle on, the donation IS commissionable and goalBaseOf already carries it. Adding a
  // credit on top would hand the scout the money twice over for the same twenty-dollar bill.
  const ctx = coverageSandbox(`
     var RATE = '35', ONLINE_RATE = '30', CASH_RATE = '30', CASH_VIA_TE = true;
     var TIERS = [{ id:'t1', thresholdCents: 15000, covers:['dues'] }];
     var SALES = { donor: { sales: 0, onS: 0, onD: 0, storeD: 50000, wagonD: 0 } };`);
  eq(vm.runInContext('scoutCommissionOf({ t: SALES.donor })', ctx), 17500,
    'the commission and the credit are both being counted');
  eq(vm.runInContext('commissionRates().cash', ctx), null,
    'the effective cash rate must read as "none" while Trail’s End is handling the cash');
});

test('the pack-wide split only credits cash that reached a scout', () => {
  const ctx = vm.createContext({
    state: { cashScoutPct: '30', cashThroughTrailsEnd: false },
    // $1000 kept, but only $250 of it was ever credited to a scout — the rest sits on a
    // storefront block nobody was assigned to.
    computePackTotals: () => ({ cashKept: 100000 }),
    computeScoutTotals: () => ({ a: { storeD: 20000, wagonD: 5000 }, b: { storeD: 0, wagonD: 0 } })
  });
  vm.runInContext(slice('cashScoutRate') + slice('cashCreditOn') + slice('cashScoutCredit') +
    slice('cashCreditTotals'), ctx);
  const out = vm.runInContext('cashCreditTotals()', ctx);
  eq(out.credited, 7500, '30% of the $250 that actually reached a scout');
  eq(out.free, 92500, 'unassigned cash is free money — no tier has a claim on it');
  eq(out.kept, 100000, 'kept is the pack figure, not the scouts’ share of it');
  ctx.state.cashScoutPct = '';
  eq(vm.runInContext('cashCreditTotals()', ctx), { on: false, rate: null, kept: 100000, credited: 0, free: 100000 },
    'with no rate the whole kept figure is free and nothing is credited');
});

test('a cash credit rate alone is enough to measure tiers', () => {
  const fn = /function tierRateMissing\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn && /rates\.cash == null/.test(fn[0]),
    'a donations-only pack is told nothing can be measured while its credit rate sits there');
});

test('the cash credit is described as credit, never as a payout', () => {
  // Scouting America's unit budgeting guidance: money raised in the pack's name belongs to the
  // pack. This rate decides tier progress and nothing else — the copy must not imply otherwise.
  ok(/nothing is paid out and no scout has an account of their own/.test(SCRIPT),
    'the field never says the money is not handed over');
  ok(/It is credit, not a payout/.test(SCRIPT), 'the standings board never says it either');
  ok(!/paid out to (a|the) scout|into the scout’s account|the scout’s own account/.test(SCRIPT),
    'the copy describes an individual scout account, which is the thing to avoid');
  ok(/<strong>reward tiers<\/strong> of the scout who brought it in/.test(SCRIPT),
    'the field never says what the credit is actually for');
});

test('a checkbox and its label are styled wherever they are used', () => {
  // .perscout was defined three times, each scoped to a row class — so Season setup's copy of
  // the same markup fell through to the global `input` rule and drew a 40px padded box.
  ok(/\n  \.perscout \{ display: inline-flex;/.test(SCRIPT_CSS), 'there is no unscoped .perscout rule');
  ok(/\n  \.perscout input\[type="checkbox"\] \{[^}]*min-height: auto;/.test(SCRIPT_CSS),
    'the checkbox still inherits the 40px min-height from the global input rule');
  ok(!/\.(erow|lrow|arow) \.perscout input \{/.test(SCRIPT_CSS),
    'a row-scoped copy of the input reset is back — the base rule already does it');
  ok(!/\.(erow|lrow|arow) \.perscout \{ display: inline-flex/.test(SCRIPT_CSS),
    'a row-scoped copy of the whole rule is back');
});

/* ========================================================================
   Camping — a page per campout, published to parents. 2026-08-02
   ===================================================================== */

test('proseText escapes first and only ever emits tags it built', () => {
  // A section body is prose a leader typed into a textarea and it is republished verbatim to
  // every parent in the pack. If anything here can emit an attacker-chosen tag, the parent
  // view is the delivery mechanism.
  const ctx = sandbox(['esc', 'proseText']);
  const run = (s) => ctx.proseText(s);
  ok(!/<script>/.test(run('<script>alert(1)</script>')), 'a script tag survived');
  ok(run('<b>hi</b>').includes('&lt;b&gt;hi&lt;/b&gt;'), 'markup is not escaped');
  ok(!/onerror/.test(run('<img src=x onerror=alert(1)>').replace(/&[a-z]+;/g, '')) === false ||
    run('<img src=x onerror=alert(1)>').indexOf('<img') === -1, 'an img tag was emitted');
  eq(run(''), '', 'empty in, empty out');
  eq(run('   \n  '), '', 'whitespace only is empty');
  eq(run('one'), '<p>one</p>', 'a bare line is a paragraph');
  eq(run('one\ntwo'), '<p>one<br>two</p>', 'a single newline is a line break, not a paragraph');
  eq(run('one\n\ntwo'), '<p>one</p><p>two</p>', 'a blank line starts a new paragraph');
  eq(run('- a\n- b'), '<ul class="camp-list"><li>a</li><li>b</li></ul>', 'a run of dashes is a list');
  // A HEADING LINE FOLLOWED BY BULLETS MUST NOT LOSE THE HEADING. That requirement is unchanged
  // and is what these assertions exist for. What changed is how it is met.
  //
  // It used to be met by refusing to build a list at all: the old all-or-nothing test
  // (`bullets.length === lines.length`) failed on any mixed block, so the whole thing fell to
  // <p>…<br>…</p> and the heading was safe because NOTHING was marked up. The old assertions
  // pinned that symptom — `indexOf('<ul') === -1`, and the literal `'Sleeping<br>- pad'` — rather
  // than the requirement. The cost was that the shape people actually write came out as a solid
  // paragraph with literal hyphens in it, on the page a parent reads once, on a phone, while the
  // textarea's own placeholder promised "start a line with - for a bullet".
  //
  // Runs honour the requirement properly: the heading becomes its own element and the bullets
  // become a real list. So the assertions now pin the requirement — the heading survives, and it
  // is never swallowed into an <li> — plus the thing the old shape could not deliver.
  const mixed = run('Sleeping\n- pad\n- bag');
  ok(mixed.includes('Sleeping'), 'the mixed block lost its heading');
  ok(!/<li>[^<]*Sleeping/.test(mixed), 'the heading was swallowed into a list item');
  ok(mixed.includes('<ul class="camp-list">'), 'the bullets under a heading are still not a list');
  ok(!/[-•]\s/.test(mixed), 'a literal dash is still being rendered to the reader');
  eq(run('Sleeping\n- pad'),
    '<p class="camp-sub">Sleeping</p><ul class="camp-list"><li>pad</li></ul>',
    'a one-line heading over a list is not a label plus a list');
  // The label treatment must not swallow a real lead-in SENTENCE — terminal punctuation is the
  // test, so a Youth Protection preamble stays a paragraph instead of becoming small caps.
  ok(run('This part is not flexible.\n- one').startsWith('<p>This part is not flexible.</p>'),
    'a punctuated lead-in sentence was demoted to a small-caps label');
  // Runs alternate correctly, and trailing prose after a list is its own paragraph. ('one' is
  // short, unpunctuated and introduces the list, so it IS a label — that is the heuristic, not a
  // slip. 'three' follows the list and introduces nothing, so it stays a paragraph.)
  eq(run('one\n- two\nthree'),
    '<p class="camp-sub">one</p><ul class="camp-list"><li>two</li></ul><p>three</p>',
    'runs are not being grouped by kind');
  // A long lead-in is prose even without terminal punctuation — 48 chars is the cut.
  ok(run('Everything in this list is provided by the pack for you\n- one').startsWith('<p>Everything'),
    'a long lead-in line was demoted to a small-caps label');
  eq(run('a\r\nb'), '<p>a<br>b</p>', 'CRLF from a pasted document is not handled');
});

test('the seeded trips are real content, and are seeded exactly once', () => {
  const ctx = sandbox(NORMALIZE_FNS);
  const trips = ctx.seedCampingTrips();
  eq(trips.length, 3, 'the two council weekends and the pack\u2019s own Fort Yargo trip are seeded');
  trips.forEach((t) => {
    ok(t.id && t.name && t.where && t.address, `${t.name}: missing header fields`);
    ok(t.sections.length >= 6, `${t.name}: only ${t.sections.length} sections`);
    t.sections.forEach((s) => ok(s.id && s.title && s.body, `${t.name}: an empty section was seeded`));
    // Every id distinct, or the sub-tab strip and every data-sec lookup collide.
    const ids = t.sections.map((s) => s.id);
    eq(new Set(ids).size, ids.length, `${t.name}: duplicate section ids`);
  });
  eq(new Set(trips.map((t) => t.id)).size, 3, 'two of the trips share an id');
  // The pack's own trip carries a STABLE id, because the one-time add below recognises it by id.
  // A uid() here would re-add the trip on every single load.
  ok(trips.some((t) => t.id === 'trip-fort-yargo'), 'the Fort Yargo trip has no stable id');
  // It is pack-run, and the two rules that follow from that are the whole reason it reads
  // differently from the council weekends: BALOO, and no BB or archery.
  const yargo = trips.find((t) => t.id === 'trip-fort-yargo');
  ok(/BALOO/.test(JSON.stringify(yargo)), 'the pack-run trip does not mention BALOO');
  ok(/not approved unit activities/.test(JSON.stringify(yargo)),
    'the pack-run trip does not say why it has no BB or archery');
  // Last year's dates, labelled with their year — the convention the other two already use, so a
  // reader can tell a published date from a confirmed one.
  ok(/\(2026: Fri 27 Mar/.test(yargo.when), 'the Fort Yargo dates are not labelled with their year');
  // The camp is spelled Rainey. Getting this wrong sends a family to the wrong search result.
  ok(/Rainey Mountain/.test(JSON.stringify(trips)), 'Camp Rainey Mountain is not named');
  ok(!/Rainy Mountain/.test(JSON.stringify(trips)), 'the camp is misspelled "Rainy"');

  // A record with no camping key gets the seed...
  const fresh = ctx.normalizeState(preMigrationState());
  eq(fresh.camping.trips.length, 3, 'a pre-camping pack record was not seeded');
  // FRESHCAMPING ITSELF must carry the flag, and asserting it on normalizeState's output cannot
  // show that — the migration sets the flag on the way through, so it is true either way. The path
  // that matters is load()'s OTHER branch: a brand-new record comes from freshState() and is
  // returned WITHOUT being normalized, so nothing else will ever set it.
  // Observed before this was fixed: new pack, delete Fort Yargo, reload, and it was back.
  ok(ctx.freshCamping().yargoAdded === true,
    'freshCamping does not flag the trip as offered — a new pack that deletes it gets it back');
  const freshMinusYargo = Object.assign(ctx.normalizeState(preMigrationState()), {
    camping: { yargoAdded: true, trips: [{ id: 'keep', name: 'Fall', sections: [] }] }
  });
  eq(ctx.normalizeState(freshMinusYargo).camping.trips.length, 1,
    'a pack that deleted Fort Yargo had it pushed back');
  // ...and a pack that has DELETED every trip must never have them pushed back. This covers the
  // one-time Fort Yargo add too: an empty camping tab is a decision, not a gap to fill.
  const emptied = ctx.normalizeState(Object.assign(preMigrationState(), { camping: { trips: [] } }));
  eq(emptied.camping.trips.length, 0, 'something was pushed into a camping tab the pack had cleared');
  ok(emptied.camping.yargoAdded === true, 'the one-time flag was not set, so it will try again next load');
  // A record that already has the two council trips DOES get the third, once.
  const twoTrips = () => Object.assign(preMigrationState(), {
    camping: { trips: [{ id: 'a', name: 'Fall', sections: [] }, { id: 'b', name: 'Spring', sections: [] }] }
  });
  const added = ctx.normalizeState(twoTrips());
  eq(added.camping.trips.length, 3, 'an existing pack did not receive the Fort Yargo trip');
  ok(added.camping.trips.some((t) => t.id === 'trip-fort-yargo'), 'the added trip is not Fort Yargo');
  // ...and only once, however many times normalize runs, and not again if it is then deleted.
  eq(ctx.normalizeState(added).camping.trips.length, 3, 'the trip was added twice');
  const deletedAgain = Object.assign(added, {
    camping: { yargoAdded: true, trips: added.camping.trips.filter((t) => t.id !== 'trip-fort-yargo') }
  });
  eq(ctx.normalizeState(deletedAgain).camping.trips.length, 2,
    'a deliberately deleted Fort Yargo trip came back');
  // Junk is coerced rather than thrown away or trusted.
  // yargoAdded pre-set: this case is about COERCING junk, and letting the one-time add fire here
  // too would mean counting two different behaviours in one assertion.
  const messy = ctx.normalizeState(Object.assign(preMigrationState(), {
    camping: { yargoAdded: true, trips: [{ name: 7, sections: [{ title: 'ok' }, null, 'nope'] }, null, 'nope'] }
  }));
  eq(messy.camping.trips.length, 1, 'non-object trips were kept');
  eq(messy.camping.trips[0].name, '', 'a non-string name was kept');
  eq(messy.camping.trips[0].sections.length, 1, 'non-object sections were kept');
  eq(messy.camping.trips[0].sections[0].body, '', 'a missing body was not defaulted');
  ok(messy.camping.trips[0].id && messy.camping.trips[0].sections[0].id, 'ids were not filled in');
});

test('a year’s new seed text reaches a pack that already has its trips — but only untouched text', () => {
  // seedCampingTrips never runs again for a pack that has trips, so without this a pack seeded in
  // August keeps last year's dates for ever. The refresh may only replace text an earlier seed
  // wrote: a leader's own edit is theirs, and overwriting it would be the app arguing with them.
  const ctx = sandbox(NORMALIZE_FNS);
  const seed = ctx.seedCampingTrips();
  const byName = (name) => seed.find((t) => t.name === name);
  const fall = byName('Fall Family Camping');

  // The real table must be SANE: no hash in it may match what the current seed writes (or the
  // refresh would be a no-op dressed up as a change), and every section it points at must exist.
  Object.entries(ctx.CAMP_OLD_SEED).forEach(([name, old]) => {
    const cur = byName(name);
    ok(cur, `CAMP_OLD_SEED names a trip the seed no longer has: ${name}`);
    Object.entries(old.fields).forEach(([k, hs]) =>
      ok(!hs.includes(ctx.campHash(cur[k])), `${name}.${k}: the old hash is the CURRENT text`));
    Object.entries(old.sections).forEach(([title, o]) => {
      const to = o.to || title;
      const s = cur.sections.find((x) => x.title === to);
      ok(s, `${name}: "${title}" points at a section the seed does not have ("${to}")`);
      ok(!o.h.includes(ctx.campHash(s.body)), `${name}: "${title}" old hash is the CURRENT text`);
    });
  });

  // Behaviour, against a synthetic table so the test does not depend on last year's prose.
  ctx.CAMP_OLD_SEED = {
    'Fall Family Camping': {
      fields: { when: [ctx.campHash('old when')], cost: [ctx.campHash('old cost')] },
      sections: {
        'Old weather': { h: [ctx.campHash('old weather body')], to: 'Weather, and what early October does' },
        'Food': { h: [ctx.campHash('old food body')] }
      }
    }
  };
  const camping = () => ({
    yargoAdded: true,
    trips: [{
      id: 'f', name: 'Fall Family Camping', when: 'old when', cost: 'Leader typed this', sections: [
        { id: 's1', title: 'Old weather', body: 'old weather body' },
        { id: 's2', title: 'Food', body: 'old food body, and then a leader added a line' },
        { id: 's3', title: 'Our own section', body: 'kept' }
      ]
    }, {
      // Renamed by a leader: not the seed's trip any more, so not the seed's to change.
      id: 'r', name: 'Scoutland 2026', when: 'old when', sections: []
    }]
  });
  const after = ctx.normalizeState(Object.assign(preMigrationState(), { camping: camping() })).camping;
  const t = after.trips[0];
  eq(t.when, fall.when, 'an untouched seeded field was not refreshed');
  eq(t.cost, 'Leader typed this', 'a field the leader edited was overwritten');
  eq(t.sections[0].title, 'Weather, and what early October does', 'a renamed section kept its old title');
  eq(t.sections[0].body, fall.sections.find((s) => s.title === t.sections[0].title).body,
    'an untouched seeded section was not refreshed');
  eq(t.sections[0].id, 's1', 'the refreshed section lost its id');
  eq(t.sections[1].body, 'old food body, and then a leader added a line', 'an edited section was overwritten');
  eq(t.sections[2].body, 'kept', 'the pack’s own section was touched');
  eq(after.trips[1].when, 'old when', 'a trip the leader renamed was refreshed');
  eq(after.seedRev, ctx.CAMP_SEED_REV, 'the revision was not recorded, so it will run every load');

  // Once per revision: a record already at this revision is left alone, whatever it holds.
  const done = ctx.normalizeState(Object.assign(preMigrationState(),
    { camping: Object.assign(camping(), { seedRev: ctx.CAMP_SEED_REV }) })).camping;
  eq(done.trips[0].when, 'old when', 'the refresh ran again on a record already at this revision');
  // A brand-new record is not normalised on load, so freshCamping must carry the revision itself.
  eq(ctx.freshCamping().seedRev, ctx.CAMP_SEED_REV, 'freshCamping does not carry the seed revision');
});

test('rev 2 carries the new supervision rules and spring link into a pack still on rev 1 text', () => {
  // The synthetic-table test above proves the mechanism; this proves the REAL table. The rev 1
  // wording is kept here verbatim because it is exactly what a live pack's record still holds,
  // and a hash that doesn't match it would leave every existing pack on the old rules silently.
  const OLD_SAFETY = 'This part is Youth Protection, and it is not flexible.\n' +
    '- Every youth is the responsibility of one named adult for the whole weekend. Lions and Tigers must have their own adult partner there.\n' +
    '- Parents, guardians and siblings share a tent as a family. That is the normal arrangement at family camp.\n' +
    '- Otherwise a Scout tents with another youth within two years of their age and of the same gender. No adult shares a tent with a youth who is not their own child.\n' +
    '- Two registered adults with current Safeguarding Youth training are present at all times.\n' +
    '- At least one adult on the trip is BALOO-trained (Basic Adult Leader Outdoor Orientation) and at least one holds current Hazardous Weather training. Both are required for a pack to camp. If you would like to be one of them, tell the Cubmaster — BALOO is a weekend course and the pack should never be one person away from being unable to go.';
  const ctx = sandbox(NORMALIZE_FNS);
  ok(ctx.CAMP_SEED_REV >= 2, 'CAMP_SEED_REV was not bumped for the 2026-09-27 seed changes');
  const seed = ctx.seedCampingTrips();
  const SLEEP = 'Sleeping arrangements and supervision';
  const rev1 = () => ({
    yargoAdded: true, seedRev: 1,
    trips: seed.map((t) => Object.assign({}, t, {
      url: t.name === 'Spring Family Camping' ? 'https://www.nega-bsa.org/spring-camping' : t.url,
      sections: t.sections.map((s) => Object.assign({}, s, s.title === SLEEP ? { body: OLD_SAFETY } : {}))
    }))
  });
  const start = rev1();
  // A leader on Fort Yargo rewrote the supervision section; theirs stays.
  start.trips[2].sections.find((s) => s.title === SLEEP).body = OLD_SAFETY + '\n- Our own extra rule.';
  const after = ctx.normalizeState(Object.assign(preMigrationState(), { camping: start })).camping;
  const body = (i) => after.trips[i].sections.find((s) => s.title === SLEEP).body;
  eq(body(0), ctx.CAMP_SAFETY, 'the fall trip kept the rev 1 supervision text');
  eq(body(1), ctx.CAMP_SAFETY, 'the spring trip kept the rev 1 supervision text');
  eq(body(2), OLD_SAFETY + '\n- Our own extra rule.', "a leader's edited supervision section was overwritten");
  eq(after.trips[1].url, 'https://www.nega-bsa.org/family-camp', 'the spring link was not moved to the family-camp page');
  ok(/own parent or legal guardian/.test(ctx.CAMP_SAFETY) && /must be registered/.test(ctx.CAMP_SAFETY) &&
    /female adult 21 or older/.test(ctx.CAMP_SAFETY), 'the new supervision rules are not in CAMP_SAFETY');
  eq(after.seedRev, ctx.CAMP_SEED_REV, 'the revision was not recorded');
});

test('rev 3 carries the 2026-09-28 supervision wording into a pack still on rev 2 text', () => {
  // The rev 2 CAMP_SAFETY, verbatim — it is what every live pack's three trips hold today.
  const REV2_SAFETY = 'This part is Youth Protection, and it is not flexible.\n' +
    '- Every Cub Scout camps with their own parent or legal guardian; Lions and Tigers with their adult partner. Only in exceptional circumstances, agreed beforehand by the Cubmaster and the parent, may a Scout come under another registered adult who is the parent of a Cub Scout also on the trip.\n' +
    '- Parents, guardians and siblings share a tent as a family. No adult shares a tent with a youth who is not their own child. Youth who share a tent are the same gender and within two years of age.\n' +
    '- Two registered adults with current Safeguarding Youth Training, at least one of them 21 or older, are present at all times. When girls attend, a registered female adult 21 or older is there too.\n' +
    '- Any adult staying overnight who is not the parent or guardian of a Cub Scout on the trip must be registered.\n' +
    '- At least one adult on the trip is BALOO-trained (Basic Adult Leader Outdoor Orientation) and at least one holds current Hazardous Weather training. Both are required for a pack to camp. If you would like to be one of them, tell the Cubmaster — BALOO is a weekend course and the pack should never be one person away from being unable to go.';
  const ctx = sandbox(NORMALIZE_FNS);
  ok(ctx.CAMP_SEED_REV >= 3, 'CAMP_SEED_REV was not bumped for the 2026-09-28 supervision wording');
  ok(/Two registered adult leaders, both 21 or older/.test(ctx.CAMP_SAFETY), 'CAMP_SAFETY does not say both leaders are 21 or older');
  ok(!/at least one of them 21 or older/.test(ctx.CAMP_SAFETY), 'CAMP_SAFETY still says only one needs to be 21');
  ok(/never applies to a Lion or Tiger/.test(ctx.CAMP_SAFETY) && /more than one Scout from outside their own family/.test(ctx.CAMP_SAFETY),
    'the exceptional-circumstances limits are missing');
  ok(/required for a pack overnighter/.test(ctx.CAMP_SAFETY) && !/required for a pack to camp/.test(ctx.CAMP_SAFETY),
    'the BALOO line still reads as if every family camper needs it');
  const SLEEP = 'Sleeping arrangements and supervision';
  const start = {
    yargoAdded: true, seedRev: 2,
    trips: ctx.seedCampingTrips().map((t) => Object.assign({}, t, {
      sections: t.sections.map((s) => Object.assign({}, s, s.title === SLEEP ? { body: REV2_SAFETY } : {}))
    }))
  };
  start.trips[1].sections.find((s) => s.title === SLEEP).body = REV2_SAFETY + '\n- Ours.';
  const after = ctx.normalizeState(Object.assign(preMigrationState(), { camping: start })).camping;
  const body = (i) => after.trips[i].sections.find((s) => s.title === SLEEP).body;
  eq(body(0), ctx.CAMP_SAFETY, 'the fall trip kept the rev 2 supervision text');
  eq(body(2), ctx.CAMP_SAFETY, 'Fort Yargo kept the rev 2 supervision text');
  eq(body(1), REV2_SAFETY + '\n- Ours.', "a leader's edited supervision section was overwritten");
  eq(after.seedRev, ctx.CAMP_SEED_REV, 'the revision was not recorded');
  ok(/both 21 or older/.test(readFileSync(join(ROOT, 'DESIGN-camping.md'), 'utf8')), 'DESIGN-camping.md still says one 21 or older');
});

test('the 2026-09-27 camping corrections hold', () => {
  const ctx = sandbox(NORMALIZE_FNS.concat(['CAMP_PACK_RUN', 'CAMP_EMERGENCY', 'YARGO_TRIP_ID']));
  const trips = ctx.seedCampingTrips();
  const all = JSON.stringify(trips);
  const [fall, spring, yargo] = trips;
  eq(fall.cost, '2026: $35 per family online through Wed 30 Sep · $45 late rate from 11:59 pm Wed 30 Sep until online registration closes Thu 1 Oct, 11:59 pm · $45 on site · card fee added online',
    'the fall cost line');
  ok(/\$45 late rate from 11:59 pm Wed 30 Sep/.test(fall.sections.find((s) => s.title === 'Before you go').body),
    '"Before you go" does not match the cost line');
  ok(!/usually credit/.test(all), 'the seed still promises fees are usually credited elsewhere');
  eq(spring.url, 'https://www.nega-bsa.org/family-camp', 'spring link');
  ok(/Northeast Georgia Medical Center Barrow, 316 N Broad St, Winder · \(770\) 867-3400/.test(JSON.stringify(yargo)),
    'Fort Yargo names the wrong hospital');
  ok(!/Barrow Regional/.test(all), 'the old hospital name is still there');
  // Drive times contradicted each other ("twenty minutes closer", "an hour up I-85"). None now.
  ok(!/twenty minutes closer|an hour up|about an hour from Atlanta|under an hour away/.test(all), 'a drive-time claim is back');
  ok(/leave pets at home unless you’ve checked with the Cubmaster first \(service animals are always welcome\)/i.test(all),
    'the Fort Yargo pets line');
  ok(!/Class [AB]\b/.test(all), 'Class A / Class B instead of field / activity uniform');
  ok(!/site appraisal|site approval/.test(JSON.stringify(yargo)), 'site-approval text was added to Fort Yargo');
  ok(!/Camp Rainey — fall/.test(SCRIPT), 'Camp Rainey is the spring campout, not the fall one');
});

test('a trip link is labelled by who hosts it', () => {
  const ctx = sandbox(['campLinkLabel']);
  eq(ctx.campLinkLabel('https://www.nega-bsa.org/APFF'), ['Register', 'Council page'], 'council');
  eq(ctx.campLinkLabel('https://mycouncil.nega-bsa.org/Event/APFF-2026'), ['Register', 'Council page'], 'council subdomain');
  eq(ctx.campLinkLabel('https://gastateparks.org/FortYargo'), ['Book', 'Park page'], 'state park');
  eq(ctx.campLinkLabel('https://example.com/nega-bsa.org'), ['Link', 'Event page'], 'a path is not a host');
  eq(ctx.campLinkLabel('https://notnega-bsa.org/'), ['Link', 'Event page'], 'a lookalike host');
  ok(/campLinkLabel\(t\.url\)/.test(slice('campFacts')), 'campFacts does not use it');
});

test('the seeded content states the rules a pack actually has to follow', () => {
  // Not a style check — these are the four things a BALOO course exists to make sure somebody
  // on the trip knows. If a rewrite drops them the page becomes a packing list with a
  // reassuring tone, which is worse than nothing.
  const ctx = sandbox(NORMALIZE_FNS);
  const all = JSON.stringify(ctx.seedCampingTrips());
  [
    ['BALOO', 'the BALOO requirement'],
    ['Hazardous Weather', 'the Hazardous Weather training requirement'],
    ['parts A and B', 'the medical form requirement'],
    ['not approved unit activities', 'why shooting sports only happen at a council camp'],
    ['No adult shares a tent with a youth who is not their own child', 'the tenting rule'],
    ['Safeguarding Youth', 'the current name for Youth Protection training'],
    ['Lions do not shoot BB guns', 'the Lion range restriction'],
    ['Fire building is Webelos and up', 'the fire-building age rule']
  ].forEach(([needle, what]) => ok(all.includes(needle), `the seed no longer states ${what}`));
});

test('Camping sections are one per trip, and a trip id is never a route', () => {
  const ctx = vm.createContext({ state: { camping: { trips: [] } } });
  vm.runInContext(slice('campingTrips') + slice('tripTabLabel') + slice('sectionsOf'), ctx);
  const secs = (trips) => {
    ctx.state.camping.trips = trips;
    return vm.runInContext('sectionsOf({ id: "camping", dynamic: "camping", sections: [] })', ctx);
  };
  eq(secs([]).length, 1, 'an empty Camping tab must still offer a section to render');
  eq(secs([{ id: 'a', name: 'Fall' }, { id: 'b', name: 'Spring' }]).map((s) => s.id), ['a', 'b'],
    'one section per trip, in order');
  const long = secs([{ id: 'a', name: 'A very long campout name indeed' }])[0].label;
  ok(long.length <= 22 && long.endsWith('…'), `a long name is not shortened for the strip: ${long}`);
  eq(secs([{ id: 'a', name: 'Fall Family Camping' }])[0].label, 'Fall Family Camping',
    'a name that already fits was truncated');
  eq(secs([{ id: 'a', name: '' }])[0].label, 'Untitled trip', 'a nameless trip has no label');
  // A static workspace is untouched by any of this.
  const stat = vm.runInContext('sectionsOf({ id: "money", sections: [{ id: "budget" }] })', ctx);
  eq(stat.length, 1, 'a static workspace lost its sections');
  // Trip ids must NOT be registered as routes: SECTION_HOME is built from the literal
  // `sections` array, and Camping declares an empty one precisely so nothing lands there.
  ok(/\{ id: 'camping', label: 'Camping', dynamic: 'camping', sections: \[\] \}/.test(SCRIPT),
    'the Camping workspace declares static sections, which would put trip ids in SECTION_HOME');
});

test('camping edits are behind canEdit, and deletes are two-tap with an undo', () => {
  const actBlock = (a) => {
    const lit = a.replace(/[-:]/g, '\\$&');
    const re = a.endsWith(':')
      ? new RegExp(`act\\.indexOf\\('${lit}'\\) === 0\\)[\\s\\S]{0,900}`)
      : new RegExp(`act === '${lit}'\\)[\\s\\S]{0,900}`);
    return re.exec(SCRIPT);
  };
  ['camp-add-trip', 'camp-add-sec:', 'camp-del-sec:', 'camp-del-trip:'].forEach((a) => {
    const m = actBlock(a);
    ok(m, `the ${a} action is missing`);
    ok(/if \(!canEdit\(\)\) return;/.test(m[0]), `${a} does not check canEdit()`);
  });
  ['camp-del-sec:', 'camp-del-trip:'].forEach((a) => {
    const m = actBlock(a);
    ok(/arm\(act, function/.test(m[0]), `${a} deletes on a single tap`);
    ok(/deleteWithUndo\(/.test(m[0]), `${a} cannot be undone`);
  });
  // Deleting the trip you are looking at must clear the remembered sub-tab.
  ok(/if \(ui\.sections\.camping === dtId\) ui\.sections\.camping = '';/.test(SCRIPT),
    'deleting the open trip leaves its id remembered as the current section');
});

test('every trip is published to parents, rebuilt field by field', () => {
  const fn = /function buildParentView\(src, opts\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'buildParentView() not found');
  ok(/var camping = campingTrips\(\)\.map/.test(fn[0]), 'the trips are not published');
  // Never a spread: a field added to a trip in some later wave must not ride along unseen.
  ok(!/\.\.\.t\b/.test(fn[0]), 'the published trip spreads the source object');
  ['name', 'where', 'address', 'when', 'arrive', 'depart', 'cost', 'url', 'intro'].forEach((k) => {
    ok(new RegExp(`${k}: String\\(t\\.${k} \\|\\| ''\\)`).test(fn[0]), `the published trip drops ${k}`);
  });
  ok(/return \{ title: String\(s\.title \|\| ''\), body: String\(s\.body \|\| ''\) \};/.test(fn[0]),
    'a section is published with more than its title and body');
  ok(/if \(camping\.length\) out\.camping = camping;/.test(fn[0]),
    'an empty camping list still publishes a key, so parents get an empty tab');
  // A trip a leader has only just created carries nothing worth reading. It must not reach a
  // parent's phone, and the only thing keeping it off is that freshTrip leaves the name BLANK
  // — a placeholder name would be truthy and would sail straight through this filter.
  ok(/return t\.name \|\| t\.where \|\| t\.when \|\| t\.intro \|\| t\.sections\.length;/.test(fn[0]),
    'an empty trip is published');
  const ft = /function freshTrip\(name\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(ft && /id: uid\(\), name: String\(name \|\| ''\)/.test(ft[0]),
    'a new trip is born with a placeholder name, which publishes it empty');
  // And the old guarantees still hold with camping in the payload.
  ok(!/ledger/i.test(fn[0]), 'buildParentView references the ledger');
  ok(!/\bbook\b/.test(fn[0]), 'buildParentView references the book');
  // The parent tab appears only when there is something on it.
  ok(/function parentHasCamping\(\)/.test(SCRIPT), 'parentHasCamping() not found');
  ok(/Array\.isArray\(pv\.camping\) && pv\.camping\.length/.test(SCRIPT),
    'an empty published list would still show the tab');
  ok(/renderParentCamping\(pv\)/.test(SCRIPT), 'the parent app never renders the camping page');
});

test('the editor says the page is published before anyone types into it', () => {
  // The whole feature is "parents can read this". Somebody will otherwise put a phone number
  // or a family's situation in a section body, and there is no unpublish.
  ok(/<strong>Everything on this page is published to parents<\/strong>/.test(SCRIPT),
    'the editor never warns that the page is public');
  ok(/no budget, no.*dues, no roster/s.test(SCRIPT),
    'the notice does not say what is NOT published, which is the other half of the reassurance');
});

/* ========================================================================
   An adventure across several den meetings — 2026-08-02
   ===================================================================== */

// One den, one adventure tagged on several dated meetings, plus an attendance book.
function runSandbox(setup) {
  const ctx = vm.createContext({});
  vm.runInContext(
    `${setup}
     ${slice('DENS')}
     ${slice('ADVENTURES')}
     ${slice('ADV_RENAMES')}
     ${slice('advOptionsForDen')}
     ${slice('advCanonicalName')}
     ${slice('advOffDenList')}
     ${slice('evAdventure')}
     ${slice('meetingRoster')}
     ${slice('wasCheckedIn')}
     ${slice('adventureRuns')}
     ${slice('runProgress')}
     ${slice('runForMeeting')}
     ${slice('sessionLabel')}
     ${slice('nextPackMeetingAfter')}
     ${slice('programYearStartISO')}
     ${slice('programYearEndISO')}
     ${slice('PROGRAM_START_MONTH')}
     ${slice('pad2')}
     function activeScouts() { return SCOUTS; }
     function advKindFor() { return 'req'; }
     function advStatus(sid, kind, name) { return (STATUS[sid] || {})[name] || ''; }
     function todayISO() { return TODAY; }
     var state = { events: EVENTS, attendance: ATT, budget: { programYear: 2026 } };`, ctx);
  return ctx;
}

const RUN_SETUP = `
  var TODAY = '2026-08-13';
  var SCOUTS = [{ id: 'a', name: 'Ada', den: 'Wolf' }, { id: 'b', name: 'Ben', den: 'Wolf' },
                { id: 'c', name: 'Cy', den: 'Bear' }];
  var STATUS = {};
  var EVENTS = [
    { id: 'm1', kind: 'den', den: 'Wolf', date: '2026-08-05', time: '19:00', adventure: 'Bobcat' },
    { id: 'm2', kind: 'den', den: 'Wolf', date: '2026-08-12', time: '19:00', adventure: 'Bobcat' },
    { id: 'm3', kind: 'den', den: 'Wolf', date: '2026-08-19', time: '19:00', adventure: 'Bobcat' },
    { id: 'p1', kind: 'pack', den: '', date: '2026-08-26', adventure: '' },
    { id: 'x1', kind: 'den', den: 'Bear', date: '2026-08-05', adventure: 'Bobcat' }
  ];
  var ATT = {
    m1: { a: { scout: true }, b: { scout: true } },
    m2: { a: { scout: true } },
    m3: {}
  };`;

test('meetings tagged with the same adventure form one run, per den', () => {
  const ctx = runSandbox(RUN_SETUP);
  const runs = vm.runInContext('adventureRuns()', ctx);
  eq(runs.length, 2, 'Wolf and Bear each work Bobcat — two runs, not one');
  eq(runs.map((r) => r.den + ':' + r.sessions.length).sort(), ['Bear:1', 'Wolf:3'],
    'the sessions are not grouped by den');
  eq(runs.find((r) => r.den === 'Wolf').sessions.map((s) => s.id), ['m1', 'm2', 'm3'],
    'sessions are not in date order');
  // A pack meeting is not a session of anything, and an untagged meeting is not either.
  ok(!runs.some((r) => r.sessions.some((s) => s.kind === 'pack')), 'a pack meeting became a session');
});

test('a scout is 2 of 3, and the missed night is named', () => {
  const ctx = runSandbox(RUN_SETUP);
  const p = vm.runInContext("runProgress(adventureRuns().find(function (r) { return r.den === 'Wolf'; }))", ctx);
  eq(p.total, 3, 'three sessions');
  eq(p.scouts.map((r) => r.scout.name), ['Ada', 'Ben'], 'the roster is not the den');
  const ada = p.scouts.find((r) => r.scout.name === 'Ada');
  const ben = p.scouts.find((r) => r.scout.name === 'Ben');
  eq(ada.count, 2, 'Ada was at the two that have happened');
  eq(ada.missed.length, 0, 'Ada has missed nothing — the third has not happened yet');
  eq(ada.pending.map((e) => e.id), ['m3'], 'the still-to-come session is not tracked');
  ok(!ada.full, 'attending 2 of 3 is not the whole run');
  eq(ben.count, 1, 'Ben was at one');
  eq(ben.missed.map((e) => e.id), ['m2'], 'Ben missed the 12th and it is not reported');
  eq(p.onTrack.map((r) => r.scout.name), ['Ada'], 'on-track is "missed nothing so far"');
  eq(p.short.map((r) => r.scout.name), ['Ben'], 'short is "missed at least one that happened"');
  eq(p.complete.length, 0, 'nobody has been to all three yet');
});

test('a session still to come is never counted as missed', () => {
  // The trap: treating every unattended session as a miss would report every scout as behind
  // the moment a den schedules next month's meetings.
  const ctx = runSandbox(RUN_SETUP.replace("var TODAY = '2026-08-13';", "var TODAY = '2026-08-06';"));
  const p = vm.runInContext("runProgress(adventureRuns().find(function (r) { return r.den === 'Wolf'; }))", ctx);
  p.scouts.forEach((r) => eq(r.missed.length, 0, `${r.scout.name} was marked as missing a future meeting`));
  eq(p.onTrack.length, 2, 'both scouts should still be on track the day after session one');
});

test('every session attended, and the run is complete', () => {
  const ctx = runSandbox(RUN_SETUP
    .replace("var TODAY = '2026-08-13';", "var TODAY = '2026-08-20';")
    .replace('m3: {}', "m3: { a: { scout: true }, b: { scout: true } }"));
  const p = vm.runInContext("runProgress(adventureRuns().find(function (r) { return r.den === 'Wolf'; }))", ctx);
  const ada = p.scouts.find((r) => r.scout.name === 'Ada');
  ok(ada.full, 'Ada attended all three and is not marked complete');
  eq(p.complete.map((r) => r.scout.name), ['Ada'], 'only Ada was at all three');
  eq(p.onTrack.map((r) => r.scout.name), ['Ada'], 'Ben missed the 12th, so he is not on track');
});

test('a run is scoped to the program year, and a meeting knows its place in it', () => {
  const ctx = runSandbox(RUN_SETUP);
  const r2 = vm.runInContext("runForMeeting(state.events[1])", ctx);
  eq(r2.position, 2, 'the second meeting is session 2');
  eq(r2.of, 3, 'of three');
  eq(vm.runInContext('sessionLabel(2, 3)', ctx), 'session 2 of 3', 'the label is wrong');
  eq(vm.runInContext('sessionLabel(1, 1)', ctx), 'one session', 'a single session should not say "1 of 1"');
  // Undated, and a pack meeting: neither is a session.
  eq(vm.runInContext("runForMeeting({ kind: 'den', den: 'Wolf', date: '', adventure: 'Bobcat' })", ctx), null,
    'an undated meeting became a session');
  eq(vm.runInContext("runForMeeting({ kind: 'pack', den: '', date: '2026-08-05', adventure: 'Bobcat' })", ctx), null,
    'a pack meeting became a session');
  // LAST year's meeting on the same adventure must not join this year's run — the den is a
  // different set of children by then, and counting it reports a scout as finished who has
  // never been.
  const prior = runSandbox(RUN_SETUP.replace("{ id: 'm1', kind: 'den', den: 'Wolf', date: '2026-08-05'",
    "{ id: 'm1', kind: 'den', den: 'Wolf', date: '2025-08-05'"));
  const wolf = vm.runInContext("adventureRuns().find(function (r) { return r.den === 'Wolf'; })", prior);
  eq(wolf.sessions.map((s) => s.id), ['m2', 'm3'], 'a meeting outside the program year joined the run');
});

test('the award is presented at the next pack meeting', () => {
  // Researched: recognition is immediate at the den meeting, and FORMAL at the next pack
  // meeting, where the loop or pin is actually handed over. The calendar knows which one.
  const ctx = runSandbox(RUN_SETUP);
  eq(vm.runInContext("nextPackMeetingAfter('2026-08-13').id", ctx), 'p1', 'the next pack meeting is not found');
  eq(vm.runInContext("nextPackMeetingAfter('2026-09-01')", ctx), null, 'a past pack meeting was offered');
});

test('the mark-off button credits the run, not the room', () => {
  // The defect this replaces: on a three-meeting adventure the old button credited everyone
  // checked in TONIGHT, so a scout marked at session one who then missed two kept the credit.
  const m = /if \(act === 'mtg-adv-mark'\) \{[\s\S]*?\n    \}/.exec(SCRIPT);
  ok(m, 'the mtg-adv-mark action is missing');
  ok(/var mamRun = runForMeeting\(mam\);/.test(m[0]), 'it does not resolve the run');
  ok(/mamRun\.prog\.onTrack\.forEach/.test(m[0]),
    'it still credits the attendance book for this one meeting');
  ok(!/state\.attendance\[mam\.id\]/.test(m[0]), 'it still reads tonight’s attendance directly');
});

test('a scout who stayed home TONIGHT is not credited by tonight’s Mark-done', () => {
  // Audit 2026-09-27: a session dated today counted as `pending`, so a scout not checked in
  // tonight had "missed nothing" and the button — pressed at the end of tonight's meeting —
  // credited them. m2 is tonight; Ada is checked in, Ben is not.
  const ctx = runSandbox(RUN_SETUP.replace("var TODAY = '2026-08-13';", "var TODAY = '2026-08-12';"));
  const p = vm.runInContext("runProgress(adventureRuns().find(function (r) { return r.den === 'Wolf'; }))", ctx);
  const ben = p.scouts.find((r) => r.scout.name === 'Ben');
  eq(ben.missed.map((e) => e.id), ['m2'], 'tonight’s session is not a miss for a scout who is not here');
  eq(ben.pending.map((e) => e.id), ['m3'], 'only sessions AFTER today are still to come');
  eq(p.onTrack.map((r) => r.scout.name), ['Ada'], 'a scout absent tonight is still offered for Mark done');
});

test('a scout who has been to no session at all is never credited', () => {
  // "Missed nothing" is also true of a scout who has not been to anything. The day before the
  // first session nobody has attended, so the button must have nobody to credit.
  const ctx = runSandbox(RUN_SETUP
    .replace("var TODAY = '2026-08-13';", "var TODAY = '2026-08-04';")
    .replace(/var ATT = \{[\s\S]*?\};/, 'var ATT = {};'));
  const p = vm.runInContext("runProgress(adventureRuns().find(function (r) { return r.den === 'Wolf'; }))", ctx);
  p.scouts.forEach((r) => eq(r.missed.length, 0, `${r.scout.name} missed a session that has not happened`));
  p.scouts.forEach((r) => eq(r.count, 0, `${r.scout.name} was checked in at something`));
  eq(p.onTrack.length, 0, 'a scout with 0 sessions attended is on track to be marked done');
});

test('Home says when there are awards ready to buy', () => {
  // Audit 2026-09-27: shopItems() returns { groups, total } and the Home task tested
  // `shop.length` — undefined on an object — so "N awards ready to buy" never appeared.
  const ctx = vm.createContext({});
  vm.runInContext(`${slice('DENS')}
    var ADVENTURES = {};
    var state = { advancement: { a: { req: { Bobcat: 'done' }, elect: { Backyard: 'awarded' } } } };
    function activeScouts() { return [{ id: 'a', den: 'Wolf' }]; }
    function advRec(id) { return state.advancement[id] || null; }
    ${slice('shopItems')}`, ctx);
  const list = vm.runInContext('shopItems()', ctx);
  eq(list.total, 1, 'one adventure is done and not yet awarded');
  ok(list.length === undefined, 'shopItems() became an array — re-check the Home task');
  const home = slice('homeTasks');
  ok(!/shop\.length/.test(home), 'the Home task still reads shop.length, which is always undefined');
  ok(/if \(shop\.total\)/.test(home), 'the Home task does not test shopItems().total');
});

test('a scout who moves up a den leaves the old rank’s adventures behind', () => {
  // Audit 2026-09-27: marks are keyed by adventure name only, and Bobcat is on every rank's
  // list. The standalone "Advance dens" moved the roster without clearing, so a new Bear
  // showed Wolf's Bobcat as done and Wolf electives counted toward Bear.
  const ctx = vm.createContext({});
  vm.runInContext(`${slice('DENS')}
    var state = {
      scouts: [
        { id: 'w', den: 'Wolf' }, { id: 'aol', den: 'Arrow of Light' },
        { id: 'gone', den: 'Tiger', archived: true }, { id: 'none', den: '' }
      ],
      advancement: {
        w: { req: { Bobcat: 'awarded' }, elect: { Backyard: 'done' } },
        aol: { req: { Bobcat: 'done' }, elect: {} },
        gone: { req: { Bobcat: 'done' }, elect: {} },
        none: { req: { Bobcat: 'done' }, elect: {} }
      }
    };
    ${slice('advanceDens')}`, ctx);
  const res = vm.runInContext('advanceDens()', ctx);
  eq(res, { advanced: 1, crossed: 1 }, 'the move itself changed');
  eq(vm.runInContext("state.scouts[0].den", ctx), 'Bear', 'the Wolf did not move up');
  ok(!vm.runInContext("state.advancement.w", ctx), 'the new Bear still carries Wolf’s Bobcat');
  ok(!vm.runInContext("state.advancement.aol", ctx), 'a crossed-over scout kept a rank they have left');
  // Scouts the button did NOT move keep their marks — they are still in the rank they earned them in.
  ok(vm.runInContext("!!state.advancement.gone && !!state.advancement.none", ctx),
    'a scout who did not move lost their advancement');
});

test('the close-out never clears the marks earned since the dens were advanced', () => {
  // Advance dens runs in spring; the close-out comes months later. Everything marked in
  // between belongs to the rank the scout is in now, so the close-out must not wipe it — and
  // the season's own summary, taken at the advance, is what the archive keeps.
  const roll = /function rolloverYear\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  ok(/var densAlreadyAdvanced = state\.densAdvancedYear === closingYear;/.test(roll), 'rollover does not know dens were advanced');
  ok(/if \(!densAlreadyAdvanced\) state\.advancement = \{\};/.test(roll),
    'rollover still clears the whole advancement book after a spring advance');
  ok(/state\.densAdvancedSummary = null;/.test(roll), 'last season’s summary survives into the new year');
  const handler = /if \(act === 'adv-dens' \|\| act === 'adv-dens-again'\) \{[\s\S]*?\n    \}/.exec(SCRIPT)[0];
  ok(handler.indexOf('advPerDenSummary()') !== -1 && handler.indexOf('advPerDenSummary()') < handler.indexOf('advanceDens()'),
    'the season summary is not taken BEFORE the advance clears the marks');
  const arc = slice('buildSeasonArchive');
  ok(/state\.densAdvancedYear === year && snap && snap\.year === year/.test(arc),
    'the season archive ignores the summary taken at Advance dens');
});

test('the Advance-dens summary survives a reload, and junk does not', () => {
  const ctx = sandbox(NORMALIZE_FNS);
  const norm = (v) => { const d = preMigrationState(); d.densAdvancedSummary = v; return ctx.normalizeState(d).densAdvancedSummary; };
  eq(norm({ year: 2026, perDen: [{ den: 'Wolf', scouts: 3, complete: 1, adventuresAwarded: 7 }, { den: 'Nope' }] }),
    { year: 2026, perDen: [{ den: 'Wolf', scouts: 3, complete: 1, adventuresAwarded: 7 }] }, 'the summary did not round-trip');
  eq(norm(undefined), null, 'a record from before this field is not null');
  eq(norm({ year: 'x', perDen: [] }), null, 'a malformed summary was kept');
});

test('an adventure typed in lower case is the official adventure, and one run', () => {
  // Audit 2026-09-27: the adventure box is free text over a suggestion list. "council fire" and
  // "Council Fire" were two runs, and a Mark-done on the first wrote a mark the grid never shows.
  const ctx = runSandbox(RUN_SETUP.replace("var EVENTS = [", `var EVENTS = [
    { id: 'c1', kind: 'den', den: 'Wolf', date: '2026-09-02', adventure: 'council fire' },
    { id: 'c2', kind: 'den', den: 'Wolf', date: '2026-09-09', adventure: '  Council  Fire ' },
    { id: 'k1', kind: 'den', den: 'Wolf', date: '2026-09-16', adventure: 'Knot night' },
    { id: 'k2', kind: 'den', den: 'Wolf', date: '2026-09-23', adventure: 'knot night' },`));
  const canon = (den, raw) => vm.runInContext(`advCanonicalName(${JSON.stringify(den)}, ${JSON.stringify(raw)})`, ctx);
  eq(canon('Wolf', 'council fire'), 'Council Fire', 'case is not matched to the official name');
  eq(canon('Lion', 'lion roar'), "Lion's Roar", 'the handbook rename is not applied case-insensitively');
  eq(canon('', 'BOBCAT'), 'Bobcat', 'an all-dens meeting does not match against every rank');
  eq(canon('Wolf', 'Knot night'), 'Knot night', 'a custom adventure was rewritten');
  eq(canon('Wolf', ''), '', 'an empty tag became something');
  const runs = vm.runInContext("adventureRuns().filter(function (r) { return r.den === 'Wolf'; })", ctx);
  const cf = runs.filter((r) => r.adventure.toLowerCase() === 'council fire');
  eq(cf.length, 1, '"council fire" and "Council Fire" are still two runs');
  eq(cf[0].adventure, 'Council Fire', 'the run is not named in the official spelling');
  eq(cf[0].sessions.map((e) => e.id), ['c1', 'c2'], 'the run lost a session');
  eq(runs.filter((r) => r.adventure.toLowerCase() === 'knot night').length, 1, 'a custom adventure typed two ways is two runs');
  eq(vm.runInContext("runForMeeting(state.events[1]).of", ctx), 2, 'the lower-case meeting does not find its run');
});

test('an adventure that is not on the den’s list is warned about, never refused', () => {
  const ctx = runSandbox(RUN_SETUP);
  const off = (den, nm) => vm.runInContext(`advOffDenList(${JSON.stringify(den)}, ${JSON.stringify(nm)})`, ctx);
  ok(off('Bear', "Lion's Roar"), 'a Lion adventure on a Bear meeting is not flagged');
  ok(!off('Wolf', 'Council Fire'), 'a Wolf adventure on a Wolf meeting is flagged');
  ok(off('Wolf', 'Knot night'), 'a custom adventure is not flagged');
  ok(!off('Wolf', ''), 'an empty tag is flagged');
  const picker = slice('advTargetPicker');
  ok(/advOffDenList\(m\.den, tagged\)/.test(picker) && /class="warn small"/.test(picker),
    'the meeting editor does not show the off-list warning');
  // Save and den change both re-spell, and neither refuses the value.
  ok(/if \(ch === 'mtg-adv' \|\| ch === 'mtg-den'\) mtg\.adventure = advCanonicalName\(mtg\.den, mtg\.adventure\);/.test(SCRIPT),
    'saving the adventure or changing the den does not normalize the adventure');
  const mark = /if \(act === 'mtg-adv-mark'\) \{[\s\S]*?\n    \}/.exec(SCRIPT)[0];
  ok(/mamAdv = mamRun\.run\.adventure;/.test(mark), 'Mark done credits the typed spelling, not the run’s');
});

test('"nobody credited" means a finished run in this year that nobody in the den has', () => {
  // Audit 2026-09-27: the nudge counted every past den MEETING ever, flagged a run after its
  // first night, and any scout on the whole roster with the name hid it for every den.
  const withSlice = (setup) => {
    const ctx = runSandbox(setup);
    vm.runInContext(slice('uncreditedRuns'), ctx);
    return vm.runInContext('uncreditedRuns().map(function (r) { return r.den + ":" + r.adventure; })', ctx);
  };
  // Aug 13: Wolf's Bobcat has a session still to come; Bear's one-nighter is over, nobody marked.
  eq(withSlice(RUN_SETUP), ['Bear:Bobcat'], 'a run with a session still to come was flagged, or a finished one was not');
  // Aug 20: both over. Cy (Bear) has Bobcat — that must not hide the Wolf den's.
  eq(withSlice(RUN_SETUP.replace("var TODAY = '2026-08-13';", "var TODAY = '2026-08-20';")
    .replace('var STATUS = {};', "var STATUS = { c: { Bobcat: 'done' } };")), ['Wolf:Bobcat'],
    'a Bear’s Bobcat hid the Wolf den’s uncredited run');
  // One Wolf credited clears the Wolf run (the nudge is "nobody", not "not everybody").
  eq(withSlice(RUN_SETUP.replace("var TODAY = '2026-08-13';", "var TODAY = '2026-08-20';")
    .replace('var STATUS = {};', "var STATUS = { a: { Bobcat: 'done' }, c: { Bobcat: 'done' } };")), [],
    'a run somebody was credited for is still flagged');
  // Last program year's meeting is not this year's business.
  eq(withSlice(RUN_SETUP.replace("{ id: 'x1', kind: 'den', den: 'Bear', date: '2026-08-05'",
    "{ id: 'x1', kind: 'den', den: 'Bear', date: '2025-08-05'")), [], 'last year’s meeting was flagged');
  ok(/var uncredited = uncreditedRuns\(\);/.test(slice('renderAdvancement')), 'the Advancement card does not use uncreditedRuns');
});

test('attendance is evidence, and the app never says a missed meeting costs the adventure', () => {
  // Researched, and it decides the wording: Cub Scout advancement is per requirement, "Do Your
  // Best" is the standard, and work done at home is signed by a parent and approved by the den
  // leader. A tracker that implied a missed den meeting forfeits the adventure would be wrong
  // about the programme, not just harsh.
  ok(/does not cost them the/.test(SCRIPT), 'the make-up path is never stated');
  ok(/“Do Your Best” is the standard/.test(SCRIPT), 'the actual standard is not named');
  ok(/Attendance is <strong>evidence, /.test(SCRIPT), 'the runs card does not say what attendance is');
  ok(!/cannot earn|missed out on the adventure|forfeit/i.test(SCRIPT),
    'the copy says a missed meeting loses the adventure');
});

/* ========================================================================
   The paid-direct prompt asks only what nobody has answered — 2026-08-02
   ===================================================================== */

test('a line the pack pays, or already has a payee, is never asked about', () => {
  // The owner's objection: the row's own Paid-by control already says "families pay the pack",
  // so why is a card asking again? Because on a carried-over line that value is what the
  // familyPays→fundedBy upgrade wrote, not a decision. fundedSet is that distinction.
  const ctx = sandbox(NORMALIZE_FNS);
  const norm = (line) => {
    const d = preMigrationState();
    d.budget.expenses = [Object.assign({ id: 'x', name: 'X' }, line)];
    return ctx.normalizeState(d).budget.expenses[0];
  };
  eq(norm({ basis: 'flat', fundedBy: 'pack' }).fundedSet, true,
    'a pack-paid line has no payee question, so it must not be asked about');
  eq(norm({ basis: 'per-head', fundedBy: 'families', paidDirectTo: 'Council' }).fundedSet, true,
    'a line that already names a payee has plainly been answered');
  eq(norm({ basis: 'per-head', fundedBy: 'families', paidDirectTo: '' }).fundedSet, false,
    'a families-pay-the-pack line with no payee is the ONE case that is genuinely unanswered');
  eq(norm({ basis: 'per-head', fundedBy: 'families', paidDirectTo: '', fundedSet: true }).fundedSet, true,
    'an answer already recorded was thrown away');
  // freshLine starts unanswered; normalize immediately settles it because it is pack-funded.
  ok(/fundedSet: false/.test(SCRIPT), 'freshLine does not carry the flag');
});

test('using the Paid-by control anywhere counts as answering', () => {
  const fn = /if \(ch\.indexOf\('line-'\) === 0\) \{[\s\S]*?\n      commit\(\); return;\n    \}/.exec(SCRIPT);
  ok(fn, 'the line change handler was not found');
  ok(/bl\.fundedSet = true;/.test(fn[0]), 'changing Paid by does not settle the question');
  ok(/bk === 'direct'\) \{ bl\.paidDirectTo = el\.value\.trim\(\); bl\.fundedSet = true; \}/.test(fn[0]),
    'typing a payee does not settle the question');
});

test('the prompt lists only unanswered lines, and Done answers them', () => {
  const card = /if \(!b\.directPrompted\) \{[\s\S]*?\n    \}/.exec(SCRIPT);
  ok(card, 'the paid-direct card was not found');
  ok(/lineFamilyFunded\(r\.line\) && lineThroughPack\(r\.line\) && !r\.line\.fundedSet/.test(card[0]),
    'the card still lists lines somebody has already answered');
  // It has to SAY why it is asking about a row that already reads "families pay the pack",
  // or it looks like it is ignoring an answer sitting right there on the row.
  ok(/that is \n?\s*'?what the upgrade wrote, not something anybody chose/.test(card[0]) ||
    /what the upgrade wrote, not something anybody chose/.test(card[0]),
    'the card never explains why it is asking about an already-set control');
  const done = /if \(act === 'direct-prompt-done'\) \{[\s\S]*?\n    \}/.exec(SCRIPT);
  ok(done, 'the done action was not found');
  ok(/r\.line\.fundedSet = true;/.test(done[0]), 'Done does not actually answer the listed lines');
  ok(!/directPrompted = true/.test(done[0]),
    'Done still mutes the question globally, so a line added later is never asked about');
  // But the legacy flag is still READ, so a pack that dismissed the old card stays dismissed.
  ok(/if \(!b\.directPrompted\) \{/.test(SCRIPT), 'the legacy dismissal is no longer honoured');
});

test('every paid-direct line is named, however many payees there are', () => {
  // The owner, looking at "Families pay $1,040.00 straight to somebody else this year — Council":
  // "I don't know where this is coming from." Four lines fed that total and the page named none
  // of them, because the breakdown rendered only when there were TWO OR MORE payees — and a
  // pack's paid-direct lines nearly all go to the same council. An unarguable figure with
  // nothing behind it is worse than either half on its own.
  const fn = /function familyDirectByPayee\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'familyDirectByPayee() not found');
  ok(/lines: \[\]/.test(fn[0]) && /cents: cents, line: l/.test(fn[0]),
    'the payee groups do not carry each line’s own figure');
  ok(!/names: \[\]/.test(fn[0]), 'the old names-only array is still there');
  // The card must not gate the breakdown on the payee count any more.
  const card = /if \(bud\.familyDirect > 0\) \{[\s\S]*?\n    \}/.exec(SCRIPT);
  ok(card, 'the paid-direct card was not found');
  ok(!/if \(fdBy\.length > 1\) \{/.test(card[0]),
    'the itemised list is still conditional on there being several payees');
  ok(/var fdOne = fdBy\.length === 1;/.test(card[0]), 'the single-payee case is not distinguished');
  // One payee → a flat list of lines. Several → payee subtotals with the lines nested.
  ok(/return fdOne \? kids/.test(card[0]), 'a single payee does not get a flat list of its lines');
  ok(/<ul style="margin:2px 0 0;padding-left:18px">' \+ kids/.test(card[0]),
    'several payees do not nest their lines under the subtotal');
  ok(!/this year' \+\s*\n?\s*\(fdOne \? ' — ' \+ esc\(fdBy\[0\]\.payee\) \+ '\.' : \(fdBy\.length \? ':' : '\.'\)\)/.test(card[0]),
    'the dangling colon before the next sentence is back');
});

test('what one family pays direct is computed per family, never by division', () => {
  // Owner ask: show the per-family cost too. The total divided by families would be a number no
  // family ever pays — a den-limited event reaches only some of them, a per-head fee is paid once
  // per scout, and a per-family fee once however many scouts they bring.
  const ctx = vm.createContext({});
  vm.runInContext(
    `${slice('familyKeyOf')}
     ${slice('familiesOf')}
     ${slice('activeFamilies')}
     ${slice('scoutsInDens')}
     ${slice('linePerHead')}
     ${slice('linePerFamily')}
     ${slice('lineThroughPack')}
     ${slice('familyDirectPerFamily')}
     ${slice('familyDirectPerDen')}
     ${slice('DENS')}
     function activeScouts() { return SCOUTS; }
     function allBudgetLines() { return LINES.map(function (l) { return { kind: 'activity', line: l }; }); }
     function lineDens(l) { return l.dens || []; }`, ctx);
  ctx.SCOUTS = [
    { id: 'a', den: 'Lion' }, { id: 'b', den: 'Wolf', familyId: 'a' },   // one family, two scouts
    { id: 'c', den: 'Tiger' }, { id: 'd', den: '' }
  ];
  ctx.LINES = [
    { name: 'Fall camp', basis: 'per-head', scoutRateCents: 3500, paidDirectTo: 'Council', dens: [] },
    { name: 'Spring camp', basis: 'per-family', scoutRateCents: 3500, paidDirectTo: 'Council', dens: [] },
    { name: 'Tigermania', basis: 'per-head', scoutRateCents: 2000, paidDirectTo: 'Council', dens: ['Lion', 'Tiger'] },
    { name: 'Shirts', basis: 'per-head', scoutRateCents: 1000, paidDirectTo: '', dens: [] } // through the pack
  ];
  const perFam = vm.runInContext('familyDirectPerFamily()', ctx);
  eq(perFam.length, 3, 'the two linked scouts must count as ONE family');
  const byFirstDen = {};
  perFam.forEach((f) => { byFirstDen[f.scouts[0].den || 'none'] = f.cents; });
  // Lion+Wolf: fall 35x2 + spring 35 once + tigermania 20 for the Lion only = 125
  eq(byFirstDen.Lion, 12500, 'a per-head fee is not doubled for a two-scout family, or the per-family fee is');
  eq(byFirstDen.Tiger, 9000, 'Tiger: 35 + 35 + 20');
  eq(byFirstDen.none, 7000, 'a scout with no den is in no den-limited event: 35 + 35');
  // A line the pack collects must never appear in a paid-direct figure.
  ok(!perFam.some((f) => f.cents % 1000 === 0 && f.cents === 1000), 'a through-the-pack line leaked in');
  // THE INVARIANT: with every direct line priced per head or per family, the family totals add
  // up to the pack-wide figure. If they ever diverge, one of the two is lying.
  const total = perFam.reduce((n, f) => n + f.cents, 0);
  eq(total, 12500 + 9000 + 7000, 'the per-family figures do not sum to the pack total');
  // Per den, for a one-scout family.
  const perDen = vm.runInContext('familyDirectPerDen()', ctx);
  eq(perDen.map((d) => d.den + ':' + d.cents),
    ['Lion:9000', 'Tiger:9000', 'Wolf:7000', 'no den set:7000'],
    'the per-den figures are wrong, or an empty den was quoted a price');
  // A flat line is a pack-wide figure, not a family price — it must not be attributed.
  ctx.LINES = [{ name: 'Flat thing', basis: 'flat', flatCents: 50000, paidDirectTo: 'Council', dens: [] }];
  eq(vm.runInContext('familyDirectPerFamily()', ctx).length, 0,
    'a flat paid-direct line was split across families, which invents a price nobody was quoted');
});

test('Home pairs two figures measured against the same thing', () => {
  // The owner, on a pack with last year's money banked and nothing sold: "$3,778.11 Funds in ·
  // 0% Of goal — this does not seem correct, that is our carryover, not funds earned or a
  // percent of our goal." Both halves of the objection were right. Funds in is carryover PLUS
  // commission PLUS fees collected PLUS other fundraisers — a Budget-page figure that only
  // reads correctly beside the formula the Budget page prints under it. Beside a sales-goal
  // percentage it looks like $3,778 of progress that counts for nothing.
  const card = /\/\* ----- Needs you ----- \*\/[\s\S]*?Looking ahead: /.exec(SCRIPT);
  ok(card, 'the Needs you card was not found');
  // The tile that names the goal's BASE must be there — but not under the label "Sold", which
  // claimed the figure was sales when teEligible also carries online (and sometimes cash)
  // donations. It is the numerator of the "Of goal" percentage beside it, so it is labelled for
  // that. The assertion pins the intent (a tile, off teEligible, named for what it measures)
  // rather than one particular word.
  ok(/<span class="l">Toward goal<\/span>/.test(card[0]), 'Home does not show what the goal is measured against');
  ok(!/<span class="l">Sold<\/span>/.test(card[0]), '"Sold" is back — teEligible is not sales');
  ok(/fmt\(packT\.teEligible\)/.test(card[0]), 'the goal-base tile is not the Trail’s End eligible figure');
  ok(!/fmt\(bud0\(\)\.fundsIn\)/.test(card[0]), 'the Funds in tile is back beside a goal percentage');
  ok(!/<span class="l">Funds in<\/span>/.test(card[0]), 'the Funds in label is back on Home');
  // Both tiles now come off teEligible/teGoal, so they can never disagree.
  ok(/var soldPct = packT\.teGoal > 0 \? Math\.min\(100, Math\.round\(packT\.teEligible \/ packT\.teBarGoal \* 100\)\)/.test(card[0]),
    'the percentage is derived from something other than the Sold figure');
  // The carryover is still reported — as what it is, and only when there is one.
  ok(/bud0\(\)\.startingBalance > 0/.test(card[0]), 'the carryover is shown even when there is none');
  ok(/carried over from last year is already in the bank, and was never part of this year’s goal/.test(card[0]),
    'the carryover is not explained as being outside the goal');
  // No goal yet is a different sentence from 0% of a goal.
  ok(/No Trail’s End goal yet/.test(card[0]), 'a pack with no goal is shown a bare em dash with no explanation');
  // The Budget page keeps Funds in — there it sits directly above its own formula.
  ok(/<span class="l">Funds in<\/span>/.test(SCRIPT), 'the Budget page lost its Funds in stat');
  ok(/<strong>Funds in<\/strong> = carryover \(/.test(SCRIPT), 'the Funds in formula is gone');
});

test('the A/B/C worksheet can wrap its labels, and groups its rows', () => {
  // The owner asked for the breakdown to be explained — because on a phone he could not SEE it.
  // The global `th, td { white-space: nowrap }` is right for the data grids (they sit in a
  // .tbl-wrap and scroll sideways), but this table has no wrapper, so the long leaders row
  // pushed it to 542px inside a 349px card and the whole amount column was clipped off-screen
  // with no scrollbar and no fade cue. Measured before: 542/349 overflowing, document 569px wide
  // in a 375px viewport. After: 321/349, document 375px.
  ok(/th, td \{[^}]*white-space: nowrap;/.test(SCRIPT_CSS),
    'the global nowrap is gone — if it was removed on purpose this test is the wrong guard');
  ok(/\.fund-tbl td:not\(\.num\) \{ white-space: normal; \}/.test(SCRIPT_CSS),
    'the worksheet labels cannot wrap, so a long one clips the amounts off-screen');
  ok(/\.fund-tbl td\.num \{[^}]*white-space: nowrap;/.test(SCRIPT_CSS),
    'money is allowed to break across lines');
  // Two kinds of indented row live here and they must not look alike: "…of which" rows break
  // A down (adding them double-counts), the rest sum to B.
  ok(/<tr class="fund-grp"><td colspan="2">Income<\/td><\/tr>/.test(SCRIPT),
    'nothing separates the rows that sum to B from the ones that break down A');
  ok(/\.fund-tbl \.fund-grp td \{/.test(SCRIPT_CSS), 'the group label row has no style');
  // The group header must sit ABOVE the first income row, not anywhere else.
  const tbl = /<table class="tbl fund-tbl">[\s\S]*?<\/table>/.exec(SCRIPT);
  ok(tbl, 'the worksheet table was not found');
  const grpAt = tbl[0].indexOf('fund-grp');
  const leadersAt = tbl[0].indexOf('leaders\\u2019 places');
  const carryAt = tbl[0].indexOf('Carryover from last year');
  ok(grpAt > leadersAt && grpAt < carryAt,
    'the Income label is not between the last "…of which" row and the first income row');
});

test('a year of Scouting, priced for a family that earns no tier', () => {
  // Owner ask: what does a year cost a family if they reach no tiers? Every other family figure
  // in this app is netted down by something (a tier's covers leave B, earned coverage stops
  // standing, the pack fronts and recovers). This one is deliberately GROSS — the most a family
  // can be asked for, which is the number you quote to somebody deciding whether they can join.
  const ctx = vm.createContext({ state: { rewardTiers: { tiers: [] } } });
  vm.runInContext(
    `${slice('scoutsInDens')}
     ${slice('linePerHead')}
     ${slice('linePerFamily')}
     ${slice('lineThroughPack')}
     ${slice('lineFamilyFunded')}
     ${slice('arrOf')}
     ${slice('sortedTiers')}
     ${slice('coverKeyOf')}
     ${slice('allTierCoverKeys')}
     ${slice('familyYearCostForDen')}
     ${slice('familyYearCost')}
     ${slice('DENS')}
     function activeScouts() { return SCOUTS; }
     function allBudgetLines() { return LINES.map(function (l) { return { kind: 'activity', line: l, key: l.name }; }); }
     function lineDens(l) { return l.dens || []; }
     function salesForCommission(c) { return c * 3; }`, ctx);
  ctx.SCOUTS = [{ id: 'a', den: 'Wolf' }, { id: 'b', den: 'Lion' }, { id: 'c', den: '' }];
  ctx.LINES = [
    { name: 'Registration', basis: 'per-head', scoutRateCents: 8500, fundedBy: 'families', paidDirectTo: '', dens: [] },
    { name: 'Blue & Gold', basis: 'per-head', scoutRateCents: 4200, adultRateCents: 5600, siblingRateCents: 2000, fundedBy: 'families', paidDirectTo: '', dens: [] },
    { name: 'Spring camp', basis: 'per-head', scoutRateCents: 3500, fundedBy: 'families', paidDirectTo: 'Council', dens: [] },
    { name: 'Tigermania', basis: 'per-head', scoutRateCents: 2000, fundedBy: 'families', paidDirectTo: 'Council', dens: ['Lion', 'Tiger'] },
    { name: 'Fall campout', basis: 'per-family', scoutRateCents: 3000, adultRateCents: 9900, fundedBy: 'families', paidDirectTo: '', dens: [] },
    { name: 'Charter fee', basis: 'flat', flatCents: 10000, fundedBy: 'pack', paidDirectTo: '', dens: [] },
    { name: 'Awards', basis: 'per-head', scoutRateCents: 4900, fundedBy: 'pack', paidDirectTo: '', dens: [] },
    { name: 'Flat family thing', basis: 'flat', flatCents: 7700, fundedBy: 'families', paidDirectTo: '', dens: [] }
  ];
  const wolf = vm.runInContext("familyYearCostForDen('Wolf')", ctx);
  // 85 + 42 + 35 + 30 = 192. NOT the Tiger-only event, NOT the two pack-funded lines, and NOT
  // the flat family line — a flat figure is a pack-wide total, not a per-family price.
  eq(wolf.scout, 19200, 'a Wolf: 85 registration + 42 banquet + 35 spring camp + 30 per-family campout');
  // OWNER RULING: one adult per scout is EXPECTED, not optional — a Cub Scout does not attend
  // alone. So the headline is scout + adult, and pricing only the scout is wrong by the whole
  // adult column.
  eq(wolf.adult, 5600, 'only Blue & Gold prices an adult; the per-family line must not');
  eq(wolf.expected, 24800, 'the expected cost is the scout AND the one adult who brings them');
  eq(wolf.throughPack, 21300, 'through the pack: 85 + (42+56) + 30');
  eq(wolf.direct, 3500, 'paid direct: the 35 spring camp, which prices no adult');
  eq(wolf.throughPack + wolf.direct, wolf.expected,
    'the two halves must add up to the EXPECTED figure, or the expansion ties to nothing on screen');
  // A per-family line prices ONE fee for whoever comes, so it contributes no adult or sibling.
  eq(wolf.lines.find((l) => l.name === 'Fall campout').adult, 0,
    'a per-family line must not add an adult price on top of its single fee');
  eq(wolf.sibling, 2000, 'only Blue & Gold prices a sibling — siblings stay out of the headline');
  ok(!wolf.lines.some((l) => l.name === 'Charter fee' || l.name === 'Awards'),
    'a line the pack pays costs a family nothing and must not be listed');
  ok(!wolf.lines.some((l) => l.name === 'Flat family thing'), 'a flat line was priced per family');
  // A den-limited event reaches only its dens.
  const lion = vm.runInContext("familyYearCostForDen('Lion')", ctx);
  eq(lion.expected - wolf.expected, 2000, 'the Lion should pay Tigermania and the Wolf should not');
  const none = vm.runInContext("familyYearCostForDen('')", ctx);
  eq(none.expected, wolf.expected, 'a scout with no den is in no den-limited event, like the Wolf');
  // Every den the pack offers — owner ask, 2026-09-11. Nobody here is a Tiger, Bear, Webelos or
  // Arrow of Light, and each of them is still priced: an empty den is the one a recruiting family
  // needs a figure for. "No den set" only while an active scout is actually missing a den.
  const rows = vm.runInContext('familyYearCost()', ctx);
  eq(rows.map((r) => r.den), ['Lion', 'Tiger', 'Wolf', 'Bear', 'Webelos', 'Arrow of Light', ''],
    'a den with nobody in it yet was left unpriced');
  ctx.SCOUTS = [{ id: 'a', den: 'Wolf' }];
  eq(vm.runInContext('familyYearCost()', ctx).some((r) => r.den === ''), false,
    '"No den set" was priced when every active scout has a den');
  ctx.SCOUTS = [{ id: 'a', den: 'Wolf' }, { id: 'b', den: 'Lion' }, { id: 'c', den: '' }];
  eq(wolf.covered, 0, 'a pack with no tiers covers nothing');

  // WHAT THE LADDER TAKES OFF IT. Three rungs that stack, two of them pointed at the same
  // banquet — the union, valued once, den-aware, scout and adult only.
  ctx.state.rewardTiers.tiers = [
    { id: 'a', name: 'a', thresholdCents: 15000, covers: ['Registration'] },
    { id: 'b', name: 'b', thresholdCents: 33000, covers: ['Blue & Gold', 'Tigermania'] },
    { id: 'c', name: 'c', thresholdCents: 41500, covers: ['Blue & Gold', 'Blue & Gold#adult'] }
  ];
  const wolf2 = vm.runInContext("familyYearCostForDen('Wolf')", ctx);
  // 85 registration + 42 banquet + 56 the banquet's adult. NOT Tigermania — no Wolf attends it,
  // and NOT the largest single rung ($98), which is the bug this replaced.
  eq(wolf2.covered, 18300, 'the union of every rung, counting the twice-named banquet once');
  eq(wolf2.expected - wolf2.covered, 6500, 'what a Wolf family still pays with every tier earned');
  const lion2 = vm.runInContext("familyYearCostForDen('Lion')", ctx);
  eq(lion2.covered - wolf2.covered, 2000, 'a Lion, who does attend Tigermania, is covered for it');

  // RUNG BY RUNG, for this den. Wolf year = 24800; rung a covers registration (8500) → 16300 left;
  // rung b adds the banquet (4200) and Tigermania, which a Wolf does not attend → 12100; rung c
  // names the banquet AGAIN (nothing new) and its adult share (5600) → 6500.
  eq(wolf2.steps.map((s) => s.afterCents), [16300, 12100, 6500], 'what a Wolf year drops to at each rung');
  eq(wolf2.steps.map((s) => s.coveredCents), [8500, 12700, 18300], 'cover accumulates down the rungs');
  eq(wolf2.steps.map((s) => s.name), ['a', 'b', 'c'], 'the rungs are listed lowest threshold first');
  eq(wolf2.steps[0].salesCents, 45000, 'the sell figure is the threshold converted, not the threshold');
  // The Lion attends Tigermania, so the SAME rung is worth 2000 more to them.
  eq(lion2.steps.map((s) => s.afterCents), [18300, 12100, 6500], 'a Lion’s rungs price their own year');
  // A rung with no name is not listed — the ladder card hides it too — but its covers still
  // ACCUMULATE, or every rung above it would be quoted a year that is too high.
  ctx.state.rewardTiers.tiers.splice(1, 0, { id: 'x', thresholdCents: 20000, covers: ['Spring camp'] });
  const named = vm.runInContext("familyYearCostForDen('Wolf')", ctx);
  eq(named.steps.map((s) => s.name), ['a', 'b', 'c'], 'an unnamed rung was listed');
  eq(named.steps.map((s) => s.afterCents), [16300, 8600, 3000], 'an unnamed rung’s covers were dropped');
  // A covered SIBLING share must not come off a figure that never counted a sibling.
  ctx.state.rewardTiers.tiers = [{ id: 'a', thresholdCents: 15000, covers: ['Blue & Gold#sibling'] }];
  eq(vm.runInContext("familyYearCostForDen('Wolf')", ctx).covered, 0,
    'a sibling share was taken off the scout-and-adult figure');
});

test('the year-cost card says what it excludes, and points at the tiers', () => {
  const fn = /function renderFamilyYearCost\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'renderFamilyYearCost() not found');
  const flat = fn[0].replace(/'\s*\+\s*'/g, '');
  ok(/no reward tier at all/.test(flat), 'the card does not say the figure assumes no tier is earned');
  ok(/nothing the pack pays for out of its own funds/.test(flat),
    'the card does not say pack-funded lines are excluded');
  // The owner's correction: one adult per scout is expected, and the card has to say both that
  // it counts one per scout AND that a two-scout family only has to send one parent — otherwise
  // the figure looks like it is double-charging them.
  // M11 (Treasurer's audit, 2026-09-27) — "typical", not "the most a family can be asked for":
  // a second parent, siblings and flat family lines are all on top of it.
  ok(/typical cost for one scout and one parent/.test(flat),
    'the headline does not say it includes the accompanying adult');
  ok(!/the most a family can be asked/.test(flat), 'the card still calls a typical figure a maximum');
  ok(/Not included:/.test(flat), 'the card does not list what it leaves out');
  ok(/counted <strong>per scout<\/strong>/.test(flat), 'the per-scout adult rule is not stated');
  ok(/two scouts only has to send one parent/.test(flat),
    'the card does not admit that a two-scout family needs only one parent');
  ok(/Siblings are extra/.test(flat), 'the card does not say siblings are optional');
  // The three tier states, because "you have tiers but none is planned on" is the one that
  // silently makes the funding worksheet wrong — it must not read the same as having none.
  ok(/No reward tiers set yet/.test(fn[0]), 'the no-tiers case is not handled');
  ok(/none is named as the one the plan counts on/.test(fn[0].replace(/' \+\s*'/g, '')),
    'a pack with tiers but no planned tier is not warned');
  ok(/The plan counts on <strong>/.test(fn[0]), 'the planned-tier case is not named');
  // The row is the app's existing expandable pattern, which already has Enter/Space for free.
  ok(/class="list-row' \+ \(open \? ' open' : ''\) \+ '" data-act="year-cost-toggle"/.test(fn[0]),
    'the row is not a .list-row, so keyboard activation will not reach it');
  ok(/\(e\.key === 'Enter' \|\| e\.key === ' '\) && e\.target\.matches\('\.list-row\[data-act\]/.test(SCRIPT),
    'the generic keyboard handler for .list-row is gone');
  // data-name is in SIG_ATTRS, so focus survives the re-render the toggle causes.
  ok(/var SIG_ATTRS = \[[^\]]*'name'/.test(SCRIPT), 'data-name is not a focus signature attribute');
});

test('a reward tier can carry the small print the covers list cannot hold', () => {
  // Owner ask: a stretch tier that reimburses uniform items next year against an itemised
  // receipt, listing the eligible items. `covers` is charges the app can waive and could never
  // express that — so a tier gets prose too, rendered through the same escaped renderer the
  // campout pages use.
  const ctx = sandbox(NORMALIZE_FNS);
  const norm = (tier) => {
    const d = preMigrationState();
    d.rewardTiers = { duesCents: 0, planOnTierId: '', tiers: [Object.assign({ id: 't1', thresholdCents: 73000 }, tier)] };
    return ctx.normalizeState(d).rewardTiers.tiers[0];
  };
  eq(norm({}).note, '', 'a tier with no note must normalize to empty, not undefined');
  eq(norm({ note: '- Neckerchief\n- Handbook' }).note, '- Neckerchief\n- Handbook', 'the note was not kept verbatim');
  eq(norm({ note: 42 }).note, '', 'a non-string note was trusted');
  // Rendered, never trusted: the same escape-first renderer as the campout sections.
  const blk = /function tierNoteBlock\(t\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(blk, 'tierNoteBlock() not found');
  ok(/proseText\(note\)/.test(blk[0]), 'the note is not run through the escaping prose renderer');
  ok(!/innerHTML|' \+ note \+ '/.test(blk[0]), 'the note is interpolated raw somewhere');
  ok(/esc\(note\)/.test(blk[0]), 'the textarea does not escape its own value');
  // A read-only leader sees a note that exists, and no empty furniture when there is none.
  ok(/if \(!canEdit\(\)\) \{\s*\n\s*if \(!note\.trim\(\)\) return '';/.test(blk[0]),
    'a read-only screen shows an empty labelled box');
  // Stored verbatim — trimming would eat the newline before the next bullet.
  const chBlock = /if \(ch === 'tier-name' \|\| ch === 'tier-threshold'[\s\S]*?commit\(\); return;\n    \}/.exec(SCRIPT);
  ok(chBlock && /else if \(ch === 'tier-note'\) tier\.note = el\.value;/.test(chBlock[0]),
    'the note is not saved, or is trimmed on the way in');
  ok(/h \+= tierNoteBlock\(t\);/.test(SCRIPT), 'the block is never rendered');
});

test('a stored make-up mark migrates onto the payment that bought it', () => {
  // The mark used to be `tier.madeUp`, written once and never revisited — the one part of a
  // scout's standing that did not follow a correction. Migration moves it onto the entry that
  // paid for it, and the credit is read off the entry from then on.
  const ctx = sandbox(NORMALIZE_FNS);
  const run = (tiers, ledger) => {
    const d = preMigrationState();
    d.rewardTiers = { duesCents: 0, planOnTierId: '', tiers: tiers };
    d.ledger = ledger;
    const after = ctx.normalizeState(d);
    return { tiers: after.rewardTiers.tiers, ledger: after.ledger };
  };
  const entry = (id, scoutId, desc) => ({
    id: id, date: '2025-11-02', description: desc, amountCents: 2000, direction: 'in',
    lineId: '', method: '', ref: '', source: 'family', donor: '', scoutId: scoutId, reconciled: false
  });
  // The ordinary case: one mark, one entry this app wrote, stamped.
  const one = run(
    [{ id: 't1', name: 'Bronze', thresholdCents: 30000, madeUp: ['s1'] }],
    [entry('L1', 's1', 'Made up the difference to Bronze — Ada')]);
  eq(one.ledger[0].tierMakeup, 't1', 'the payment was not stamped with the tier it bought');
  ok(!('madeUp' in one.tiers[0]), 'the stored mark survived the migration');
  // Two rungs, two payments: each entry goes to the tier it NAMES, not to whichever asked first.
  const two = run(
    [{ id: 't1', name: 'Bronze', thresholdCents: 30000, madeUp: ['s1'] },
     { id: 't2', name: 'Silver', thresholdCents: 60000, madeUp: ['s1'] }],
    [entry('L2', 's1', 'Made up the difference to Silver — Ada'),
     entry('L1', 's1', 'Made up the difference to Bronze — Ada')]);
  eq(two.ledger.find((e) => e.id === 'L1').tierMakeup, 't1', 'Bronze claimed the wrong entry');
  eq(two.ledger.find((e) => e.id === 'L2').tierMakeup, 't2', 'Silver claimed the wrong entry');
  // A mark whose payment has been deleted — the reported bug — is dropped rather than carried,
  // and no unrelated family payment is stamped to cover for it.
  const orphan = run(
    [{ id: 't1', name: 'Bronze', thresholdCents: 30000, madeUp: ['s1'] }],
    [entry('L1', 's1', 'Dues')]);
  eq(orphan.ledger[0].tierMakeup, '', 'an unrelated family payment was stamped as a make-up');
  ok(!('madeUp' in orphan.tiers[0]), 'a mark with no payment behind it was kept');
  // Idempotent: normalizing again must not re-stamp or double up.
  const again = ctx.normalizeState(JSON.parse(JSON.stringify(
    (() => { const d = preMigrationState();
      d.rewardTiers = { duesCents: 0, planOnTierId: '', tiers: [{ id: 't1', name: 'Bronze', thresholdCents: 30000, madeUp: ['s1'] }] };
      d.ledger = [entry('L1', 's1', 'Made up the difference to Bronze — Ada')];
      return ctx.normalizeState(d); })())));
  eq(again.ledger.filter((e) => e.tierMakeup === 't1').length, 1, 'a second normalize re-stamped the book');
});

test('the ledger entry carries the tier it bought, and survives a round trip', () => {
  const ctx = sandbox(NORMALIZE_FNS);
  const d = preMigrationState();
  d.ledger = [{ id: 'k', date: '2025-11-02', description: 'Made up the difference to Bronze — Ada',
    amountCents: 2000, direction: 'in', lineId: '', method: '', ref: '', source: 'family',
    donor: '', scoutId: 's1', tierMakeup: 't1', reconciled: false }];
  const after = ctx.normalizeState(d);
  const e = after.ledger.find((x) => x.id === 'k');
  eq(e.tierMakeup, 't1', 'the stamp was dropped on the way through normalization');
  // Every other entry gets the field as '', so the shape is uniform and a stale value cannot
  // linger as undefined and read as truthy somewhere.
  ok(after.ledger.every((x) => typeof x.tierMakeup === 'string'), 'tierMakeup is not normalized to a string');
  const junk = ctx.normalizeState(Object.assign(preMigrationState(), {
    ledger: [{ id: 'j', description: '', direction: 'in', tierMakeup: 42 }]
  }));
  eq(junk.ledger[0].tierMakeup, '', 'a non-string stamp was trusted');
});

test('the prose renderer is not named after the first thing that used it', () => {
  // It renders campout sections AND reward-tier notes now. A general helper called campText is
  // the kind of thing the next person copy-pastes instead of reusing.
  ok(/function proseText\(s\) \{/.test(SCRIPT), 'proseText() not found');
  // Call sites and declarations only — the comment above proseText names the old function on
  // purpose, because "why is this not called campText" is a question worth having answered.
  ok(!/campText\s*\(/.test(SCRIPT), 'something still calls campText');
  ok(!/function campText/.test(SCRIPT), 'campText is still declared');
});

test('a line priced per person plans the parent, and knows who is paying for them', () => {
  // Owner ask: "the Christmas party is budgeted at $7 per scout but it really needs to be per
  // person — scout + 1 parent + leaders." $7 x 13 scouts + 13 parents + 4 leaders = $210.
  const { linePlannedCents, freshLine } = sandbox(PRICE_FNS);
  const party = freshLine({
    basis: 'per-head', scoutRateCents: 700, adultRateCents: 700,
    includeAdults: true, includeLeaders: true, leaderRateCents: 700
  });
  eq(linePlannedCents(party, 13, 4), 21000, '13 scouts + 13 parents + 4 leaders at $7');
  // Ticking the box prefills the parent rate from the scout rate — one tick and a party is right.
  const ch = /} else if \(bk === 'include-adults'\) \{[\s\S]*?\n      \}/.exec(SCRIPT);
  ok(ch, 'the include-adults handler is missing');
  ok(/if \(bl\.includeAdults && !bl\.adultRateCents\) bl\.adultRateCents = bl\.scoutRateCents \|\| 0;/.test(ch[0]),
    'ticking per-person does not prefill the parent rate, so the line silently plans $0 parents');
  // Absent on an older record → false. It must NOT be inferred from the old assumption field,
  // or every line that once had it quietly puts parents back in the plan.
  const nctx = sandbox(NORMALIZE_FNS);
  const d = preMigrationState();
  const after = nctx.normalizeState(d);
  after.budget.activities.concat(after.budget.expenses).forEach((l) => {
    eq(l.includeAdults, false, `${l.name}: a carried-over line must not plan for parents`);
  });
  const norm = /l\.includeAdults = l\.includeAdults === true;/.exec(SCRIPT);
  ok(norm, 'includeAdults is not normalized to a boolean');
  const migrate = /if \(typeof l\.includeLeaders !== 'boolean'\) \{[\s\S]*?\n      \}/.exec(SCRIPT);
  ok(migrate && !/includeAdults/.test(migrate[0]),
    'includeAdults is inferred from the old adultsFrom field, reviving the bug the July ruling removed');
  // Who pays decides where it lands: pack-pays is spending, families-pay is expected income.
  const rep = /function adultPlannedCents\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(rep, 'adultPlannedCents() not found');
  ok(/if \(lineFamilyFunded\(l\)\) return;/.test(rep[0]),
    'a families-pay parent is reported as pack spending, which double-counts it against the fees row');
  ok(/!l\.includeAdults \|\| linePerFamily\(l\)/.test(rep[0]),
    'it counts lines that plan no parent, or a per-family fee that has no parent head');
  // A rollover must carry the flag or next year's party silently loses half its heads.
  ok((SCRIPT.match(/includeAdults: x\.includeAdults, adultRateCents: x\.adultRateCents,/g) || []).length === 2,
    'the close-out projections drop the per-person flag');
});

/* ========================================================================
   Storefront rows carry their own shift list — 2026-08-02
   ===================================================================== */

// getScout is stubbed: these functions only ever ask it for a name, and a sandbox has no state.
function shiftListCtx(roster) {
  const ctx = sandbox(['esc', 'fmtClock', 'fmtTimeRange', 'blocksInDayOrder', 'blockScoutNames',
    'storefrontShiftLines']);
  vm.runInContext(
    'var ROSTER = ' + JSON.stringify(roster || {}) + ';' +
    'function getScout(id) { return ROSTER[id] ? { id: id, name: ROSTER[id] } : null; }', ctx);
  return ctx;
}
const shiftBlk = (label, start, end, ids) => ({
  id: 'b-' + label, label: label, start: start, end: end,
  assignments: (ids || []).map((id) => ({ scoutId: id, weight: 1 }))
});

test('a storefront shows its shifts in the order the day happens, not the order they were added', () => {
  const ctx = shiftListCtx({});
  const sf = { blocks: [shiftBlk('Block 1', '12:00', '14:00'), shiftBlk('Block 2', '08:00', '10:00'),
    shiftBlk('Block 3', '', ''), shiftBlk('Block 4', '10:00', '12:00')] };
  eq(ctx.blocksInDayOrder(sf).map((b) => b.label),
    ['Block 2', 'Block 4', 'Block 1', 'Block 3'],
    'shift order');
  // The stored array must be untouched: blockShares() hands the rounding remainder to the LAST
  // element it finds, so sorting in place would move real cents onto a different scout.
  eq(sf.blocks.map((b) => b.label), ['Block 1', 'Block 2', 'Block 3', 'Block 4'],
    'blocksInDayOrder mutated the stored blocks');
});

test('the scouts on a shift read alphabetically, whatever order they signed up in', () => {
  const ctx = shiftListCtx({ s1: 'Piper Hartley', s2: 'Ada Reyes', s3: 'Beckett Hartley' });
  // The sign-up order here matches NEITHER the alphabetical order nor the id order. With
  // ['s1','s2','s3'] a sort-in-place by id is a no-op, so the guard below passed on code that
  // reordered the stored array — the mutation probe is the only reason that showed up.
  const b = shiftBlk('Block 1', '10:00', '12:00', ['s1', 's3', 's2']);
  eq(ctx.blockScoutNames(b), ['Ada Reyes', 'Beckett Hartley', 'Piper Hartley'], 'names');
  // Display only — the stored assignments keep their own order for the same reason as above.
  eq(b.assignments.map((a) => a.scoutId), ['s1', 's3', 's2'],
    'blockScoutNames mutated the stored assignments');
  eq(ctx.blockScoutNames({ assignments: [{ scoutId: 'gone' }] }), ['Unknown scout'],
    'a scout who was deleted still leaves their slot visible');
});

test('every shift gets a line, and an unstaffed one says so', () => {
  const ctx = shiftListCtx({ s1: 'Ada Reyes' });
  const html = ctx.storefrontShiftLines({ blocks: [
    shiftBlk('Block 1', '10:00', '12:00', ['s1']), shiftBlk('Block 2', '12:00', '14:00', [])] });
  // The trailing [ "] matters — the <ul class="sf-shifts"> wrapper is a prefix match otherwise.
  eq((html.match(/class="sf-shift[ "]/g) || []).length, 2, 'one line per shift');
  ok(/10:00 AM–12:00 PM<\/span><span class="sf-who">Ada Reyes/.test(html),
    'a staffed shift shows the time and who is on it');
  ok(/class="sf-shift sf-open"/.test(html), 'an unstaffed shift is marked as open');
  eq((html.match(/>Open</g) || []).length, 1, 'exactly the empty shift reads "Open"');
  // A storefront with no shifts yet must add nothing at all — the summary line already says so.
  eq(ctx.storefrontShiftLines({ blocks: [] }), '', 'no shifts, no list');
});

test('a shift with no time set still shows up, under its block name', () => {
  const ctx = shiftListCtx({});
  const html = ctx.storefrontShiftLines({ blocks: [shiftBlk('Saturday morning', '', '', [])] });
  ok(/Saturday morning/.test(html), 'an untimed shift falls back to its block name');
});

test('the storefront row names itself, instead of reading out its whole shift list', () => {
  // role="button" flattens a row's contents into its accessible NAME, so without an explicit
  // label the shift list becomes forty words of button name.
  const row = /function storefrontRow\(sf\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(row, 'storefrontRow() not found');
  ok(/role="button" tabindex="0" aria-label="/.test(row[0]),
    'the row is a button with no aria-label of its own');
  ok(/shift' \+ \(cov\.total === 1 \? '' : 's'\) \+ ' covered'/.test(row[0]),
    'the spoken label drops the coverage summary, which is the whole point of the row');
});

test('the printable day sheets list shifts in day order too', () => {
  // Both sheets used to walk sf.blocks raw, so a shift added later printed out of sequence —
  // on the sheet that gets carried to the store.
  for (const fn of ['daySheetText', 'renderDaySheet']) {
    const src = new RegExp(`function ${fn}\\(\\w*\\) \\{[\\s\\S]*?\\n  \\}`).exec(SCRIPT);
    ok(src, `${fn}() not found`);
    ok(/blocksInDayOrder\(sf\)/.test(src[0]), `${fn} walks the stored block order`);
    // …and by their PUBLIC names: the sheet is taped to a table outside a store (2026-09-27).
    ok(/blockScoutNames\(b, pub\)/.test(src[0]), `${fn} lists the scouts in stored order, or by full name`);
    ok(/var pub = publicNameMap\(state\.scouts\);/.test(src[0]), `${fn} does not use the shared public-name map`);
  }
});

test('the shift list survives a phone, and its times never wrap', () => {
  // A 17-character time range plus two names does not fit 375px, and the half-wrapped
  // two-column form reads as a bug rather than a layout.
  ok(/\.sf-when \{[^}]*white-space: nowrap/.test(SCRIPT_CSS),
    'the time column can wrap, which breaks the straight edge that makes the list scannable');
  ok(/@media \(max-width: 520px\) \{\s*\.sf-shift \{ display: block/.test(SCRIPT_CSS),
    'the shift row keeps its two columns on a narrow screen');
  // Content-sized, every storefront's shift table came out a different width — and the narrow
  // ones fell under the two columns' combined basis and wrapped every single line.
  ok(/\.sf-main \{ flex: 1 1 auto; min-width: 0; \}/.test(SCRIPT_CSS),
    'the shift list is content-sized again, so its width varies per storefront');
});

/* ========================================================================
   The parent standings board says what its two numbers mean — 2026-08-02
   ===================================================================== */

// The claim the footnote makes, tested on the two functions that decide it. Neither figure was
// ever wrong; they answer different questions, and only kept cash can make them disagree.
function goalBaseCtx(viaTE) {
  const ctx = sandbox(['cashDonOf', 'goalBaseOf']);
  vm.runInContext('var state = { cashThroughTrailsEnd: ' + (viaTE ? 'true' : 'false') + ' };', ctx);
  return ctx;
}
// storeD/wagonD are cash handed over in person; onD is an online donation, which always counts.
const donorRow = { t: { sales: 32000, onD: 1000, storeD: 6000, wagonD: 3000 } };

test('cash the pack keeps is the only thing that can split Raised from Of goal', () => {
  const kept = goalBaseCtx(false);
  const combined = donorRow.t.sales + donorRow.t.onD + donorRow.t.storeD + donorRow.t.wagonD;
  eq(kept.goalBaseOf(donorRow), 33000, 'kept cash must stay out of the goal base');
  ok(kept.goalBaseOf(donorRow) < combined,
    'with cash kept, the goal base should fall short of what the scout brought in');
  // Run it through Trail's End and the gap closes — which is why the footnote is conditional.
  const viaTE = goalBaseCtx(true);
  eq(viaTE.goalBaseOf(donorRow), combined, 'through Trail’s End the two figures must agree');
  // A scout with no cash donations never diverges either way.
  const dry = { t: { sales: 32000, onD: 1000, storeD: 0, wagonD: 0 } };
  eq(kept.goalBaseOf(dry), 33000, 'a scout with no cash donations diverges');
});

test('parents see ONE goal, not the pack’s internal cash split', () => {
  // Owner ask, 2026-08-02. Whether a dollar of cash runs through Trail's End or the pack keeps it
  // decides which of the two old bars it landed in, without any family having done anything
  // differently — so a family watched money move between bars for reasons that were not about them.
  const src = codeOnly(BPV());
  ok(/var raised = withAmounts \? pack\.combined : Math\.round\(pack\.combined \/ 5000\) \* 5000;/.test(src) &&
     /goalCents: goalCents,\s*raisedCents: raised,/.test(src),
    'the goal is not published as one combined figure');
  ok(!/teGoalCents|cashGoalCents|tePct|cashPct/.test(src),
    'the two-bar split is still published');
  // The identity that makes the single figure safe: teEligible carries cash only when the toggle
  // is ON and cashKept only when it is OFF, so sales + every donation is the whole of it with
  // nothing counted twice. pack.combined IS that sum — asserted here so a future edit cannot
  // quietly swap it for teEligible + cashKept and lose the guarantee.
  ok(/combined: sales \+ don,/.test(SCRIPT), 'pack.combined is no longer sales plus every donation');
  // The flag that explained the old two-number row goes with the column it explained.
  ok(!/cashOutsideGoal/.test(codeOnly(SCRIPT)),
    'the cash-outside-goal flag survives the column it existed to explain');
});

test('every scout on the board gets a progress bar, and it is a list so the bar has room', () => {
  const fn = /function renderParentStandings\(pv\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'renderParentStandings() not found');
  // The table this replaced was right when a row was four short figures. A bar needs width, and a
  // 10px track in a fifth column is either unreadably narrow or — on a phone, inside .tbl-wrap —
  // only reachable by swiping the table sideways to find your own scout.
  ok(/rows\.forEach\(function \(r, i\) \{ h \+= parentStandingRow\(r, i, ladder, ranked\); \}\);/.test(fn[0]),
    'the board does not render one list row per scout');
  ok(!/tbl-wrap|<th scope="col"/.test(codeOnly(fn[0])),
    'the board is a table again, which puts the bar behind a sideways scroll on a phone');
  // The percentage that needed a footnote is GONE, not hidden: it was measured on goal-eligible
  // money while the money beside it was everything, so the two could not be reconciled at all.
  ok(!/goalPct/.test(fn[0]), 'the of-goal percentage is still on the row');
});

test('the family bar runs to the planned tier, the same one the leaders’ card does', () => {
  const src = codeOnly(BPV());
  // Owner ask, 2026-08-31: both boards on one denominator. Published straight off the row rather
  // than recomputed here — a second ratio in this file is a second thing to keep in step.
  ok(/nextPct: \(p && typeof p\.anchorPct === 'number'\) \? p\.anchorPct : null/.test(src),
    'the bar is measured against something other than the planned tier');
  ok(!/Math\.round\(p\.base \/ p\.need \* 100\)/.test(src),
    'the old next-rung ratio is still being published alongside it');
  // Clamping and the top-of-ladder case moved with it, onto tierProgressRows.anchorPct.
  const rows = /function tierProgressRows\(\w*\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  ok(/Math\.max\(0, Math\.min\(100, Math\.round\(base \/ anchor\.thresholdCents \* 100\)\)\)/.test(rows),
    'the percentage is not clamped to 0-100');
  ok(/anchor && anchor\.thresholdCents > 0/.test(rows),
    'a pack with nothing to measure publishes a figure instead of null');
  // The field NAME is unchanged on purpose: a payload published before this change still renders,
  // just measured the old way, rather than losing every bar until a leader next saves.
  ok(/nextPct:/.test(src), 'the field was renamed, so older payloads lose their bars');
  // The ratio is still taken in commission: salesForCommission divides both halves by the same
  // goal rate, so it is the same ratio in sales terms. Converting per scout would break it,
  // because a scout's own rate depends on their channel mix (online pays differently).
  ok(!/salesForCommission\(p\.base\)|salesForCommission\(p\.need\)/.test(src),
    'the bar converts each side to sales per scout, so it disagrees with the shortfall beside it');
});

test('the family board is told what a full bar means, and can survive not being told', () => {
  const src = codeOnly(BPV());
  ok(/out\.tierLadder = ladderProg;/.test(src), 'the ladder legend is never published');
  ok(/anchorName: String\(progLad\.plan\.name/.test(src), 'the anchor is published without its name');
  // ⚠ Read off the shared ladder, NOT off row zero's own anchor. Rows are ordered by what a scout
  // brought in, so row zero is usually a stretch-cohort row — a legend built from it would name
  // the top rung and describe the exception rather than the rule.
  ok(!/progRows\[0\]\.anchor|progAny\.anchor/.test(src),
    'the legend is built from the top seller’s own scale');
  ok(/progLad\.stretchOn/.test(src), 'the stretch scale is never published');
  ok(/pastPlan: !!\(p && p\.pastPlan\)/.test(src), 'the row does not say which scale it is on');
  ok(/planned: !!plannedTier\(\)/.test(src),
    'the payload cannot tell a planned anchor from the top-of-ladder fallback');
  // Every renderer path has to cope with the field being absent — a pack that has not republished
  // since this shipped serves a payload with no ladder on it at all.
  const list = /function renderParentStandings\(pv\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  ok(/pv\.tierLadder && typeof pv\.tierLadder === 'object' && !Array\.isArray\(pv\.tierLadder\)/.test(list),
    'the legend trusts the payload to have the shape it expects');
  // parentBar is handed the cohort's own marks rather than the whole ladder — which scale a row
  // is on is parentTierProgress's decision, and the bar should not have to know about cohorts.
  const bar = /function parentBar\(pct, label, marks, planPct\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(bar, 'parentBar() no longer takes the marks and plan boundary');
  ok(/Array\.isArray\(marks\) \? marks : \[\]/.test(bar[0]),
    'the notches are drawn without checking the payload carries any');
  // A payload whose planPct sat above the scout's own percentage would ask for a negative width.
  ok(/planPct >= 0 && planPct <= p/.test(bar[0]), 'the stretch segment can be drawn backwards');
  // And the cohort choice itself degrades: a row flagged pastPlan on a payload with no stretch
  // block published still draws the single-scale bar rather than throwing.
  const prog = /function parentTierProgress\(r, ladder\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(/var past = !!\(r && r\.pastPlan && stretch\);/.test(prog[0]),
    'a pastPlan row trusts a stretch block that may not have been published');
  // Notches are decoration: each is named once in the legend, so repeating them inside every
  // bar's label would read the whole ladder out once per scout.
  ok(/role="img" aria-label="/.test(bar[0]), 'the bar lost the only thing that reaches a screen reader');
});

test('the progress bar carries its figure in words, and is absent when there is nothing to measure', () => {
  const ctx = sandbox(['esc', 'fmt', 'parentBar', 'parentTierProgress']);
  const mid = ctx.parentTierProgress({ tier: 'Pack tee', nextTier: 'Camp week', nextPct: 43,
    nextReward: 'A week of summer camp, paid', nextSalesCents: 50167, nextUnlocksCents: 3500 });
  ok(/<div class="bar-fill" style="width:43%">/.test(mid), 'the fill does not follow the percentage');
  ok(/43% of the way to <strong>Camp week<\/strong>/.test(mid), 'the caption repeats the figure in words');
  ok(/A week of summer camp, paid/.test(mid), 'the prize in words is dropped — the tier name is only a label');
  ok(/\$501\.67<\/strong> more to sell/.test(mid), 'what is still to sell');
  ok(/\$35\.00<\/span> off your costs/.test(mid), 'what reaching it is worth to this family');
  // A bar carries no text of its own: role="img" plus a label is the only way it reaches a screen
  // reader, and the caption beneath serves everyone else.
  ok(/role="img" aria-label="43 percent of the way to Camp week"/.test(mid),
    'the bar has no accessible label, so it is invisible to a screen reader');
  // Top of the ladder: full bar, plain statement.
  const done = ctx.parentTierProgress({ tier: 'Camp week', nextTier: '', nextPct: 100 });
  ok(/width:100%/.test(done) && /Every tier earned/.test(done), 'a finished ladder');
  // ⚠ ABSENT, not zero-width. An empty track beside a scout who has done everything asked of them
  // would be a lie told by geometry — this is the case where the pack has no tiers, or no rate.
  eq(ctx.parentTierProgress({ tier: '', nextTier: '', nextPct: null }), '',
    'a pack with nothing to measure still draws an empty bar');
  eq(ctx.parentTierProgress({}), '', 'a scout with no progress data still draws a bar');
  // No rate typed: the rung and the bar still show, the invented shortfall does not.
  const noRate = ctx.parentTierProgress({ tier: '', nextTier: 'Dues covered', nextPct: 12,
    nextReward: '', nextSalesCents: null, nextUnlocksCents: 0 });
  ok(/Dues covered/.test(noRate) && !/more to sell/.test(noRate), 'an unmeasurable shortfall invents a figure');
  ok(!/\$0\.00/.test(noRate), 'a prize-only rung claims it is worth nothing off your costs');
});

test('a family sees the stretch scale as two fills, and is told which rung it ends at', () => {
  const ctx = sandbox(['esc', 'fmt', 'parentBar', 'parentTierProgress']);
  // The ladder as published: plan scale for most rows, stretch scale for anyone past Gold.
  const LADDER = {
    anchorName: 'Gold',
    planned: true,
    marks: [{ name: 'Bronze', pct: 25, plan: false }, { name: 'Silver', pct: 50, plan: false }],
    stretch: {
      topName: 'Platinum', planPct: 60,
      marks: [{ name: 'Bronze', pct: 15, plan: false }, { name: 'Silver', pct: 30, plan: false },
              { name: 'Gold', pct: 60, plan: true }]
    }
  };
  const past = ctx.parentTierProgress({ nextTier: 'Platinum', nextPct: 80, pastPlan: true,
    nextReward: 'A week of summer camp, paid', nextSalesCents: 50167, nextUnlocksCents: 3500 }, LADDER);
  // Two fills: the plan complete, then what they have done beyond it.
  ok(/<div class="bar-fill bar-fill-part" style="width:60%">/.test(past),
    'the plan half of the bar is missing, or still drawn as a pill that stops mid-track');
  ok(/<div class="bar-fill-stretch" style="left:60%;width:20%">/.test(past),
    'the stretch segment does not run from the plan boundary to where the scout actually is');
  // The plan notch is the boundary, and is flagged so it can be drawn heavier than a rung.
  ok(/class="tprog-tick is-plan" style="left:60%"/.test(past), 'the plan boundary is an ordinary notch');
  // Caption and spoken label say the same thing, so a screen reader is not given a percentage
  // measured against a rung the sighted caption never names.
  ok(/<strong>Gold<\/strong> met · 80% of the way to <strong>Platinum<\/strong>/.test(past),
    'the caption does not say which rung the percentage is measured against');
  ok(/aria-label="Gold met, 80 percent of the way to Platinum"/.test(past),
    'the spoken label still claims the old scale');

  // A row on the plan scale is untouched by any of it — the majority case, and the regression
  // that would matter most.
  const below = ctx.parentTierProgress({ nextTier: 'Silver', nextPct: 47, nextSalesCents: 3334 }, LADDER);
  ok(/<div class="bar-fill" style="width:47%">/.test(below), 'a plan-scale bar gained a second fill');
  ok(!/bar-fill-stretch|is-plan/.test(below), 'a plan-scale bar was drawn with the stretch furniture');
  ok(/47% of the way to <strong>Gold<\/strong>/.test(below) && !/met ·/.test(below),
    'a scout below the plan is told they have met it');
  ok(/left:25%/.test(below) && /left:50%/.test(below), 'the plan-scale notches are not the plan-scale rungs');

  // A payload published before any of this: pastPlan absent, no stretch block. Must render
  // exactly the single-scale bar it always did rather than throwing.
  const oldPayload = ctx.parentTierProgress({ nextTier: 'Silver', nextPct: 43, nextSalesCents: 25000 },
    { anchorName: 'Gold', planned: true, marks: [{ name: 'Bronze', pct: 25 }] });
  ok(/<div class="bar-fill" style="width:43%">/.test(oldPayload), 'an old payload lost its bar');
  ok(!/bar-fill-stretch/.test(oldPayload), 'an old payload grew a segment it never published');
  // And a row flagged pastPlan whose payload carries NO stretch block — a half-upgraded document —
  // falls back rather than reading through undefined.
  const halfway = ctx.parentTierProgress({ nextTier: 'Platinum', nextPct: 80, pastPlan: true },
    { anchorName: 'Gold', planned: true, marks: [] });
  ok(/<div class="bar-fill" style="width:80%">/.test(halfway), 'a half-upgraded payload breaks the bar');
  ok(!/bar-fill-stretch/.test(halfway), 'a stretch segment was drawn with no scale published for it');
});

test('a family is told how close their scout is to the rung they are chasing', () => {
  const ctx = sandbox(['esc', 'fmt', 'parentBar', 'parentTierProgress']);
  const LADDER = {
    anchorName: 'Gold', planned: true,
    marks: [{ name: 'Bronze', pct: 17, plan: false }, { name: 'Silver', pct: 50, plan: false }]
  };
  // Ada: 44% of the way to Gold (the bar's anchor) but 88% of the way to Silver, the rung in
  // front of her. The caption used to lead with Gold and make Silver a muted afterthought.
  const split = ctx.parentTierProgress({
    nextTier: 'Silver', nextPct: 44, nextRungPct: 88, nextMarkPct: 50,
    nextReward: 'Dues covered', nextSalesCents: 6134
  }, LADDER);
  ok(/88% of the way to <strong>Silver<\/strong>/.test(split), 'the caption does not lead with the near rung');
  ok(/44% of Gold/.test(split), 'the ladder reading is gone, or no longer names its rung');
  ok(split.indexOf('88% of the way to') < split.indexOf('44% of Gold'),
    'the ladder figure is printed ahead of the actionable one');
  // ⚠ THE BAR IS STILL THE LADDER — 44%, not 88%. Only the caption leads with the near rung.
  // Feeding the bar the near-rung figure would rescale every family's bar to whatever rung that
  // scout happens to be chasing, throwing away the comparability the planned-tier anchor bought.
  // (I got this wrong first time round; it is the reason this assertion is here.)
  ok(/<div class="bar-fill" style="width:44%">/.test(split),
    'the bar was rescaled to the near rung instead of staying on the ladder');
  ok(!/width:88%/.test(split), 'the near-rung figure reached the bar');
  // The label describes the BAR. Both figures are in the caption, which a screen reader reads as
  // an ordinary paragraph — putting them in the label too would say each one twice.
  ok(/aria-label="44 percent of the way to Gold"/.test(split),
    'the spoken label no longer describes the bar it is attached to');
  // Silver at 50% is ahead of a 44% fill, and it is the rung being chased — so both classes. The
  // gap between the fill and this notch is how close they are.
  ok(/class="tprog-tick ahead is-next" style="left:50%"/.test(split),
    'the rung being chased is not singled out on the family bar');
  ok(/class="tprog-tick" style="left:17%"/.test(split), 'a passed rung is inked as though still ahead');

  // A scout heading straight for the anchor: one figure, exactly as before.
  const straight = ctx.parentTierProgress({
    nextTier: 'Gold', nextPct: 44, nextRungPct: 44, nextMarkPct: null, nextSalesCents: 6134
  }, LADDER);
  ok(/44% of the way to <strong>Gold<\/strong>/.test(straight), 'the single-rung caption changed');
  ok(!/% of Gold<\/span>|· 44% of/.test(straight), 'the same figure is printed twice');
  ok(/aria-label="44 percent of the way to Gold"/.test(straight), 'the spoken label gained a second rung');
  // Notches ahead of a 44% fill are inked so a family can see what is coming.
  ok(/class="tprog-tick ahead" style="left:50%"/.test(straight),
    'a rung ahead of the fill is invisible on the family board');

  // An older payload has neither field. It must render exactly the bar it always did.
  const oldPayload = ctx.parentTierProgress({ nextTier: 'Silver', nextPct: 43, nextSalesCents: 25000 }, LADDER);
  ok(/43% of the way to <strong>Gold<\/strong>/.test(oldPayload),
    'an old payload lost its caption, or invented a near-rung figure it never published');
  ok(!/is-next/.test(oldPayload), 'a rung was singled out with no position published for it');
  ok(/class="tprog-tick ahead" style="left:50%"/.test(oldPayload),
    'ahead/behind needs no new payload field — it is judged against the fill');
});

test('the two fills are not told apart by colour alone', () => {
  // --good against the gold fill measures 1.09:1 in light, 1.01:1 in dark, 1.09:1 in print — the
  // two are the same LIGHTNESS and differ only in hue, so on greyscale, on paper, or to a
  // red-green colour-blind reader they are one solid bar. Same trap .brow::after documents. No
  // token in the palette clears 3:1 against gold in every theme, so the texture has to carry it.
  ok(/\.bar-fill-stretch \{[^}]*background-image: repeating-linear-gradient/.test(SCRIPT_CSS),
    'the stretch fill is distinguished by hue alone');
  ok(/\.bar-fill-stretch \{[^}]*background: var\(--good\)/.test(SCRIPT_CSS),
    'the stretch fill lost the token that clears 3:1 against the track in all three themes');
  // --navy would be invisible in dark: it is a background token there, 1.08:1 on the dark track.
  ok(!/\.bar-fill-stretch \{[^}]*var\(--navy\)/.test(SCRIPT_CSS),
    'the stretch fill uses a background token that vanishes in dark mode');
  // The boundary is a position, not a colour, so it works for the same readers.
  ok(/\.tprog-tick\.is-plan \{[^}]*width: 3px/.test(SCRIPT_CSS), 'the plan boundary is not drawn heavier');
  // Neither legend names a colour — "the green part" fails exactly the readers it is written for.
  for (const fn of ['renderTierProgress', 'renderParentStandings']) {
    const src = new RegExp(`function ${fn}\\(\\w*\\) \\{[\\s\\S]*?\\n  \\}`).exec(SCRIPT);
    ok(src, `${fn}() not found`);
    ok(/hatched|striped part/.test(codeOnly(src[0])), `${fn} does not tell a reader what the second fill looks like`);
    ok(!/\bgreen\b/i.test(codeOnly(src[0])), `${fn} names a colour a reader may not be able to see`);
  }
});

test('the published standings carry the tier progress, from the shared tier map', () => {
  const src = codeOnly(BPV());
  // One call, two readers: the per-scout map below and the pack-wide ladder legend. tierProgressRows
  // walks every storefront and every entry, so calling it twice per publish is not free.
  ok(/var progRows = tierProgressRows\(true\);/.test(src) &&
     /progRows\.forEach\(function \(p\) \{ progById\[p\.scout\.id\] = p; \}\)/.test(src),
    'per-scout tier progress is not taken from tierProgressRows');
  ok((src.match(/tierProgressRows\(/g) || []).length === 1,
    'the publish walks every scout’s totals more than once');
  // Sales, never the commission shortfall — the same rule the ladder follows.
  ok(/nextSalesCents: \(p && p\.next && typeof p\.shortSales === 'number'\) \? p\.shortSales : null/.test(src),
    'the shortfall is published as commission, or invented when there is no rate');
  ok(!/short: p\.short|shortCents/.test(src), 'the raw commission shortfall is published');
  // tierProgressRows walks ACTIVE scouts; the board also carries archived-but-credited ones, who
  // must simply show no tier rather than crashing or borrowing somebody else's.
  ok(/var p = progById\[r\.id\];/.test(src) && /\(p && p\.earned\)/.test(src),
    'a scout with no progress row is not handled');
});

test('a family can see what the year costs, and what a tier takes off it', () => {
  const src = codeOnly(BPV());
  ok(/var familyCost = familyYearCost\(\)\.map/.test(src), 'the year cost is not published');
  ok(/if \(familyCost\.length\) out\.familyCost = familyCost;/.test(src),
    'the year cost never reaches the document');
  // The PLAN, per den — not any family's balance. None of these may be consulted.
  ok(!/scoutOwesCents|state\.charges|state\.collected|chargesFor/.test(src),
    'a family’s actual balance is reachable from the published view');
  // ⚠ The ladder must NOT publish or print a money figure: it has no den, and a tier can cover a
  // den-limited event (Tigermania is $20 to a Tiger, nothing to a Wolf). The worth is per den, on
  // familyCost[].steps, next to the bill it reduces.
  ok(!/coversCents/.test(src), 'the den-less ladder publishes a money figure again');
  const lad2 = /function parentTierLadder\(pv\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(lad2 && !/coversCents|off your costs/.test(lad2[0]), 'the ladder prints a den-blind money figure');
  ok(/steps: \(r\.steps \|\| \[\]\)\.map/.test(src), 'the per-den ladder steps are not published');
  // What the whole ladder takes off the figure, published per den.
  ok(/coveredCents: r\.covered/.test(src), 'the year cost never says what the tiers cover');
  const fn = /function parentFamilyCost\(pv\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'parentFamilyCost() not found');
  // ⚠ THIS TEST USED TO PIN THE BUG. It required `Math.max(m, t.coversCents)` across the
  // published tiers, on the reasoning that a rung's own figure is "the whole amount that rung
  // waives" — it is not. Coverage STACKS (packCoverage credits every tier reached), so a rung's
  // own figure counts only what it ADDS, and the largest single one understated Pack 569's
  // ladder by $354 of $500. The union now comes from the leaders' side, den-aware.
  ok(!/coversCents/.test(fn[0]), 'the family figure is back to reading one rung in isolation');
  ok(/var cover = d\.coveredCents \|\| 0;/.test(fn[0]), 'the published cover is not used');
  ok(/Math\.max\(0, expected - cover\)/.test(fn[0]), 'the after-tier figure can go negative');
  // A payload written before the field existed must show no claim at all, not a stale one.
  ok(/\(cover > 0/.test(fn[0]), 'an old payload still prints an after-tier figure');
  // The den-exact rung table: the only money figure a parent gets for the ladder.
  ok(/Your year drops to/.test(fn[0]), 'the den row does not say what each tier drops the year to');
  ok(/d\.steps/.test(fn[0]) && /x\.afterCents/.test(fn[0]), 'the rung table is not driven by the published steps');
  ok(/coveredCents > 0/.test(fn[0]), 'a rung that covers this den nothing still gets a row');
});

test('a rung named on two tiers is handed back once, not twice', () => {
  const ctx = vm.createContext({ state: { rewardTiers: { tiers: [] } } });
  vm.runInContext(
    `${slice('arrOf')} ${slice('sortedTiers')} ${slice('COVER_WHO')} ${slice('coverKeyOf')}
     ${slice('lineRateForWho')} ${slice('coverValueOfKeys')} ${slice('tierCumulativeCoverCents')}
     function coverableLines() { return LINES; }`, ctx);
  ctx.LINES = [
    { key: 'maze', line: { scoutRateCents: 2200, adultRateCents: 2200 } },
    { key: 'dues', line: { scoutRateCents: 8500 } }
  ];
  ctx.state.rewardTiers.tiers = [
    { id: 'a', thresholdCents: 15000, covers: ['dues', 'maze'] },
    { id: 'b', thresholdCents: 33000, covers: ['maze', 'maze#adult'] },  // maze again
    { id: 'c', thresholdCents: 90000, covers: ['dues'] }                 // above: must not count
  ];
  const at = (id) => vm.runInContext(`tierCumulativeCoverCents(state.rewardTiers.tiers.find(function (t) { return t.id === '${id}'; }))`, ctx);
  eq(at('a'), 10700, 'the first rung: 85 dues + 22 maze');
  // 85 + 22 + 22 adult. The SUM would say 15100 — the maze scout share billed to the pack twice.
  eq(at('b'), 12900, 'a line both rungs name is handed back once');
  eq(at('c'), 12900, 'the top rung adds a key it already had');
});

test('the ladder covers are unioned, not summed, and every rung counts', () => {
  const ctx = vm.createContext({ state: { rewardTiers: { tiers: [] } } });
  vm.runInContext(slice('arrOf') + slice('sortedTiers') + slice('allTierCoverKeys'), ctx);
  ctx.state.rewardTiers.tiers = [
    { id: 'a', thresholdCents: 15000, covers: ['dues', 'shirt'] },
    { id: 'b', thresholdCents: 33000, covers: ['maze', 'shirt'] },          // shirt twice
    { id: 'c', thresholdCents: 41500, covers: ['maze', 'stripers#adult'] }  // maze twice
  ];
  eq(Object.keys(vm.runInContext('allTierCoverKeys()', ctx)).sort(),
    ['dues', 'maze', 'shirt', 'stripers#adult'], 'the union of every rung');
  ctx.state.rewardTiers.tiers = [];
  eq(Object.keys(vm.runInContext('allTierCoverKeys()', ctx)), [], 'no tiers covers nothing');
});

test('the parent calendar is a real month grid, driven only by the published events', () => {
  const fn = /function parentCalendar\(pv, today\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'parentCalendar() not found');
  ok(/Array\.isArray\(pv\.events\)/.test(fn[0]), 'the grid reads something other than the published events');
  // Nothing in the parent app may reach `state` — that is the whole shape of the parent phase.
  ok(!/state\./.test(codeOnly(fn[0])), 'the parent calendar reads the leaders’ pack record');
  // Its own month, so a leader who is also a parent cannot have one view drag the other's month.
  ok(/ui\.parentCalMonth/.test(fn[0]) && !/ui\.calMonth/.test(fn[0]),
    'the parent grid shares ui.calMonth with the leader calendar');
  // A hollow storefront dot means an open shift on both sides now that parents can see coverage.
  ok(/cls: covered \? 'dot-store' : 'dot-store-open'/.test(fn[0]),
    'a storefront dot does not distinguish a fully staffed day');
  ok(/shifts\.every\(function \(s\) \{/.test(fn[0]), 'coverage is not computed from every shift');
  // Same tab-stop diet as the leader grid, and every focusable cell carries its own date.
  ok(/var focusable = iso === today \|\| !!dayEvs;/.test(fn[0]), 'every day in the month is a tab stop');
  ok(/aria-label="' \+ esc\(fmtDate\(iso\)\)/.test(fn[0]), 'a focusable day has no accessible date');
  // Without the allowlist entries the strip renders and does nothing.
  for (const act of ['parent-cal-prev', 'parent-cal-next', 'parent-cal-day', 'parent-cost-toggle']) {
    ok(new RegExp("var PARENT_ACTS = \\[[^\\]]*'" + act + "'").test(SCRIPT),
      `${act} is not in PARENT_ACTS, so the control is inert`);
  }
});

/* ========================================================================
   The parent camping page: one campout per sub-tab — 2026-08-02
   ===================================================================== */

test('camping anchors are unique across trips that share section names', () => {
  const ctx = sandbox(['campAnchor']);
  eq(ctx.campAnchor(2, 5), 'pc-t2-s5', 'a section anchor');
  // Every trip carries the SAME six section titles, so a slug of the title would collide on
  // every one of them and every link would jump to the wrong place. The trip index stays in the
  // id even though one trip renders at a time, so a copied link says which campout it came from.
  const ids = new Set();
  for (let t = 0; t < 3; t++) for (let s = 0; s < 6; s++) ids.add(ctx.campAnchor(t, s));
  eq(ids.size, 18, 'anchor collision across trips');
});

test('the shown campout lists its own sections, and short trips get no index', () => {
  const ctx = sandbox(['esc', 'campAnchor', 'campSectionNav']);
  const trip = (secs) => ({ name: 'Fort Yargo', sections: secs.map((t) => ({ title: t, body: 'x' })) });
  const six = ['What to expect', 'What to pack', 'Getting there', 'Meals', 'Safety', 'Cost'];
  const html = ctx.campSectionNav(trip(six), 1);
  eq((html.match(/<a href="#pc-t1-s/g) || []).length, 6, 'one link per section');
  ok(/href="#pc-t1-s4"/.test(html), 'the hrefs carry the shown trip’s index');
  ok(/<nav class="camp-toc" aria-label="On this page">/.test(html), 'the contents are not a landmark');
  // The sub-tab strip already got you to this trip; only the sections are left to index, so
  // the trip's own name has no link here.
  ok(html.indexOf('camp-toc-trip') === -1, 'the trip links to itself');
  // A page you can already see does not need an index of itself.
  eq(ctx.campSectionNav(trip(['What to pack', 'Meals', 'Safety']), 0), '',
    'a three-section trip still gets an index');
  eq(ctx.campSectionNav({ name: 'x' }, 0), '', 'a trip with no sections gets an index');
  ok(ctx.campSectionNav(trip(['a', 'b', 'c', 'd']), 0) !== '',
    'four sections is the floor and it excluded four');
});

test('parents get a campout sub-tab strip, and only on Camping', () => {
  // The leader side has had one sub-tab per campout all along; a parent got all three trips
  // stacked. Ids are the trip INDEX, because buildParentView publishes no trip id.
  const defs = /function parentSectionDefs\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(defs, 'parentSectionDefs() not found');
  ok(/if \(parentTab\(\) !== 'camping'\) return \[\];/.test(defs[0]),
    'the strip is offered on tabs that have no sections');
  ok(/parentTrips\(\)\.map\(function \(t, i\) \{ return \{ id: String\(i\), label: tripTabLabel\(t\) \}; \}\)/.test(defs[0]),
    'the sub-tabs are not one per published trip');
  // The strip is shared with the leader side, and one row must not leak the other's action.
  const rend = /var secDefs = gate \? \[\][\s\S]*?secEl\.setAttribute\('aria-label'[^;]*;/.exec(SCRIPT);
  ok(rend, 'the section-strip block has moved');
  ok(/var secAct = parent \? 'parent-camp-trip' : 'section';/.test(rend[0]),
    'a parent’s sub-tab emits the leader action');
  ok(/\(parent \? '' : ' data-tab="' \+ esc\(wsNow\.id\) \+ '"'\)/.test(rend[0]),
    'a parent sub-tab carries a workspace id, and wsNow is null for parents');
  // Without the allowlist entry the handler drops the click and the strip does nothing.
  ok(/var PARENT_ACTS = \[[^\]]*'parent-camp-trip'/.test(SCRIPT),
    'parent-camp-trip is not in PARENT_ACTS, so the sub-tabs are inert');
  // Trust nothing off the DOM: an index out of range must not select a trip that isn't there.
  const handler = /if \(act === 'parent-camp-trip'\) \{[\s\S]*?\n    \}/.exec(SCRIPT);
  ok(handler, "the parent-camp-trip handler is missing");
  ok(/if \(pcWant >= 0 && pcWant < parentTrips\(\)\.length\)/.test(handler[0]),
    'the handler takes the clicked index without checking it');
});

test('the parent camping page renders one campout, not all of them', () => {
  const fn = /function renderParentCamping\(pv\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'renderParentCamping() not found');
  ok(/var ti = parentCampTrip\(\);/.test(fn[0]) && /var t = trips\[ti\] \|\| trips\[0\];/.test(fn[0]),
    'the page does not select a single trip');
  // The give-away for a regression to the stacked page.
  ok(fn[0].indexOf('trips.forEach') === -1, 'the page still iterates every trip');
});

test('a camping jump clears the sticky topbar', () => {
  // Without this the heading you jumped to lands UNDERNEATH the header, which reads as the link
  // being broken. Sized for the tall (wrapped-wordmark) bar plus the card's own padding.
  const m = /\.camp-anchor \{ scroll-margin-top: (\d+)px; \}/.exec(SCRIPT_CSS);
  ok(m, 'the camping anchors have no scroll margin');
  ok(+m[1] >= 141, `scroll-margin-top ${m[1]}px is under the 122px topbar plus card padding`);
  // The heading has to BE the anchor, or the margin lands on nothing. Only section headings are
  // anchored now: the trip's own name is the top of its sub-tab, so nothing jumps to it.
  ok(/class="section display camp-anchor" id="' \+ campAnchor\(ti, si\)/.test(SCRIPT),
    'a camping section heading is anchored without the class that gives it clearance');
});

/* ========================================================================
   What else the parent view publishes — 2026-08-02
   ===================================================================== */

test('an activity crosses over with its time, its end time and its address', () => {
  // All three are editable, all three are shown to leaders, all three go into the .ics export —
  // and the app NAGS a leader when an upcoming activity is missing a time or a place. It then
  // published neither, so a family got a title and a date and had to text somebody.
  const src = BPV();
  ok(/var aRange = fmtTimeRange\(e\.time, e\.endTime\);/.test(src),
    'an activity publishes no time, or only its start');
  ok(/if \(aRange\) av\.times = \[aRange\];/.test(src), 'the time range never reaches the document');
  ok(/if \(e\.location\) av\.where = String\(e\.location\);/.test(src), 'the location is still dropped');
  // The nudge that chases leaders for exactly these two fields must keep matching them, or the
  // app goes back to asking for something it throws away.
  ok(/\(!a\.time \|\| !a\.location\)/.test(SCRIPT), 'the vague-activity nudge no longer checks time and place');
  // A meeting's note IS its "Where" and has always published; its internal note must not.
  ok(/kind: 'meeting'[^}]*detail: String\(e\.note \|\| ''\)/.test(src), 'a meeting stopped publishing its Where');
  // A meeting has no end-time INPUT, so fmtTimeRange degrades to exactly what fmtClock returned —
  // this is not a behaviour change today. It is pinned because the .ics importer writes endTime
  // straight onto an event, and a meeting that arrives from BAND carrying one should show the
  // range rather than silently dropping half of it.
  ok(/var mRange = fmtTimeRange\(e\.time, e\.endTime\);/.test(src),
    'a meeting imported with an end time would publish only its start');
  ok(codeOnly(src).indexOf('noteInternal') === -1,
    'the leaders-only note is reachable from the published view');
  // An ACTIVITY's free-text note is not a location and is not published — only e.location is.
  ok(!/av\.\w+ = String\(e\.note/.test(src), 'an activity now publishes its note');
});

test('a storefront publishes who is on each shift, and never a penny of it', () => {
  const src = BPV();
  ok(/var shifts = blocksInDayOrder\(sf\)\.map/.test(src),
    'the shifts publish in stored order rather than the order the day happens');
  ok(/return \{ when: fmtTimeRange\(b\.start, b\.end\), who: shiftWho\(b\) \};/.test(src),
    'a published shift no longer carries who is on it');
  ok(/if \(shifts\.length\) ev\.shifts = shifts;/.test(src), 'the shifts never reach the document');
  // The whole reason shift money was withheld in the first place. Anchored on `b.` so the tier
  // ladder's own salesCents key (a sell-through target, not a block's takings) is not a match.
  const code = codeOnly(src);
  ok(!/b\.salesCents|b\.donationsCents|blockShares\(/.test(code),
    'a block’s money is reachable from the published view');
  // First names only, and alphabetical like every other list of scouts in the app.
  const who = /function shiftWho\(b\) \{[\s\S]*?\n      \}/.exec(src);
  ok(who, 'shiftWho() not found');
  ok(/pubName\[a\.scoutId\]/.test(who[0]), 'shift names come from somewhere other than the public-name map');
  ok(/\.sort\(function \(x, y\) \{ return String\(x\)\.localeCompare\(String\(y\)\); \}\)/.test(who[0]),
    'shift names are not sorted, so a rename reshuffles a shift');
});

test('one public-name map, so no two surfaces call the same child different things', () => {
  const src = BPV();
  // Built over the WHOLE roster before anything names a child — by the one helper every outbound
  // builder shares (the day sheet and the copied standings use it too).
  ok(/var shown = shortNames\(all\.map\(function \(s\) \{ return s\.name; \}\)\);/.test(slice('publicNameMap')),
    'the public-name map is not built from the full roster');
  ok(/var pubName = publicNameMap\(state\.scouts\);/.test(src), 'the parent view builds its own name map');
  ok(/name: pubName\[r\.id\] \|\| ''/.test(src), 'the standings board names children from its own pass');
  // A SECOND shortNames() pass over a subset is exactly how the two boards drifted apart: the
  // derby list keeps one, but only as the fallback for a racer who is not a roster scout at all
  // (a sibling in the open class), and pubRacer() prefers the shared map.
  ok(/function pubRacer\(raw, fallback\)/.test(src), 'pubRacer() not found');
  ok(/racerName: pubRacer\(aw\.racerName, derbyNames\[winners\.length \+ i\]\)/.test(src),
    'a design-award racer is not reconciled against the roster');
  ok(/scoutName: pubRacer\(w\.scoutName, derbyNames\[i\]\)/.test(src),
    'a derby winner is not reconciled against the roster');
  eq((codeOnly(src).match(/shortNames\(/g) || []).length, 1,
    'an unexpected number of shortNames() passes — every extra one can name a child differently');
});

test('the derby date is a calendar fact, not a standings one', () => {
  const src = BPV();
  const gate = src.indexOf('if (!withStandings) return out;');
  const dbyRow = src.indexOf("kind: 'derby'");
  ok(dbyRow > -1, 'no derby row is published');
  ok(dbyRow < gate, 'the derby date sits behind the standings gate, so a calendar-only pack loses it');
  // Deduped on the DATE alone — a rule a leader can predict. Fuzzy title matching would drop a
  // real event, or double a row, depending on how they spelled it.
  ok(/!events\.some\(function \(e\) \{ return e\.date === dbyDate; \}\)/.test(src),
    'a pack with its own derby event gets a second row beside it');
  ok(/if \(dbyDate && inYear\(dbyDate\)/.test(src), 'a derby outside the program year still publishes');
  // The winners stay behind the gate: they are a board of children's names.
  ok(src.indexOf('winners: winners.map') > gate, 'the derby winners escaped the standings gate');
});

test('the reward ladder publishes what a scout must SELL, and never who paid instead', () => {
  const src = BPV();
  ok(/salesCents: salesForCommission\(t\.thresholdCents\)/.test(src),
    'the ladder publishes the raw threshold, which is commission — nobody sells commission');
  const tcode = codeOnly(src);
  ok(!/thresholdCents: /.test(tcode), 'the commission threshold is published as-is');
  // madeUp names the families who paid the difference instead of selling it.
  ok(tcode.indexOf('madeUp') === -1, 'tier.madeUp is reachable from the published view');
  ok(!/t\.covers/.test(tcode), 'the tier’s internal collect keys are published');
  const gate = src.indexOf('if (!withStandings) return out;');
  ok(src.indexOf('var tiers = sortedTiers()') > gate,
    'the ladder publishes in calendar-only mode, where there is no tab to show it on');
});

test('a parent sees which shifts are open, and an old document still shows its windows', () => {
  const ctx = sandbox(['esc', 'parentShiftLines']);
  const html = ctx.parentShiftLines({ shifts: [
    { when: '10:00 AM–12:00 PM', who: ['Ada', 'Beckett H.'] },
    { when: '12:00 PM–2:00 PM', who: [] }
  ] });
  eq((html.match(/class="sf-shift[ "]/g) || []).length, 2, 'one line per shift');
  ok(/Ada, Beckett H\./.test(html), 'the names of a staffed shift');
  ok(/class="sf-shift sf-open"/.test(html) && />Open</.test(html),
    'an open shift is not marked, so a parent cannot see what needs covering');
  // A document published before this shipped has `times` instead. Those render above as chips,
  // so this adds nothing rather than blanking the storefront.
  eq(ctx.parentShiftLines({ times: ['10:00 AM–12:00 PM'] }), '', 'an old document breaks');
  eq(ctx.parentShiftLines({}), '', 'a storefront with no shifts breaks');
});

test('the ladder shows a rung with no measurable target, rather than a target of nothing', () => {
  const ctx = sandbox(['esc', 'fmt', 'fmtDate', 'parentTierLadder']);
  const rows = (html) => (html.match(/<tr>/g) || []).length;
  const full = ctx.parentTierLadder({ tiers: [
    { name: 'Dues covered', reward: 'The pack pays your dues', note: '', dueBy: '2026-10-15', salesCents: 17500 },
    { name: 'Camp week', reward: 'A week of camp', note: 'Sign up by the November meeting.', dueBy: '', salesCents: 87500 }
  ] });
  // The word "sold" left the cell when the column header became "Sell" — saying it twice is
  // noise, and the footnote under the table says it once more for anyone who scrolled past.
  ok(/>\$175\.00</.test(full), 'the sell-through target');
  ok(/<th scope="col">Sell<\/th>/.test(full), 'the column does not say what the figure is');
  ok(/any time/.test(full), 'a tier with no deadline should say so, not show a blank');
  ok(/Sign up by the November meeting\./.test(full), 'the tier note is dropped');
  eq(rows(full), 3, 'a header row and one row per tier');
  // salesForCommission returns null when the pack has typed no rate at all.
  const noRate = ctx.parentTierLadder({ tiers: [
    { name: 'Pack tee', reward: 'Pack t-shirt', note: '', dueBy: '', salesCents: null }
  ] });
  ok(/Pack t-shirt/.test(noRate), 'an unmeasurable rung is dropped entirely, reward and all');
  ok(!/\$0\.00/.test(noRate), 'an unmeasurable rung shows a target of zero');
  eq(ctx.parentTierLadder({}), '', 'a pack with no tiers gets an empty card');
});

/* ========================================================================
   An admin can look at the parent view — 2026-08-02
   ===================================================================== */

test('the preview is gated so nobody can be stranded in a view they cannot leave', () => {
  const fn = /function canPreviewParent\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'canPreviewParent() not found');
  // canEdit() as WELL as the role: if a pack demotes an admin mid-session the preview must end
  // on its own, not leave them holding a flag with no button to clear it.
  ok(/return canEdit\(\) && \(isAdmin\(\) \|\| !accountsInForce\(\)\);/.test(fn[0]),
    'the preview is not gated on both the role and edit rights');
  // previewingParent() re-checks the gate rather than trusting the flag, so a stale ui flag on a
  // demoted admin's screen resolves to false.
  ok(/function previewingParent\(\) \{ return ui\.previewParent === true && canPreviewParent\(\); \}/.test(SCRIPT),
    'the preview flag is trusted without re-checking who is holding it');
  // NOT persisted: a reload is always an escape hatch. `ui` is never written to storage, and the
  // flag lives there for exactly that reason.
  ok(/previewParent: false/.test(SCRIPT), 'the preview flag has no declared default');
  ok(!/previewParent/.test(/function normalizeState\(d\) \{[\s\S]*?\n  \}/.exec(SCRIPT)?.[0] || ''),
    'the preview flag reached the persisted pack record, so a reload could not clear it');
  // The way out is on the allowlist. Every other leader action is refused while parentMode() is
  // true, so an exit that was not allowlisted would be a trap.
  ok(/var PARENT_ACTS = \[[^\]]*'parent-preview-off'/.test(SCRIPT),
    'the exit action is not allowlisted, so the preview cannot be left');
  // Entering re-checks; leaving is unconditional.
  const on = /if \(act === 'parent-preview-on'\) \{[\s\S]*?\n    \}/.exec(SCRIPT);
  ok(on && /if \(!canPreviewParent\(\)\) return;/.test(on[0]),
    'entering the preview does not re-check who is asking');
  const off = /if \(act === 'parent-preview-off'\) \{[^}]*\}/.exec(SCRIPT);
  ok(off && !/canPreviewParent/.test(off[0]), 'leaving the preview is conditional');
});

test('the preview reads the pack record without letting it into the parent block', () => {
  // The invariant that makes the money, dues and roster unreachable from a parent's screen is
  // structural: `state` never appears in the parent render block (asserted separately above). The
  // preview needs a document built FROM state, so it is built in render() and read through
  // parentDoc() — the one place that may know about both.
  ok(/parentPreviewDoc = previewingParent\(\) \? buildParentView\(state\) : null;/.test(SCRIPT),
    'the preview document is not built in render(), or not from the pack record');
  ok(/function parentDoc\(\) \{ return previewingParent\(\) \? parentPreviewDoc : sync\.parentView; \}/.test(SCRIPT),
    'parentDoc() no longer chooses between the preview and the published copy');
  // Cleared when not previewing, so a stale build can never be served to a real parent — the
  // `: null` branch is inside the assignment asserted above. It also starts empty:
  ok(/var parentPreviewDoc = null;/.test(SCRIPT), 'the preview document does not start empty');
  // That it is REACHED on every render is not something a source scan can show, and two attempts
  // to assert it textually were both wrong (a harmless one-line `if` sits between the parent-mode
  // decision and the assignment). Verified in a browser instead: entering and leaving the preview
  // repeatedly serves a freshly built document each time, and a reload clears it.
  // EVERY reader goes through parentDoc(). A reader left on sync.parentView would make the tabs
  // and the content disagree — a preview whose Standings tab is offered from the published copy
  // and filled from the live one.
  const start = SCRIPT.indexOf('function parentHasStandings(');
  const block = SCRIPT.slice(start, SCRIPT.indexOf('function renderStorefrontList('));
  ok(!/sync\.parentView/.test(codeOnly(block)),
    'a parent-app reader still reads the published copy directly, so the preview is inconsistent');
  // Deliberately NOT a count of parentDoc() calls: the meaningful property is that no reader
  // bypasses it, which the assertion above proves directly. A count is just a number to update.
  ok(/var pv = parentDoc\(\);/.test(block), 'the parent app no longer takes its document from parentDoc()');
});

test('the preview announces itself, and the leader entry point hides from everyone else', () => {
  const banner = /function parentPreviewBanner\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(banner, 'parentPreviewBanner() not found');
  ok(/Parent view preview\./.test(banner[0]), 'the banner does not say what it is');
  ok(/data-act="parent-preview-off"/.test(banner[0]), 'the banner has no way back');
  // no-print: a parent's printed schedule should not carry a leader's scaffolding.
  ok(/class="card no-print pv-preview"/.test(banner[0]), 'the banner prints, or is not tinted');
  ok(/\.pv-preview \{ background: var\(--accent-soft\); border: 1px solid var\(--accent\); \}/.test(SCRIPT_CSS),
    'the banner is styled as an ordinary card, so it reads as part of the parent view');
  // Rendered first, before any content — a leader who forgets they are in here will report the
  // pack's money as missing.
  const app = /function renderParentApp\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(/var h = previewingParent\(\) \? parentPreviewBanner\(\) : '';/.test(app[0]),
    'the banner is not the first thing on the page');
  // The entry card renders for nobody who cannot use it, so there is no disabled control to explain.
  const card = /function renderParentPreviewCard\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(card && /if \(!canPreviewParent\(\)\) return '';/.test(card[0]),
    'the entry card renders for people who cannot use it');
  ok(/renderParentPreviewCard\(\);/.test(SCRIPT), 'the entry card is never rendered');
});

test('the source is text, with no control characters hiding in it', () => {
  // A single NUL byte makes grep report NOTHING for the whole 900KB file — silently, with a
  // non-zero exit — so every "there are no matches for X" becomes a lie. It has happened
  // twice in this project now: once in the harness (a `join('\x00')`), once in index.html (a
  // NUL used as a map-key separator). Both worked perfectly and both blinded every search
  // over the file they were in. Cheap to assert, expensive to debug.
  const bad = [];
  for (let i = 0; i < HTML.length; i++) {
    const c = HTML.charCodeAt(i);
    if (c < 9 || (c > 13 && c < 32) || c === 127) bad.push([i, c]);
  }
  ok(!bad.length, `${bad.length} control character(s), first at offset ${bad[0] && bad[0][0]} (code ${bad[0] && bad[0][1]})`);
});

/* ========================================================================
   The printout IS the family page — 2026-08-31
   ===================================================================== */

// Owner ruling: what gets printed for a bulletin board or a parents meeting is the page families
// will read online once the site is shared, not a separately authored handout. A second rendering
// of the same ladder is a second thing to keep in step, and the standings sheet in this very file
// had already drifted four ways by the time anybody looked at it.

test('there is no separately authored tier handout left to drift', () => {
  for (const gone of ['tierSheetRungs', 'tierSheetText', 'renderTierSheet']) {
    ok(!new RegExp(`function ${gone}\\(`).test(SCRIPT), `${gone}() is back — a second source for the ladder`);
  }
  ok(!/kind: 'tiers'|o\.kind === 'tiers'/.test(SCRIPT), 'the retired tier-sheet overlay is still reachable');
  ok(!/copy-tier-sheet|data-act="tier-sheet"/.test(SCRIPT), 'the retired sheet still has controls pointing at it');
  // The affordance stays where leaders look; it just lands on the family view now.
  ok(/data-act="family-sheet"/.test(SCRIPT), 'the Rewards card lost its print affordance entirely');
  const h = /if \(act === 'family-sheet'\) \{[\s\S]*?\n    \}/.exec(SCRIPT);
  ok(h, "the family-sheet action has no handler");
  ok(/ui\.previewParent = true;/.test(h[0]) && /ui\.parentTab = 'standings';/.test(h[0]),
    'the button does not land on the family Standings tab');
  // Re-checks the role rather than trusting a button that was rendered for an admin who has since
  // been demoted — the same guard parent-preview-on carries.
  ok(/if \(!canPreviewParent\(\)\) return;/.test(h[0]), 'a demoted admin can still open the family view');
});

test('the family page can print itself, and the print reaches a parent’s own device', () => {
  const list = /function renderParentStandings\(pv\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(list, 'renderParentStandings() not found');
  ok(/data-act="parent-print"/.test(list[0]), 'the family page has no way to print itself');
  ok(/class="row no-print"/.test(list[0]), 'the print control prints itself onto the paper');
  // ⚠ The parent app ignores any action not on this list, so a button alone would be inert.
  ok(/'parent-cal-day', 'parent-cost-toggle', 'parent-preview-off', 'parent-print'/.test(SCRIPT),
    'parent-print is not allowed through the parent-mode action gate');
  ok(/if \(act === 'parent-print'\) \{ window\.print\(\); return; \}/.test(SCRIPT),
    'the print action does something other than print the page in front of it');
  // <main> has to stay visible in parent mode or the paper comes out blank — the normal print
  // rule hides it and shows only overlays, and a parent has no overlays.
  ok(/@media print \{ body\.parent-mode main \{ display: block !important; \} \}/.test(SCRIPT_CSS),
    'the family page prints blank');
});

test('paper breaks between facts, never through one', () => {
  // Owner ask, 2026-08-31: page breaks so the content fits nicer. Before this the print block had
  // no pagination rules at all, so a scout's bar could land on one sheet with their name on the
  // previous one, and a standings table running past a page lost its column headings entirely.
  const pr = /@media print \{[\s\S]*?\n  \}/.exec(SCRIPT_CSS);
  ok(pr, 'the print block was not found');
  // ⚠ SCOPED TO THE SMALL UNITS ON PURPOSE. break-inside on a container taller than a sheet
  // cannot be honoured, and the browser's fallback is to push the whole thing to a fresh page and
  // leave the previous one half empty. "What a year costs a family" runs well past a page on its
  // own, so the CARD must stay breakable and the dens are what hold together.
  ok(/\.pv-scout, \.pv-den, \.block-card, \.pv-stand, \.stat \{ break-inside: avoid; \}/.test(pr[0]),
    'the atomic units can still be split across a page break');
  ok(!/\.card \{[^}]*break-inside: avoid/.test(pr[0]),
    'a card taller than a sheet is marked unbreakable, which strands half a page');
  // A column of figures with no heading is unreadable on page two.
  ok(/thead \{ display: table-header-group; \}/.test(pr[0]), 'a long table loses its headings after page one');
  ok(/tr[^{]*\{ break-inside: avoid; \}/.test(pr[0]), 'a table row can be split in half');
  // A heading at the foot of a page points at nothing.
  ok(/h1, h2, h3, \.eyebrow \{ break-after: avoid; \}/.test(pr[0]), 'a heading can be stranded from its content');
  ok(/orphans: 3; widows: 3/.test(pr[0]), 'a single dangling line can be left at a page edge');
  // The bars carry meaning through a background colour, which browsers drop by default. Every
  // figure is also in words, so a viewer who declines still loses nothing.
  ok(/print-color-adjust: exact/.test(pr[0]), 'the progress bars print as empty outlines');
});

test('every den prints opened out, however the reader left them on screen', () => {
  // ⚠ A collapsed den used to `return` before emitting anything, so the breakdown was not in the
  // DOM and NO print rule could bring it back: paper got the headline figure and none of the
  // detail, which is most of what the card is for. The toggle now decides only what is SHOWN.
  const fn = /function parentFamilyCost\(pv\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(fn, 'parentFamilyCost() not found');
  ok(!/if \(!open\) return;/.test(fn[0]), 'a collapsed den is skipped, so print cannot expand it');
  ok(/class="pv-cost-detail' \+ \(open \? ' open' : ''\)/.test(fn[0]),
    'the detail is not wrapped in something a print rule can target');
  // Both early exits inside the loop have to close the wrapper, or a den with no priced rungs
  // leaves an unclosed div and swallows every den after it.
  // TWO wrappers now: .pv-den holds the row and its detail together so a page break cannot land
  // between them, and .pv-cost-detail is the collapsible part inside it. Both early exits have to
  // close both, or a den with no priced rungs swallows every den after it and the closing note.
  ok(/if \(!steps\.length\) \{ h \+= '<\/div><\/div>'; return; \}/.test(fn[0]),
    'a den with no priced rungs leaves a wrapper unclosed');
  eq((fn[0].match(/pv-cost-detail/g) || []).length, 1, 'the wrapper is opened more than once per den');
  eq((fn[0].match(/'<div class="pv-den">'/g) || []).length, 1, 'the den wrapper is opened more than once');
  // Balanced across the whole loop body: one <div class="pv-den"> and one .pv-cost-detail opened,
  // and every path out closes both.
  eq((fn[0].match(/<\/div><\/div>/g) || []).length, 2, 'the two exits from the den loop do not close the same tags');
  ok(/\.pv-cost-detail \{ display: none; \}/.test(SCRIPT_CSS), 'a collapsed den is visible on screen');
  ok(/@media print \{[\s\S]*?\.pv-cost-detail \{ display: block !important; \}/.test(SCRIPT_CSS),
    'the detail stays collapsed on paper');
  // The chevron points at an interaction paper does not have, and would show the collapsed glyph
  // beside content that is open.
  ok(/\[data-act="parent-cost-toggle"\] \.mo-chev \{ display: none !important; \}/.test(SCRIPT_CSS),
    'the disclosure arrow prints beside expanded content');
});

/* ========================================================================
   The shared standings sheet, brought level with the board — 2026-08-31
   ===================================================================== */

test('the shared sheet never puts one rate over a two-rate commission', () => {
  // ⚠ THE BUG THIS EXISTS FOR. pack.pct is the STOREFRONT rate alone (computePackTotals sets
  // `pct` from rates.base), so on a pack running 35% at a table and 30% online — the ordinary
  // case, and this pack's — "Commission (35%)" labelled a figure that is the sum of two separate
  // calculations. On a sheet that gets handed to a committee that is just a wrong number.
  const sheet = /if \(o\.kind === 'summary'\) \{[\s\S]*?\n      return h;/.exec(SCRIPT);
  ok(sheet, "the summary overlay branch was not found");
  ok(!/Commission \(' \+ pack\.pct \+ '%\)/.test(sheet[0]),
    'the sheet labels a two-rate commission with the storefront rate');
  ok(/pack\.ratesSplit \|\| pack\.pct == null \? '' :/.test(sheet[0]),
    'the rate is named unconditionally, so a split-rate pack is mislabelled');
  // With two rates it discloses both halves instead, exactly as the on-screen card does.
  ok(/pack\.commissionOther/.test(sheet[0]) && /pack\.commissionOnline/.test(sheet[0]),
    'a treasurer cannot reconcile the sheet against a Trail’s End statement');
  // Same fix in the copy-as-text twin, or the two disagree.
  const txt = /function summaryText\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(!/Pack commission \(' \+ pack\.pct \+ '%\)/.test(txt[0]),
    'the text version still labels a two-rate commission with one rate');
  ok(/pack\.ratesSplit/.test(txt[0]), 'the text version does not disclose the two halves');
});

test('the shared sheet says which tier each scout reached, and what the pack ends up with', () => {
  const sheet = /if \(o\.kind === 'summary'\) \{[\s\S]*?\n      return h;/.exec(SCRIPT)[0];
  // The reward ladder is the pack's main lever and the shared standings sheet never mentioned it,
  // while the board it is printed from shows a badge per scout.
  ok(/tierBadgesFor\(r, sumTiers, sumCovered, sumMap\)/.test(sheet),
    'the sheet builds its own idea of who earned what, or shows none at all');
  ok(/var sumTiers = sortedTiers\(\);/.test(sheet) && /var sumCovered = packCoverageByScout\(sumMap\);/.test(sheet),
    'the badges are not taken from the same two calls the Standings card makes');
  // A pack with no tiers gets no empty column.
  ok(/sumTiers\.length \? '<th scope="col">Tier<\/th>' : ''/.test(sheet),
    'a pack with no reward tiers is given an empty Tier column');
  // The bottom line the sheet used to stop one figure short of.
  ok(/Total to the pack/.test(sheet), 'the sheet stops at commission and never says what the pack keeps');
  ok(/fmt\(pack\.cashKept \+ pack\.commission\)/.test(sheet),
    'the total is not commission plus the cash the pack keeps');
  // And the stretch goal, which the on-screen card shows and the sheet had dropped — on its own
  // bar, never a marker on the first one.
  ok(/Stretch goal/.test(sheet), 'the sheet omits the stretch goal the board shows');
  ok(/pack\.stretch > 0/.test(sheet), 'the stretch bar is drawn even when there is no stretch goal');
  const txt = /function summaryText\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  ok(/earnedTierFor\(r\.id, txTiers, txEarned\)/.test(txt), 'the text version names no tiers');
  ok(/Total to the pack/.test(txt) && /Stretch goal/.test(txt),
    'the text version is behind the printed sheet');
});

/* ================================================================
   2026-09-07 — the printed sheet, and what each rung buys
   ================================================================ */

test('the printed sheet drops the pack goal and opens a fresh page at the ladder', () => {
  // Owner ask, 2026-09-07: every scout on the first two sheets. The pack goal bar was spending a
  // card at the top of sheet one on a figure that is read aloud at the meeting the handout is
  // given out at, and pushing the last scouts onto a third sheet to do it.
  const stand = /function renderParentStandings\(pv\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(stand, 'renderParentStandings() not found');
  ok(/<div class="card pv-packgoal">/.test(stand[0]),
    'the pack goal card carries no print hook, so it cannot come off the paper');
  ok(/@media print \{ \.pv-packgoal \{ display: none !important; \} \}/.test(SCRIPT_CSS),
    'the pack goal still prints');
  // ...and it is hidden on PAPER only. It is a live figure a parent checks between meetings, and
  // deleting it from the page would be answering a print question with a screen change. Every
  // rule that names the class has to sit inside an @media print, so: it is named exactly once.
  eq(SCRIPT_CSS.match(/\.pv-packgoal\b/g).length, 1,
    'the pack goal class is styled somewhere besides the one print rule — check it still shows on screen');

  // The ladder is the reference half of the handout. Run under the last scout's bar across a fold
  // it reads as one continuing list, and sheet three opens on a table of money with no heading.
  const lad = /function parentTierLadder\(pv\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(lad, 'parentTierLadder() not found');
  ok(/<div class="card pv-ladder">/.test(lad[0]), 'the ladder card carries no page-break hook');
  const brk = /\.pv-ladder \{([^}]*)\}/.exec(SCRIPT_CSS);
  ok(brk, '.pv-ladder has no print rule');
  ok(/break-before: page/.test(brk[1]) && /page-break-before: always/.test(brk[1]),
    'the break is not stated in both spellings — most of what is attached to a pack printer is old');
});

test('the year cost card opens a sheet, and so does every den after the first', () => {
  // Owner ask, 2026-09-09: the same fold the ladder gets, one card further on, and again at each
  // den. A den runs longer than a page, so the break-inside rule up in the pagination block can
  // never hold one together; what CAN be guaranteed is that a family looking for Wolf finds Wolf
  // starting at the top of a sheet instead of four line items under somebody else's tier table.
  const cost = /function parentFamilyCost\(pv\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(cost, 'parentFamilyCost() not found');
  ok(/<div class="card pv-yearcost">/.test(cost[0]), 'the year cost card carries no page-break hook');
  const yc = /\.pv-yearcost \{([^}]*)\}/.exec(SCRIPT_CSS);
  ok(yc, '.pv-yearcost has no print rule');
  ok(/break-before: page/.test(yc[1]) && /page-break-before: always/.test(yc[1]),
    'the year cost break is not stated in both spellings');

  // Per den, and the FIRST one excepted: it belongs under the card's own heading, and a sheet
  // holding that one line alone is a wasted page. (The paragraph that used to sit there beside it
  // comes off the paper as of 2026-09-11 — see the lead-in test below.)
  const den = /\.pv-den \+ \.pv-den \{([^}]*)\}/.exec(SCRIPT_CSS);
  ok(den, 'the dens still run one into the next on paper');
  ok(/break-before: page/.test(den[1]) && /page-break-before: always/.test(den[1]),
    'the den break is not stated in both spellings');
  ok(!/\n    \.pv-den \{[^}]*break-before: page/.test(SCRIPT_CSS),
    'every den breaks, including the first — the heading gets a sheet to itself');

  // Both breaks are PAPER only. Named inside @media print and nowhere else, or the screen grows
  // page breaks it has no use for.
  const printBlocks = SCRIPT_CSS.match(/@media print \{[\s\S]*?\n  \}/g) || [];
  const inPrint = printBlocks.join('\n');
  eq((inPrint.match(/\.pv-yearcost\b/g) || []).length,
    (SCRIPT_CSS.match(/\.pv-yearcost\b/g) || []).length,
    'the year cost card is styled outside the print block');
});

test('a den folds at its tier table, and the ladder note comes off the paper', () => {
  // Owner ask, 2026-09-09, printing it a second time. A den asks two questions — what the year
  // costs line by line, then what each rung takes off the total — and the table answering the
  // second was breaking across the fold, heading on one sheet and half its rungs on the next.
  const cost = /function parentFamilyCost\(pv\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(cost, 'parentFamilyCost() not found');
  ok(/class="eyebrow pv-den-drops"/.test(cost[0]),
    'the tier table heading carries no page-break hook');
  const drops = /\.pv-den-drops \{([^}]*)\}/.exec(SCRIPT_CSS);
  ok(drops, '.pv-den-drops has no print rule');
  ok(/break-before: page/.test(drops[1]) && /page-break-before: always/.test(drops[1]),
    'the tier table break is not stated in both spellings');
  // The heading has to travel WITH the table it opens, or the fold just moves down one line.
  ok(/h1, h2, h3, \.eyebrow \{ break-after: avoid; \}/.test(SCRIPT_CSS),
    'an eyebrow can be stranded at the foot of a page again');

  // The ladder's closing note took a whole sheet to say three lines, and the one thing it points
  // at — what a rung is worth in money, under your den — begins on the next page regardless.
  const lad = /function parentTierLadder\(pv\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(lad, 'parentTierLadder() not found');
  ok(/class="small muted pv-ladder-note"/.test(lad[0]), 'the ladder note carries no print hook');
  ok(/\.pv-ladder-note \{ display: none !important; \}/.test(SCRIPT_CSS), 'the ladder note still prints');
  // PAPER only, like the pack goal bar. A parent reading online still gets the note, so the class
  // is named exactly once in the stylesheet and that one mention is the print rule.
  eq((SCRIPT_CSS.match(/\.pv-ladder-note\b/g) || []).length, 1,
    'the ladder note is styled somewhere besides the one print rule — check it still shows on screen');
});

test('the year cost lead-in comes off the paper, and the first den opens the sheet', () => {
  // Owner ask, 2026-09-11. The card already breaks to a sheet of its own, and the lead-in was
  // spending the top of that sheet restating the heading — so the first den, which is deliberately
  // NOT broken to a page of its own, began a third of the way down. Off the paper, the first den
  // is the first thing under the title, which is what the sheet is handed out to show.
  const cost = /function parentFamilyCost\(pv\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(cost, 'parentFamilyCost() not found');
  ok(/class="small muted pv-yearcost-note"/.test(cost[0]),
    'the year cost lead-in carries no print hook');
  ok(/\.pv-yearcost-note \{ display: none !important; \}/.test(SCRIPT_CSS),
    'the year cost lead-in still prints');
  // The LEADER card opens with the same sentence and must NOT have been hooked: it is a different
  // card on a screen that never prints through this path, and hiding it there would be answering a
  // parent's print question with a change to a leader's screen.
  const leader = /function renderFamilyYearCost\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(leader, 'renderFamilyYearCost() not found');
  ok(!/pv-yearcost-note/.test(leader[0]), 'the leader card picked up the parent print hook');
  // PAPER only, like the ladder note and the pack goal bar before it: named exactly once in the
  // stylesheet, and that one mention is the print rule.
  eq((SCRIPT_CSS.match(/\.pv-yearcost-note\b/g) || []).length, 1,
    'the year cost lead-in is styled somewhere besides the one print rule — check it still shows on screen');
});

test('each line of the family bill names the rung that buys it', () => {
  // Owner ask, 2026-09-07: show the items broken down by the tier level that covers them. The
  // card already said what a family pays and what the year drops to at each rung; what it never
  // said is WHICH lines a rung takes off, which is the difference between "sell $175" and
  // "sell $175 and camp is paid for".
  const ctx = vm.createContext({ state: { rewardTiers: { tiers: [] } } });
  vm.runInContext(
    `${slice('scoutsInDens')}
     ${slice('linePerHead')}
     ${slice('linePerFamily')}
     ${slice('lineThroughPack')}
     ${slice('lineFamilyFunded')}
     ${slice('arrOf')}
     ${slice('sortedTiers')}
     ${slice('coverKeyOf')}
     ${slice('allTierCoverKeys')}
     ${slice('familyYearCostForDen')}
     ${slice('DENS')}
     function activeScouts() { return SCOUTS; }
     function allBudgetLines() { return LINES.map(function (l) { return { kind: 'activity', line: l, key: l.name }; }); }
     function lineDens(l) { return l.dens || []; }
     function salesForCommission(c) { return c * 3; }`, ctx);
  ctx.SCOUTS = [{ id: 'a', den: 'Wolf' }];
  ctx.LINES = [
    { name: 'Registration', basis: 'per-head', scoutRateCents: 8500, fundedBy: 'families', dens: [] },
    { name: 'Blue & Gold', basis: 'per-head', scoutRateCents: 4200, adultRateCents: 5600, fundedBy: 'families', dens: [] },
    { name: 'Spring camp', basis: 'per-head', scoutRateCents: 3500, fundedBy: 'families', dens: [] }
  ];
  ctx.state.rewardTiers.tiers = [
    { id: 'a', name: 'a', thresholdCents: 15000, covers: ['Registration'] },
    { id: 'b', name: 'b', thresholdCents: 33000, covers: ['Blue & Gold'] },
    { id: 'c', name: 'c', thresholdCents: 41500, covers: ['Blue & Gold#adult'] }
  ];
  const w = vm.runInContext("familyYearCostForDen('Wolf')", ctx);
  const by = Object.fromEntries(w.lines.map((l) => [l.name, l]));
  eq(by['Registration'].coverScoutStep, 0, 'registration is bought by the lowest rung');
  // The two halves of one line, bought by two different rungs. Grouping the line under "b" and
  // calling it covered would quote a family a year that is $56 short.
  eq([by['Blue & Gold'].coverScoutStep, by['Blue & Gold'].coverAdultStep], [1, 2],
    'the banquet’s scout and adult shares are not attributed to their own rungs');
  eq([by['Spring camp'].coverScoutStep, by['Spring camp'].coverAdultStep], [-1, -1],
    'a line no rung names was attributed to one anyway');
  // A share that costs nothing has no rung to name, however many tiers point at it.
  eq(by['Registration'].coverAdultStep, -1, 'a line with no adult price was given an adult rung');
  // The cover keys are an internal handle; a parent payload must never carry them.
  ok(!('keyScout' in by['Registration']) && !('keyAdult' in by['Registration']),
    'the internal cover keys survived onto the published line');

  // A rung the ladder HIDES (no name, no reward) is not in steps, and its money is banked into
  // the next rung that is shown — so its lines have to land there too, or the items and the
  // figure they explain end up in different places.
  ctx.state.rewardTiers.tiers.splice(1, 0, { id: 'x', thresholdCents: 20000, covers: ['Spring camp'] });
  const w2 = vm.runInContext("familyYearCostForDen('Wolf')", ctx);
  eq(w2.steps.map((s) => s.name), ['a', 'b', 'c'], 'an unnamed rung was listed');
  eq(w2.lines.find((l) => l.name === 'Spring camp').coverScoutStep, 1,
    'a hidden rung’s line did not carry forward to the rung its money did');
});

test('the family bill is grouped rung by rung, with the floor last', () => {
  const ctx = sandbox(['esc', 'fmt', 'parentStepName', 'parentCostLine', 'parentCostLines']);
  const steps = [
    { name: 'Bronze', salesCents: 45000, afterCents: 16300 },
    { name: 'Gold', salesCents: 99000, afterCents: 6500 }
  ];
  const html = ctx.parentCostLines({
    steps: steps,
    lines: [
      { name: 'Registration', scoutCents: 8500, coverScoutStep: 0, coverAdultStep: -1 },
      { name: 'Blue & Gold', scoutCents: 4200, adultCents: 5600, coverScoutStep: 1, coverAdultStep: 1 },
      { name: 'Spring camp', scoutCents: 3500, coverScoutStep: -1, coverAdultStep: -1 }
    ]
  });
  const heads = [...html.matchAll(/<p class="eyebrow"[^>]*>(.*?)<\/p>/g)].map((m) => m[1]);
  eq(heads.length, 3, 'a group is missing a heading');
  ok(/^Comes off at Bronze/.test(heads[0]) && /^Comes off at Gold/.test(heads[1]),
    'the rungs are not listed lowest first');
  // The floor LAST, and named. It is what the year costs however much a scout sells, and it is
  // the figure a family has to be able to afford before they agree to any of this.
  ok(/whatever your scout sells/.test(heads[2]), 'the lines no rung buys are not called out, or not last');
  ok(html.indexOf('Registration') < html.indexOf('Blue &amp; Gold')
    && html.indexOf('Blue &amp; Gold') < html.indexOf('Spring camp'),
    'a line is not under its own rung');
  ok(/sell \$450\.00/.test(heads[0]), 'a rung heading does not say what it takes to reach it');

  // HALF A LINE. A banquet whose adult share is bought two rungs up sits with the scout share —
  // and says so, at the point the heading claims it is covered.
  const split = ctx.parentCostLines({
    steps: steps,
    lines: [{ name: 'Blue & Gold', scoutCents: 4200, adultCents: 5600, coverScoutStep: 0, coverAdultStep: 1 }]
  });
  ok(/the adult’s cost comes off at Gold/.test(split), 'a line half-bought by a higher rung says nothing about it');
  const stuck = ctx.parentCostLines({
    steps: steps,
    lines: [{ name: 'Blue & Gold', scoutCents: 4200, adultCents: 5600, coverScoutStep: 0, coverAdultStep: -1 }]
  });
  ok(/you still pay the adult’s share/.test(stuck),
    'a line whose adult half no rung ever buys reads as fully covered');

  // A line that prices no scout at all has no scout share to group on, and sits with the rung
  // that buys the adult rather than falling to the floor beside the things nobody covers.
  const adultOnly = ctx.parentCostLines({
    steps: steps,
    lines: [
      { name: 'Banquet seat', scoutCents: 0, adultCents: 5600, coverScoutStep: -1, coverAdultStep: 1 },
      { name: 'Spring camp', scoutCents: 3500, coverScoutStep: -1, coverAdultStep: -1 }
    ]
  });
  ok(adultOnly.indexOf('Banquet seat') < adultOnly.indexOf('Spring camp'),
    'an adult-only line fell to the floor instead of sitting with the rung that buys it');

  // A payload published before the step indices existed. Every line falls to the floor, and one
  // group prints no heading — the flat list it has always been, not a list under a heading
  // announcing that nothing is covered.
  const old = ctx.parentCostLines({
    steps: steps,
    lines: [{ name: 'Registration', scoutCents: 8500 }, { name: 'Spring camp', scoutCents: 3500 }]
  });
  ok(!/eyebrow/.test(old), 'an old payload is given a heading claiming nothing is covered');
  ok(/Registration/.test(old) && /Spring camp/.test(old), 'an old payload lost its lines');
  eq(ctx.parentCostLines({ lines: [] }), '', 'a den with no priced lines still drew an empty list');
});

/* ================================================================
   Wave 22 — storefront weather
   ================================================================ */
const WX = sandbox([
  'WX_LIMITS', 'WEATHER_TAGS', 'WX_DEFAULT_LOC', 'arrOf', 'pad2', 'todayISO',
  'weatherBucket', 'hhmmMinutes', 'blockHours', 'weatherComparisonFrom', 'weatherCaveat',
  'numOrNull', 'daysFromToday', 'weatherUrl', 'readWeatherPayload'
]);

test('rain beats temperature, which is the whole point of the bucket rule', () => {
  // A wet 88° day behaves like rain at a folding table, not like heat. Filing it under 'hot'
  // would put the pack's two worst kinds of day in one bucket and average them into nothing.
  eq(WX.weatherBucket(88, 0.4), 'rain', 'a hot wet day');
  eq(WX.weatherBucket(45, 0.4), 'rain', 'a cold wet day');
  eq(WX.weatherBucket(88, 0), 'hot', 'a hot dry day');
  eq(WX.weatherBucket(55, 0), 'cold', 'a cold dry day');
  eq(WX.weatherBucket(70, 0), 'mild', 'a mild dry day');
  // Exactly on each threshold: hot and wet are inclusive, cold is strictly below.
  eq(WX.weatherBucket(WX.WX_LIMITS.hotF, 0), 'hot', 'exactly the hot threshold');
  eq(WX.weatherBucket(WX.WX_LIMITS.coldF, 0), 'mild', 'exactly the cold threshold is not cold');
  eq(WX.weatherBucket(70, WX.WX_LIMITS.wetIn), 'rain', 'exactly the wet threshold');
  // A trace of rain is not a rainy day — that is what the threshold is for.
  eq(WX.weatherBucket(70, 0.01), 'mild', 'a trace of rain');
});

test('no temperature means no tag — never a guess that reads like a measurement', () => {
  eq(WX.weatherBucket(null, 0), '', 'dry but no temperature');
  eq(WX.weatherBucket(undefined, undefined), '', 'nothing at all');
  eq(WX.weatherBucket(NaN, 0), '', 'NaN is not a temperature');
  // Rain is still decidable without a temperature, because the precipitation alone settles it.
  eq(WX.weatherBucket(null, 0.5), 'rain', 'wet with no temperature');
});

test('a block with no usable times is worth zero hours, not a default length', () => {
  eq(WX.blockHours({ start: '10:00', end: '12:00' }), 2, 'a two-hour block');
  eq(WX.blockHours({ start: '10:00', end: '11:30' }), 1.5, 'a ninety-minute block');
  eq(WX.blockHours({ start: '', end: '12:00' }), 0, 'no start');
  eq(WX.blockHours({ start: '12:00', end: '10:00' }), 0, 'end before start');
  eq(WX.blockHours({ start: '10:00', end: '10:00' }), 0, 'zero length');
  eq(WX.blockHours({ start: '9 AM', end: '11 AM' }), 0, 'free text is not canonical HH:MM');
  eq(WX.blockHours(null), 0, 'no block at all');
  eq(WX.hhmmMinutes('25:00'), null, 'hour out of range');
  eq(WX.hhmmMinutes('10:75'), null, 'minute out of range');
});

// A season shaped to make the point the feature exists for: the rainy DAY took more money in
// total than the mild one, because it was staffed twice as heavily for twice as long.
// Per scout-hour it is the worse day by a distance, and only the rate can see that.
function wxSeason() {
  return [
    {
      id: 'a', name: 'Kroger', date: '2025-10-04', weather: { tag: 'rain', source: 'auto' },
      blocks: [
        { start: '09:00', end: '13:00', assignments: [{ scoutId: 's1' }, { scoutId: 's2' }, { scoutId: 's3' }], salesCents: 24000, donationsCents: 0 },
        { start: '13:00', end: '17:00', assignments: [{ scoutId: 's1' }, { scoutId: 's2' }, { scoutId: 's3' }], salesCents: 24000, donationsCents: 0 }
      ]
    },
    {
      id: 'b', name: 'Publix', date: '2025-10-11', weather: { tag: 'mild', source: 'auto' },
      blocks: [
        { start: '10:00', end: '12:00', assignments: [{ scoutId: 's1' }], salesCents: 18000, donationsCents: 2000 }
      ]
    }
  ];
}

test('the comparison is per scout-hour, so a big day worked by a crowd cannot fake a good one', () => {
  const wx = WX.weatherComparisonFrom(wxSeason());
  const rain = wx.rows.filter((r) => r.id === 'rain')[0];
  const mild = wx.rows.filter((r) => r.id === 'mild')[0];
  // The raw totals say rain won: $480 against $200.
  eq(rain.combined, 48000, 'rain combined');
  eq(mild.combined, 20000, 'mild combined');
  // The rate says the opposite, which is the number that is actually comparable.
  eq(rain.scoutHours, 24, 'rain scout-hours');   // 2 blocks x 4h x 3 scouts
  eq(mild.scoutHours, 2, 'mild scout-hours');    // 1 block x 2h x 1 scout
  eq(rain.perScoutHour, 2000, 'rain per scout-hour');   // $20.00
  eq(mild.perScoutHour, 10000, 'mild per scout-hour');  // $100.00
  ok(mild.perScoutHour > rain.perScoutHour,
    'the rate failed to see past the bigger day being the more heavily staffed one');
});

test('the unit is a shift, not a date', () => {
  const wx = WX.weatherComparisonFrom(wxSeason());
  const rain = wx.rows.filter((r) => r.id === 'rain')[0];
  eq(rain.dates, 1, 'one storefront date');
  eq(rain.shifts, 2, 'but two shifts, which is the sample the rate is built on');
});

test('an unworked shift is a scheduling fact, not evidence about the weather', () => {
  const sfs = wxSeason();
  // A third block nobody staffed and that took nothing must not drag the rain rate down.
  sfs[0].blocks.push({ start: '17:00', end: '19:00', assignments: [], salesCents: 0, donationsCents: 0 });
  const rain = WX.weatherComparisonFrom(sfs).rows.filter((r) => r.id === 'rain')[0];
  eq(rain.shifts, 2, 'an empty block was counted as a shift');
  eq(rain.perScoutHour, 2000, 'an empty block moved the rate');
});

test('money with no times or nobody assigned counts in the total but not in the rate', () => {
  const sfs = wxSeason();
  sfs[1].blocks.push({ start: '', end: '', assignments: [{ scoutId: 's9' }], salesCents: 5000, donationsCents: 0 });
  const wx = WX.weatherComparisonFrom(sfs);
  const mild = wx.rows.filter((r) => r.id === 'mild')[0];
  eq(mild.combined, 25000, 'the money was dropped from the total');
  eq(mild.scoutHours, 2, 'an untimed block invented scout-hours');
  eq(wx.thin, 1, 'the untimed block was not reported as thin');
  // Reported rather than silently shrinking the denominator — that is the whole reason
  // `thin` exists, so the screen can say so.
  ok(wx.thin > 0, 'a shift left out of the rate has to be visible somewhere');
});

test('storefronts with no weather are left out and counted, not quietly folded in', () => {
  const sfs = wxSeason();
  sfs.push({ id: 'c', name: 'Ace', date: '2025-10-18', blocks: [{ start: '10:00', end: '12:00', assignments: [{ scoutId: 's1' }], salesCents: 9900, donationsCents: 0 }] });
  sfs.push({ id: 'd', name: 'Bad', date: '2025-10-25', weather: { tag: 'blizzard' }, blocks: [] });
  const wx = WX.weatherComparisonFrom(sfs);
  eq(wx.untagged, 2, 'an untagged and a junk-tagged storefront');
  eq(wx.rows.length, 2, 'a junk tag opened a bucket of its own');
  eq(wx.rows.reduce((n, r) => n + r.combined, 0), 68000, 'untagged money leaked into a bucket');
});

test('a bucket with no rate reports null, never $0.00', () => {
  // $0.00 per scout-hour reads as a catastrophic day rather than as an absent measurement.
  const wx = WX.weatherComparisonFrom([
    { id: 'a', name: 'K', date: '2025-10-04', weather: { tag: 'cold' },
      blocks: [{ start: '', end: '', assignments: [], salesCents: 1000, donationsCents: 0 }] }
  ]);
  eq(wx.rows.length, 1, 'the bucket');
  eq(wx.rows[0].perScoutHour, null, 'a rate was computed against no scout-hours');
});

test('empty and junk input produce no rows rather than throwing', () => {
  eq(WX.weatherComparisonFrom([]).rows, [], 'empty season');
  eq(WX.weatherComparisonFrom(null).rows, [], 'no season at all');
  eq(WX.weatherComparisonFrom([null, 'x', { id: 'a' }]).rows, [], 'junk entries');
});

test('the caveat gets less hedged as the sample grows, and never claims more than it has', () => {
  const one = WX.weatherCaveat({ rows: [{ shifts: 4, perScoutHour: 100 }], untagged: 0, thin: 0 });
  ok(/nothing to compare/.test(one), 'a single kind of day was presented as a comparison');
  const few = WX.weatherCaveat({ rows: [{ shifts: 3, perScoutHour: 1 }, { shifts: 3, perScoutHour: 1 }], untagged: 0, thin: 0 });
  ok(/too few/.test(few), '6 shifts did not read as too few');
  const some = WX.weatherCaveat({ rows: [{ shifts: 10, perScoutHour: 1 }, { shifts: 10, perScoutHour: 1 }], untagged: 0, thin: 0 });
  ok(/Suggestive/.test(some), '20 shifts did not read as suggestive');
  const many = WX.weatherCaveat({ rows: [{ shifts: 20, perScoutHour: 1 }, { shifts: 20, perScoutHour: 1 }], untagged: 0, thin: 0 });
  ok(/worth reading/.test(many), '40 shifts did not read as worth a look');
  // Even at the top of the scale it still says staffing explains more than weather.
  ok(/staffing/.test(many), 'the largest sample dropped the confound it exists to flag');
});

test('the response is read by date, never by index', () => {
  // Both endpoints can return a wider window than asked for. Taking row 0 would be wrong
  // silently, and by a plausible-looking amount.
  const payload = {
    daily: {
      time: ['2025-10-02', '2025-10-03', '2025-10-04'],
      temperature_2m_max: [95, 40, 72],
      precipitation_sum: [0, 0, 0]
    }
  };
  const w = WX.readWeatherPayload(payload, '2025-10-04');
  eq(w.highF, 72, 'the wrong day was read out of the response');
  eq(w.tag, 'mild', 'the wrong day set the tag');
  eq(WX.readWeatherPayload(payload, '2025-10-09'), null, 'a day that is not in the response');
  eq(WX.readWeatherPayload({}, '2025-10-04'), null, 'an empty response');
  eq(WX.readWeatherPayload({ daily: { time: ['2025-10-04'], temperature_2m_max: [null], precipitation_sum: [null] } }, '2025-10-04'),
    null, 'a response whose numbers are null must not become a tag');
});

test('the endpoint is chosen by how far back the date is', () => {
  const iso = (delta) => {
    const d = new Date(Date.parse(WX.todayISO() + 'T12:00:00Z') + delta * 86400000);
    return d.toISOString().slice(0, 10);
  };
  ok(/api\.open-meteo\.com\/v1\/forecast/.test(WX.weatherUrl(iso(-7), 34, -83)), 'last week should use the forecast endpoint');
  ok(/api\.open-meteo\.com\/v1\/forecast/.test(WX.weatherUrl(iso(7), 34, -83)), 'next week is a forecast');
  ok(/archive-api\.open-meteo\.com/.test(WX.weatherUrl(iso(-400), 34, -83)), 'last season should use the archive');
  ok(/archive-api\.open-meteo\.com/.test(WX.weatherUrl('not-a-date', 34, -83)), 'an unparseable date falls to the archive');
  eq(WX.daysFromToday(WX.todayISO()), 0, 'today is zero days from today');
  // Fahrenheit and inches are requested explicitly — the thresholds in WX_LIMITS are in those
  // units, and the API's default is Celsius and millimetres.
  const u = WX.weatherUrl(iso(-7), 34.2979, -83.8241);
  ok(/temperature_unit=fahrenheit/.test(u), 'temperature was not requested in Fahrenheit');
  ok(/precipitation_unit=inch/.test(u), 'precipitation was not requested in inches');
  ok(u.indexOf('start_date=' + iso(-7)) !== -1 && u.indexOf('end_date=' + iso(-7)) !== -1, 'the day was not pinned');
});

test('normalizeState drops a junk weather tag rather than keeping half of it', () => {
  const ctx = sandbox(NORMALIZE_FNS);
  const out = ctx.normalizeState({
    version: 1, packName: 'Pack 569', scouts: [],
    storefronts: [
      { id: 'a', name: 'K', date: '2025-10-04', blocks: [], weather: { tag: 'blizzard', highF: 70 } },
      { id: 'b', name: 'P', date: '2025-10-11', blocks: [], weather: { tag: 'rain', highF: '72', precipIn: 0.4, source: 'nonsense' } },
      { id: 'c', name: 'A', date: '2025-10-18', blocks: [], weather: 'sunny' },
      { id: 'd', name: 'B', date: '2025-10-25', blocks: [], weather: { tag: 'cold', highF: 50, precipIn: 0, source: 'manual' } }
    ]
  });
  eq(out.storefronts[0].weather, undefined, 'a junk tag survived normalisation');
  eq(out.storefronts[2].weather, undefined, 'a non-object weather survived');
  // A recognised tag is kept, its numbers coerced, and an unknown source lands on 'auto' —
  // never on 'manual', which is the flag that protects a record from being overwritten.
  eq(out.storefronts[1].weather, { tag: 'rain', highF: null, precipIn: 0.4, source: 'auto' }, 'the coerced record');
  eq(out.storefronts[3].weather.source, 'manual', 'a real manual record lost its protection');
});

test('normalizeState defaults the weather lookup location and refuses an impossible one', () => {
  const ctx = sandbox(NORMALIZE_FNS);
  const bare = ctx.normalizeState({ version: 1, packName: 'Pack 569', scouts: [] });
  eq(bare.packLoc.lat, ctx.WX_DEFAULT_LOC.lat, 'an existing pack record got no location');
  eq(bare.packLoc.label, ctx.WX_DEFAULT_LOC.label, 'no label');
  // Out of range falls back rather than being kept: a 340° longitude returns weather for
  // somewhere real, just not here, which is the worst failure this feature can have.
  const bad = ctx.normalizeState({ version: 1, packName: 'Pack 569', scouts: [], packLoc: { label: '  ', lat: 91, lon: 340 } });
  eq(bad.packLoc.lat, ctx.WX_DEFAULT_LOC.lat, 'an impossible latitude was kept');
  eq(bad.packLoc.lon, ctx.WX_DEFAULT_LOC.lon, 'an impossible longitude was kept');
  eq(bad.packLoc.label, ctx.WX_DEFAULT_LOC.label, 'a blank label was kept');
  const good = ctx.normalizeState({ version: 1, packName: 'Pack 569', scouts: [], packLoc: { label: 'Athens, GA', lat: 33.96, lon: -83.38 } });
  eq(good.packLoc, { label: 'Athens, GA', lat: 33.96, lon: -83.38 }, 'a real location was not kept as given');
});

test('a manual tag is never overwritten by a lookup', () => {
  // The rule lives in weatherLookupable, and it is what makes the manual control worth having.
  const src = SCRIPT.slice(SCRIPT.indexOf('function weatherLookupable('));
  const body = src.slice(0, src.indexOf('\n  }'));
  ok(/source === 'manual'/.test(body) && /return false/.test(body),
    'weatherLookupable no longer exempts a hand-recorded tag');
});

/* ================================================================
   Trail's End Scout List import — owner, 2026-09-16, handing over the pack's exported scout
   list: "can you help me import this so we can add the missing scouts to our site".

   The Scout List is the only Trail's End export that is a ROSTER rather than a ledger: it names
   every registered scout, including the ones who have not sold a thing. Every other import only
   ever learns about a child who has money or a shift against them.
   ================================================================ */

const rosterCtx = (() => {
  const ctx = vm.createContext({});
  vm.runInContext(['detectReport', 'mapRosterReport', 'teNameKey', 'toCents', 'teParseCsv'].map(slice).join('\n'), ctx);
  return ctx;
})();
// The real export's shape, with invented families (the repo is public), trimmed to the rows that
// carry a decision. Note La’Tavia's CURLY apostrophe: that is what Trail's End actually sends,
// and it is why teNameKey exists.
const ROSTER_ROWS = [
  ['Name', 'ID', 'SF Hours Worked', 'SF Hours Claimed', 'Sales', 'Goal', 'Email Address', 'Phone Number'],
  ['Lorenzo Kessler', 'TE00AA11', '13.5', '23.5', '1127', '2001', 'parent1@example.com', '4045550101'],
  ['Beckett Hartley', 'TE00BB22', '10', '18', '595.5', '1500', 'parent2@example.com', '4045550102'],
  ['La’Tavia Pruitt', 'TE00CC33', '0', '0', '0', '0', 'parent3@example.com', '4045550103'],
  ['Tobin Castellano', 'TE00DD44', '0', '0', '70', '350', 'parent4@example.com', '4045550104'],
];

test('the Scout List is sniffed as its own report, and never steals one of the other three', () => {
  eq(rosterCtx.detectReport(ROSTER_ROWS).type, 'roster', 'the scout list is not recognised');
  // Name + Goal is the signature: 'Goal' appears on no other export, and 'Name' alone would
  // claim almost any spreadsheet. Drop Goal and it must stop matching rather than guess.
  const noGoal = ROSTER_ROWS.map((r) => r.filter((_, i) => i !== 5));
  eq(rosterCtx.detectReport(noGoal), null, "'Name' alone is being sniffed as a scout list");
  // The three ledgers are checked FIRST, so a file carrying both signatures keeps its old
  // destination. This is the guard that makes adding a fourth report safe.
  eq(rosterCtx.detectReport([['Date', 'Site Name', 'Shift', 'Name', 'Goal']]).type, 'shifts',
    'the scout list stole a shift report');
  eq(rosterCtx.detectReport([['Order Number', 'Scout', 'Sale Type', 'Name', 'Goal']]).type, 'sales',
    'the scout list stole a sales report');
  eq(rosterCtx.detectReport([['Product', 'Quantity', 'Transaction Type', 'Name', 'Goal']]).type, 'inventory',
    'the scout list stole an inventory report');
});

test('a trimmed export still maps — contact columns are optional, the roster is not', () => {
  // A pack that strips the families' email and phone before sharing the file still gets its
  // roster. Only Name and Goal are required, so everything else has to survive being absent.
  const trimmed = [['Name', 'Goal'], ['Lorenzo Kessler', '2001'], ['Tobin Castellano', '350']];
  const det = rosterCtx.detectReport(trimmed);
  eq(det.type, 'roster', 'a trimmed export is no longer recognised');
  const mapped = rosterCtx.mapRosterReport(trimmed, det);
  eq(mapped.scouts.map((s) => s.name), ['Lorenzo Kessler', 'Tobin Castellano'], 'names were lost');
  eq(mapped.scouts.map((s) => s.email + '|' + s.phone + '|' + s.teId), ['||', '||'],
    'absent columns did not come back as empty strings');
  eq(mapped.scouts[0].salesCents, 0, 'a missing Sales column did not read as zero');
});

test('the scout list maps to cents, hours and alphabetical order', () => {
  const mapped = rosterCtx.mapRosterReport(ROSTER_ROWS, rosterCtx.detectReport(ROSTER_ROWS));
  eq(mapped.count, 4, 'the wrong number of scouts came off the report');
  // Alphabetical, because this is read as a roster. The report's own order is sales descending,
  // which is the standings — a different question, already answered on Popcorn · Standings.
  eq(mapped.scouts.map((s) => s.name),
    ['Beckett Hartley', 'La’Tavia Pruitt', 'Lorenzo Kessler', 'Tobin Castellano'],
    'the scout list is not in roster order');
  const lorenzo = mapped.scouts.find((s) => s.name === 'Lorenzo Kessler');
  eq(lorenzo.salesCents, 112700, '1127 dollars did not become cents');
  eq(lorenzo.goalCents, 200100, 'the goal did not become cents');
  // Half hours are real: 13.5 worked against 23.5 claimed is the disagreement a leader is
  // looking at this column to find, so it must not be rounded away.
  eq([lorenzo.hoursWorked, lorenzo.hoursClaimed], [13.5, 23.5], 'half hours were rounded');
  const beckett = mapped.scouts.find((s) => s.name === 'Beckett Hartley');
  eq(beckett.salesCents, 59550, '595.50 did not survive as cents');
  eq(beckett.teId, 'TE00BB22', "the Trail's End id was dropped");
});

test('a Totals row is not a scout, and a re-registered child is not two scouts', () => {
  // Some exports end with a labelled totals line. A roster row for it would create a scout
  // named Totals, who then appears on the attendance sheet.
  const rows = ROSTER_ROWS.concat([['Totals', '', '13.5', '23.5', '1792.5', '3851', '', '']]);
  const mapped = rosterCtx.mapRosterReport(rows, rosterCtx.detectReport(rows));
  eq(mapped.count, 4, 'a Totals row was imported as a scout');
  // Trail's End can list the same child twice when a family re-registers mid-season.
  const dupe = ROSTER_ROWS.concat([['lorenzo  KESSLER', 'TE00AA11', '0', '0', '0', '0', '', '']]);
  eq(rosterCtx.mapRosterReport(dupe, rosterCtx.detectReport(dupe)).count, 4,
    'the same child was mapped twice');
});

test('teNameKey folds the curly apostrophe Trail’s End actually exports', () => {
  // The bug this exists to stop: the export sends U+2019, a leader typed U+0027, and the
  // importer read La’Tavia as a scout the pack did not have — then added her a second time.
  // A duplicate scout splits her attendance, her advancement and her share of a block.
  const k = rosterCtx.teNameKey;
  eq(k('La’Tavia Pruitt'), k("La'Tavia Pruitt"), 'the curly apostrophe is not folded');
  eq(k('  La’TAVIA   Pruitt '), k("la'tavia pruitt"), 'case and spacing are not folded');
  // Narrow on purpose. "Ashby-Vance" and "Ashby Vance" being one child is a GUESS, and a
  // wrong merge (two children treated as one) is worse than the duplicate it would prevent.
  ok(k('Desmond Ashby-Vance') !== k('Desmond Ashby Vance'), 'hyphens are being folded away');
  eq(k(null), '', 'a null name did not key as empty');
});

test('every importer asks "do we have this child?" the same way', () => {
  // teNameKey is the single seam. If one importer keeps its own trim+lowercase, that importer
  // is the one that quietly creates the duplicate — so none of them may.
  for (const fn of ['teMatchScouts', 'teAddMissingScouts', 'teMatchShiftScout']) {
    const src = slice(fn);
    ok(/teNameKey\(/.test(src), `${fn} does not use the shared roster key`);
    ok(!/\.trim\(\)\.toLowerCase\(\)/.test(codeOnly(src)),
      `${fn} still has its own name normalisation, which can drift from teNameKey`);
  }
});

test('the Scout List import writes NAMES, and says what it drops', () => {
  // The sales figure on this report is ONE blended number that already includes storefront
  // credit. Storefront money lives on the app's storefront blocks, split across the scouts
  // assigned to them, so writing this in as well would count every storefront dollar twice.
  const commit = slice('teCommitRosterImport');
  ok(/teAddMissingScouts\(/.test(commit), 'the commit does not go through the shared roster seam');
  const code = codeOnly(commit);
  for (const field of ['salesCents', 'goalCents', 'email', 'phone', 'hoursWorked', 'hoursClaimed']) {
    ok(!new RegExp(field).test(code), `the roster commit writes ${field}, which has nowhere to live`);
  }
  ok(!/state\.entries/.test(code), 'the roster import writes sales entries — that double-counts storefront');
  // Only the new ones are passed in at all, so an existing scout cannot be touched.
  ok(/it\.isNew/.test(commit), 'the commit hands teAddMissingScouts scouts it already has');
  // And the preview has to SAY so: a leader handing over a file holding twenty families'
  // phone numbers should not have to guess which of it was kept.
  const preview = /if \(o\.report === 'roster'\) \{[\s\S]*?\n      return q;/.exec(SCRIPT);
  ok(preview, "the roster preview branch of renderTePreview() not found");
  ok(/Deliberately <strong>not<\/strong> imported/.test(preview[0]),
    'the preview does not list what it drops');
  ok(/stored for none/.test(preview[0]), 'the preview does not say the contact details are not stored');
});

test('an import never removes, archives or re-dens a scout it was not asked about', () => {
  // The shift import lets the report win, because a shift is a slot on a schedule. A scout is
  // a child: absent from Trail's End means not registered (or registered under a different
  // spelling), not gone from the pack. Archiving on that inference would take them off the
  // attendance sheet and the advancement grid.
  const build = slice('teBuildRosterPreview');
  ok(/missing/.test(build), 'roster-only scouts are not even surfaced');
  const code = codeOnly(build + slice('teCommitRosterImport'));
  ok(!/archived\s*=/.test(code), 'the roster import assigns archived');
  ok(!/\.den\s*=/.test(code), 'the roster import assigns a den');
  ok(!/splice|filter\(function \(x\) \{ return x\.id/.test(code), 'the roster import removes scouts');
  // An archived scout who is back on this year's Trail's End list is surfaced, NOT un-archived:
  // archiving is how a leader records that somebody left, and undoing it would overrule them.
  ok(/wasArchived/.test(build), 'an archived scout still on the list is not surfaced');
});

/* ================================================================
   The Part C security rules (SETUP.md) and the client that has to live under them. The rules
   are pasted into the Firebase console by hand, so nothing but this file notices when the two
   drift apart — and a drift here fails as "nobody can sign up", or worse, silently succeeds.
   ================================================================ */

const SETUP = readFileSync(join(ROOT, 'SETUP.md'), 'utf8');
const RULES = (() => {
  const at = SETUP.indexOf('## Part C');
  const m = /```\n(rules_version[\s\S]*?)```/.exec(SETUP.slice(at));
  return m ? m[1] : '';
})();
// The object literal a function hands to setDoc(<ref>, { … }), as a list of its keys.
function setDocKeys(src, refPattern) {
  const out = [];
  const re = new RegExp('setDoc\\(' + refPattern + '[^{]*\\{([^}]*)\\}', 'g');
  let m;
  while ((m = re.exec(src))) out.push(m[1].split('\n').map((l) => (/^\s*(\w+):/.exec(l) || [])[1]).filter(Boolean));
  return out;
}

test('the Part C rules carry the 2026-09-27 update, dated, at the top of Part C', () => {
  ok(RULES, 'no rules block found under Part C');
  const partC = SETUP.slice(SETUP.indexOf('## Part C'));
  ok(/^> \*\*Rules updated 2026-09-27 — paste this whole block into the Firebase console\.\*\*/m
    .test(partC.slice(0, 600)), 'the dated "paste this whole block" note is not at the top of Part C');
});

test('nobody joins the Members card with nothing but the pack id', () => {
  const create = /allow create: if signedIn\(\) && request\.auth\.uid == uid[\s\S]*?;\n/.exec(RULES);
  ok(create, 'members create rule not found');
  const c = create[0];
  ok(/viaGoogle\(\)/.test(c) && /sign_in_provider == 'google\.com'/.test(RULES), 'member create does not require Google');
  ok(/ownEmail\(\)/.test(c) && /data\.email == request\.auth\.token\.email/.test(RULES), 'member email is not pinned to the token');
  // The bare branch this replaced: `request.resource.data.role == 'pending' ||`. Every 'pending'
  // must sit inside the join-code conjunction.
  const pendings = c.split("role == 'pending'").length - 1;
  eq(pendings, 1, "'pending' appears in more than one create branch");
  ok(/role == 'pending'\s*&& exists\(joinPath\(\)\)\s*&& joinCfg\(\)\.open == true\s*&& request\.resource\.data\.joinCode == joinCfg\(\)\.code/
    .test(c), 'a pending create is not bound to the open link and its current code');
  ok(/invitedRole\(\) in \['editor', 'viewer', 'parent'\]\s*&& request\.resource\.data\.role == invitedRole\(\)/.test(c),
    'the invite branch does not pin the role to a non-admin invite');
});

test('the member doc the client writes is exactly what the rules accept', () => {
  const allowed = /function memberKeysOk\(\) \{\s*return request\.resource\.data\.keys\(\)\.hasOnly\(\[([^\]]*)\]\)/.exec(RULES);
  ok(allowed, 'memberKeysOk() not found in the rules');
  const keys = allowed[1].match(/'(\w+)'/g).map((k) => k.slice(1, -1));
  const writes = setDocKeys(slice('ensureMyMemberDoc') + slice('joinCreateMemberDoc'), 'ref');
  // The owner/invitee create, the owner's self-heal, and the sign-up-link create.
  eq(writes.length, 3, 'expected the member create, the owner heal and the join create');
  writes.forEach((w) => w.forEach((k) => ok(keys.indexOf(k) !== -1, `the client writes "${k}", which the rules refuse`)));
  // The join path has to SEND the code, or the rule has nothing to check.
  ok(writes.some((w) => w.indexOf('joinCode') !== -1), 'the join path no longer writes joinCode');
  // Invites the same way.
  const inv = /request\.resource\.data\.keys\(\)\.hasOnly\(\['role', 'email', 'invitedBy', 'invitedAt'\]\)/.test(RULES);
  ok(inv, 'the invite field list changed in the rules');
  const invWrite = setDocKeys(slice('createInvite'), "fs\\.doc\\(sync\\.db, 'packs', sync\\.docId, 'invites', email\\)");
  eq(invWrite, [['role', 'email', 'invitedBy', 'invitedAt']], 'createInvite writes different fields from the rules');
});

test('the client never writes a bare pending member, and never reads the join code first', () => {
  const ens = codeOnly(slice('ensureMyMemberDoc'));
  // (Reading an existing doc's role with a 'pending' default is fine — WRITING one is not.)
  ok(!/role = 'pending'|write\('pending'\)|\|\| 'pending'\)|role: 'pending'/.test(ens),
    'ensureMyMemberDoc writes (or falls back to) pending outside the sign-up link');
  ok(/joinRejected = 'nolink'/.test(ens), 'a signer with no link and no invite is not sent to the ask-a-leader gate');
  const join = codeOnly(slice('joinCreateMemberDoc'));
  ok(!/getDoc/.test(join) && !/'public'/.test(join), 'the join path reads public/join, which only leaders may read');
});

test('invites are admin-made and consumed only by their own invitee', () => {
  const inv = /match \/invites\/\{email\} \{([\s\S]*?)\n      \}/.exec(RULES);
  ok(inv, 'invites match not found');
  ok(/allow read: if isAdmin\(\) \|\| \(signedIn\(\) && myEmailKey\(\) == email\);/.test(inv[1]), 'invite read');
  ok(/allow create, update: if isAdmin\(\)\s*&& request\.resource\.data\.role in \['editor', 'viewer', 'parent'\]/.test(inv[1]),
    'invite create/update is not admin-only with a non-admin role');
  ok(/allow delete: if isAdmin\(\) \|\| \(signedIn\(\) && myEmailKey\(\) == email\);/.test(inv[1]), 'invite delete');
  // The client looks invites up lowercased; the rule must too, or a capitalised Google email
  // can never consume the invite an admin typed.
  ok(/request\.auth\.token\.email\.lower\(\)/.test(RULES), 'the rules match invites on the raw token email');
  ok(/inviteEmailKey\(user\.email\)/.test(slice('ensureMyMemberDoc')), 'the client no longer lowercases the invite key');
});

test('who may read what: roster, join code and parent view', () => {
  ok(/function isLeader\(\) \{ return myRole\(\) in \['admin', 'editor', 'viewer'\]; \}/.test(RULES), 'isLeader()');
  ok(/match \/members\/\{uid\} \{[\s\S]*?allow read: if isLeader\(\) \|\| \(signedIn\(\) && request\.auth\.uid == uid\);/.test(RULES),
    'members read is wider than leaders + self');
  ok(/match \/public\/join \{\s*allow read:  if isLeader\(\);\s*allow write: if isAdmin\(\);/.test(RULES), 'public/join');
  ok(/match \/public\/view \{\s*allow read:  if myRole\(\) in \['admin', 'editor', 'viewer', 'parent'\];\s*allow write: if myRole\(\) in \['admin', 'editor'\];/
    .test(RULES), 'public/view');
  // Overlapping matches OR together: a /public/{d} wildcard would hand pending users the join code.
  ok(!/match \/public\/\{/.test(RULES), 'a /public/{…} wildcard is back, and it ORs over public/join');
  // …and the client has to live with a roster it can't read: non-leaders watch their own doc.
  const sub = codeOnly(slice('applyMembersSubscription'));
  ok(/LEADER_ROLES\.indexOf\(sync\.myRole\)/.test(sub) && /fs\.doc\(sync\.db, 'packs', sync\.docId, 'members', uid\)/.test(sub),
    'parents and pending users still subscribe to the whole members collection');
  eq(/var LEADER_ROLES = (\[[^\]]*\])/.exec(SCRIPT)[1], "['admin', 'editor', 'viewer']", 'LEADER_ROLES drifted from isLeader()');
  ok(!/fs\.collection\(db, 'packs', docId, 'members'\)/.test(slice('startAccounts')),
    'startAccounts subscribes the whole roster for every role again');
});

test('the parent-view banner names every key the view publishes', () => {
  const src = slice('buildParentView');
  const banner = /\/\/ PUBLISHED — the whole list;([\s\S]*?)\/\/ DELIBERATELY EXCLUDED/.exec(SCRIPT);
  ok(banner, 'the PUBLISHED list above buildParentView is gone');
  const keys = [...new Set([...src.matchAll(/out\.(\w+) = /g)].map((m) => m[1]))];
  const named = { standings: /standings/, goals: /goal bar/, derby: /derby winners/, tiers: /reward tiers/,
    tierLadder: /tierLadder/, familyCost: /familyCost/, camping: /camping trips/, contact: /`contact`.*who to ask/ };
  keys.forEach((k) => {
    ok(named[k], `buildParentView publishes out.${k}, which this test (and the banner) doesn't know about`);
    ok(named[k].test(banner[1]), `out.${k} is published but not listed in the banner`);
  });
  ok(/salesCents/.test(banner[1]) && /cost line/.test(banner[1]), 'tier sales targets / camping cost are not declared');
  // SETUP.md tells the pack the same thing.
  ok(/including each\s+trip's cost line/.test(SETUP) && /sales that reach each tier/.test(SETUP) &&
    /what the year is planned to cost/.test(SETUP) && /"who to ask" line/.test(SETUP),
    'SETUP.md does not list what the parent view really publishes');
  ok(!/activity costs or expenses/.test(SETUP), 'SETUP.md still claims activity costs are never published');
  // S5 (2026-09-28): every per-row field, both ways, named in the banner AND in SETUP.md.
  const bpv = codeOnly(src);
  const rowLit = /var row = \{([\s\S]*?)\n          \};/.exec(bpv);
  ok(rowLit, 'the standings row literal was not found');
  const rowKeys = [...rowLit[1].matchAll(/^\s*(\w+):/gm)].map((m) => m[1]);
  const offLit = /if \(withAmounts\) return row;[\s\S]*?return \{([\s\S]*?)\};/.exec(bpv);
  ok(offLit, 'the amounts-off row was not found');
  const offKeys = [...offLit[1].matchAll(/(\w+):/g)].map((m) => m[1]);
  ok(rowKeys.length >= 12 && offKeys.length >= 7, 'the row key scan found too little');
  rowKeys.forEach((k) => {
    ok(new RegExp('\\b' + k + '\\b').test(banner[1]) || k === 'name' || k === 'den', `row field ${k} is not in the banner`);
    ok(k === 'name' || k === 'den' || new RegExp('`' + k + '`').test(SETUP), `row field ${k} is not in SETUP.md`);
  });
  const offPara = /With "Show dollar amounts and rank" off, a row is ONLY([\s\S]*?)are removed\./.exec(banner[1]);
  ok(offPara, 'the banner does not say what an amounts-off row is');
  offKeys.forEach((k) => ok(new RegExp('\\b' + k + '\\b').test(offPara[1]), `amounts-off field ${k} is not in the banner`));
  rowKeys.filter((k) => offKeys.indexOf(k) === -1).forEach((k) =>
    ok(offPara[1].indexOf(k) !== -1,
      `the banner does not say amounts-off removes ${k}`));
  ok(/With \*\*Show dollar amounts and rank\*\* off, a row is only/.test(SETUP), 'SETUP.md does not say what amounts-off leaves');
});

test('single-pack mode never signs in anonymously, which is why SETUP says to turn it off', () => {
  ok(/src\.kind === 'pass'\s*\?\s*mods\.auth\.signInAnonymously/.test(SCRIPT), 'anonymous sign-in is no longer passphrase-only');
  ok(/if \(src\.kind === 'fixed' && current && current\.isAnonymous\) current = null;/.test(SCRIPT),
    'a stale anonymous session is reused in single-pack mode');
  ok(/turn it \*\*off\*\*/.test(SETUP), 'SETUP.md does not tell a single-pack admin to turn Anonymous off');
});

/* ================================================================
   Wave 3 (2026-09-27) — the security reviewer's follow-ups on the Part C rules commit.
   ================================================================ */

test('the owner restores their admin role by rewriting their doc whole, and a refusal is not a trap', () => {
  const ens = codeOnly(slice('ensureMyMemberDoc'));
  ok(!/updateDoc/.test(ens), 'the owner heal is an updateDoc again — a junked doc makes the rules refuse it');
  const heal = /if \(sync\.ownerUid === uid && cur !== 'admin'\) \{([\s\S]*?)\n        \}/.exec(ens);
  ok(heal, 'the owner heal branch was not found');
  const keys = setDocKeys(heal[1], 'ref');
  eq(keys, [['role', 'name', 'email', 'addedAt']], 'the heal writes other keys than the rules accept');
  ok(/role: 'admin'/.test(heal[1]), 'the heal does not write admin');
  // Refused → carry on as the doc's role; never throw into handleAccountsError (setup screen).
  ok(/\.then\(function \(\) \{ return 'admin'; \}, function \(\) \{ return cur; \}\)/.test(heal[1]),
    'a refused heal is thrown, which handleAccountsError reads as "rules not published"');
});

// A fake Firestore that records what it was asked to do. Enough of the modular API for the
// member-management functions, which only ever build refs and write them.
const FAKE_FS = `
  var calls = [];
  var fakeFs = {
    doc: function () { return { path: Array.prototype.slice.call(arguments, 1).join('/') }; },
    collection: function () { return { path: Array.prototype.slice.call(arguments, 1).join('/') }; },
    deleteDoc: function (r) { calls.push('delete ' + r.path); return Promise.resolve(); },
    setDoc: function (r) { calls.push('set ' + r.path); return Promise.resolve(); },
    updateDoc: function (r) { calls.push('update ' + r.path); return Promise.resolve(); },
    serverTimestamp: function () { return 'TS'; }
  };`;

function removeMemberCtx() {
  const ctx = vm.createContext({});
  vm.runInContext(FAKE_FS + `
    var committed = 0;
    function commit() { committed += 1; }
    function isAdmin() { return true; }
    function isLastAdmin() { return false; }
    function accountsToast() {}
    function showToast() {}
    var sync = { mods: { fs: fakeFs }, db: 'db', docId: 'P',
      members: [{ uid: 'u1', email: ' Pat@Example.com ', role: 'editor' }, { uid: 'u2', email: 'x@example.com', role: 'admin' }] };
    var state = {
      scouts: [{ id: 's1', parentUids: ['u1', 'u9'] }, { id: 's2', parentUids: [] }],
      leaders: [{ id: 'l1', uid: 'u1' }, { id: 'l2', uid: 'u2' }, { id: 'l3', uid: '' }]
    };
    ${slice('arrOf')}
    ${slice('inviteEmailKey')}
    ${slice('removeMember')}`, ctx);
  return ctx;
}

test('removing a member also removes their leftover invite and their leader link', () => {
  const ctx = removeMemberCtx();
  vm.runInContext("removeMember('u1')", ctx);
  const calls = vm.runInContext('calls', ctx);
  ok(calls.indexOf('delete packs/P/members/u1') !== -1, 'the member doc was not deleted');
  // Keyed exactly as createInvite keys it (trimmed, lowercased), or the delete misses.
  ok(calls.indexOf('delete packs/P/invites/pat@example.com') !== -1,
    'an invite under the removed member’s email survives them, and would let them straight back in');
  eq(vm.runInContext('state.scouts[0].parentUids', ctx), ['u9'], 'their scout link survived');
  eq(vm.runInContext('state.leaders.map(function (l) { return l.uid; })', ctx), ['', 'u2', ''],
    'the leader record still claims the removed account (or another link was touched)');
  eq(vm.runInContext('state.leaders.length', ctx), 3, 'the leader record itself was removed');
  eq(vm.runInContext('committed', ctx), 1, 'the unlinking was not committed');
  // A member with no email has no invite to delete — and must not try to delete invites/''.
  const ctx2 = removeMemberCtx();
  vm.runInContext("sync.members[0].email = ''; removeMember('u1')", ctx2);
  ok(!vm.runInContext('calls', ctx2).some((c) => /invites/.test(c)), 'an emailless member triggered an invite delete');
});

test('B9: removing someone who came in on a still-open sign-up link offers New code', () => {
  const run = (joinCode, open) => {
    const ctx = removeMemberCtx();
    vm.runInContext(`
      var toasts = [], rotated = [];
      showToast = function (m, o) { toasts.push({ m: m, o: o || null }); };
      function joinOpen() { return ${open}; }
      function newJoinCode() { return 'NEWCODE'; }
      function writeJoinConfig(p) { rotated.push(p.code); }
      sync.members[0].joinCode = ${JSON.stringify(joinCode)};
      removeMember('u1');`, ctx);
    return ctx;
  };
  const ctx = run('abc123', true);
  const t = vm.runInContext('toasts', ctx);
  ok(t.length === 1 && t[0].o && t[0].o.actionLabel === 'New code', 'no New code toast after removing a link arrival');
  ok(/still open/.test(t[0].m), 'the toast does not say why');
  eq(vm.runInContext('rotated', ctx), [], 'the code rotated without the admin asking');
  vm.runInContext('toasts[0].o.onAction()', ctx);
  eq(vm.runInContext('rotated', ctx), ['NEWCODE'], 'the toast button does not mint a new code');
  eq(vm.runInContext('toasts.length', run('abc123', false)), 0, 'a closed link still nags');
  eq(vm.runInContext('toasts.length', run('', true)), 0, 'an invited (non-link) member still nags');
});

function roleSubCtx(over) {
  const ctx = vm.createContext({});
  vm.runInContext(`
    var KEY = 'pack-popcorn-ledger-v1';
    var removed = [], stopped = [], rendered = 0, subscribed = [];
    var localStorage = { removeItem: function (k) { removed.push(k); } };
    function freshState() { return { fresh: true }; }
    function stopDocFeed() { stopped.push('doc'); }
    function stopParentFeed() { stopped.push('parent'); }
    function subscribeDoc() { subscribed.push('doc'); }
    function subscribeParentView() { subscribed.push('parent'); }
    function feedForRole(r) { return r === 'parent' ? 'parent' : r === 'pending' ? 'none' : 'doc'; }
    function render() { rendered += 1; }
    var inForce = ${over.inForce !== false};
    function accountsInForce() { return inForce; }
    var state = { money: 'the pack record' };
    var sync = { session: 1, feed: 'doc', unsub: function () {}, parentView: { x: 1 }, mode: 'online',
      membersScope: ${JSON.stringify(over.scope === undefined ? 'all' : over.scope)},
      membersFromServer: ${over.server !== false}, joinRejected: null,
      user: { uid: 'me' }, ownerUid: ${JSON.stringify(over.owner || 'someone-else')},
      pushTimer: 'push', dirty: true };
    var parentViewTimer = 'pv', cleared = [];
    function clearTimeout(t) { cleared.push(t); }
    var healCalls = 0, HEAL = null;
    function ensureMyMemberDoc() { healCalls += 1; return HEAL; }
    ${slice('stopLocalWrites')}
    ${slice('applyRoleSubscription')}`, ctx);
  return ctx;
}

test('a member removed mid-session loses the pack from this device, not just the next read', () => {
  const ctx = roleSubCtx({});
  vm.runInContext('applyRoleSubscription(null, 1)', ctx);
  eq(vm.runInContext('removed', ctx), ['pack-popcorn-ledger-v1'], 'the cached pack record was left in localStorage');
  eq(vm.runInContext('state', ctx), { fresh: true }, 'the pack record is still in memory');
  eq(vm.runInContext('stopped.sort()', ctx), ['doc', 'parent'], 'a feed was left running');
  eq(vm.runInContext('sync.parentView', ctx), null, 'the parent view was left on screen');
  eq(vm.runInContext('sync.joinRejected', ctx), 'removed', 'no gate tells them why the page emptied');
  eq(vm.runInContext('subscribed', ctx), [], 'something was subscribed for a removed member');
  // B4 (2026-09): nothing this device was about to write survives the wipe.
  eq(vm.runInContext('[cleared.sort(), sync.pushTimer, sync.dirty, parentViewTimer]', ctx), [['push', 'pv'], null, false, null],
    'a pending pack push or parent-view publish survived the removal');
  // Every other null is "we don't know yet" and leaves the feed exactly alone.
  for (const [what, over] of [['legacy rules / no accounts', { inForce: false }],
    ['no members watch of our own yet', { scope: null }],
    ['a cache-only snapshot', { server: false }]]) {
    const c = roleSubCtx(over);
    vm.runInContext('applyRoleSubscription(null, 1)', c);
    eq(vm.runInContext('[removed.length, stopped.length, state.money || null]', c), [0, 0, 'the pack record'],
      `${what}: a null role wiped the device`);
  }
  // The gate it lands on says so.
  ok(/if \(sync\.joinRejected === 'removed'\)/.test(slice('renderJoinClosed')), 'no screen for a removed member');
});

test('nothing is published to parents before the join config has said whether standings are on', () => {
  const ctx = vm.createContext({});
  vm.runInContext(FAKE_FS + `
    var built = 0;
    function buildParentView() { built += 1; return { events: [] }; }
    function accountsInForce() { return true; }
    function canEdit() { return true; }
    function fixedSyncBlocked() { return false; }
    function clearTimeout() {}
    var parentViewTimer = null, parentViewFingerprint = null;
    var state = {};
    var sync = { mods: { fs: fakeFs }, db: 'db', docId: 'P', joinLoaded: false };
    ${slice('writeParentView')}`, ctx);
  vm.runInContext('writeParentView()', ctx);
  eq(vm.runInContext('[built, calls.length]', ctx), [0, 0], 'the parent view was built and written before the join config loaded');
  vm.runInContext('sync.joinLoaded = true; writeParentView()', ctx);
  eq(vm.runInContext('calls', ctx), ['set packs/P/public/view'], 'once loaded, the view is not written');
});

test('the join config loads for every leader, and both of its answers release the parent view', () => {
  function joinCtx(role) {
    const ctx = vm.createContext({});
    vm.runInContext(FAKE_FS + `
      var onNext = null, onErr = null, scheduled = 0, opts = null;
      // (ref, onNext, onErr) or (ref, options, onNext, onErr), as the SDK takes either.
      fakeFs.onSnapshot = function (r, a, b, c) {
        if (typeof a === 'function') { onNext = a; onErr = b; } else { opts = a; onNext = b; onErr = c; }
        return function () {};
      };
      function accountsInForce() { return true; }
      function scheduleParentViewRefresh() { scheduled += 1; }
      function render() {}
      var LEADER_ROLES = ['admin', 'editor', 'viewer'];
      var sync = { session: 1, mods: { fs: fakeFs }, db: 'db', docId: 'P', myRole: '${role}',
        joinUnsub: null, joinUnavailable: false, joinLoaded: false, joinCfg: null };
      ${slice('applyJoinSubscription')}
      applyJoinSubscription(1);`, ctx);
    return ctx;
  }
  for (const role of ['admin', 'editor', 'viewer']) {
    ok(vm.runInContext('!!onNext', joinCtx(role)), `a ${role} does not load the join config`);
  }
  // Parents and pending users are refused it by the rules, and never need it.
  for (const role of ['parent', 'pending']) {
    ok(vm.runInContext('!onNext', joinCtx(role)), `a ${role} asks for the join config the rules refuse them`);
  }
  const a = joinCtx('editor');
  // B2 (2026-09): a CACHED answer fills joinCfg but does not open the gate; the server's does.
  ok(vm.runInContext('!!(opts && opts.includeMetadataChanges)', a), 'without includeMetadataChanges the server answer may never arrive');
  vm.runInContext("onNext({ metadata: { fromCache: true }, exists: function () { return true; }, data: function () { return { showStandings: true }; } })", a);
  eq(vm.runInContext('[sync.joinLoaded, scheduled, sync.joinCfg.showStandings]', a), [false, 0, true], 'a cached join config released the parent view');
  vm.runInContext("onNext({ metadata: { fromCache: false }, exists: function () { return true; }, data: function () { return { showStandings: false }; } })", a);
  eq(vm.runInContext('[sync.joinLoaded, scheduled]', a), [true, 1], 'the snapshot does not release the deferred write');
  const b = joinCtx('editor');
  vm.runInContext('onErr({ code: "permission-denied" })', b);
  eq(vm.runInContext('[sync.joinLoaded, scheduled]', b), [true, 1], 'a denied read stalls the parent view for good');
  // And a new session starts over.
  ok(/sync\.joinLoaded = false;/.test(slice('clearAccountsRuntime')), 'clearAccountsRuntime keeps the last pack’s joinLoaded');
});

test('the rules take only a verified Google account as a member, and a short name', () => {
  ok(/function viaGoogle\(\) \{\s*return request\.auth\.token\.firebase\.sign_in_provider == 'google\.com'\s*&& request\.auth\.token\.email_verified == true;\s*\}/
    .test(RULES), 'viaGoogle() does not require a verified email');
  ok(/function isMember\(\) \{ return signedIn\(\) && viaGoogle\(\) && exists\(memberPath\(\)\); \}/.test(RULES),
    'isMember() counts a member doc from any sign-in');
  ok(/function memberKeysOk\(\) \{[\s\S]*?&& request\.resource\.data\.name is string\s*&& request\.resource\.data\.name\.size\(\) <= 120;/
    .test(RULES), 'memberKeysOk() does not bound the name');
  // …and the client never writes a name the rules would refuse.
  eq(/var MEMBER_NAME_MAX = (\d+);/.exec(SCRIPT)[1], '120', 'the client clips names to a different length than the rules allow');
  const src = slice('ensureMyMemberDoc') + slice('joinCreateMemberDoc');
  eq((src.match(/name: memberName\(user\)/g) || []).length, 3, 'a member write takes the raw displayName');
  ok(!/name: user\.displayName/.test(src), 'a member write takes the raw displayName');
  const ctx = sandbox(['MEMBER_NAME_MAX', 'memberName']);
  eq(ctx.memberName({ displayName: 'x'.repeat(300) }).length, 120, 'a long name is not clipped');
  eq(ctx.memberName({}), '', 'a missing name is not an empty string');
});

test('SETUP tells an upgrading pack the deploy order and the clean-up after publishing', () => {
  ok(/deploy this version of `index\.html` first, reload it once, then publish these rules/.test(SETUP),
    'the deploy order is missing');
  ok(/The new page works under the old rules too; an old page does not work under the new rules/.test(SETUP),
    'SETUP does not say which way round the versions are compatible');
  ok(/remove any \*\*admin, editor or viewer\*\* you didn't approve/.test(SETUP), 'cleanup: unapproved leaders');
  ok(/any with \*\*no\s+email\*\*/.test(SETUP), 'cleanup: unrecognised / emailless pending');
  ok(/delete any invite whose `role` is `admin`/.test(SETUP), 'cleanup: admin invites');
  ok(/Authentication → Users:\*\* delete the \*\*anonymous\*\* users/.test(SETUP), 'cleanup: anonymous users');
});

test('the export and document types that carry children’s names stay out of the public repo', () => {
  const gi = readFileSync(join(ROOT, '.gitignore'), 'utf8').split('\n').map((l) => l.trim());
  for (const pat of ['*.pdf', '*.csv', '*.xlsx', '*.xls', '*.tsv', '*.xlsm', '*.ods', '*.doc', '*.docx',
    '*.pages', '*.numbers', '*.png', '*.jpg', '*.jpeg', '*.heic', '*.heif', '*.webp', '*.mov', '*.mp4',
    // B1 (2026-09): the app's own backups and snapshots are .json and carry the whole record.
    '*.json', '*.ics', '*.zip', '*.vcf', '*.rtf', '*.eml',
    // 2026-09-28: pasted rosters as .txt, GIFs, binary Excel.
    '*.txt', '*.gif', '*.xlsb']) {
    // Case-blind (2026-09-28): a phone saves IMG_0412.JPG, and *.jpg does not match it.
    const blind = pat.replace(/[a-z]/g, (c) => '[' + c.toUpperCase() + c + ']');
    ok(gi.indexOf(blind) !== -1, `.gitignore does not ignore ${pat} in every case (${blind})`);
  }
  // And git agrees: the app's own download names really are ignored.
  try {
    const out = execSync('git check-ignore popcorn-backup.json pack-year-2026-snapshot.json pack-569.ics',
      { cwd: ROOT, encoding: 'utf8' });
    eq(out.split('\n').filter(Boolean).length, 3, 'git check-ignore');
    const upper = execSync('git check-ignore --no-index IMG_0412.JPG REPORT.PDF Roster.Txt SCOUTS.CSV',
      { cwd: ROOT, encoding: 'utf8' });
    eq(upper.split('\n').filter(Boolean).length, 4, 'git check-ignore, upper-case names');
    // And nothing the site actually serves is caught by it.
    eq(execSync('git ls-files -ci --exclude-standard', { cwd: ROOT, encoding: 'utf8' }).trim(), '',
      'a tracked file matches .gitignore');
  } catch (e) {
    if (e.status === 1) throw new Error('git does not ignore the app’s backup/snapshot/calendar downloads');
    if (e.status !== 128) throw e;   // 128: not a git checkout — the pattern scan above is the check
  }
});

/* ================================================================
   Wave 3 (2026-09-27) — what leaves the app. Every outbound builder is run against one roster
   with surnames nobody would type by accident, and none of them may carry one out.
   ================================================================ */

const PRIV_SCOUTS = [
  { id: 's1', name: 'Ada Quenneville', den: 'Wolf', renewalMonth: '2026-01' },
  { id: 's2', name: 'Beckett Hartwellington', den: 'Bear', renewalMonth: '2026-09' },
  { id: 's3', name: 'Beckett Zimmerfield', den: 'Tiger', renewalMonth: '' }
];
const SURNAMES = ['Quenneville', 'Hartwellington', 'Zimmerfield'];
const LEADER_SURNAME = 'Oyelaran-Pettigrew';
function noSurname(text, what) {
  SURNAMES.concat([LEADER_SURNAME]).forEach((n) => ok(String(text).indexOf(n) === -1, `${what} carries the surname ${n}`));
}
const PRIV_STATE = `
  var state = {
    packName: 'Pack 569', rev: 3,
    scouts: ${JSON.stringify(PRIV_SCOUTS)},
    leaders: [{ id: 'l1', name: 'Morgan ${LEADER_SURNAME}', jobs: [] }],
    fundraisers: [{ id: 'f1', name: 'Wreaths', goalCents: 50000 }],
    storefronts: [{ id: 'sf1', name: 'Kroger', date: '2026-10-03', blocks: [
      { id: 'b1', label: 'Block 1', start: '10:00', end: '12:00',
        assignments: [{ scoutId: 's1', weight: 1 }, { scoutId: 's2', weight: 1 }] },
      { id: 'b2', label: 'Block 2', start: '12:00', end: '14:00',
        assignments: [{ scoutId: 's3', weight: 1 }] }] }],
    events: [
      { id: 'e1', kind: 'pack', date: '2026-10-06', time: '18:30', note: 'Gym' },
      { id: 'e2', kind: 'activity', name: 'Fall campout', date: '2026-10-17', time: '09:00', location: 'Fort Yargo', dens: [] }
    ],
    entries: [],
    budget: { programYear: 2026, activities: [{ id: 'a1', eventId: 'e2', planned: 124000 }], expenses: [] },
    derby: { name: '', date: '' }
  };
  function getScout(id) { for (var i = 0; i < state.scouts.length; i++) if (state.scouts[i].id === id) return state.scouts[i]; return null; }
  function fmtDate(d) { return String(d); }
`;

test('calendar-only publishes the calendar and the cost of a year, and no child’s name anywhere', () => {
  const ctx = vm.createContext({});
  vm.runInContext(PRIV_STATE + `
    function standingsEnabled() { return true; }
    function campingTrips() { return []; }
    function familyYearCost() {
      return [{ den: 'Wolf', scout: 18000, adult: 4000, sibling: 0, expected: 22000, covered: 9600,
        steps: [{ name: 'Dues covered', salesCents: 17500, coveredCents: 9600, afterCents: 12400 }],
        lines: [{ name: 'Youth registration', scout: 9600, adult: 0, sibling: 0, direct: true, payee: 'Council',
          perFamily: false, coverScoutStep: 0, coverAdultStep: -1 }] }];
    }
    ${['shortNames', 'publicNameMap', 'buildParentView', 'blocksInDayOrder', 'fmtTimeRange', 'fmtClock',
       'eventIsMeeting', 'eventLabel', 'denListLabel', 'eventDens', 'programYearStartISO',
       'programYearEndISO', 'cleanContactLine', 'parentContactLine', 'amountsEnabled'].map(slice).join('\n')}
    var sync = {};`, ctx);
  const pv = vm.runInContext('buildParentView(state, { showStandings: false })', ctx);
  const text = JSON.stringify(pv);
  noSurname(text, 'the calendar-only view');
  ['Ada', 'Beckett'].forEach((n) => ok(text.indexOf(n) === -1, `the calendar-only view names ${n}`));
  ['standings', 'goals', 'derby', 'tiers', 'tierLadder'].forEach((k) =>
    ok(!(k in pv), `calendar-only publishes ${k}`));
  const sf = pv.events.find((e) => e.kind === 'storefront');
  eq(sf.shifts, [{ when: '10:00 AM–12:00 PM' }, { when: '12:00 PM–2:00 PM' }],
    'the shift windows are not published bare');
  // J2 — the year's cost is the pack's plan, with nobody in it, and a calendar-only link is
  // exactly who asks for it.
  ok(Array.isArray(pv.familyCost) && pv.familyCost[0].den === 'Wolf', 'calendar-only drops what a year costs');
  const gate = BPV().indexOf('if (!withStandings) return out;');
  ok(BPV().indexOf('var familyCost = familyYearCost()') < gate, 'the year’s cost is behind the standings gate');
});

test('calendar-only puts the cost card on the Schedule tab, and the toggle says what it hides', () => {
  const sched = slice('renderParentSchedule');
  ok(/if \(!Array\.isArray\(pv\.standings\)\) h \+= parentFamilyCost\(pv\);/.test(sched),
    'with no Standings tab the cost card is shown nowhere');
  // Only there when there is no Standings tab — the Standings page is also the printed handout.
  ok(/h \+= parentFamilyCost\(pv\);/.test(slice('renderParentStandings')), 'the Standings page lost its cost card');
  const label = /Untick for a calendar-only page:([\s\S]*?)<\/p>/.exec(SCRIPT);
  ok(label, 'the calendar-only explanation under the toggle is gone');
  // B7 (2026-09): it is the reward-tier BOARD that goes; the year's cost keeps what each tier
  // takes off it, and the toggle has to say both or it reads as though every tier figure vanishes.
  ['scout names', 'storefront shifts', 'sales totals', 'goal bar', 'the reward-tier board', 'derby winners',
    'the year’s cost', '(with what each tier takes off it) and the camping pages still show', 'monthly digest'
  ].forEach((w) => ok(label[1].indexOf(w) !== -1, `the toggle text does not mention ${w}`));
  ok(!/the reward tiers and derby/.test(label[1]), 'the toggle still says every reward tier is hidden');
  // The docs say the same thing.
  ok(/names on storefront\s+shifts are then left out/.test(SETUP), 'SETUP does not say shift names go in calendar-only mode');
  ok(/\*\*what a year costs\*\* each den moves onto it/.test(SETUP), 'SETUP does not say where the cost card goes');
  const banner = /\/\/ PUBLISHED — the whole list;([\s\S]*?)\/\/ DELIBERATELY EXCLUDED/.exec(SCRIPT)[1];
  ok(banner.indexOf('familyCost') < banner.indexOf('with standings on'), 'the banner still files familyCost under standings');
  ok(banner.indexOf('FIRST NAMES') > banner.indexOf('with standings on'), 'the banner still says shift names always publish');
});

test('the copied standings name children the way the parent view does, and nobody’s cash', () => {
  const ctx = vm.createContext({});
  vm.runInContext(PRIV_STATE + `
    function computePackTotals() {
      return { sales: 60000, don: 9000, combined: 69000, commission: null, pct: null, ratesSplit: false,
        teGoal: 0, stretch: 0, cashGoal: 0, cashKept: 0, cashDon: 7000, teEligible: 62000 };
    }
    var T = { s1: { sales: 30000, onD: 1000, storeD: 4321, wagonD: 0 }, s2: { sales: 20000, onD: 1000, storeD: 1234, wagonD: 1445 },
      s3: { sales: 10000, onD: 0, storeD: 0, wagonD: 0 } };
    function computeScoutTotals() { return T; }
    function visibleScoutRows() { return state.scouts.map(function (s) { return { id: s.id, name: s.name, den: s.den, t: T[s.id] }; }); }
    function rankBy(rows, f) { return rows.slice().sort(function (a, b) { return f(b) - f(a); }); }
    function eligibleOf(r) { return r.t.sales + r.t.onD; }
    function cashDonOf(r) { return r.t.storeD + r.t.wagonD; }
    function sortedTiers() { return []; }
    function tierEarnedMap() { return {}; }
    function earnedTierFor() { return null; }
    function cashCreditTotals() { return { on: true }; }
    function cashScoutCredit(c) { return c; }
    function standingsEnabled() { return true; }
    function amountsEnabled() { return true; }
    function sharingSettingsKnown() { return true; }
    ${['shortNames', 'publicNameMap', 'salesOnlyTierMap', 'summaryText', 'fmt'].map(slice).join('\n')}`, ctx);
  const txt = vm.runInContext('summaryText()', ctx);
  noSurname(txt, 'the copied standings');
  ok(/1\. Ada — /.test(txt) && /Beckett H\./.test(txt) && /Beckett Z\./.test(txt),
    'the copied standings do not use the public names (an initial only to split the two Becketts)');
  // Per-family cash: $43.21, $26.79 — neither may appear. The pack's cash total does.
  ok(txt.indexOf('43.21') === -1 && txt.indexOf('26.79') === -1, 'a family’s cash donation is in the copied standings');
  ok(/Cash donations \(storefront tables and wagons, all scouts\): \$70\.00/.test(txt), 'the pack’s cash total is gone');
  // The printed twin of it, by scan: no raw roster name, and no per-scout cash table.
  const sheet = /if \(o\.kind === 'summary'\) \{[\s\S]*?\n      return h;/.exec(SCRIPT)[0];
  ok(!/esc\(r\.name\)/.test(sheet), 'the printed summary names children in full');
  ok(/esc\(sumPub\[r\.id\] \|\| ''\)/.test(sheet), 'the printed summary does not use the public names');
  ok(!/cashDonOf\(r\)|r\.t\.storeD|r\.t\.wagonD/.test(sheet), 'the printed summary lists each family’s cash');
});

test('the storefront day sheet names children by their public names', () => {
  const ctx = vm.createContext({});
  vm.runInContext(PRIV_STATE + ['shortNames', 'publicNameMap', 'DAY_SHEET_KEEP', 'daySheetText', 'blocksInDayOrder',
    'blockScoutNames', 'fmtTimeRange', 'fmtClock'].map(slice).join('\n'), ctx);
  const txt = vm.runInContext('daySheetText(state.storefronts[0])', ctx);
  noSurname(txt, 'the day sheet');
  // It lists which children are at which store when: a leaders' copy, and it says so on the paper.
  ok(txt.split('\n').indexOf('Leaders\u2019 copy \u2014 keep with the shift leader, do not post') !== -1,
    'the copied day sheet does not say it is a leaders\u2019 copy');
  ok(/esc\(DAY_SHEET_KEEP\)/.test(slice('renderDaySheet')), 'the printed day sheet does not say it is a leaders\u2019 copy');
  ok(!/taped to a table/.test(SCRIPT), 'a comment still describes taping the day sheet up outside a store');
  ok(/Scouts: Ada, Beckett H\./.test(txt) && /Scouts: Beckett Z\./.test(txt), 'the day sheet does not use the public names');
  // Leaders' own screen still shows the roster as typed.
  eq(vm.runInContext('blockScoutNames(state.storefronts[0].blocks[0])', ctx), ['Ada Quenneville', 'Beckett Hartwellington'],
    'the leaders’ shift list lost its full names');
});

function digestCtx() {
  const ctx = vm.createContext({});
  vm.runInContext(PRIV_STATE + `
    function monthLabel(mk) { return 'October 2026'; }
    function rsvpSummary() { return { any: false, yes: 0, adults: 0 }; }
    function dayEventsForMonth() { return { 3: [{ type: 'storefront', sf: state.storefronts[0] }], 6: [{ type: 'event', ev: state.events[0] }] }; }
    function pad2(n) { return (n < 10 ? '0' : '') + n; }
    function firstLine(s) { return String(s).split('\\n')[0]; }
    function slotMonthKey() { return ''; }
    function computePackTotals() { return { combined: 69000, teGoal: 100000, teBarGoal: 100000, teEligible: 62000 }; }
    var STANDINGS = true;
    function standingsEnabled() { return STANDINGS; }
    function fundraiserTotals() { return { total: 31500 }; }
    function leaderStatus(l) { return [{ label: 'YPT expired' }]; }
    function leaderJobLabels() { return 'Cubmaster'; }
    function monthKey(d) { return String(d).slice(0, 7); }
    function todayISO() { return '2026-09-27'; }
    function renewalDue(m) { return !!m && m <= '2026-09'; }
    function activeScouts() { return state.scouts; }
    ${['monthlyDigest', 'monthlyDigestLeaders', 'eventIsMeeting', 'eventLabel', 'fmtClock', 'fmtTimeRange', 'fmt'].map(slice).join('\n')}`, ctx);
  return ctx;
}

test('the monthly digest a leader pastes to families carries nothing for leaders only', () => {
  const ctx = digestCtx();
  const parents = vm.runInContext("monthlyDigest('2026-10')", ctx);
  noSurname(parents, 'the families’ digest');
  ok(parents.indexOf('ACTION NEEDED') === -1, 'renewals and leader training are in the families’ digest');
  ok(parents.indexOf('OTHER FUNDRAISERS') === -1 && parents.indexOf('Wreaths') === -1,
    'other fundraisers are in the families’ digest');
  ok(parents.indexOf('YPT') === -1 && parents.indexOf('Morgan') === -1, 'a leader’s training is in the families’ digest');
  ok(/EVENTS THIS MONTH/.test(parents) && /Pack meeting/.test(parents), 'the families’ digest lost the calendar');
  // The leaders' copy is where it all went, labelled so nobody pastes it by mistake.
  const leaders = vm.runInContext("monthlyDigestLeaders('2026-10')", ctx);
  ok(/LEADERS ONLY, not for families/.test(leaders), 'the leaders’ copy is not labelled');
  ok(/ACTION NEEDED/.test(leaders) && /Ada Quenneville: registration renewal overdue/.test(leaders) &&
    /Morgan/.test(leaders) && /OTHER FUNDRAISERS/.test(leaders), 'the leaders’ copy dropped something');
  // Nothing to chase → no second box at all.
  vm.runInContext('state.fundraisers = []; state.leaders = []; state.scouts = [];', ctx);
  eq(vm.runInContext("monthlyDigestLeaders('2026-10')", ctx), '', 'an empty leaders’ copy is still offered');
  // …and the overlay keeps them in two boxes with two buttons.
  ok(/data-act="copy-digest-leaders"/.test(SCRIPT) && /id="exportBoxLeaders"/.test(SCRIPT),
    'the leaders’ copy has no box of its own');
  ok(/if \(act === 'copy-digest-leaders'\) \{[\s\S]*?monthlyDigestLeaders\(ui\.calMonth\)[\s\S]*?'exportBoxLeaders'\);/.test(SCRIPT),
    'the leaders’ copy button copies something else');
});

test('the calendar file carries no budget figure and no child', () => {
  const ctx = vm.createContext({});
  vm.runInContext(PRIV_STATE + `
    function lineForEvent(id) { return state.budget.activities.find(function (a) { return a.eventId === id; }) || null; }
    function linePlanned(a) { return a.planned; }
    function linePerHead() { return false; }
    function lineRateSummary() { return ''; }
    function pad2(n) { return (n < 10 ? '0' : '') + n; }
    ${['buildICS', 'icsStamp', 'icsDate', 'icsTime', 'icsNextDay', 'icsEndPlusHour', 'icsEscape', 'icsFold',
       'eventIsMeeting', 'eventLabel', 'fmt'].map(slice).join('\n')}`, ctx);
  const ics = vm.runInContext('buildICS()', ctx);
  ok(/SUMMARY:Fall campout/.test(ics), 'the fixture did not reach the calendar file');
  ok(!/Estimated/.test(ics) && ics.indexOf('$') === -1 && ics.indexOf('1,240') === -1,
    'the budget line’s planned total is in the calendar file families subscribe to');
  noSurname(ics, 'the calendar file');
  ok(!/lineForEvent|linePlanned/.test(codeOnly(slice('buildICS'))), 'buildICS reads the budget again');
});

/* ================================================================
   The repo is public. Real families' emails and phone numbers once sat in this file as test
   fixtures (a Trail's End export pasted in whole). Fixtures use @example.com and 555-01xx; the
   only real numbers allowed are the public ones the camping pages print on purpose.
   ================================================================ */

test('no tracked file carries a real email address or phone number', () => {
  let files;
  try {
    files = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch (e) {
    files = ['index.html', 'test/harness.mjs'];   // not a git checkout: scan the two that matter
  }
  const PUBLIC_NUMBERS = [
    '(770) 867-3489',      // Fort Yargo park office, printed on the camping page
    '(770) 867-3400',      // Northeast Georgia Medical Center Barrow, the hospital nearest it
    '1-800-222-1222',      // Poison Control
  ];
  const ALLOWED_EMAIL = /@(example\.com|pack569\.com)$/i;
  const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
  const PHONE = /(?:1-800-\d{3}-\d{4})|\(?\b[2-9]\d{2}\)?[-. ]?\d{3}[-. ]\d{4}\b|\b[2-9]\d{9}\b/g;
  const isFake = (p) => /555[-. ]?01\d\d$/.test(p.replace(/\s+$/, ''));
  const found = [];
  for (const f of files) {
    if (/\.(png|jpe?g|gif|ico|pdf|heic|woff2?)$/i.test(f)) continue;
    let text;
    try { text = readFileSync(join(ROOT, f), 'utf8'); } catch (e) { continue; }
    // This test's own allowlist is the one place a real public number may be written twice.
    (text.match(EMAIL) || []).forEach((m) => { if (!ALLOWED_EMAIL.test(m)) found.push(f + ': an email'); });
    (text.match(PHONE) || []).forEach((m) => {
      if (!isFake(m) && PUBLIC_NUMBERS.indexOf(m) < 0) found.push(f + ': a phone number');
    });
  }
  // Report WHERE, never WHAT: a failing run's output is pasted into chats and issues too.
  eq(found, [], 'personal contact details in a tracked file');
});

/* ================================================================
   Wave 4 — the Treasurer's audit, 2026-09-27 (money).
   Every test here was checked to FAIL against the code it guards.
   ================================================================ */

test('M1: commission posted to an income line is not a refund off Actual spent', () => {
  // DESIGN-money §3.6 tells the treasurer to post the council's cheque to "Popcorn income".
  // lineActualCents read any money in without a scout as a vendor refund, so it came off
  // Actual spent while Funds in already counted commission from sales — twice.
  const { lineActualCents } = sandbox(LEDGER_FNS);
  const led = [
    entry({ id: '1', lineId: 'P', amountCents: 273000, direction: 'in', source: 'commission' }),
    entry({ id: '2', lineId: 'C', amountCents: 50000, direction: 'out' }),
    entry({ id: '3', lineId: 'C', amountCents: 5000, direction: 'in', source: '' }),          // real refund
    entry({ id: '4', lineId: 'C', amountCents: 9000, direction: 'in', source: 'fundraiser' })  // income, not refund
  ];
  eq(lineActualCents(led, 'P'), 0, 'commission read as negative spending');
  eq(lineActualCents(led, 'C'), 45000, 'a vendor refund still reduces the cost; income does not');
});

test('M1: posted commission replaces the sales estimate; other income moves to Funds in', () => {
  const { ledgerIncomeCents } = sandbox(LEDGER_FNS);
  const isInc = (id) => id === 'P';
  const none = ledgerIncomeCents([entry({ lineId: 'C', direction: 'out', amountCents: 100 })], isInc);
  eq(none.hasCommission, false, 'nothing posted means the estimate stands');
  const t = ledgerIncomeCents([
    entry({ lineId: 'P', amountCents: 273000, direction: 'in', source: 'commission' }),
    entry({ lineId: '', amountCents: 1000, direction: 'in', source: 'commission' }),
    entry({ lineId: 'P', amountCents: 2000, direction: 'in', source: '' }),     // on an income line
    entry({ lineId: 'P', amountCents: 500, direction: 'out' }),                  // back out of it
    entry({ lineId: 'C', amountCents: 9000, direction: 'in', source: 'fundraiser' }),
    entry({ lineId: 'C', amountCents: 5000, direction: 'in', source: '' }),      // refund: stays on C
    entry({ lineId: '', amountCents: 7000, direction: 'in', source: 'donation' }), // uncategorised: out, as ever
    entry({ lineId: 'D', amountCents: 8000, direction: 'in', source: 'family', scoutId: 's1' })
  ], isInc);
  eq(t.hasCommission, true, 'posted');
  eq(t.commission, 274000, 'every posted commission entry, on a line or not');
  eq(t.other, 2000 - 500 + 9000, 'other income');
});

test('M1: income-category lines are neither planned nor actual SPENDING', () => {
  const fn = /function computeBudget\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  ok(/b\.activities\.forEach\(function \(a\) \{\s*if \(a\.category === 'income'\) return;/.test(fn),
    'an income activity line is counted as planned spending');
  ok(/b\.expenses\.forEach\(function \(e\) \{\s*if \(e\.category === 'income'\) return;/.test(fn),
    'an income expense line is counted as planned spending');
  ok(/var commission = income\.hasCommission \? income\.commission : commissionEstimate;/.test(fn),
    'posted commission is added on top of the sales estimate');
  ok(/income\.other/.test(fn), 'income that used to come off Actual spent no longer reaches Funds in');
});

test('M2: next year starts from the reconciled bank balance, not the projection', () => {
  const { closingCarryover } = sandbox(['closingCarryover']);
  eq(closingCarryover(50000, 42000, true), 42000, 'the bank balance is the carryover when the book has one');
  eq(closingCarryover(50000, -3000, false), 50000, 'net movement with no opening figure is not a balance');
  const fn = /function rolloverYear\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  ok(/b\.startingBalance = closingCarryover\(bud\.balance, closingBank, closingBankKnown\);/.test(fn),
    'Starting funds still carries the projection when a reconciled bank balance exists');
  ok(/var closingBankKnown = closingHadLedger && !!state\.book\.openingDate;/.test(fn),
    'a ledger with no opening figure is treated as a bank balance');
  ok(/if \(closingBankKnown\) \{\s*state\.book\.openingCents = closingBank;/.test(fn),
    "next year's book opens at net movement when there was no opening figure");
});

test('M3: every reward-tier cover key follows its line into the new year', () => {
  const { remapCoverKey } = sandbox(['remapCoverKey']);
  const map = { E1: 'N1', A1: 'N2' };
  eq(remapCoverKey('E1', map), 'N1', 'an expense scout share');
  eq(remapCoverKey('E1#adult', map), 'N1#adult', 'an expense adult share');
  eq(remapCoverKey('act:A1', map), 'act:N2', 'an activity scout share');
  eq(remapCoverKey('act:A1#sibling', map), 'act:N2#sibling', 'an activity sibling share');
  eq(remapCoverKey('act:GONE', map), 'act:GONE', 'a stale key is left alone');
  const fn = /function rolloverYear\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  ok(/t\.covers = arrOf\(t\.covers\)\.map\(function \(k\) \{ return remapCoverKey\(k, lineIdMap\); \}\);/.test(fn),
    'the rollover rebuilds line ids and leaves every tier pointing at last year’s');
  ok(/lineIdMap\[c\.line\.id\] = b\.activities\[i\]\.id/.test(fn) && /lineIdMap\[x\.id\] = b\.expenses\[i\]\.id/.test(fn),
    'the old-to-new line map is incomplete');
});

test('M3: a tier deadline moves on a year rather than opening the year closed', () => {
  const { shiftISOYear } = sandbox(['shiftISOYear']);
  eq(shiftISOYear('2026-10-31'), '2027-10-31', 'one year on');
  eq(shiftISOYear('2028-02-29'), '2029-02-28', 'a leap day');
  eq(shiftISOYear(''), '', 'no deadline stays none');
  const fn = /function rolloverYear\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  ok(/if \(t\.dueBy\) t\.dueBy = shiftISOYear\(t\.dueBy\);/.test(fn), 'last year’s deadline is carried unchanged');
});

test('M5: a tier make-up payment does not also settle the family’s other charges', () => {
  // Treasurer's repro: dues $40 covered by a tier the family paid $30 to reach; a $40 campout
  // still open. The $30 bought the tier. Counted as a payment too, it knocked the campout to $10.
  const { familyOutstanding, chargeTotals } = sandbox(CHARGE_FNS);
  const charges = [
    { scoutId: 's1', lineId: 'dues', amountCents: 4000, waivedBy: 't1', forgiven: null },
    { scoutId: 's1', lineId: 'camp', amountCents: 4000, waivedBy: '', forgiven: null }
  ];
  const ledger = [{ direction: 'in', scoutId: 's1', amountCents: 3000, source: 'family', tierMakeup: 't1' }];
  eq(familyOutstanding(charges, ledger, 's1'), 4000, 'the campout is still owed in full');
  const t = chargeTotals(charges, ledger);
  eq(t.paid, 0, 'make-up money is not a charge payment');
  eq(t.makeup, 3000, 'but it is reported, not lost');
  eq(t.outstanding, 4000, 'still owed');
  const fn = /function computeBudget\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  ok(/var feeIncomeGross = chg\.paid \+ chg\.donated \+ chg\.makeup;/.test(fn) &&
     /feeIncomeCollected = feeIncomeGross - chg\.refunded;/.test(fn), 'make-up money dropped out of Funds in');
});

test('M6: editing a reimbursement keeps who it paid back', () => {
  // tierReimbursements reads the scout off a money-OUT entry to know a family was paid back.
  // Every edit used to clear it — including typing the receipt number the toast asks for.
  const h = /if \(ch\.indexOf\('led-'\) === 0\) \{[\s\S]*?\n    \}/.exec(SCRIPT)[0];
  ok(!/led\.direction !== 'in'\) \{ led\.source = ''; led\.donor = ''; led\.scoutId = ''; \}/.test(h),
    'any edit of a money-out entry clears its scout');
  ok(/if \(lk === 'dir'\) \{ led\.scoutId = '';/.test(h), 'flipping the direction no longer drops the payer');
});

test('T1: a refunded family credit leaves the account, and nothing is carried', () => {
  // The Dues card says "record the refund as money out" — and money out could not name the
  // family, so the credit outlived the cheque and came forward at close-out: paid back twice.
  const ctx = sandbox(CHARGE_FNS.concat(['chargePaidAllocation', 'LEDGER_INCOME_SOURCES', 'entryIsRefund',
    'entrySignedCents', 'lineActualCents']));
  const charges = [{ id: 'd', scoutId: 'ada', lineId: 'D', amountCents: 8000, date: '2026-09-01', waivedBy: '', forgiven: null }];
  const paid = { direction: 'in', scoutId: 'ada', amountCents: 12000, source: 'family' };      // $40 over
  const refund = { direction: 'out', scoutId: 'ada', amountCents: 4000, source: 'refund', lineId: 'D' };
  const before = ctx.familyAccounts(charges, [paid]);
  eq(before[0].credit, 4000, 'the credit before the refund');
  const after = ctx.familyAccounts(charges, [paid, refund]);
  eq([after[0].balance, after[0].credit, after[0].outstanding], [0, 0, 0], 'square after the refund');
  // rolloverYear carries every family whose balance is not 0 — so a square family carries nothing.
  const roll = /function rolloverYear\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  ok(/var closingAccounts = familyAccountsNow\(\)\.filter\(function \(a\) \{ return a\.balance !== 0; \}\);/.test(roll),
    'close-out does not read the refunded balance');
  eq(ctx.familyOutstanding(charges, [paid, refund], 'ada'), 0, 'familyOutstanding');
  const t = ctx.chargeTotals(charges, [paid, refund]);
  eq([t.paid, t.refunded, t.credit, t.outstanding], [12000, 4000, 0, 0], 'chargeTotals reports it');
  eq(ctx.chargePaidAllocation(charges, [paid, refund]), { d: 8000 }, 'a refund of credit un-paid a charge');
  // Refunding more than the credit un-pays the charge it has to.
  const big = Object.assign({}, refund, { amountCents: 6000 });
  eq(ctx.chargePaidAllocation(charges, [paid, big]), { d: 6000 }, 'a refund past the credit');
  eq(ctx.familyOutstanding(charges, [paid, big], 'ada'), 2000, 'and the family owes it again');
  // Not a cost of the line it sits on.
  eq(ctx.lineActualCents([refund], 'D'), 0, 'a refund counted as spending on its line');
  // A reward-tier reimbursement is never a refund — marked, or from before the mark (no source).
  eq(ctx.entryRefundsFamily({ direction: 'out', scoutId: 'ada', source: '' }), false, 'an old reimbursement reads as a refund');
  eq(ctx.entryRefundsFamily({ direction: 'out', scoutId: 'ada', source: 'refund', reimbursement: true }), false,
    'a marked reimbursement reads as a refund');
  eq(ctx.familyAccounts(charges, [paid, { direction: 'out', scoutId: 'ada', amountCents: 4000, source: '' }])[0].credit, 4000,
    'a reimbursement took the family’s credit away');
  // Wiring: the reimburse button marks what it records, the reimbursement list skips refunds,
  // Funds in loses the money, and the ledger lets money out name a family.
  const rb = /if \(act\.indexOf\('tier-reimburse:'\) === 0\) \{[\s\S]*?\n    \}/.exec(SCRIPT)[0];
  ok(/reimbursement: true/.test(rb), 'a reimbursement is not marked as one');
  const tr = /function tierReimbursements\(map\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  ok(/!entryRefundsFamily\(e\)/.test(tr), 'a refund on a paid-direct line counts as a reimbursement');
  const add = /if \(act === 'ledger-add'\) \{[\s\S]*?\n    \}/.exec(SCRIPT)[0];
  ok(/source: dr\.direction === 'in' \? dr\.source : \(\(dr\.scoutId && !drReimb\) \? 'refund' : ''\)/.test(add) && /scoutId: dr\.scoutId,/.test(add),
    'a new money-out entry cannot name the family refunded');
  const rows = /function renderLedgerEntries\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  ok(/data-ch="led-scout"[^\n]*Refunded to which family/.test(rows) && /data-ch="ledn-scout" aria-label="Refunded to which family"/.test(rows),
    'the ledger has no family picker on money out');
  ok(/if \(act === 'charge-refund'\) \{/.test(SCRIPT) && /data-act="charge-refund"/.test(SCRIPT), 'no Record a refund button');
  ok(!/record the refund as money out/.test(SCRIPT), 'the old instruction is still there');
});

test('T2: the close-out preview names the starting funds rolloverYear will actually carry', () => {
  // It said "the starting balance becomes this year's ending balance" and showed the projection,
  // when a book with an opening date carries its bank balance (M2).
  const ov = /function renderCloseoutOverlay\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  ok(!/the starting balance becomes this year’s ending balance/.test(ov), 'the old projection-only sentence is still there');
  ok(/var coCarry = closingCarryover\(coBud\.balance, bookBalance\(\), coBankKnown\);/.test(ov),
    'the preview does not work the carryover out the way close-out does');
  ok(/var coBankKnown = state\.ledger\.length > 0 && !!state\.book\.openingDate;/.test(ov),
    'the preview decides "bank balance known" differently from rolloverYear');
  const roll = /function rolloverYear\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  ok(/var closingHadLedger = state\.ledger\.length > 0;/.test(roll) &&
    /var closingBankKnown = closingHadLedger && !!state\.book\.openingDate;/.test(roll) &&
    /closingCarryover\(bud\.balance, closingBank, closingBankKnown\)/.test(roll) && /var closingBank = bookBalance\(\);/.test(roll),
    'rolloverYear no longer matches what the preview promises');
  ok(/bank balance<\/strong> \(' \+ fmt\(coCarry\)/.test(ov) && /projected ending balance<\/strong> \(' \+ fmt\(coCarry\)/.test(ov),
    'the preview does not say which figure it is carrying');
  ok(/' \+ coCarryLine \+ '/.test(ov), 'the carry line is not in the list');
});

test('T3: a family credit comes forward even when the book had no opening date, and the preview says so', () => {
  const fn = /function rolloverYear\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  ok(/\} else if \(a\.balance < 0\) \{/.test(fn) && !/a\.balance < 0 && closingBankKnown/.test(fn),
    'a credit is dropped when the closing book had no opening date');
  // Dated before the program year starts — where "Start from the carryover figure" opens the book —
  // not off state.book.openingDate, which a pack with no opening balance does not have.
  ok(/date: priorDayISO\(programYearStartISO\(b\.programYear\)\)/.test(fn) && !/priorDayISO\(state\.book\.openingDate\)/.test(fn),
    'the carried credit is dated off an opening date that may not exist');
  ok(fn.indexOf('b.programYear += 1;') < fn.indexOf('priorDayISO(programYearStartISO(b.programYear))'),
    'the credit is dated in the closing year, not before the new one');
  const use = /data-act="ledger-use-carryover"/.test(SCRIPT) &&
    /if \(act === 'ledger-use-carryover'\) \{[\s\S]*?programYearStartISO\(state\.budget\.programYear\)/.test(SCRIPT);
  ok(use, 'the carryover button no longer opens the book on the first day of the program year');
  const ctx = sandbox(['fmt', 'closeoutFamilyLine']);
  eq(ctx.closeoutFamilyLine([{ balance: 4500 }, { balance: 1000 }, { balance: -2000 }, { balance: 0 }]),
    '2 families’ unpaid balances ($55.00) come forward as Prior-year balance; 1 family’s credit ($20.00) comes forward.',
    'the preview line');
  eq(ctx.closeoutFamilyLine([{ balance: 0 }]), 'Every family account is square, so no balance comes forward.', 'all square');
  const ov = /function renderCloseoutOverlay\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  ok(/closeoutFamilyLine\(familyAccountsNow\(\)\)/.test(ov), 'the preview does not say what happens to family balances');
  ok(!/dues collections/.test(ov), 'the preview still says dues collections are cleared');
});

test('T4: an income-line cheque that may be the commission is asked about, and $0 is not a posted commission', () => {
  const ctx = sandbox(LEDGER_FNS.concat(['COMMISSION_LOOKALIKE_SOURCES', 'commissionLookalikes']));
  const isInc = (id) => id === 'POP';
  // (b) A $0 "commission" entry switched the sales estimate off and left commission at $0.
  const zero = ctx.ledgerIncomeCents([entry({ direction: 'in', source: 'commission', amountCents: 0, lineId: 'POP' })], isInc);
  eq([zero.commission, zero.hasCommission], [0, false], 'a $0 commission entry counts as posted');
  eq(ctx.ledgerIncomeCents([entry({ direction: 'in', source: 'commission', amountCents: 1, lineId: '' })], isInc).hasCommission, true,
    'a real commission entry is not posted');
  // (a) Old cheques posted before M1, with a blank or "fundraiser" source, on the income line.
  const led = [
    entry({ id: 'a', direction: 'in', source: 'fundraiser', amountCents: 90000, lineId: 'POP' }),
    entry({ id: 'b', direction: 'in', source: '', amountCents: 10000, lineId: 'POP' }),
    entry({ id: 'c', direction: 'in', source: 'donation', amountCents: 5000, lineId: 'POP' }),     // says what it is
    entry({ id: 'd', direction: 'in', source: '', amountCents: 7000, lineId: 'CAMP' }),            // not an income line
    entry({ id: 'e', direction: 'in', source: '', amountCents: 4000, lineId: 'POP', scoutId: 'ada' }), // a family's
    entry({ id: 'f', direction: 'out', source: '', amountCents: 3000, lineId: 'POP' })
  ];
  eq(JSON.parse(JSON.stringify(ctx.commissionLookalikes(led, isInc))).map((x) => ({ lineId: x.lineId, cents: x.cents, count: x.count })),
    [{ lineId: 'POP', cents: 100000, count: 2 }], 'lookalikes');
  // M4 — an entry the treasurer has answered "not the commission" for is not asked about again.
  const answered = led.map((x) => x.id === 'a' ? Object.assign({}, x, { notCommission: true }) : x);
  eq(JSON.parse(JSON.stringify(ctx.commissionLookalikes(answered, isInc))),
    [{ lineId: 'POP', cents: 10000, count: 1, entries: [{ id: 'b', cents: 10000, date: led[1].date }] }], 'an answered entry is still asked about');
  eq(ctx.commissionLookalikes(led.map((x) => Object.assign({}, x, { notCommission: true })), isInc).length, 0,
    'every entry answered, and the line is still listed');
  // Only while the estimate is what Funds in counts, and never guessed from the description.
  const fn = /function computeBudget\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  ok(/var lookalikes = \(!income\.hasCommission && commissionEstimate > 0\)\s*\? commissionLookalikes\(state\.ledger, isIncomeLine\) : \[\];/.test(fn),
    'the question is asked when no estimate is being counted, or after the commission is posted');
  ok(!/description/.test(/function commissionLookalikes\([^)]*\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0]), 'it guesses from the description');
  const card = /function renderBudget\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0].replace(/'\s*\+\s*'/g, '');
  ok(/bud\.commissionLookalikes\.map/.test(card) && /Is this the council’s commission cheque\?/.test(card) &&
    /so it isn’t counted twice/.test(card), 'the Budget card does not ask');
});

test('T5: a carryover entry is not counted as income on top of Starting funds', () => {
  const ctx = sandbox(LEDGER_FNS);
  const isInc = (id) => id === 'INC';
  const t = ctx.ledgerIncomeCents([
    entry({ direction: 'in', source: 'carryover', amountCents: 42000, lineId: 'INC' }),
    entry({ direction: 'in', source: 'carryover', amountCents: 1000, lineId: 'CAMP' }),
    entry({ direction: 'in', source: 'fundraiser', amountCents: 5000, lineId: 'INC' })
  ], isInc, 42000);
  eq(t.other, 5000, 'the carryover reached Funds in a second time');
  eq(t.carryover, 0, 'the carryover was counted on its own term as well as in Starting funds');
});

test('M3: with Starting funds at $0, a carryover entry counts, and the card asks for it to be moved', () => {
  const ctx = sandbox(LEDGER_FNS);
  const isInc = (id) => id === 'INC';
  const L = [
    entry({ direction: 'in', source: 'carryover', amountCents: 42000, lineId: '' }),
    entry({ direction: 'in', source: 'carryover', amountCents: 1000, lineId: 'CAMP' }),
    // A family's carried credit is never the pack's carryover.
    entry({ direction: 'in', source: 'carryover', amountCents: 700, lineId: '', scoutId: 'ada' }),
    entry({ direction: 'in', source: 'fundraiser', amountCents: 5000, lineId: 'INC' })
  ];
  const zero = ctx.ledgerIncomeCents(L, isInc, 0);
  eq([zero.carryover, zero.other], [43000, 5000], 'with Starting funds $0');
  eq(ctx.ledgerIncomeCents(L, isInc).carryover, 43000, 'no Starting funds given reads as $0');
  const set = ctx.ledgerIncomeCents(L, isInc, 43000);
  eq([set.carryover, set.other], [0, 5000], 'with Starting funds set');
  const fn = slice('computeBudget');
  ok(/ledgerIncomeCents\(state\.ledger, isIncomeLine, b\.startingBalance \|\| 0\)/.test(fn), 'computeBudget does not pass Starting funds');
  ok(/ledgerCarryover: income\.carryover,/.test(fn), 'the counted carryover is not reported');
  const card = /function renderBudget\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0].replace(/'\s*\+\s*'/g, '');
  ok(/bud\.ledgerCarryover > 0/.test(card) &&
     /A Carryover entry of <strong class="money">' \+\s*fmt\(bud\.ledgerCarryover\) \+ '<\/strong> is in the ledger but Starting funds is \$0 \\u2014 set Starting funds to it and this entry stops counting\./.test(card),
    'the Budget card does not ask for the carryover to be moved into Starting funds');
});

test('T6: a part-paid commission says how much is still expected from the council', () => {
  const card = /function renderBudget\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  const at = card.indexOf("' as posted to the ledger'");
  ok(at !== -1, 'the posted-commission wording is gone');
  const bit = card.slice(at, at + 900);
  ok(/bud\.commissionEstimate > bud\.commission\s*\? ' — ' \+ fmt\(bud\.commissionEstimate - bud\.commission\) \+ ' less than sales work out to; still expected from the council, or check the rate with the Kernel'/.test(bit),
    'a part-payment does not say what is still to come');
});

test('T7: chargeTotals is only ever asked about the whole book; a subset uses chargeSetTotals', () => {
  // Handed one line's charges, chargeTotals counted every payment in the ledger as paid for that
  // line and each touched family's whole balance as owed on it.
  const calls = codeOnly(SCRIPT).match(/chargeTotals\([^)]*\)/g) || [];
  const bad = calls.filter((c) => !/^chargeTotals\((state\.charges, state\.ledger, chargeFamilyKey|charges, ledger, keyOf)\)$/.test(c));
  eq(bad, [], 'chargeTotals called on something other than state.charges');
  const { chargeSetTotals } = sandbox(CHARGE_FNS);
  eq(chargeSetTotals([
    { amountCents: 4000, waivedBy: 't', forgiven: null },
    { amountCents: 3000, waivedBy: '', forgiven: { reason: 'x' } },
    { amountCents: 2000, waivedBy: '', forgiven: null }
  ]), { raised: 9000, standing: 2000, waived: 4000, forgiven: 3000 }, 'the charge-only figures');
});

test('T8: reward-tier reimbursements are measured against what the plan set aside for them', () => {
  // A paid-direct line is out of the plan, so every reimbursement on it read as over budget
  // against $0 — though Planned (A) already counts what the planned tiers will pay back.
  const now = /function budgetVsActualNow\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  ok(/var bvaCover = coverCostForKeys\(plannedCoverKeys\(\)\);\s*items\.push\(\{ category: BVA_REIMBURSE, planned: bvaCover\.extraReimburse, actual: 0 \}\);/.test(now),
    'the reimbursements row is not planned at what A counts for them');
  ok(/LINE_CATEGORIES\.concat\(\[\[BVA_REIMBURSE, 'Reward-tier reimbursements'\]\]\)/.test(now), 'no row of their own');
  // A covers exactly that figure, via tierExtra — so the row and Planned agree.
  ok(/extra \+= cents; extraReimburse \+= cents;/.test(SCRIPT) && /function tierExtraPackCostCents\(\) \{ return coverCostForKeys\(plannedCoverKeys\(\)\)\.extra; \}/.test(SCRIPT),
    'what Planned counts for reimbursements has moved');
  const { budgetVsActual, LINE_CATEGORIES } = sandbox(['LINE_CATEGORIES', 'budgetVsActual']);
  const out = budgetVsActual([
    { category: 'registration', planned: 8500, actual: 8500 },
    { category: 'tier-reimburse', planned: 0, actual: 6000 },      // two scouts paid back
    { category: 'tier-reimburse', planned: 9000, actual: 0 }       // the plan: three scouts
  ], LINE_CATEGORIES.concat([['tier-reimburse', 'Reward-tier reimbursements']]));
  const r = out.rows.find((x) => x.category === 'tier-reimburse');
  eq([r.label, r.planned, r.actual, r.variance], ['Reward-tier reimbursements', 9000, 6000, -3000], 'under plan, not over');
  eq(out.rows[out.rows.length - 1].category, 'tier-reimburse', 'the row is not last');
});

test('T9: a shared balance, a carried credit and the parents’ cost card say what they are', () => {
  // (a) Linked siblings each carried "owes $120" — the family's one balance, read as two.
  const roster = SCRIPT.slice(SCRIPT.indexOf('var owe = scoutOwesCents(s.id);'), SCRIPT.indexOf('var owe = scoutOwesCents(s.id);') + 1600);
  ok(/\(shared \? 'family owes ' : 'owes '\)/.test(roster), 'a sibling’s pill does not say the balance is the family’s');
  ok(/state\.scouts\.filter\(function \(o\) \{ return familyKeyOf\(o\) === famKey; \}\)\.length > 1/.test(roster),
    'an archived sibling does not count as sharing the account');
  // (b) "received" included last year's carried credit.
  const { familyAccounts } = sandbox(CHARGE_FNS);
  const a = familyAccounts([{ scoutId: 'ada', amountCents: 8000, waivedBy: '', forgiven: null }], [
    { direction: 'in', scoutId: 'ada', amountCents: 3000, source: 'carryover' },
    { direction: 'in', scoutId: 'ada', amountCents: 5000, source: 'family' }
  ])[0];
  eq([a.paid, a.carried, a.balance], [8000, 3000, 0], 'the family account');
  const blk = /function duesFamilyBlock\(f\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  ok(/fmt\(a\.paid - a\.carried\) \+ ' received'/.test(blk) && /' carried forward'/.test(blk),
    'the family block counts a carried credit as received');
  // (c) The parents' card is the fees in the plan, not everything a year costs. No new published fields.
  const pv = /function parentFamilyCost\(pv\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  ok(/fees in the pack’s plan/.test(pv), 'the parents’ cost card is not softened');
});

test('T10: undoing a forgiveness takes two taps', () => {
  const u = /if \(act\.indexOf\('charge-unforgive:'\) === 0\) \{[\s\S]*?\n    \}/.exec(SCRIPT)[0];
  ok(/arm\(act, function \(\) \{[\s\S]*uc\.forgiven = null;/.test(u), 'a forgiveness is undone on one tap');
  const blk = /function duesFamilyBlock\(f\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  ok(/data-act="charge-unforgive:' \+ c\.id \+ '"/.test(blk) && /Tap again to undo/.test(blk),
    'the Undo button is not keyed per charge, so it cannot show it is armed');
  ok(!/data-act="charge-unforgive" /.test(SCRIPT), 'the old one-tap button is still drawn');
});

test('T10: unpaid duplicate charges are listed for a leader, never removed on their own', () => {
  const ctx = sandbox(['chargeIsOpen', 'duplicateCharges']);
  const fam = { aol: 'F', wolf: 'F' };
  const mk = (c) => c.lineId === 'FAM' && c.who === 'scout' ? 'FAM|fam:' + (fam[c.scoutId] || c.scoutId) : c.id;
  const open = (id, sid, extra) => Object.assign({ id: id, scoutId: sid, lineId: 'FAM', who: 'scout', seq: 0,
    amountCents: 6000, waivedBy: '', forgiven: null }, extra || {});
  // The old charge (crossed-over AoL) and the one raised again for the sibling.
  let out = ctx.duplicateCharges([open('c1', 'aol'), open('c2', 'wolf'), open('x', 'ben')], mk, {});
  eq(out.map((d) => [d.charge.id, d.keep.id]), [['c2', 'c1']], 'the later one is listed, the oldest kept');
  // The one money went to is kept, whichever it is.
  out = ctx.duplicateCharges([open('c1', 'aol'), open('c2', 'wolf')], mk, { c2: 6000 });
  eq(out.map((d) => [d.charge.id, d.keep.id]), [['c1', 'c2']], 'a paid charge was listed for removal');
  // Both paid against, or the other settled: nothing is listed for removal as "unpaid".
  eq(ctx.duplicateCharges([open('c1', 'aol'), open('c2', 'wolf')], mk, { c1: 100, c2: 100 }).length, 0, 'paid duplicates listed');
  eq(ctx.duplicateCharges([open('c1', 'aol', { forgiven: { reason: 'r' } }), open('c2', 'wolf', { waivedBy: 't' })], mk, {}).length, 0,
    'settled duplicates listed');
  // Nothing in the code removes one without the leader's second tap.
  const rm = /if \(act\.indexOf\('charge-dup-remove:'\) === 0\) \{[\s\S]*?\n    \}/.exec(SCRIPT);
  ok(rm && /arm\(act, function \(\) \{/.test(rm[0]) && /duplicateChargesNow\(\)\.filter/.test(rm[0]) && /deleteWithUndo\(/.test(rm[0]),
    'removing a duplicate is not two taps, re-checked, with Undo');
  const sc = /function syncCharges\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  ok(!/duplicateCharges/.test(sc), 'syncCharges removes duplicates on its own');
  const dues = /function renderDues\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  ok(/var dups = duplicateChargesNow\(\);/.test(dues) && /Charged twice\?/.test(dues), 'the Dues card does not list them');
  ok(/dupN \+ ' charge' \+ \(dupN === 1 \? '' : 's'\) \+ ' may be a duplicate'/.test(SCRIPT), 'the Treasurer is not told on Home');
});

test('T1: a refund source only survives on money out that names a family', () => {
  const ns = /function normalizeState\(d\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  ok(/if \(e\.source === 'refund' && \(e\.direction !== 'out' \|\| !e\.scoutId\)\) e\.source = '';/.test(ns),
    'a stray refund source is kept on money in, or with no family');
  ok(/e\.reimbursement = e\.reimbursement === true;/.test(ns), 'the reimbursement mark is not normalized');
  const opts = /function sourceSelectOptions\(sel\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  ok(/s !== 'refund'/.test(opts), 'Refund is offered as a source of money IN');
});

test('M7: one cheque against either sibling settles the family, and a credit is shown', () => {
  const { familyAccounts, familyOutstanding, chargeTotals } = sandbox(CHARGE_FNS);
  const fam = { ada: 'F', ben: 'F', cal: 'cal' };
  const keyOf = (id) => fam[id] || id;
  const charges = [
    { scoutId: 'ada', amountCents: 8000, waivedBy: '', forgiven: null },
    { scoutId: 'ben', amountCents: 8000, waivedBy: '', forgiven: null },
    { scoutId: 'cal', amountCents: 8000, waivedBy: '', forgiven: null }
  ];
  const ledger = [
    { direction: 'in', scoutId: 'ada', amountCents: 16000, source: 'family' },  // one cheque, both children
    { direction: 'in', scoutId: 'cal', amountCents: 10000, source: 'family' }   // $20 over
  ];
  eq(familyOutstanding(charges, ledger, 'ben', keyOf), 0, 'Ben still owes after his sister’s cheque covered him');
  const accts = familyAccounts(charges, ledger, keyOf);
  const f = accts.find((a) => a.key === 'F');
  eq([f.owed, f.paid, f.outstanding, f.credit], [16000, 16000, 0, 0], 'the family account');
  const c = accts.find((a) => a.key === 'cal');
  eq(c.credit, 2000, 'an overpayment is a credit, not "square"');
  const t = chargeTotals(charges, ledger, keyOf);
  eq(t.outstanding, 0, 'nobody owes');
  eq(t.credit, 2000, 'the credit is reported');
  // Without a key every scout is a family of one — what an unlinked pack always had.
  eq(familyOutstanding(charges, ledger, 'ben'), 8000, 'unlinked, Ben is his own account');
});

test('M7: every "owes" beside a name, and the Treasurer’s nag, is the family’s', () => {
  ok(/function scoutOwesCents\(scoutId\) \{ return familyOutstanding\(state\.charges, state\.ledger, scoutId, chargeFamilyKey\); \}/.test(SCRIPT),
    'scoutOwesCents is still per scout');
  const key = /function chargeFamilyKey\(scoutId\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  ok(/getScout\(scoutId\)/.test(key) && /familyKeyOf\(sc\)/.test(key),
    'the family key does not read archived scouts through getScout');
  ok(/var owingFams = familyAccountsNow\(\)/.test(SCRIPT), 'the Treasurer’s nag counts a family once per child');
  const dues = /function renderDues\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  ok(/duesFamilyBlock/.test(dues) && />Family balances</.test(dues), 'the Dues card still lists scouts one by one');
  const blk = /function duesFamilyBlock\(f\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  ok(/Credit ' \+ fmt\(a\.credit\)/.test(blk), 'a family in credit still reads "square"');
});

test('M9: a former scout’s balance has a row to settle it from', () => {
  // "Still owed" counts every family; the list showed only the current roster.
  const dues = /function renderDues\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  ok(/Former scouts with a balance/.test(dues), 'archived scouts with a balance have nowhere to be paid or forgiven');
  ok(/var former = fams\.filter\(function \(f\) \{\s*return !f\.active\.length && \(f\.acct\.outstanding \|\| f\.acct\.credit \|\|\s*f\.charges\.some\(function \(c\) \{ return !!c\.forgiven; \}\)\);/.test(dues),
    'the former-scouts list does not pick up families with nobody left on the roster');
  ok(/former\.forEach\(function \(f\) \{ h \+= duesFamilyBlock\(f\); \}\);/.test(dues),
    'former families are not given the same pay and forgive controls');
  const df = /function duesFamilies\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  ok(/state\.scouts\.filter/.test(df), 'family members are read from the active roster only');
});

test('M8: a payment freezes the charge it paid, not every charge the family has', () => {
  // One $80 dues cheque used to freeze the scout's campout charges too, so a head count
  // corrected afterwards could neither drop a parent who never came nor re-price the line.
  const { chargePaidAllocation } = sandbox(CHARGE_FNS.concat(['chargePaidAllocation']));
  const charges = [
    { id: 'dues', scoutId: 's1', lineId: 'D', amountCents: 8000, date: '2026-09-01', waivedBy: '', forgiven: null },
    { id: 'campS', scoutId: 's1', lineId: 'C', amountCents: 4000, date: '2026-10-10', waivedBy: '', forgiven: null },
    { id: 'campA', scoutId: 's1', lineId: 'C', amountCents: 4000, date: '2026-10-10', waivedBy: '', forgiven: null },
    { id: 'sib', scoutId: 's2', lineId: 'D', amountCents: 8000, date: '2026-09-01', waivedBy: '', forgiven: null }
  ];
  const onLine = chargePaidAllocation(charges, [
    { direction: 'in', scoutId: 's1', lineId: 'D', amountCents: 8000, source: 'family' }
  ]);
  eq(onLine, { dues: 8000 }, 'a dues cheque paid the dues and nothing else');
  // No line: oldest first. $100 pays the dues and half the first campout head.
  const fifo = chargePaidAllocation(charges, [
    { direction: 'in', scoutId: 's1', lineId: '', amountCents: 10000, source: 'family' }
  ]);
  eq(fifo, { dues: 8000, campS: 2000 }, 'oldest first');
  // Per family: the sister's cheque reaches the brother's charge.
  const fam = chargePaidAllocation(charges, [
    { direction: 'in', scoutId: 's2', lineId: 'D', amountCents: 16000, source: 'family' }
  ], (id) => 'F');
  eq(fam.dues + fam.sib, 16000, 'a family cheque on the dues line pays both children’s dues');
  // A tier make-up pays no charge at all (M5).
  eq(chargePaidAllocation(charges, [
    { direction: 'in', scoutId: 's1', lineId: '', amountCents: 3000, source: 'family', tierMakeup: 't' }
  ]), {}, 'make-up money was allocated to a charge');
});

test('M8: a per-family fee is not billed again when the child carrying it crosses over', () => {
  const { chargeMatchKey } = sandbox(['linePerFamily', 'chargeKey', 'chargeMatchKey']);
  const fam = { aol: 'F', wolf: 'F' };
  const keyOf = (id) => fam[id] || id;
  const perFamily = { id: 'L', basis: 'per-family' };
  const perHead = { id: 'L', basis: 'per-head' };
  const old = { lineId: 'L', scoutId: 'aol', who: 'scout', seq: 0 };
  const now = { lineId: 'L', scoutId: 'wolf', who: 'scout', seq: 0 };
  eq(chargeMatchKey(old, perFamily, keyOf), chargeMatchKey(now, perFamily, keyOf),
    'the sibling’s wanted charge does not match the charge the family already has');
  ok(chargeMatchKey(old, perHead, keyOf) !== chargeMatchKey(now, perHead, keyOf),
    'a per-head charge is pooled across siblings');
  const fn = /function syncCharges\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  ok(/want\[chargeMatchKey\(row, r\.line, chargeFamilyKey\)\] = row/.test(fn) && /byKey\[mk\(c\)\] = c/.test(fn),
    'syncCharges still matches charges by scout id');
});

test('M4: a family’s open balance survives the year-end as one prior-year charge', () => {
  const fn = /function rolloverYear\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  // Read before anything is cleared...
  const read = fn.indexOf('var closingAccounts = familyAccountsNow()');
  ok(read !== -1, 'family balances are not read at close-out');
  ok(read < fn.indexOf('state.ledger = [];') && read < fn.indexOf('state.charges = [];'),
    'family balances are read after the ledger or the charges were cleared');
  // ...and written back after the clear, on no line, one per family.
  const clear = fn.indexOf('state.charges = [];');
  const carry = fn.indexOf('closingAccounts.forEach', clear);
  ok(carry > clear, 'balances are not carried into the cleared charges');
  ok(/lineId: '', who: 'scout', seq: 0,\s*amountCents: a\.balance/.test(fn), 'the carried charge is not the family’s net balance on no line');
  ok(/label: carryLabel/.test(fn), 'the carried charge is not named');
  // A credit is a payment BEFORE the opening date: in the family's account, not in the bank twice.
  ok(/source: 'carryover', donor: '', scoutId: to/.test(fn) && /date: priorDayISO\(programYearStartISO\(b\.programYear\)\)/.test(fn),
    'a family credit is lost at close-out, or lands inside the new bank balance');
  // syncCharges must not drop what it did not raise.
  const sc = /function syncCharges\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  ok(/if \(!c\.lineId\) return true;/.test(sc), 'syncCharges drops a prior-year balance on the next commit');
  const { priorDayISO } = sandbox(['priorDayISO']);
  eq(priorDayISO('2027-07-01'), '2027-06-30', 'the day before the book opens');
  eq(priorDayISO('2028-03-01'), '2028-02-29', 'across a leap day');
});

test('M10: reconciling is against THIS statement — nothing dated after it counts', () => {
  const { reconcileTotals } = sandbox(LEDGER_FNS);
  const book = { openingCents: 10000, openingDate: '2026-07-01', statementCents: 15000, statementDate: '2026-09-30' };
  const led = [
    entry({ id: 'a', date: '2026-09-10', amountCents: 5000, direction: 'in', reconciled: true }),
    entry({ id: 'b', date: '2026-10-02', amountCents: 900, direction: 'out', reconciled: true }),   // ticked by mistake
    entry({ id: 'c', date: '2026-10-05', amountCents: 400, direction: 'out', reconciled: false })
  ];
  const rec = reconcileTotals(led, book);
  eq(rec.cleared, 15000, 'an October entry moved a September statement');
  eq(rec.difference, 0, 'the book agrees with the statement');
  eq([rec.ticked, rec.open, rec.after], [1, 0, 2], 'counts');
  const tick = /if \(act === 'ledger-tick-all' \|\| act === 'ledger-untick-all'\) \{[\s\S]*?\n    \}/.exec(SCRIPT)[0];
  ok(/entryOnStatement\(e, state\.book\)/.test(tick), 'Tick all ticks entries dated after the statement');
});

test('M10: a reconciled entry is read-only until it is deliberately un-reconciled', () => {
  const rows = /function renderLedgerEntries\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  ok(/if \(e\.reconciled\) \{[\s\S]*?data-act="ledger-unreconcile:' \+ e\.id \+ '"[\s\S]*?return;\s*\}/.test(rows),
    'a reconciled entry is rendered with editable fields');
  const ch = /if \(ch\.indexOf\('led-'\) === 0\) \{[\s\S]*?\n    \}/.exec(SCRIPT)[0];
  ok(/if \(led\.reconciled && lk !== 'rec'\) \{ render\(\); return; \}/.test(ch), 'the change handler still edits a reconciled entry');
  const un = /if \(act\.indexOf\('ledger-unreconcile:'\) === 0\) \{[\s\S]*?\n    \}/.exec(SCRIPT);
  ok(un && /arm\(act, function \(\) \{/.test(un[0]) && /urE\.reconciled = false;/.test(un[0]),
    'there is no two-tap un-reconcile');
  const del = /if \(act\.indexOf\('del-ledger:'\) === 0\) \{[\s\S]*?\n    \}/.exec(SCRIPT)[0];
  ok(/if \(state\.ledger\[dlIx\]\.reconciled\)/.test(del), 'a reconciled entry can be deleted');
});

test('M10: forgiving needs a reason and a name, and undoing it leaves a trace', () => {
  const f = /if \(kind === 'charge-forgive'\) \{[\s\S]*?\n    \}/.exec(SCRIPT)[0];
  ok(/if \(!fgReason \|\| !fgBy\) \{/.test(f), 'a charge can be forgiven with no reason or nobody agreeing it');
  const u = /if \(act\.indexOf\('charge-unforgive:'\) === 0\) \{[\s\S]*?\n    \}/.exec(SCRIPT)[0];
  ok(/uc\.note = forgivenessUndoneNote\(/.test(u), 'undoing a forgiveness erases it without a trace');
  const { forgivenessUndoneNote } = sandbox(['fmt', 'forgivenessUndoneNote']);
  const n1 = forgivenessUndoneNote('', { date: '2026-10-01', by: 'Committee Chair', reason: 'hardship' }, 4000, '2026-10-09');
  ok(/undone 2026-10-09/.test(n1) && /by Committee Chair: hardship/.test(n1) && /\$40\.00/.test(n1), 'the trace: ' + n1);
  ok(forgivenessUndoneNote(n1, null, 4000, '2026-11-01').indexOf(n1) === 0, 'a second undo replaces the first trace');
});

test('M11: a new pack’s youth registration is paid by families, so the family cost counts it', () => {
  // freshLine defaults to pack-pays, so the seeded registration was left out of every family quote.
  const { SEED_EXPENSES, freshLine } = sandbox(REG_FNS);
  const youth = freshLine(SEED_EXPENSES.filter(e => e.name === 'Youth registration')[0]);
  eq(youth.fundedBy, 'families', 'youth registration seeds as pack-paid');
  const adult = freshLine(SEED_EXPENSES.filter(e => e.name === 'Adult leader registration')[0]);
  eq(adult.fundedBy, 'pack', 'leaders’ registration is the pack’s, and must not bill a family');
});

test('M11: the family-cost card says who pays registration and what else it leaves out', () => {
  const ex = /function familyCostExclusions\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT);
  ok(ex, 'familyCostExclusions() not found');
  ok(/!lineFamilyFunded\(l\) \? 'pack'/.test(ex[0]), 'a pack-paid registration is not detected');
  ok(/lineFamilyFunded\(l\) && !linePerHead\(l\)/.test(ex[0]), 'flat family-paid lines are not named');
  const fn = /function renderFamilyYearCost\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0].replace(/'\s*\+\s*'/g, '');
  ok(/ex\.registration === 'pack'/.test(fn) && /The pack pays national youth registration/.test(fn),
    'a pack that pays registration is not told it is missing from the figure');
  ok(/a second parent/.test(fn), 'the second parent is not listed as excluded');
  // Existing packs keep their choice: the seed is only used to ADD a missing line.
  const seed = /function seedStandardYear\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  ok(/if \(existingExp\[t\.name\.toLowerCase\(\)\]\) return;/.test(seed), 'reseeding would overwrite a pack’s registration line');
  const pv = /function parentFamilyCost\(pv\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0].replace(/'\s*\+\s*'/g, '');
  ok(/fees in the pack’s plan<\/strong> for one scout and one parent across a typical year/.test(pv) && /Not included:/.test(pv),
    'the family view still reads as the most a family can be asked for');
});

test('a past season’s months read right whichever year-start it was closed under', () => {
  const { seasonSlotLabel } = sandbox(['PROGRAM_MONTHS', 'PROGRAM_TURN', 'PROGRAM_JULY_SINCE', 'archiveSlotBase', 'seasonSlotLabel']);
  const july = { year: 2026, slotBase: 'july', closedAt: '2027-06-30T12:00:00Z' };
  eq(seasonSlotLabel(july, 0), 'July 2026', 'July-based slot 0');
  eq(seasonSlotLabel(july, 5), 'December 2026', 'the July year still owns December');
  eq(seasonSlotLabel(july, 6), 'January 2027', 'January is the following calendar year');
  eq(seasonSlotLabel(july, 11), 'June 2027', 'June');
  const sept = { year: 2025, closedAt: '2026-06-15T12:00:00Z' };   // closed before the switch, no marker
  eq(seasonSlotLabel(sept, 0), 'September 2025', 'an old archive’s slot 0 is September, not July');
  eq(seasonSlotLabel(sept, 3), 'December 2025', 'December');
  eq(seasonSlotLabel(sept, 4), 'January 2026', 'January');
  eq(seasonSlotLabel(sept, 11), 'August 2026', 'August');
  eq(seasonSlotLabel({ year: 2026, closedAt: '2026-08-01T00:00:00Z' }, 6), 'January 2027',
    'an archive closed after the switch, before the marker, is July-based');
  const build = /function buildSeasonArchive\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  ok(/slotBase: 'july'/.test(build), 'a new archive does not say which slot numbering it uses');
});

test('E9: budget vs actual, by category, with variance', () => {
  const { budgetVsActual, LINE_CATEGORIES } = sandbox(['LINE_CATEGORIES', 'budgetVsActual']);
  const out = budgetVsActual([
    { category: 'camp', planned: 80000, actual: 102000 },
    { category: 'camp', planned: 20000, actual: 0 },
    { category: 'registration', planned: 85000, actual: 85000 },
    { category: 'advancement', planned: 35000, actual: 31250 },
    { category: 'uniforms', planned: 0, actual: 0 }
  ], LINE_CATEGORIES);
  const byCat = {};
  out.rows.forEach((r) => { byCat[r.category] = r; });
  eq(byCat.camp && [byCat.camp.planned, byCat.camp.actual, byCat.camp.variance], [100000, 102000, 2000], 'camp, over by $20');
  eq(byCat.advancement.variance, -3750, 'advancement, under');
  eq(byCat.registration.variance, 0, 'registration on plan');
  ok(!byCat.uniforms, 'an empty category is listed');
  eq(out.total, { planned: 220000, actual: 218250, variance: -1750 }, 'total');
  // In 510-278 order, which is how a committee reads it.
  const order = LINE_CATEGORIES.map((c) => c[0]);
  const got = out.rows.map((r) => order.indexOf(r.category));
  eq(got, got.slice().sort((a, b) => a - b), 'rows are not in category order');
  const now = /function budgetVsActualNow\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  ok(/if \(l\.category === 'income'\) return;/.test(now), 'income lines are reported as spending');
  ok(/if \(!lineThroughPack\(l\)\) \{\s*items\.push\(\{ category: BVA_REIMBURSE, planned: 0, actual: lineActual\(l\.id\) \}\);/.test(now),
    'paid-direct money is planned as the pack’s, or its reimbursements are filed under the line’s category');
  ok(/h \+= renderBudgetVsActual\(\);/.test(/function renderBudget\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0]),
    'the Budget workspace does not show it');
});

test('M4: a credit carried from last year settles charges but is not new money in', () => {
  // Found driving a real close-out in the browser: the carried credit is already inside the
  // carryover, and counting it under Received put it in Funds in a second time.
  const { chargeTotals, familyOutstanding } = sandbox(CHARGE_FNS);
  const charges = [{ scoutId: 'cal', amountCents: 8000, waivedBy: '', forgiven: null }];
  const ledger = [{ direction: 'in', scoutId: 'cal', amountCents: 5000, source: 'carryover', date: '2027-06-30' }];
  eq(familyOutstanding(charges, ledger, 'cal'), 3000, 'the credit settles part of the new dues');
  const t = chargeTotals(charges, ledger);
  eq([t.paid, t.carried, t.outstanding], [0, 5000, 3000], 'carried, not received');
});

/* ================================================================
   Popcorn Kernel audit, 2026-09
   ================================================================ */
test('P1: a Trail’s End import keeps the day each online/wagon order was taken', () => {
  const ctx = sandbox(['toCents', 'teSaleDateISO', 'mapSalesReport', 'teLiveEntriesFor']);
  vm.runInContext('function defaultProgramYear() { return 2026; }', ctx);
  eq(ctx.teSaleDateISO('9/14/2026 10:32 AM'), '2026-09-14', 'US text');
  eq(ctx.teSaleDateISO('2026-10-01T12:00:00'), '2026-10-01', 'ISO text');
  eq(ctx.teSaleDateISO('46279'), '2026-09-14', 'Excel serial');
  eq(ctx.teSaleDateISO('soon'), '', 'unreadable');
  // K3 — a day the month does not have is undated, not a string that compares like a date.
  eq(ctx.teSaleDateISO('2/31/2026'), '', '2/31');
  eq(ctx.teSaleDateISO('2026-04-31'), '', 'April 31st, ISO');
  eq(ctx.teSaleDateISO('2/29/2027'), '', 'Feb 29 in a common year');
  eq(ctx.teSaleDateISO('2/29/2028'), '2028-02-29', 'Feb 29 in a leap year');
  eq(ctx.teSaleDateISO('12/31/2026'), '2026-12-31', 'the last day of a month');
  const hdr = { headerRow: 0, col: { 'Order Number': 0, 'Scout': 1, 'Sale Type': 2, 'Total Order Amount': 3, 'Date Taken': 4 } };
  const rows = [[],
    ['1', 'Ada', 'Online', '100.00', '9/14/2026'],
    ['2', 'Ada', 'Online', '50.00', '9/14/2026'],
    ['3', 'Ada', 'Wagon', '20.00', '10/20/2026'],
    ['4', 'Ada', 'Online', '5.00', '']];
  const arc = ctx.mapSalesReport(rows, hdr);
  eq(arc.undatedRows, 1, 'undated rows are counted for the preview warning');
  const out = ctx.teLiveEntriesFor(Object.assign({ scoutId: 'a' }, arc.scouts[0]), '2026-11-02');
  eq(out.map((e) => [e.date, e.kind, e.salesCents]),
    [['2026-09-14', 'online', 15000], ['2026-10-20', 'wagon', 2000], ['2026-11-02', 'online', 500]],
    'one row per scout per day, undated money falls back to today');
  // A tier due 2026-10-01 must still see the September sale after an import in November.
  const commit = /function teCommitSalesLive\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  ok(/teLiveEntriesFor\(row, today\)/.test(commit) && !/date: today/.test(commit),
    'the live import stamps sales with the import date again');
  ok(/arc\.undatedRows/.test(SCRIPT), 'the preview no longer warns about undated orders');
});

test('P6: the import preview lists unknown sale types and hand-entered duplicates', () => {
  const ctx = sandbox(['toCents', 'teSaleDateISO', 'mapSalesReport', 'teManualOverlap']);
  vm.runInContext('function defaultProgramYear() { return 2026; }', ctx);
  const hdr = { headerRow: 0, col: { 'Order Number': 0, 'Scout': 1, 'Sale Type': 2, 'Total Order Amount': 3, 'Date Taken': 4 } };
  const arc = ctx.mapSalesReport([[],
    ['1', 'Ada', 'Online', '10.00', '9/14/2026'],
    ['2', 'Ada', 'Direct Ship', '30.00', '9/14/2026'],
    ['3', 'Bo', 'Direct Ship', '12.00', '9/15/2026']], hdr);
  eq(arc.otherTypes, [{ type: 'Direct Ship', rows: 2, cents: 4200 }], 'unknown sale types are dropped silently');
  const matched = [{ scoutId: 'a', name: 'Ada', onlineCents: 1000, wagonCents: 0 }, { scoutId: 'b', name: 'Bo', onlineCents: 0, wagonCents: 0 }];
  const entries = [
    { scoutId: 'a', kind: 'online', salesCents: 1000 },
    { scoutId: 'b', kind: 'wagon', salesCents: 500 },
    { scoutId: 'a', kind: 'online', salesCents: 1000, source: 'te-import' }];
  eq(ctx.teManualOverlap(matched, entries), ['Ada'], 'only a scout the import will also credit is flagged');
  ok(/teManualOverlap\(teMatchScouts\(arc\.scouts\)\.matched, state\.entries\)/.test(SCRIPT) && /arc\.otherTypes\.map/.test(SCRIPT),
    'the preview does not show them');
});

test('P2: another fundraiser counts toward the budget at what the pack keeps', () => {
  const ctx = sandbox(['fundraiserTotals']);
  vm.runInContext('function activeScouts() { return [{ id: "a" }]; }', ctx);
  const sales = [{ scoutId: 'a', cents: 1000 }, { scoutId: 'a', cents: 1000 }];
  const camp = ctx.fundraiserTotals({ sales, keepPct: 45 });
  eq([camp.total, camp.net, camp.perScout.a], [2000, 900, 2000], 'standings gross, budget net');
  eq(ctx.fundraiserTotals({ sales }).net, 2000, 'an old record without keepPct keeps 100%');
  const fs = /function fundingSummary\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  ok(/otherFr \+= fundraiserTotals\(fr\)\.net/.test(fs), 'fundingSummary counts gross fundraiser sales');
  ok(/otherFundraiserIn \+= fundraiserTotals\(fr\)\.net/.test(SCRIPT) && !/otherFundraiserIn \+= fundraiserTotals\(fr\)\.total/.test(SCRIPT),
    'the Budget card counts gross fundraiser sales');
  ok(/fr\.keepPct = \(typeof fr\.keepPct === 'number'[^\n]*: 100;/.test(SCRIPT), 'normalize does not default keepPct to 100');
});

test('P3: a cash goal run through Trail’s End counts only its commission', () => {
  const ctx = sandbox(['fundingSummary', 'commissionRates', 'cashScoutRate', 'cashCreditOn', 'fundraiserTotals']);
  vm.runInContext(`
    var COVER_WHO = [];
    function activeScouts() { return [{ id: 'a' }]; }
    function allBudgetLines() { return [{ key: 'k', line: { id: 'l', category: 'camp' } }]; }
    function linePlanned() { return 100000; }
    function lineThroughPack() { return true; }
    function plannedCoverKeys() { return {}; }
    function lineRaisesCharges() { return false; }
    function coverCostForKeys() { return { extra: 0, extraHeads: 0, extraReimburse: 0 }; }
    function leaderPlannedCents() { return 0; }
    function salesForCommission(c) { return c; }
    var state = { budget: { startingBalance: 0 }, fundraisers: [], charges: [], ledger: [],
      cashGoalCents: 50000, commissionPct: '30', commissionPctOnline: '', cashScoutPct: '10', cashThroughTrailsEnd: false };
  `, ctx);
  const kept = ctx.fundingSummary();
  eq([kept.cashGoalIn, kept.C], [50000, 50000], 'kept cash is 100% the pack’s');
  vm.runInContext('state.cashThroughTrailsEnd = true;', ctx);
  const via = ctx.fundingSummary();
  eq([via.cashGoal, via.cashGoalIn, via.B, via.C], [50000, 15000, 15000, 85000], 'via Trail’s End only 30% is the pack’s');
  // No double credit: the scout cash credit is off while cash runs through Trail's End.
  eq(ctx.commissionRates().cash, null, 'cashScoutPct still credits cash that earns commission');
  // The Trail's End bars measure cash-inclusive teEligible against a cash-inclusive target.
  const cpt = /function computePackTotals\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  ok(/teBarGoal: teGoalNow \+ \(viaTE \? \(state\.cashGoalCents \|\| 0\) : 0\)/.test(cpt), 'teBarGoal missing');
  ok(!/teEligible \/ packT?\.teGoal\b/.test(SCRIPT), 'a Trail’s End bar still divides by teGoal');
  // The parent bar adds the gross cash goal to the sales goal and measures every dollar raised,
  // so it stays consistent without change.
  ok(/var goalCents = \(pack\.teGoal \|\| 0\) \+ \(pack\.cashGoal \|\| 0\);/.test(BPV()) && /var raised = withAmounts \? pack\.combined :/.test(BPV()),
    'the parent goal bar changed shape');
});

// The tier readers below price a share for a scout only where the line BILLS that scout.
function tierScopeSandbox() {
  const ctx = vm.createContext({});
  vm.runInContext(`
    ${slice('arrOf')} ${slice('COVER_WHO')} ${slice('coverKeyOf')} ${slice('lineRateForWho')}
    ${slice('scoutsInDens')} ${slice('familiesOf')} ${slice('familyBillingScout')}
    ${slice('lineBillingRoster')} ${slice('lineBillingIds')}
    ${slice('coverValueOfKeys')} ${slice('tierCoverCentsPerScout')}
    ${slice('familyFeeHolder')} ${slice('familyCoverage')} ${slice('shareCountsForScout')}
    ${slice('packCoverageByScout')} ${slice('privateBenefitCheck')} ${slice('entryRefundsFamily')} ${slice('tierReimbursements')}
    function familyKeyOf(s) { return s.familyId || s.id; }
    function linePerFamily(l) { return !!l.perFamily; }
    function lineDens(l) { return l.dens || []; }
    function lineRoster(l) { return scoutsInDens(activeScouts(), lineDens(l)); }
    function activeScouts() { return SCOUTS; }
    function tierCoverageConfigured() { return true; }
    // wolf, and two Webelos siblings (web1 bills the family), all reached every tier.
    var SCOUTS = [{ id: 'wolf', den: 'Wolf' }, { id: 'web1', den: 'Webelos' }, { id: 'web2', den: 'Webelos', familyId: 'web1' }];
    var WEB = { id: 'webfee', scoutRateCents: 5000, dens: ['Webelos'] };
    var CAMP = { id: 'camp', scoutRateCents: 8000, perFamily: true };
    var LINES = [{ key: 'webfee', line: WEB }, { key: 'camp', line: CAMP }];
    function coverableLines() { return LINES; }
    function coverableShares() {
      return [{ coverKey: 'webfee', item: WEB, rate: 5000, reimburse: false },
              { coverKey: 'camp', item: CAMP, rate: 8000, reimburse: true }];
    }
    var ALL = { wolf: true, web1: true, web2: true };
    function packCoverage() { return { webfee: ALL, camp: ALL }; }
    function computePackTotals() { return { commission: 100000 }; }
    var T = { id: 't', covers: ['webfee', 'camp'] };
    function sortedTiers() { return [T]; }
    function tierEarnedMap() { return { t: ALL }; }
    var state = { ledger: [] };
  `, ctx);
  return ctx;
}

test('P4: a tier prices a den-limited fee only for the dens it is for', () => {
  const ctx = tierScopeSandbox();
  const s = (id) => ctx.SCOUTS.find((x) => x.id === id);
  const t = ctx.T;
  eq(ctx.tierCoverCentsPerScout(t, s('wolf')), 8000, 'a Wolf is asked to make up a Webelos-only fee');
  eq(ctx.tierCoverCentsPerScout(t, s('web1')), 13000, 'the Webelos billing scout');
  eq(ctx.tierCoverCentsPerScout(t, s('web2')), 5000, 'a sibling carries the family fee a second time');
  eq(ctx.tierCoverCentsPerScout(t), 13000, 'the unscoped pack-level figure changed');
  eq(ctx.coverValueOfKeys({ webfee: true }, s('wolf')), 0, 'coverValueOfKeys ignores dens');
  const by = ctx.packCoverageByScout();
  eq([by.wolf, by.web1, by.web2], [8000, 13000, 5000], 'packCoverageByScout');
  // 5000 × 2 Webelos + 8000 × 3 families would be 34000; the families are wolf and web1.
  eq(ctx.privateBenefitCheck().back, 26000, 'privateBenefitCheck overstates what goes back');
  const src = /function tierShortfallRows\(t, map\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  ok(/tierCoverCentsPerScout\(t, s, cov\)/.test(src), 'the make-up cap is not per scout');
  const tpr = /function tierProgressRows\(\w*\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  ok(/coverOf\(next, s\)/.test(tpr) && /coverValueOfKeys\(addedKeys, s, famCov\)/.test(tpr), 'the progress row is not per scout');
});

test('P5: a per-family paid-direct fee is reimbursed once per family', () => {
  const ctx = tierScopeSandbox();
  const rows = ctx.tierReimbursements().map((r) => r.scout.id);
  eq(rows, ['wolf', 'web1'], 'one reimbursement row per family');
  // Paid back against the OTHER sibling still settles the family.
  ctx.state.ledger = [{ direction: 'out', lineId: 'camp', scoutId: 'web2', amountCents: 8000 }];
  const web = ctx.tierReimbursements().find((r) => r.scout.id === 'web1');
  eq([web.paid, web.left], [8000, 0], 'a payment recorded against a sibling is not seen');
});

test('P7: a new popcorn order projects at the season rate, not a hard-coded 32%', () => {
  const ctx = sandbox(['freshInventory', 'commissionRates', 'cashScoutRate', 'cashCreditOn', 'inventoryTotals']);
  vm.runInContext(`
    function containersOrdered() { return 0; } function productValueCents() { return 0; }
    var state = { commissionPct: '35', commissionPctOnline: '30', cashScoutPct: '', cashThroughTrailsEnd: false,
      inventory: freshInventory() };
    state.inventory.orderTotalCents = 100000;`, ctx);
  eq(ctx.state.inventory.commissionPct, '', 'a fresh inventory still carries a rate of its own');
  const t = ctx.inventoryTotals();
  eq([t.pct, t.earningsCents, t.pctFromSeason], [35, 35000, true], 'blank does not follow the season storefront rate');
  vm.runInContext("state.inventory.commissionPct = '32';", ctx);
  eq(ctx.inventoryTotals().earningsCents, 32000, 'a typed rate is no longer honoured');
  ok(/inv\.commissionPct = typeof inv\.commissionPct === 'string' \? inv\.commissionPct : '';/.test(SCRIPT),
    'normalize still invents 32% for a record without a rate');
});

test('P8: a fundraiser card says what the council needs before the money is raised', () => {
  const ctx = sandbox(['FUNDRAISER_KINDS', 'fundraiserPaperworkGap']);
  eq(ctx.FUNDRAISER_KINDS.map((k) => k.id), ['council', 'sale', 'raffle'], 'kinds');
  const rule = (id) => ctx.FUNDRAISER_KINDS.find((k) => k.id === id).rule;
  ok(/no Unit Money-Earning Application/.test(rule('council')), 'a council product sale is not exempted');
  ok(/34427/.test(rule('sale')) && /14 days/.test(rule('sale')), 'the other-sale rule lost the form or the lead time');
  // K1 (final review, 2026-09-28) — the Kernel's wording, verbatim where it is load-bearing.
  eq(ctx.FUNDRAISER_KINDS[0].label, 'Council product sale (e.g. popcorn)', 'council label');
  eq(rule('council'), 'A council-coordinated product sale needs no Unit Money-Earning Application (form 34427). ' +
    'If you\u2019re not sure the council runs this sale, ask first.', 'council rule');
  ok(/written approval at least 14 days before the pack commits to it \u2014 before anything is signed, ordered or paid for\./.test(rule('sale')) &&
    /sell on its own merit, not as a gift to Scouting/.test(rule('sale')) && /signed by a person, never in Scouting America\u2019s name/.test(rule('sale')) &&
    /wearing the uniform needs council approval/.test(rule('sale')), 'the sale rule is not the Kernel\u2019s');
  ok(/before you advertise it, sell a ticket or organize it/.test(rule('raffle')) &&
    /form 34427 still says raffles are forbidden/.test(rule('raffle')) && /November 7, 2025/.test(rule('raffle')) &&
    /at most four games of chance a calendar year in total/.test(rule('raffle')) && /only raffles may be run online/.test(rule('raffle')) &&
    /no alcohol or firearm prizes/.test(rule('raffle')) && /casino night or bingo/.test(rule('raffle')) &&
    /name the pack by its number/.test(rule('raffle')) && /raffle license from the county sheriff/.test(rule('raffle')) &&
    /may be stricter or not allow raffles at all/.test(rule('raffle')), 'the raffle rules are incomplete');
  ok(!/four raffles|before it starts|before the start/.test(JSON.stringify(ctx.FUNDRAISER_KINDS)), 'the old wording is still there');
  const gap = ctx.fundraiserPaperworkGap;
  eq(gap({ kind: 'council' }), '', 'a council sale has nothing outstanding');
  eq(gap({ kind: '' }), '', 'an unclassified fundraiser is not nagged');
  ok(/34427/.test(gap({ kind: 'sale' })) && /before the pack commits to it\./.test(gap({ kind: 'sale' })), 'a sale with no application is not flagged');
  eq(gap({ kind: 'sale', appSubmitted: '2026-09-01' }),
    'Application in, no approval recorded yet \u2014 don\u2019t sign, order or pay for anything until the council approves it.',
    'an application in is treated as permission');
  eq(gap({ kind: 'sale', appSubmitted: '2026-09-01', councilApproved: '2026-09-05' }), '', 'an approved sale still flagged');
  ok(/approval/.test(gap({ kind: 'raffle', appSubmitted: '2026-09-01' })), 'a raffle without approval is not flagged');
  eq(gap({ kind: 'raffle', appSubmitted: '2026-09-01', councilApproved: '2026-09-10' }), '', 'an approved raffle still flagged');
  ok(/fr\.kind = \['council', 'sale', 'raffle'\]\.indexOf\(fr\.kind\) !== -1 \? fr\.kind : '';/.test(SCRIPT), 'normalize does not keep kind');
  ok(/h \+= fundraiserPaperworkBlock\(fr\);/.test(/function renderFundraiserCard\(fr, roster\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0]),
    'the card does not show it');
  ok(/if \(ch === 'fr-kind' \|\| ch === 'fr-app' \|\| ch === 'fr-approved'\)/.test(SCRIPT), 'the fields are not saved');
});

test('P9: the private-benefit panel is one test, not a ruling, and says its figure is conservative', () => {
  const i = SCRIPT.indexOf('var pb = privateBenefitCheck();');
  ok(i !== -1, 'the private-benefit panel was not found');
  const blk = codeOnly(SCRIPT.slice(i, i + 2200));
  ok(/confirm this setup with the council and your chartered organization/.test(blk), 'the panel does not send the pack to the council');
  ok(/conservative figure: it counts popcorn commission only/.test(blk), 'the figure is not labelled conservative');
  ok(!/side of that line to be on/.test(blk), 'the panel still implies 50% settles it');
});

test('B3: the pack owner removed by another admin is healed, not wiped', () => {
  const ctx = roleSubCtx({ owner: 'me' });
  // ensureMyMemberDoc recreates the owner as admin; the subscription then resolves as admin.
  vm.runInContext("var resolve; HEAL = { then: function (ok) { resolve = ok; } };", ctx);
  vm.runInContext('applyRoleSubscription(null, 1)', ctx);
  eq(vm.runInContext('[removed.length, stopped.length, state.money || null, sync.joinRejected]', ctx),
    [0, 0, 'the pack record', null], 'the owner’s device was wiped');
  vm.runInContext('applyRoleSubscription(null, 1)', ctx);
  eq(vm.runInContext('healCalls', ctx), 1, 'a second removal signal started a second heal');
  vm.runInContext("resolve('admin')", ctx);
  eq(vm.runInContext('[sync.myRole, sync.ownerHealing, removed.length]', ctx), ['admin', false, 0], 'the heal did not resolve the role');
});

test('B5: an unverified Google email gets its own gate before anything touches the cloud', () => {
  const fn = slice('syncStart');
  const gate = fn.indexOf("if (isGoogleUser(u) && u.emailVerified === false) {");
  ok(gate !== -1, 'syncStart does not check emailVerified');
  ok(gate < fn.indexOf('sync.db = mods.fs.getFirestore') && gate < fn.indexOf('startAccounts('),
    'the verified check comes after the cloud is touched');
  const blk = fn.slice(gate, fn.indexOf('sync.db = mods.fs.getFirestore'));
  ok(/sync\.joinRejected = 'unverified';/.test(blk) && /return;/.test(blk), 'the unverified branch does not stop at a gate');
  const closed = slice('renderJoinClosed');
  ok(/if \(sync\.joinRejected === 'unverified'\)/.test(closed) &&
    /Google hasn’t verified this email address yet — verify it with Google, then sign in again\./.test(closed),
    'no screen tells them to verify with Google');
});

test('B6: the family digest carries no popcorn numbers while standings are off', () => {
  const fn = slice('monthlyDigest');
  const i = fn.indexOf("lines.push('POPCORN');");
  ok(i !== -1, 'the POPCORN section was not found');
  const guard = fn.slice(0, i).split('\n').filter((l) => /^\s*if \(/.test(l)).pop() || '';
  ok(/standingsEnabled\(\)/.test(guard), 'the POPCORN section is not gated on standingsEnabled()');
  const ctx = digestCtx();
  ok(/POPCORN/.test(vm.runInContext("monthlyDigest('2026-10')", ctx)), 'standings on: the popcorn section is gone');
  vm.runInContext('STANDINGS = false;', ctx);
  const off = vm.runInContext("monthlyDigest('2026-10')", ctx);
  ok(!/POPCORN/.test(off) && off.indexOf('690.00') === -1 && !/goal/i.test(off), 'calendar-only: popcorn numbers in the families’ digest');
  ok(/EVENTS THIS MONTH/.test(off), 'calendar-only: the calendar went too');
});

test('B8: the calendar file carries where an event is, but no free-text note', () => {
  const ctx = vm.createContext({});
  vm.runInContext(PRIV_STATE + `
    state.events[0].note = 'Gym — Ada Q. needs a ride, call 555-0101';
    state.events[0].location = 'Church hall';
    state.events[1].note = 'Gate code 4411';
    function pad2(n) { return (n < 10 ? '0' : '') + n; }
    ${['buildICS', 'icsStamp', 'icsDate', 'icsTime', 'icsNextDay', 'icsEndPlusHour', 'icsEscape', 'icsFold',
       'eventIsMeeting', 'eventLabel', 'fmt'].map(slice).join('\n')}`, ctx);
  const ics = vm.runInContext('buildICS()', ctx);
  ok(!/DESCRIPTION:/.test(ics) && ics.indexOf('555-0101') === -1 && ics.indexOf('4411') === -1,
    'a free-text note is in the calendar file');
  ok(/LOCATION:Fort Yargo/.test(ics) && /LOCATION:Church hall/.test(ics), 'the where was dropped with the note');
  ok(/not its notes/.test(SCRIPT.slice(SCRIPT.indexOf('Sync with BAND'), SCRIPT.indexOf('Sync with BAND') + 2000)),
    'the export card does not say notes are left out');
});

/* ========================================================================
   Wave 6 — parents and joining (2026-09-28)
   ===================================================================== */

// A runnable buildParentView over PRIV_STATE, with the pieces it leans on stubbed. `extra` runs
// after the state is declared, so a test can move dates or add rows before the build.
function pvCtx(extra) {
  const ctx = vm.createContext({});
  vm.runInContext(PRIV_STATE + `
    function standingsEnabled() { return true; }
    function campingTrips() { return []; }
    function familyYearCost() { return []; }
    var sync = {};
    ${['shortNames', 'publicNameMap', 'buildParentView', 'coarseBarPct', 'blocksInDayOrder', 'fmtTimeRange', 'fmtClock',
       'eventIsMeeting', 'eventLabel', 'denListLabel', 'eventDens', 'programYearStartISO',
       'programYearEndISO', 'cleanContactLine', 'parentContactLine', 'amountsEnabled'].map(slice).join('\n')}
    ${extra || ''}`, ctx);
  return ctx;
}

test('J1: the published calendar is the July-to-June program year, edges included', () => {
  const ctx = pvCtx(`
    state.events = [
      { id: 'j0', kind: 'activity', name: 'Last June hike', date: '2026-06-30', dens: [] },
      { id: 'j1', kind: 'activity', name: 'School Night', date: '2026-07-01', dens: [] },
      { id: 'j2', kind: 'activity', name: 'Summer outing', date: '2026-08-15', dens: [] },
      { id: 'j3', kind: 'activity', name: 'Crossover', date: '2027-06-30', dens: [] },
      { id: 'j4', kind: 'activity', name: 'Next kickoff', date: '2027-07-01', dens: [] }
    ];
    state.storefronts[0].date = '2026-07-20';
    state.derby = { name: 'Derby', date: '2026-08-01' };`);
  const pv = vm.runInContext('buildParentView(state, { showStandings: false })', ctx);
  const titles = pv.events.map((e) => e.title);
  ['School Night', 'Summer outing', 'Crossover'].forEach((t) =>
    ok(titles.indexOf(t) > -1, `${t} is inside the program year and did not publish`));
  ['Last June hike', 'Next kickoff'].forEach((t) =>
    ok(titles.indexOf(t) === -1, `${t} is outside the program year and published`));
  ok(pv.events.some((e) => e.kind === 'storefront' && e.date === '2026-07-20'), 'a July storefront did not publish');
  ok(pv.events.some((e) => e.kind === 'derby' && e.date === '2026-08-01'), 'an August derby date did not publish');
  ok(!/'-09-01'|'-08-31'/.test(BPV()), 'buildParentView still carries a September-to-August window');
});

test('J3: the waiting screen says what a family can do while they wait', () => {
  const w = codeOnly(slice('renderJoinWaiting'));
  ok(w.indexOf('Nothing else to do') === -1, 'the waiting screen still says there is nothing to do');
  ok(/beascout\.scouting\.org/.test(w), 'the waiting screen does not point at council registration');
  ok(/Safeguarding Youth\s*'?\s*\+?\s*'?\s*Training/.test(w), 'the adult-partner training is not named');
  ok(/ask your den leader/.test(w), 'the waiting screen gives no one to ask when approval is slow');
});

test('J4: the invite promises the standings only where they are known to be on', () => {
  const run = (setup) => {
    const ctx = vm.createContext({});
    vm.runInContext(`${setup}
      function standingsEnabled() { return !(sync.joinCfg && sync.joinCfg.showStandings === false); }
      ${slice('joinStandingsKnownOn')}
      ${slice('joinWhatYouSee')}`, ctx);
    return vm.runInContext('joinWhatYouSee()', ctx);
  };
  const plain = 'the pack calendar and campout details';
  eq(run('var sync = {}; function parentDoc() { return null; }'), plain, 'a signed-out visitor was promised standings');
  eq(run('var sync = { joinCfg: { showStandings: false } }; function parentDoc() { return null; }'), plain,
    'a calendar-only pack promised standings');
  eq(run('var sync = {}; function parentDoc() { return { events: [] }; }'), plain,
    'a published calendar-only view promised standings');
  ok(/scout standings/.test(run('var sync = {}; function parentDoc() { return { standings: [] }; }')),
    'a view that publishes standings does not say so');
  ok(/joinWhatYouSee\(\)/.test(slice('renderJoinWelcome')), 'the welcome screen does not use the branch');
  ok(!/and the scout standings\./.test(slice('renderJoinWelcome')), 'the welcome screen still promises standings outright');
});

test('J5: what is left to sell reads as a choice, in a family’s words', () => {
  const ctx = sandbox(['esc', 'fmt', 'parentBar', 'parentRouteLabel', 'parentRouteNoun', 'parentTierProgress']);
  const row = (routes) => ctx.parentTierProgress({ tier: '', nextTier: 'Gold', nextPct: 40,
    nextSalesCents: routes[0].cents, nextRoutes: routes });
  const onlineBetter = row([{ label: 'at a storefront or wagon', pct: 25, cents: 24000 },
    { label: 'online', pct: 30, cents: 20000 }]);
  ok(/Still to sell: <strong class="money">\$240\.00<\/strong> at a storefront or door to door — or <strong class="money">\$200\.00<\/strong> online/.test(onlineBetter),
    'the two figures are not one sentence joined by "or"');
  ok(/\(online sales count for more toward the reward\)/.test(onlineBetter), 'the better channel is not named');
  ok(!/wagon/.test(onlineBetter) && !/\d%\)/.test(onlineBetter), 'the parent line still says "wagon" or quotes a rate');
  // This pack's own case: online is the LOWER rate, so the storefront is the one that counts for more.
  const storeBetter = row([{ label: 'online', pct: 25, cents: 24000 },
    { label: 'at a storefront or wagon', pct: 30, cents: 20000 }]);
  ok(/\(storefront and door-to-door sales count for more toward the reward\)/.test(storeBetter),
    'the better channel is assumed to be online');
  // One route: the figure alone, no rate.
  const one = row([{ label: 'in popcorn', pct: 25, cents: 24000 }]);
  ok(/\$240\.00<\/strong> more to sell/.test(one) && !/%\)/.test(one), 'a single route still quotes its rate');
});

test('J6: a family sees the sync status as words, never as a button that does nothing', () => {
  const span = /<span class="sync-pill sync-text no-print" id="syncText"[^>]*>/.exec(HTML);
  ok(span, 'there is no text-only sync status for parents');
  ok(!/data-act/.test(span[0]), 'the parents’ sync status carries an action');
  const fn = slice('renderSyncPill');
  ok(/var asText = !gm && parentMode\(\)/.test(fn), 'the text status is not tied to parent mode');
  ok(/el\.hidden = gm \|\| asText;/.test(fn), 'the goto-pack button still shows for parents');
  const acts = /var PARENT_ACTS = \[([\s\S]*?)\];/.exec(SCRIPT);
  ok(acts[1].indexOf("'goto-pack'") === -1, 'goto-pack became a parent action — revisit this test');
  ok(/offline: 'Offline — showing what was saved last'/.test(SCRIPT), 'offline is not explained to families');
  ok(/tabsEl\.setAttribute\('aria-label', parent \? 'Pack pages' : 'Workspaces'\)/.test(SCRIPT),
    'the parent nav is still announced as "Workspaces"');
});

test('J7: a family’s controls are 44px, and the calendar says what is on a day without colour', () => {
  const css = SCRIPT_CSS;
  ok(/body\.parent-mode button\.btn\.small, \.join-gate button\.btn \{ min-height: 44px/.test(css),
    'Sign out / Show N / Forget this link are under 44px for families');
  ok(/body\.parent-mode \.cal-nav \{ width: 44px; height: 44px; \}/.test(css), 'the month arrows are under 44px');
  ok(/body\.parent-mode \.tab, body\.parent-mode \.snav \{ min-height: 44px; \}/.test(css),
    'the parent tabs or campout sub-tabs are under 44px');
  ok(/body\.parent-mode \.camp-toc-secs a \{[^}]*min-height: 44px[^}]*padding: 10px 0/.test(css),
    'the camping "On this page" links are not padded to a tap target');
  // Letter per kind, and the kinds in the day's spoken label.
  const ctx = vm.createContext({});
  vm.runInContext(`var ui = {}; function monthKey(d) { return String(d).slice(0, 7); }
    function monthLabel(k) { return k; } function fmtDate(d) { return 'Sat, Oct 3'; }
    ${['esc', 'pad2', 'parentEventRow', 'parentShiftLines', 'parentCalendar'].map(slice).join('\n')}`, ctx);
  ctx.pv = { events: [
    { kind: 'meeting', date: '2026-10-03', title: 'Wolf den meeting' },
    { kind: 'storefront', date: '2026-10-03', title: 'Kroger', shifts: [{ when: '10–12', who: [] }] }] };
  const cal = vm.runInContext("parentCalendar(pv, '2026-10-01')", ctx);
  ok(/aria-label="Sat, Oct 3: den meeting, storefront"/.test(cal), 'the day does not say what is on it');
  ok(/class="cal-dot2 cal-glyph dot-mtg" aria-hidden="true">D</.test(cal), 'a den meeting dot has no letter');
  ok(/class="cal-dot2 cal-glyph dot-store-open" aria-hidden="true">S</.test(cal), 'a storefront dot has no letter');
  // Print.
  ok(/\.pv-row, \.camp-facts, \.camp-list li \{ break-inside: avoid; \}/.test(css), 'an event or a campout fact can split across sheets');
  ok(/\.pill, \.cal-dot2 \{ -webkit-print-color-adjust: exact/.test(css), 'the calendar dots print without their colour');
  ok(/class="btn small no-print" data-act="parent-earlier"/.test(SCRIPT), 'the Show N button prints');
  ok(/<div class="card no-print"><nav class="camp-toc"/.test(SCRIPT), 'the camping contents menu prints');
  ok(/'<p class="print-only pv-print-head">'/.test(slice('renderParentApp')) && / · printed /.test(slice('renderParentApp')),
    'the printout does not say whose it is or when it was printed');
});

test('J8: the parent app speaks a family’s language', () => {
  // No "rung" in anything a parent reads. Code only — the comments are the leaders' notes.
  const start = SCRIPT.indexOf('  function renderParentApp()');
  const end = SCRIPT.indexOf('  function parentFooter(');
  ok(start > -1 && end > start, 'the parent block moved');
  const block = codeOnly(SCRIPT.slice(start, end));
  const strings = block.match(/'[^'\n]*'/g) || [];
  ok(!strings.some((q) => /\brungs?\b/.test(q)), 'a parent-facing string still says "rung": ' +
    strings.filter((q) => /\brungs?\b/.test(q)).join(' | '));
  ok(/<th scope="col">Sell by<\/th>/.test(block), 'the tier table’s date column is still headed "By"');
  ok(/you still pay the adult\\u2019s share/.test(block), 'the adult’s share is still "your place"');
  ok(/one fee covers the whole family/.test(block), 'a per-family fee still says "one fee per family"');
  ok(/Storefront \(popcorn booth outside a store\)/.test(block) && /Booth: all shifts filled/.test(block) &&
    /Booth: a shift still needs a family/.test(block), 'the calendar legend still uses the leaders’ words');
  ok(/Your pack hasn’t posted its calendar yet\. Check back in a few days, or ask your den leader\./.test(SCRIPT),
    'the empty calendar does not say who to ask');
  ok(/Families get a view-only calendar\. Leaders sign in ' \+\s*'here too\. A pack leader approves each account — there’s no password to remember\./.test(slice('renderJoinWelcome')),
    'the sign-in intro is not the plain version');
});

test('J8: the standings legend names the pack’s own levels, in plain words', () => {
  const ctx = sandbox(['esc', 'fmt', 'fmtDate', 'parentBar', 'parentRouteLabel', 'parentRouteNoun',
    'parentTierProgress', 'parentStandingRow', 'parentStepName', 'parentTierLadder', 'parentCostLine',
    'parentCostLines', 'parentFamilyCost', 'parentGoalBar', 'renderParentStandings']);
  ctx.ui = { parentCostOpen: {} };
  const html = ctx.renderParentStandings({
    standings: [{ name: 'Ada', combinedCents: 100, nextTier: 'Acorn', nextPct: 10 }],
    tierLadder: { anchorName: 'Oak', planned: true,
      marks: [{ name: 'Seed', pct: 20 }, { name: 'Acorn', pct: 50 }, { name: 'Oak', pct: 100, plan: true }],
      stretch: { topName: 'Redwood', planPct: 70, marks: [] } }
  });
  ok(/A full bar means <strong>Oak<\/strong>, the level the pack is aiming for\./.test(html), 'the full bar is not explained');
  ok(/smaller rewards on the way \(Seed, Acorn\)/.test(html), 'the marks are not named from the pack’s own tiers');
  ok(!/Bronze|Silver|Gold|Platinum|rung|Notches/.test(html), 'the legend hard-codes tier names or keeps the old jargon');
  ok(/Scouts who have passed <strong>Oak<\/strong> are measured against <strong>Redwood<\/strong> instead\. The striped part of their bar is what they sold beyond Oak\./.test(html),
    'the stretch scale is not explained in plain words');
});

test('J8: What’s coming up is the next 30 days by month, with the rest one tap away', () => {
  const ctx = vm.createContext({});
  vm.runInContext(`var ui = { parentCostOpen: {} };
    function todayISO() { return '2026-09-28'; }
    function monthKey(d) { return String(d).slice(0, 7); }
    function monthLabel(k) { return k === '2026-10' ? 'October 2026' : k === '2026-09' ? 'September 2026' : k; }
    function fmtDate(d) { return String(d); }
    function parentCalendar() { return ''; }
    function parentFamilyCost() { return ''; }
    ${['esc', 'pad2', 'PARENT_EMPTY_CAL', 'isoPlusDays', 'parentEventsByMonth', 'parentEventRow',
       'parentShiftLines', 'renderParentSchedule'].map(slice).join('\n')}`, ctx);
  eq(vm.runInContext("isoPlusDays('2026-09-28', 30)", ctx), '2026-10-28', 'thirty days on');
  eq(vm.runInContext("isoPlusDays('2026-03-01', 30)", ctx), '2026-03-31', 'across a DST change');
  ctx.pv = { standings: [], events: [
    { kind: 'activity', date: '2026-09-01', title: 'Kickoff' },
    { kind: 'activity', date: '2026-09-30', title: 'Hike' },
    { kind: 'activity', date: '2026-10-28', title: 'Trunk or treat' },
    { kind: 'activity', date: '2026-10-29', title: 'Late one' },
    { kind: 'activity', date: '2027-02-20', title: 'Blue and Gold' }] };
  const shut = vm.runInContext('renderParentSchedule(pv)', ctx);
  ok(/Hike/.test(shut) && /Trunk or treat/.test(shut), 'something in the next 30 days is missing');
  ok(!/Late one/.test(shut) && !/Blue and Gold/.test(shut), 'the rest of the year is shown before it is asked for');
  ok(/September 2026<\/p>[\s\S]*Hike[\s\S]*October 2026<\/p>[\s\S]*Trunk or treat/.test(shut), 'the events are not grouped by month');
  ok(/data-act="parent-rest" aria-expanded="false">Show the rest of the year \(2\)/.test(shut), 'no button, or the wrong count');
  ctx.ui.parentRestOpen = true;
  const open = vm.runInContext('renderParentSchedule(pv)', ctx);
  ok(/Late one/.test(open) && /2027-02<\/p>[\s\S]*Blue and Gold/.test(open), 'the rest of the year does not open');
  ctx.pv = { events: [] };
  ok(/Your pack hasn’t posted its calendar yet/.test(vm.runInContext('renderParentSchedule(pv)', ctx)),
    'an empty calendar does not say so plainly');
  ok(/'parent-rest'/.test(/var PARENT_ACTS = \[([\s\S]*?)\];/.exec(SCRIPT)[1]), 'the rest-of-year button is refused in parent mode');
});

test('J9: a campout says when to arrive and when to leave, each on its own labelled row', () => {
  const ctx = sandbox(['esc', 'campLinkLabel', 'campFacts']);
  const both = ctx.campFacts({ arrive: 'Friday 6:00 pm', depart: 'Sunday 11:00 am' });
  ok(/<dt>Arrive<\/dt><dd>Friday 6:00 pm<\/dd><dt>Leave by<\/dt><dd>Sunday 11:00 am<\/dd>/.test(both),
    'arrive and leave are not two labelled rows');
  ok(!/Times/.test(both), 'the merged "Times" row is back');
  const leaveOnly = ctx.campFacts({ depart: 'Sunday 11:00 am' });
  ok(/<dt>Leave by<\/dt>/.test(leaveOnly) && !/Arrive/.test(leaveOnly), 'a leave-only trip is not labelled as leaving');
});

test('J10: the single-pack sign-in screen names the pack and helps someone with no Google account', () => {
  const run = (packName) => {
    const ctx = vm.createContext({});
    vm.runInContext(`var PACK_PUBLIC_NAME = 'Cub Scout Pack 569';
      function fixedPackMode() { return true; } function activeJoin() { return null; }
      function parentDoc() { return ${packName ? `{ packName: '${packName}' }` : 'null'}; }
      var FLEUR = '';
      ${['esc', 'joinPackName', 'joinGateShell', 'renderJoinWelcome'].map(slice).join('\n')}`, ctx);
    return vm.runInContext('renderJoinWelcome()', ctx);
  };
  const out = run('');
  ok(/<h2 class="section display">Cub Scout Pack 569<\/h2>/.test(out), 'the signed-out title is still generic');
  ok(!/Pack sign-in/.test(out), 'the generic title is showing in single-pack mode');
  ok(/No Google account\? Any email address can be made into one at <strong>accounts\.google\.com<\/strong>/.test(out),
    'no help for somebody without a Google account');
  ok(/var PACK_PUBLIC_NAME = 'Cub Scout Pack 569';/.test(SCRIPT), 'the public name constant is gone');
});

test('J11: a leader-written "who to ask" line reaches the foot of every family’s page, and nothing else rides with it', () => {
  const run = (cfg, show) => {
    const ctx = pvCtx(`var sync = { joinCfg: ${JSON.stringify(cfg)} };
      ${slice('cleanContactLine')}
      ${slice('parentContactLine')}`);
    return vm.runInContext(`buildParentView(state, { showStandings: ${show} })`, ctx);
  };
  eq(run({ contact: '  Membership chair —\n pack569@example.com ' }, false).contact,
    'Membership chair — pack569@example.com', 'the line is not published, or not cleaned to one line');
  ok(!('contact' in run({ contact: '   ' }, false)), 'an empty line is published');
  ok(!('contact' in run(null, false)), 'no join config still publishes a contact key');
  eq(run({ contact: 'x'.repeat(500) }, false).contact.length, 160, 'the line is not capped');
  // Calendar-only packs get it too — it names no child.
  ok(BPV().indexOf('out.contact = contactLine') < BPV().indexOf('if (!withStandings) return out;'),
    'the contact line sits behind the standings gate');
  // The footer uses it, escaped; without it the old sentence stands.
  const ctx = vm.createContext({});
  vm.runInContext(`var sync = { user: null }; ${slice('esc')} ${slice('parentFooter')}`, ctx);
  const withC = vm.runInContext(`parentFooter({ packName: 'Pack 569', contact: 'Chair <b>' })`, ctx);
  ok(/Ask: <strong>Chair &lt;b&gt;<\/strong>/.test(withC), 'the footer does not show the line, or does not escape it');
  ok(/Ask a pack leader/.test(vm.runInContext(`parentFooter({ packName: 'Pack 569' })`, ctx)), 'the fallback is gone');
  // The settings field warns that it is public to families.
  const card = slice('renderJoinCard');
  ok(/data-ch="join-contact"/.test(card) && /every approved ' \+\s*'family/.test(card) && /not a personal phone/.test(card),
    'the setting does not say who sees it and what not to put in it');
  ok(/contact: next\.contact/.test(slice('writeJoinConfig')), 'the line is not saved with the join config');
});

test('J12: with amounts and rank off, the board keeps each scout’s progress and no per-scout money', () => {
  const build = (showAmounts) => {
    const ctx = pvCtx(`
      state.derby = { name: '', date: '', awards: [] };
      function computePackTotals() { return { combined: 99000, teGoal: 200000, cashGoal: 0 }; }
      var TOT = { s1: 30000, s2: 60000, s3: 9000 };
      function computeScoutTotals() { return TOT; }
      function visibleScoutRows(t) {
        return state.scouts.map(function (s) { return { id: s.id, den: s.den, t: { combined: t[s.id] } }; });
      }
      function rankBy(rows, key) { return rows.slice().sort(function (a, b) { return key(b) - key(a); }); }
      function tierProgressRows() {
        return state.scouts.map(function (s) {
          return { scout: s, earned: { name: 'Bronze' }, next: { name: 'Gold', reward: 'Camp' }, shortSales: 12345,
            unlocks: 4000, sellRoutes: [{ label: 'online', pct: 30, cents: 12345 }], anchorPct: 40, pct: 55,
            nextMarkPct: 100, pastPlan: false, ladder: { plan: { name: 'Gold' }, marksPlan: [] } };
        });
      }
      function plannedTier() { return { name: 'Gold' }; }
      function derbyWinners() { return []; }
      function sortedTiers() { return []; }
      function salesForCommission(c) { return c; }`);
    return vm.runInContext(`buildParentView(state, { showStandings: true, showAmounts: ${showAmounts} })`, ctx);
  };
  const on = build(true);
  eq(on.standings.map((r) => r.name), ['Beckett H.', 'Ada', 'Beckett Z.'], 'with amounts on the board is not ranked by sales');
  ok(on.standings.every((r) => typeof r.combinedCents === 'number'), 'amounts on lost the totals');
  const off = build(false);
  eq(off.standings.map((r) => r.name), ['Ada', 'Beckett H.', 'Beckett Z.'], 'with amounts off the board is not alphabetical');
  off.standings.forEach((r) => {
    Object.keys(r).forEach((k) => ok(!/Cents$|Routes$/.test(k), `amounts off still publishes ${k} for ${r.name}`));
    // 40% of a 0–100 segment, banded in quarters (coarseBarPct) → 25.
    ok(r.nextTier === 'Gold' && r.tier === 'Bronze' && r.nextPct === 25,
      'amounts off dropped the reward-level progress too');
    ok(!('nextRungPct' in r), 'amounts off still publishes the near-rung percentage');
  });
  ok(off.goals && off.goals.goalCents === 200000, 'the pack-wide goal bar went with the per-scout amounts');
  // The renderer: unnumbered, no total, and says it is in name order.
  const ctx = sandbox(['esc', 'fmt', 'fmtDate', 'parentBar', 'parentRouteLabel', 'parentRouteNoun',
    'parentTierProgress', 'parentStandingRow', 'parentStepName', 'parentTierLadder', 'parentCostLine',
    'parentCostLines', 'parentFamilyCost', 'parentGoalBar', 'renderParentStandings']);
  ctx.ui = { parentCostOpen: {} };
  const html = ctx.renderParentStandings({ standings: off.standings });
  ok(!/pv-scout-rank/.test(html) && !/pv-scout-total/.test(html), 'an alphabetical board still shows a rank or a total');
  ok(/Scouts are listed by name\./.test(html), 'the board does not say it is in name order');
  ok(/pv-scout-rank/.test(ctx.renderParentStandings({ standings: on.standings })), 'a ranked board lost its numbers');
  ok(/data-ch="join-amounts"/.test(slice('renderJoinCard')) && /showAmounts: next\.showAmounts/.test(slice('writeJoinConfig')),
    'the option is not on the join card, or not saved');
});

test('S1: with amounts off, a scout’s bar cannot be multiplied back into what they sold', () => {
  // The ladder publishes every tier's sales target, so an exact percentage against the anchor IS
  // the child's sales. Real figures chosen off the 10% grid, as real sales almost always are.
  const TIERS = [
    { id: 'b', name: 'Bronze', thresholdCents: 25000 },
    { id: 's', name: 'Silver', thresholdCents: 50000 },
    { id: 'g', name: 'Gold', thresholdCents: 100000 }
  ];
  const SALES = { s1: 34567, s2: 61234, s3: 9012 };
  const build = (showAmounts) => {
    const ctx = pvCtx(`
      state.derby = { name: '', date: '', awards: [] };
      var TIERS = ${JSON.stringify(TIERS)};
      var SALES = ${JSON.stringify(SALES)};
      function computePackTotals() { return { combined: 104813, teGoal: 200000, cashGoal: 0 }; }
      function computeScoutTotals() { return SALES; }
      function visibleScoutRows(t) {
        return state.scouts.map(function (s) { return { id: s.id, den: s.den, t: { combined: t[s.id] } }; });
      }
      function rankBy(rows, key) { return rows.slice().sort(function (a, b) { return key(b) - key(a); }); }
      // The real row shape, from a real threshold walk: commission = sales (rate 1) for clarity.
      function tierProgressRows() {
        var anchor = TIERS[2];
        return state.scouts.map(function (s) {
          var base = SALES[s.id], earned = null, next = null;
          TIERS.forEach(function (t) { if (base >= t.thresholdCents) earned = t; else if (!next) next = t; });
          return { scout: s, earned: earned, next: next, anchor: anchor, shortSales: next.thresholdCents - base,
            unlocks: 0, sellRoutes: [], pastPlan: false,
            anchorPct: Math.round(base / anchor.thresholdCents * 100),
            pct: Math.round(base / next.thresholdCents * 100),
            nextMarkPct: next.thresholdCents < anchor.thresholdCents ? Math.round(next.thresholdCents / anchor.thresholdCents * 100) : null,
            ladder: { plan: anchor, marksPlan: [] } };
        });
      }
      function plannedTier() { return TIERS[2]; }
      function derbyWinners() { return []; }
      function sortedTiers() { return TIERS; }
      function salesForCommission(c) { return c; }`);
    return vm.runInContext(`buildParentView(state, { showStandings: true, showAmounts: ${showAmounts} })`, ctx);
  };
  const off = build(false);
  const byName = { Ada: 's1', 'Beckett H.': 's2', 'Beckett Z.': 's3' };
  const anchorSales = off.tiers.find((t) => t.name === 'Gold').salesCents;
  off.standings.forEach((r) => {
    const real = SALES[byName[r.name]];
    ok(!('nextRungPct' in r), `${r.name}: the near-rung percentage is published`);
    ok(Math.abs(r.nextPct / 100 * anchorSales - real) > 500,
      `${r.name}: nextPct × the anchor’s target is within $5 of what they sold`);
  });
  // Banded inside each scout's own segment (wave 7b): Ada holds Bronze (25) chasing Silver (50) at
  // 34.6 → the bottom of [25, 37.5); Beckett H. holds Silver (50) chasing Gold (the anchor) at 61.2
  // → the bottom of [50, 62.5); Beckett Z. holds nothing, Bronze at 25, 9.0 → 0.
  eq(off.standings.find((r) => r.name === 'Ada').nextPct, 25, 'Ada');
  eq(off.standings.find((r) => r.name === 'Beckett H.').nextPct, 50, 'Beckett H.');
  eq(off.standings.find((r) => r.name === 'Beckett Z.').nextPct, 0, 'Beckett Z.');
  ok(/coarse = coarseBarPct\(row\.nextPct, segLo, segHi\);/.test(BPV()), 'the published bar is not banded by segment');
  // Amounts ON is unchanged: the exact figure, and the near rung.
  const on = build(true);
  eq(on.standings.find((r) => r.name === 'Ada').nextPct, 35, 'amounts on lost the exact bar');
  ok(on.standings.every((r) => typeof r.nextRungPct === 'number'), 'amounts on lost the near-rung figure');
  // The setting says what is and is not left.
  const card = slice('renderJoinCard');
  ok(/a progress bar shown only in broad steps between levels/.test(card), 'the join card does not say the bar is coarse');
  ok(/Families will see each level\\u2019s sales target but not their own scout\\u2019s ' \+\s*'remaining gap\./.test(card),
    'the join card does not say the level targets still show');
});

test('S3: a rung a family paid for never shows on the published board or the shared standings', () => {
  // Bronze by selling, Silver by a make-up payment. Leaders see Silver; everybody else sees Bronze,
  // and the rung after it is Silver — not Gold, which would give the skipped rung away.
  const planned = TP_TIERS[1];
  const MAP = { b: { a: 'earned' }, s: { a: 'madeUp' } };
  const leader = tp({ tiers: TP_TIERS, scouts: TP_ONE, map: MAP, comm: 9000, keyValue: TP_KEYS, planned })[0];
  eq(leader.earned.name, 'Silver', 'the leaders’ card lost the paid-for rung');
  eq(leader.earnedBy, 'madeUp', 'the leaders’ card no longer says how the rung was credited');
  Object.assign(tpCtx, { TIERS: TP_TIERS, MAP, SCOUTS: TP_ONE, COMM: 9000, KEY_VALUE: TP_KEYS, PLANNED: planned });
  vm.runInContext(slice('salesOnlyTierMap'), tpCtx);
  const pub = tpCtx.tierProgressRows(true)[0];
  ok(pub.earned.name !== 'Silver', 'the published row names the rung the family paid for');
  eq(pub.earned.name, 'Bronze', 'the published row does not carry the rung actually sold to');
  eq(pub.next.name, 'Silver', 'the published next rung skips the paid-for one, which gives it away');
  eq(pub.earnedBy, 'earned', 'the published row carries a made-up mark');
  // A scout with nothing sold holds nothing on the board.
  Object.assign(tpCtx, { MAP: { s: { a: 'madeUp' } }, COMM: 1000 });
  const none = tpCtx.tierProgressRows(true)[0];
  eq(none.earned, null, 'a scout who only paid is shown holding a tier');
  // The published board takes that view, and so do both halves of the shared standings.
  ok(/var progRows = tierProgressRows\(true\);/.test(codeOnly(BPV())), 'the parent view reads the full map');
  ok(/tier: \(p && p\.earned\) \? String\(p\.earned\.name/.test(codeOnly(BPV())), 'the published tier is not the row’s own');
  ok(/var txEarned = txTiers\.length \? salesOnlyTierMap\(tierEarnedMap\(\)\) : \{\};/.test(slice('summaryText')),
    'the copied standings name a paid-for rung');
  const sheet = /if \(o\.kind === 'summary'\) \{[\s\S]*?\n      return h;/.exec(SCRIPT)[0];
  ok(/var sumMap = sumTiers\.length \? salesOnlyTierMap\(tierEarnedMap\(\)\) : \{\};/.test(sheet) &&
     /packCoverageByScout\(sumMap\)/.test(sheet), 'the printed standings name a paid-for rung, or price it');
  // The helper keeps only sold marks.
  const ctx = sandbox(['salesOnlyTierMap']);
  eq(JSON.parse(JSON.stringify(ctx.salesOnlyTierMap({ b: { a: 'earned', c: 'madeUp' }, s: { a: 'madeUp' } }))),
    { b: { a: 'earned' }, s: {} }, 'salesOnlyTierMap');
  const SETUP = readFileSync(join(ROOT, 'SETUP.md'), 'utf8');
  ok(/\*\*never\*\* contains:[^]*?who\s+paid their way up a reward tier/.test(SETUP), 'SETUP.md dropped the promise this keeps');
});

test('S2: the copied and printed standings honour the pack’s two sharing switches', () => {
  const make = (stand, amt, known) => {
    const ctx = vm.createContext({});
    vm.runInContext(PRIV_STATE + `
      function computePackTotals() {
        return { sales: 60000, don: 9000, combined: 69000, commission: null, pct: null, ratesSplit: false,
          teGoal: 0, stretch: 0, cashGoal: 0, cashKept: 0, cashDon: 7000, teEligible: 62000 };
      }
      var T = { s1: { sales: 30000, onD: 1000 }, s2: { sales: 20000, onD: 1000 }, s3: { sales: 10000, onD: 0 } };
      function computeScoutTotals() { return T; }
      function visibleScoutRows() { return state.scouts.map(function (s) { return { id: s.id, name: s.name, den: s.den, t: T[s.id] }; }); }
      function rankBy(rows, f) { return rows.slice().sort(function (a, b) { return f(b) - f(a); }); }
      function eligibleOf(r) { return r.t.sales + r.t.onD; }
      var TIERS = [{ id: 'b', name: 'Bronze', thresholdCents: 1 }, { id: 'g', name: 'Gold', thresholdCents: 2 }];
      function sortedTiers() { return TIERS; }
      // Ada sold to Bronze and PAID her way to Gold; Beckett H. sold to Gold.
      function tierEarnedMap() { return { b: { s1: 'earned', s2: 'earned' }, g: { s1: 'madeUp', s2: 'earned' } }; }
      function standingsEnabled() { return ${stand}; }
      function amountsEnabled() { return ${amt}; }
      var KNOWN = true; function sharingSettingsKnown() { return KNOWN; }
      ${['shortNames', 'publicNameMap', 'salesOnlyTierMap', 'earnedTierFor', 'summaryText', 'fmt'].map(slice).join('\n')}`, ctx);
    return vm.runInContext(known === false ? 'KNOWN = false; summaryText()' : 'summaryText()', ctx);
  };
  const full = make(true, true);
  // Wave 7b — before the sharing settings load, both switches count as off.
  const waiting = make(true, true, false);
  ok(!/\$|Ada|Beckett|Pack total/.test(waiting) && /Loading the pack\u2019s sharing settings/.test(waiting),
    'the copied text publishes before the sharing settings are known');
  ok(/1\. Ada \[Bronze\] — \$310\.00/.test(full), 'the full copy lost its ranked line, or names Ada’s paid-for Gold');
  ok(/Beckett H\. \[Gold\]/.test(full), 'a tier sold to is missing from the full copy');
  const off = make(false, true);
  ok(!/Ada|Beckett|Standings —/.test(off), 'standings off still lists scouts in the copied text');
  // Wave 7b — and no money or goal line at all: standings off is calendar-only.
  ok(!/\$|Pack total|commission|goal|Cash donations/i.test(off), 'standings off still publishes pack money in the copied text');
  ok(/not sharing popcorn standings or totals/.test(off), 'standings off does not say why the copy is empty');
  const noAmt = make(true, false);
  ok(/Scouts, by name — reward level reached:\n- Ada — Bronze\n- Beckett H\. — Gold\n- Beckett Z\.\n/.test(noAmt),
    'amounts off is not public name + tier, alphabetically');
  const lines = noAmt.split('\n');
  const block = lines.slice(lines.indexOf('Scouts, by name — reward level reached:'));
  ok(!block.slice(0, 4).some((l) => /\$|^\d+\./.test(l)), 'amounts off still carries a figure or a rank number');
  ok(!/\[Gold\]|Ada — Gold/.test(noAmt), 'amounts off names Ada’s paid-for Gold');
  // The printed sheet: the same switches, and a note saying why the table is short.
  const sheet = /if \(o\.kind === 'summary'\) \{[\s\S]*?\n      return h;/.exec(SCRIPT)[0];
  ok(/var sumStand = sumKnown && standingsEnabled\(\), sumAmt = sumKnown && amountsEnabled\(\);/.test(sheet), 'the sheet ignores the switches');
  ok(/if \(sumStand && sumAmt\) \{/.test(sheet) && /\} else if \(sumStand\) \{/.test(sheet), 'the sheet does not branch on them');
  const alpha = sheet.slice(sheet.indexOf('} else if (sumStand) {'));
  ok(!/fmt\(|\(i \+ 1\)|rankBy/.test(alpha.slice(0, alpha.indexOf('h += \'<p class="small" style="margin:14px 0 0">'))),
    'the amounts-off table carries a figure or a rank');
  ok(/tierBadgesFor\(r, sumTiers, \{\}, sumMap\)/.test(alpha), 'the amounts-off table shows what the pack covers per family');
  ok(/Scout standings are off for families/.test(sheet) && /Dollar amounts and rank are off for families/.test(sheet),
    'the sheet does not say why its table is missing or short');
});

test('S4: the sharing settings cannot be written before the pack’s own copy has loaded', () => {
  // writeJoinConfig writes the WHOLE doc from sync.joinCfg, so a tick made while that is still
  // null would put standings and amounts back on and blank the contact line.
  const run = (loaded) => {
    const ctx = vm.createContext({});
    vm.runInContext(`
      var FIREBASE_CONFIG = {}, WRITES = [];
      var sync = { user: {}, joinLoaded: ${loaded}, joinCfg: ${loaded ? "{ open: true, code: 'abc', showStandings: false, showAmounts: false, contact: 'Chair' }" : 'null'},
        mods: { fs: { doc: function () { return {}; }, serverTimestamp: function () { return 0; },
          setDoc: function (ref, data) { WRITES.push(data); return { then: function () { return { catch: function () {} }; } }; } } },
        db: {}, docId: 'p' };
      function isAdmin() { return true; }
      function render() {} function scheduleParentViewRefresh() {} function showToast() {}
      function accountsToast() {} function joinLinkUrl() { return 'https://x/?join=abc'; }
      function dangerBtn(k, l) { return '<button data-act="' + k + '">' + l + '</button>'; }
      ${['esc', 'JOIN_CODE_RE', 'newJoinCode', 'joinOpen', 'standingsEnabled', 'amountsEnabled',
         'cleanContactLine', 'parentContactLine', 'writeJoinConfig', 'renderJoinCard'].map(slice).join('\n')}`, ctx);
    return ctx;
  };
  const early = run(false);
  early.writeJoinConfig({ showStandings: true });
  eq(early.WRITES.length, 0, 'a change was written before the settings loaded');
  const card = early.renderJoinCard();
  ['join-open', 'join-standings', 'join-amounts', 'join-contact'].forEach((k) => {
    const m = new RegExp(`<input[^>]*data-ch="${k}"[^>]*>`).exec(card);
    ok(m && / disabled/.test(m[0]), `${k} is live before the settings loaded`);
  });
  ok(/Loading the pack’s current settings/.test(card), 'the card does not say it is waiting');
  const ready = run(true);
  ready.writeJoinConfig({ showStandings: true });
  eq(ready.WRITES.length, 1, 'a loaded card cannot save');
  eq(ready.WRITES[0].showAmounts, false, 'the untouched switch was not carried over');
  eq(ready.WRITES[0].contact, 'Chair', 'the untouched contact line was not carried over');
  ok(!/ disabled/.test(ready.renderJoinCard()), 'a loaded card is still disabled');
});

test('M1: a refund past the family’s credit is flagged, shown, and never used for a reimbursement', () => {
  const ctx = sandbox(CHARGE_FNS.concat(['refundCreditBefore']));
  const charges = [{ id: 'd', scoutId: 'ada', lineId: 'D', amountCents: 8000, date: '2026-09-01', waivedBy: '', forgiven: null }];
  const paid = { id: 'p', direction: 'in', scoutId: 'ada', amountCents: 12000, source: 'family' };       // $40 credit
  const small = { id: 'r1', direction: 'out', scoutId: 'ada', amountCents: 4000, source: 'refund' };
  const big = { id: 'r2', direction: 'out', scoutId: 'ada', amountCents: 9000, source: 'refund' };
  eq(ctx.refundCreditBefore(charges, [paid], null, big), 4000, 'the credit before an unsaved refund');
  eq(ctx.refundCreditBefore(charges, [paid, big], null, big), 4000, 'a saved refund counted against itself');
  eq(ctx.refundCreditBefore(charges, [paid, small], null, small), 4000, 'the credit before a refund that fits');
  eq(ctx.refundCreditBefore(charges, [paid], null, { direction: 'out', scoutId: 'ada', amountCents: 1, source: '', reimbursement: true }),
    null, 'a reimbursement is measured as if it were a refund');
  // No credit, no charges: every cent is over.
  eq(ctx.refundCreditBefore([], [], null, big), 0, 'a family with nothing gets a credit');
  // The warning's words, and where it fires.
  const w = slice('refundOverCreditWarning');
  ok(/This is more than ' \+/.test(w) && /\\u2019s credit of ' \+ fmt\(credit\) \+ '\. Refunds give back money a family paid; to repay a council ' \+\s*'fee for a reward tier, use Reimburse on the Budget\.'/.test(w),
    'the warning does not say what the reviewer asked it to');
  const add = /if \(act === 'ledger-add'\) \{[\s\S]*?\n    \}/.exec(SCRIPT)[0];
  ok(/var drWarn = refundOverCreditWarning\(drEntry\);\s*state\.ledger\.push\(drEntry\);/.test(add), 'a new refund is not checked before it is added');
  const ed = /if \(ch\.indexOf\('led-'\) === 0\) \{[\s\S]*?\n    \}/.exec(SCRIPT)[0];
  ok(/\(lk === 'amount' \|\| lk === 'scout'\) \? refundOverCreditWarning\(led\)/.test(ed), 'an edited refund is not checked');
  // (a) A family whose refund left them owing is still on the Dues screen.
  ok(/\.filter\(function \(f\) \{ return f\.charges\.length \|\| f\.acct\.paid \|\| f\.acct\.refunded; \}\)/.test(slice('duesFamilies')),
    'a family with only a refund is filtered off the Dues screen');
  // (c) On a family-direct line the picker is a reimbursement, and saves as one.
  const rows = /function renderLedgerEntries\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  ok(/ledgerLineIsDirect\(dr\.lineId\)[\s\S]*?aria-label="Paid back to \(reimbursement\)"/.test(rows), 'the new-entry picker is always a refund');
  ok(/ledgerLineIsDirect\(e\.lineId\)[\s\S]*?aria-label="Paid back to \(reimbursement\)"/.test(rows), 'the entry picker is always a refund');
  ok(/var drReimb = dr\.direction !== 'in' && !!dr\.scoutId && ledgerLineIsDirect\(dr\.lineId\);/.test(add) &&
     /if \(drReimb\) drEntry\.reimbursement = true;/.test(add), 'a family-direct payback is saved as a refund');
  ok(/if \(lk === 'scout' && led\.scoutId && ledgerLineIsDirect\(led\.lineId\)\) \{ led\.source = ''; led\.reimbursement = true; \}/.test(ed),
    'an edited family-direct payback is saved as a refund');
  ok(/if \(nk === 'line' && nd\.direction !== 'in'\) \{ nd\.lineId = el\.value; render\(\); return; \}/.test(SCRIPT),
    'the picker does not follow the line chosen in the form');
});

test('M2: the Funds in sentence adds up, with refunds as their own term', () => {
  const ctx = sandbox(['fmt', 'fundsInTerm']);
  eq(ctx.fundsInTerm('refunds to families', -2000), ' − refunds to families ($20.00)', 'a refund term');
  eq(ctx.fundsInTerm('family-paid fees collected', 12000), ' + family-paid fees collected ($120.00)', 'a fee term');
  eq(ctx.fundsInTerm('other fundraisers', -500), ' − other fundraisers ($5.00)', 'a loss is dropped from the sentence');
  eq(ctx.fundsInTerm('x', 0), '', 'a $0 term is printed');
  // Every addend of fundsIn after carryover and commission is a fundsInTerm, and none is gated on > 0.
  const fn = slice('computeBudget');
  ok(/var fundsIn = startingBalance \+ commission \+ retainedCash \+ feeIncomeCollected \+ otherFundraiserIn \+ income\.other \+\s*income\.carryover;/.test(fn),
    'Funds in gained a term this test does not know about');
  ok(/feeIncomeGross: feeIncomeGross, feeRefunds: chg\.refunded,/.test(fn), 'the two halves of the fee income are not reported');
  const card = /'<p class="small muted" style="margin:8px 0 0"><strong>Funds in<\/strong> = carryover[\s\S]*?Balance<\/strong> = funds in/.exec(SCRIPT);
  ok(card, 'the Funds in sentence was not found');
  ['bud.ledgerCarryover', 'bud.incomePosted', 'bud.retainedCash', 'bud.feeIncomeGross', '-(bud.feeRefunds || 0)', 'bud.otherFundraiserIn'].forEach((x) =>
    ok(card[0].indexOf(x + ')') !== -1 && new RegExp("fundsInTerm\\('[^']+', " + x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\)').test(card[0]),
      `${x} is not a term of the sentence`));
  ok(/fundsInTerm\('refunds to families', -\(bud\.feeRefunds \|\| 0\)\)/.test(card[0]), 'refunds are not their own term');
  ok(!/> 0 \? ' \+/.test(card[0]), 'a term is still printed only when it is above zero');
  // "Collected" is what families handed over, never net of refunds.
  ok(/collected: t\.paid \+ t\.donated \+ t\.makeup, refunded: t\.refunded,/.test(slice('feesTotals')),
    'collected is net of refunds again');
});

test('M4: "Not the commission" is answered per entry, and any edit to the entry asks again', () => {
  const card = /function renderBudget\(\) \{[\s\S]*?\n  \}/.exec(SCRIPT)[0];
  ok(/data-act="not-commission:' \+ esc\(le\.id\) \+ '"/.test(card) && /the commission<\/button>/.test(card),
    'the Check line offers no per-entry answer');
  const h = /if \(act\.indexOf\('not-commission:'\) === 0\) \{[\s\S]*?\n    \}/.exec(SCRIPT);
  ok(h && /ncE\.notCommission = true;/.test(h[0]) && /commit\(\)/.test(h[0]), 'the answer is not saved');
  const ed = /if \(ch\.indexOf\('led-'\) === 0\) \{[\s\S]*?\n    \}/.exec(SCRIPT)[0];
  ok(/if \(lk === 'amount' \|\| lk === 'source' \|\| lk === 'line' \|\| lk === 'dir'\) led\.notCommission = false;/.test(ed),
    'editing the entry does not clear the answer');
  // It survives a reload, as a boolean.
  const ctx = sandbox(NORMALIZE_FNS);
  const d = ctx.normalizeState(Object.assign(preMigrationState(), {
    ledger: [{ id: 'x', direction: 'in', amountCents: 100, notCommission: true }, { id: 'y', direction: 'in', amountCents: 100, notCommission: 'yes' }]
  }));
  eq(d.ledger.filter((e) => e.id === 'x' || e.id === 'y').map((e) => e.notCommission), [true, false], 'normalizeState');
});

test('M5: Budget vs actual plans every dollar the Budget card plans, adult and sibling shares included', () => {
  // Three lines, and the planned tiers cover one share of each kind: an adult share on a line the
  // pack collects (extraHeads), the scout share of a collected line (fees — already planned), and a
  // paid-direct line (extraReimburse).
  const ctx = vm.createContext({});
  vm.runInContext(`
    var A1 = { id: 'A1', name: 'Campout', category: 'camp', through: true, planned: 10000, rates: { scout: 1000, adult: 2000 } };
    var E1 = { id: 'E1', name: 'Shirts', category: 'uniforms', through: true, planned: 5000, rates: { scout: 500, adult: 1500 } };
    var D1 = { id: 'D1', name: 'Registration', category: 'registration', through: false, planned: 3000, rates: { scout: 3000 } };
    var state = { budget: { activities: [A1], expenses: [E1, D1], startingBalance: 0 }, ledger: [], charges: [], fundraisers: [], collected: {} };
    function allBudgetLines() { return [{ line: A1, key: 'act:A1', kind: 'activity' }, { line: E1, key: 'E1', kind: 'expense' }, { line: D1, key: 'D1', kind: 'expense' }]; }
    function coverableLines() { return allBudgetLines(); }
    function lineIsFamilyDirect(l) { return !l.through; }
    function lineThroughPack(l) { return l.through; }
    function linePlanned(l) { return l.planned; }
    function lineActual() { return 0; }
    function lineActualCents() { return 0; }
    function lineRateForWho(l, who) { return l.rates[who] || 0; }
    function lineBillingRoster() { return [{ id: 'a' }, { id: 'b' }, { id: 'c' }]; }
    function linePerFamily() { return false; }
    function plannedCoverKeys() { return { 'act:A1#adult': true, 'E1': true, 'D1': true }; }
    function activeScouts() { return [{}, {}, {}]; }
    function chargeTotals() { return { paid: 0, donated: 0, makeup: 0, refunded: 0 }; }
    function chargeFamilyKey(x) { return x; }
    function tierCoverageConfigured() { return true; }
    function packCoverage() { return {}; }
    function linePerHead() { return false; }
    function lineFamilyFunded() { return false; }
    function fundingSummary() { return { fees: 0, cashGoal: 0, C: 0, salesGoal: 0, perScoutGoal: 0 }; }
    function rewardTierSummary() { return { rewardDues: 0 }; }
    function computePackTotals() { return { commission: 0, retainedCash: 0 }; }
    function getBudgetLine() { return null; }
    function ledgerIncomeCents() { return { commission: 0, hasCommission: false, other: 0, carryover: 0 }; }
    function commissionLookalikes() { return []; }
    function familyCoverage(c) { return c; }   // no per-family line in this fixture
    ${['COVER_WHO', 'coverKeyOf', 'coverCostForKeys', 'tierExtraPackCostCents', 'LINE_CATEGORIES',
       'budgetVsActual', 'BVA_REIMBURSE', 'budgetVsActualNow', 'computeBudget'].map(slice).join('\n')}`, ctx);
  const planned = vm.runInContext('computeBudget().planned', ctx);
  eq(planned, 10000 + 5000 + 6000 + 9000, 'computeBudget’s Planned (the fixture)');
  const bva = vm.runInContext('budgetVsActualNow()', ctx);
  eq(bva.total.planned, planned, 'Budget vs actual’s total Planned is not the Budget card’s Planned');
  const camp = bva.rows.find((r) => r.category === 'camp');
  eq(camp && camp.planned, 16000, 'the covered adult share is not planned under its own line’s category');
});

test('M6: an archived season says what actually carried forward, and old archives read as before', () => {
  const ctx = sandbox(['fmt', 'esc', 'normalizeSeasonArchive', 'seasonBalanceLabel', 'seasonCarriedLine', 'closingCarryover']);
  const norm = (a) => { ctx.normalizeSeasonArchive(a); return a; };
  const base = () => ({ id: 'a', kind: 'season', year: 2026, closedAt: '2027-07-01T00:00:00Z',
    fundraising: {}, budget: { plannedCents: 100000, actualCents: 90000, startingBalanceCents: 5000, fundsInCents: 120000, balanceCents: 30000 },
    events: {}, dues: {}, advancement: {} });
  const bank = norm(Object.assign(base(), {
    budget: Object.assign(base().budget, { carriedCents: 28712, carriedFrom: 'bank' }) }));
  eq([bank.budget.carriedFrom, bank.budget.carriedCents], ['bank', 28712], 'the carried figure did not survive a reload');
  const old = norm(base());
  ok(!('carriedFrom' in old.budget) && !('carriedCents' in old.budget), 'an old archive gained a carried figure it never had');
  const junk = norm(Object.assign(base(), { budget: Object.assign(base().budget, { carriedFrom: 'guess', carriedCents: 5 }) }));
  ok(!('carriedFrom' in junk.budget), 'an unknown carriedFrom was kept');
  eq(ctx.seasonBalanceLabel(bank.budget), 'Projected ending balance', 'bank-carried label');
  eq(ctx.seasonCarriedLine(bank.budget), 'Carried forward: $287.12 (bank balance)', 'carried line');
  eq(ctx.seasonBalanceLabel(old.budget), 'Ending balance', 'an old archive’s label changed');
  eq(ctx.seasonCarriedLine(old.budget), '', 'an old archive gained a carried line');
  eq(ctx.seasonBalanceLabel({ carriedFrom: 'projection', carriedCents: 30000 }), 'Ending balance', 'a projection carry is relabelled');
  // Stored by the archive builder from the same decision rolloverYear makes; used by every reader.
  const arc = slice('buildSeasonArchive');
  ok(/var carry = closingCarryNow\(bud\);/.test(arc) && /carriedCents: carry\.cents, carriedFrom: carry\.from,/.test(arc),
    'the archive does not store what carried');
  ok(/var bankKnown = state\.ledger\.length > 0 && !!state\.book\.openingDate;/.test(slice('closingCarryNow')) &&
     /var closingBankKnown = closingHadLedger && !!state\.book\.openingDate;/.test(slice('rolloverYear')),
    'the archive and the rollover decide the carry differently');
  ['renderCloseoutOverlay', 'seasonArchiveTables', 'seasonArchiveText', 'seasonArchiveRow'].forEach((fn) => {
    const src = slice(fn);
    ok(/seasonBalanceLabel\(/.test(src) && /seasonCarriedLine\(/.test(src), `${fn} does not say which balance it shows`);
    ok(!/<span class="l">Ending balance<\/span>|' · ending balance '/.test(src), `${fn} still hard-codes "Ending balance"`);
  });
});

test('M7: a refund or a carryover with no budget line does not keep the Home nag up', () => {
  const ctx = sandbox(LEDGER_FNS);
  const book = { openingCents: 0, openingDate: '' };
  const L = [
    entry({ id: '1', direction: 'out', scoutId: 'ada', source: 'refund', lineId: '', amountCents: 4000 }),
    entry({ id: '2', direction: 'in', source: 'carryover', lineId: '', amountCents: 42000 }),
    entry({ id: '3', direction: 'in', source: 'carryover', scoutId: 'ada', lineId: '', amountCents: 700 }),
    entry({ id: '4', direction: 'out', source: '', lineId: '', amountCents: 1500 }),          // a real one
    entry({ id: '5', direction: 'out', scoutId: 'ada', reimbursement: true, lineId: '', amountCents: 900 }) // still wants a line
  ];
  eq(ctx.ledgerTotals(L, book).uncategorised, 2, 'uncategorised');
  // The ledger's "No budget line" filter lists what the count counts.
  const lm = slice('ledgerMatches');
  ok(/if \(f\.dir === 'uncategorised' && !entryWantsLine\(e\)\) return false;/.test(lm), 'the filter and the count disagree');
});

test('K2: with cash through Trail’s End, the stretch bar carries the cash goal too', () => {
  const fn = slice('computePackTotals');
  ok(/teBarStretch: stretchNow > 0 \? stretchNow \+ \(viaTE \? \(state\.cashGoalCents \|\| 0\) : 0\) : 0/.test(fn),
    'teBarStretch is not the stretch plus a cash goal that runs through Trail’s End');
  // Every stretch bar, percentage and "to go" reads it — none still divides by the bare stretch.
  ok(!/pack\.teEligible \/ pack\.stretch\b|fmt\(pack\.stretch\)|pack\.stretch - pack\.teEligible/.test(SCRIPT),
    'a stretch figure is still measured against the stretch without the cash goal');
  const card = SCRIPT.slice(SCRIPT.indexOf('aria-label="Stretch goal '), SCRIPT.indexOf('aria-label="Stretch goal ') + 900);
  ok(/var stLeft = Math\.max\(0, pack\.teBarStretch - pack\.teEligible\);/.test(SCRIPT), '"to go" is not against teBarStretch');
  ok(/Stretch goal: ' \+ fmt\(pack\.teEligible\) \+ ' of ' \+ fmt\(pack\.teBarStretch\)/.test(slice('summaryText')), 'the copied text');
  ok(/var sp = Math\.min\(100, Math\.round\(pack\.teEligible \/ pack\.teBarStretch \* 100\)\);/.test(SCRIPT), 'the printed sheet');
  ok(card.length > 0, 'the card');
});

test('K4: the "one entry per scout per sale day" comment sits on the code it describes', () => {
  const overlap = SCRIPT.indexOf('  function teManualOverlap(');
  const note = SCRIPT.indexOf('// ONE ENTRY PER SCOUT PER SALE DAY');
  const entries = SCRIPT.indexOf('  function teLiveEntriesFor(');
  ok(overlap !== -1 && note !== -1 && entries !== -1, 'a landmark is missing');
  ok(overlap < note && note < entries, 'teManualOverlap still sits between the sale-day comment and teLiveEntriesFor');
  ok(!/\n  function /.test(SCRIPT.slice(note, entries)), 'another declaration sits between the comment and its function');
});

test('N1: the waiting screen says how to register, and who the adult partner is', () => {
  const run = (fixed) => {
    const ctx = vm.createContext({});
    vm.runInContext(`var PACK_PUBLIC_NAME = 'Cub Scout Pack 569'; var FLEUR = '';
      var sync = { user: { displayName: 'Sam <b>' } };
      function fixedPackMode() { return ${fixed}; } function activeJoin() { return null; } function parentDoc() { return null; }
      ${['esc', 'joinPackName', 'joinGateShell', 'renderJoinWaiting'].map(slice).join('\n')}`, ctx);
    return vm.runInContext('renderJoinWaiting()', ctx);
  };
  const out = run(true);
  ok(out.indexOf('While you wait: register your scout with Scouting America at <strong>beascout.scouting.org</strong> — ' +
    'enter your ZIP, choose <strong>Cub Scout Pack 569</strong>, then <em>Apply now</em> (your den leader can help). ' +
    'For a Lion or Tiger, a parent or guardian is usually the adult partner and just ticks that box on the form. ' +
    'If another adult will be the partner, they may need their own adult application. ' +
    'Every adult who comes along is encouraged to take the free online Safeguarding Youth Training.</p>') !== -1,
    'the waiting screen is not the New Member Coordinator’s wording');
  ok(!/they’ll need to register too/.test(out), 'the old wording is still there');
  ok(/Sam &lt;b&gt;/.test(out), 'the signed-in name is not escaped');
  ok(/choose your pack, then/.test(run(false)), 'a multi-pack build names Pack 569');
  ok(!/an adult partner who is not\s+\/\/ the parent needs registering/.test(SCRIPT), 'the old comment is still there');
});

test('N2: both family-cost cards say an adult partner who isn’t a parent is not included', () => {
  const pv = slice('parentFamilyCost').replace(/'\s*\+\s*(\/\/[^\n]*\n\s*)*'/g, '');
  ok(/<strong>Not included:<\/strong> a second parent, brothers and sisters \(listed separately, because nothing requires one to come\), an adult partner who isn’t a parent \(may pay an adult registration fee\), and anything the pack charges as one flat amount\./.test(pv),
    'the parents’ card does not list the adult partner');
  const leaders = /var notIn = \[[^\]]*\];/.exec(SCRIPT);
  ok(leaders && /'an adult partner who isn’t a parent \(may pay an adult registration fee\)'/.test(leaders[0]),
    'the leaders’ card does not list the adult partner');
});

test('S1: with no near-rung figure, the caption names the next rung before its reward', () => {
  const ctx = sandbox(['esc', 'fmt', 'parentBar', 'parentTierProgress']);
  const LADDER = { anchorName: 'Silver', planned: true, marks: [{ name: 'Bronze', pct: 33, plan: false }] };
  const cal = ctx.parentTierProgress({ nextTier: 'Bronze', nextReward: 'Pack patch', nextPct: 10, nextMarkPct: 33 }, LADDER);
  ok(/10% of the way to <strong>Silver<\/strong> · next: <strong>Bronze<\/strong> <span class="muted">— Pack patch<\/span>/.test(cal),
    'Bronze’s reward is printed against Silver');
  const straight = ctx.parentTierProgress({ nextTier: 'Silver', nextReward: 'Dues covered', nextPct: 80 }, LADDER);
  ok(!/next:/.test(straight), 'a scout heading straight for the anchor is told the next rung twice');
});

test('7b-1: an amounts-off bar never pins a scout near a notch into a narrow band', () => {
  const { coarseBarPct } = sandbox(['coarseBarPct']);
  // A ladder with notches at 31% and 39% of the anchor: segments [0,31), [31,39), [39,100).
  const segs = [[0, 31], [31, 39], [39, 100]];
  segs.forEach(([lo, hi]) => {
    // Preimage of every published value, sampled at 0.01 across the segment.
    const pre = {};
    for (let i = lo * 100; i < hi * 100; i++) {
      const x = i / 100;
      const v = coarseBarPct(x, lo, hi);
      ok(v >= lo && v < hi, `[${lo},${hi}): ${x} published outside its segment (${v})`);
      (pre[v] || (pre[v] = [x, x]))[1] = x;
    }
    Object.keys(pre).forEach((v) => {
      const width = pre[v][1] - pre[v][0] + 0.01;
      // Every band is at least 10 points of the anchor wide — or it is the WHOLE segment, whose
      // ends the tier and the next tier already publish.
      ok(width >= 9.99 || (Object.keys(pre).length === 1 && hi - lo < 10),
        `[${lo},${hi}): published ${v} covers only ${width.toFixed(2)} points`);
    });
  });
  // The old failure: held notch 39, sold 39.5 → it published 39, a one-point band.
  eq(coarseBarPct(39.5, 39, 100), 39, 'the bottom of the first band');
  eq(coarseBarPct(54.3, 39, 100), 54, 'the second band of four (step 15.25)');
  eq(coarseBarPct(35, 31, 39), 31, 'a narrow segment is one band');
  eq(coarseBarPct(30.9, 0, 31), 21, 'the third of three bands under 31');
  eq(coarseBarPct(100, 39, 100), 100, 'the top of the ladder is a full bar');
  eq(coarseBarPct(null, 0, 100), null, 'no figure');
});

test('7b-2: with standings off, the printed summary carries no pack money or goal bar', () => {
  const sheet = /if \(o\.kind === 'summary'\) \{[\s\S]*?\n      return h;/.exec(SCRIPT)[0];
  const money = sheet.indexOf("if (sumStand) h += '<div class=\"row\" style=\"margin-bottom:14px\">'");
  ok(money !== -1, 'the stat row is not behind the standings switch');
  // Everything from the stat row to the per-scout tables is one guarded expression.
  const block = sheet.slice(money, sheet.indexOf('if (sumStand && sumAmt) {'));
  ['Trail’s End', 'Pack commission', 'Total to the pack', 'Trail’s End goal', 'Stretch goal', 'Cash donations goal'].forEach((w) =>
    ok(block.indexOf(w) !== -1, `${w} is not inside the guarded block`));
  ok(!/;\s*\n\s*'/.test(block.slice(0, block.lastIndexOf("'';"))), 'the guarded block ends early, leaving money outside it');
  ok(/if \(sumStand\) \{\s*h \+= '<p class="small" style="margin:14px 0 0">Cash donations at storefront tables/.test(sheet),
    'the cash donations line prints with standings off');
  ok(/Scout standings are off for families/.test(sheet), 'the on-screen note is gone');
});

test('7b-3: Copy and Print of the summary wait for the pack’s sharing settings', () => {
  const ctx = vm.createContext({});
  vm.runInContext(`var sync = { user: {}, accountsUnavailable: false, joinLoaded: false };
    ${['accountsInForce', 'sharingSettingsKnown'].map(slice).join('\n')}`, ctx);
  eq(ctx.sharingSettingsKnown(), false, 'signed in, config not loaded');
  ctx.sync.joinLoaded = true;
  eq(ctx.sharingSettingsKnown(), true, 'config loaded');
  ctx.sync.user = null; ctx.sync.joinLoaded = false;
  eq(ctx.sharingSettingsKnown(), true, 'local-only use has nothing to wait for');
  const sheet = /if \(o\.kind === 'summary'\) \{[\s\S]*?\n      return h;/.exec(SCRIPT)[0];
  ok(/var sumStand = sumKnown && standingsEnabled\(\), sumAmt = sumKnown && amountsEnabled\(\);/.test(sheet), 'the sheet trusts unloaded switches');
  ok(/data-act="copy-summary"' \+ sumDis/.test(sheet) && /data-act="print-summary"' \+ sumDis/.test(sheet), 'the buttons are live before load');
  ok(/Loading the pack\\u2019s sharing settings\\u2026/.test(sheet), 'the sheet does not say it is waiting');
  ok(/if \(\(act === 'copy-summary' \|\| act === 'print-summary'\) && !sharingSettingsKnown\(\)\)/.test(SCRIPT), 'a stale button still copies');
});

test('7b-4: with amounts off, the pack goal bar is rounded to $50 and its percent follows', () => {
  const build = (showAmounts, combined) => {
    const ctx = pvCtx(`
      state.derby = { name: '', date: '', awards: [] };
      function computePackTotals() { return { combined: ${combined}, teGoal: 200000, cashGoal: 0 }; }
      function computeScoutTotals() { return {}; }
      function visibleScoutRows() { return []; }
      function rankBy(rows) { return rows; }
      function tierProgressRows() { return []; }
      function plannedTier() { return null; }
      function derbyWinners() { return []; }
      function sortedTiers() { return []; }
      function salesForCommission(c) { return c; }`);
    return vm.runInContext(`buildParentView(state, { showStandings: true, showAmounts: ${showAmounts} })`, ctx).goals;
  };
  eq(build(true, 123456), { goalCents: 200000, raisedCents: 123456, pct: 62 }, 'amounts on is exact');
  eq(build(false, 123456), { goalCents: 200000, raisedCents: 125000, pct: 63 }, 'amounts off: $1,234.56 → $1,250, 63%');
  eq(build(false, 122499), { goalCents: 200000, raisedCents: 120000, pct: 60 }, 'rounds down below the half');
  // One family's $15 sale does not move the published figure.
  eq(build(false, 120500).raisedCents, build(false, 122000).raisedCents, 'a $15 sale shows on the goal bar');
  ok(/pack goal bar's amount raised is rounded to the nearest \$50/.test(SETUP), 'SETUP.md does not say so');
  ok(/`raisedCents` is rounded to the nearest \$50/.test(SCRIPT), 'the banner does not say so');
});

// The sibling rule for a per-family fee — owner decision, 2026-09-28. One family: Bea (Bear, first
// on the roster, so the fee is BILLED to her) and her younger brother Tig (Tiger). Web is a
// Webelos on his own. Three per-family lines, all covered by the one tier T:
//   FAM   collected by the pack, every den             — a charge on Bea, waived or not
//   DIR   paid straight to the council, every den      — reimbursed, one row per family
//   BFAM  collected by the pack, BEAR den only         — Tig's tier must not count for it
function siblingSandbox(earned) {
  const ctx = vm.createContext({});
  vm.runInContext(`
    ${['arrOf', 'COVER_WHO', 'coverKeyOf', 'lineRateForWho', 'scoutsInDens', 'familiesOf', 'familyBillingScout',
       'lineBillingRoster', 'lineBillingIds', 'familyFeeHolder', 'familyCoverage', 'shareCountsForScout',
       'coverValueOfKeys', 'tierCoverCentsPerScout', 'packCoverage', 'packCoverageByScout', 'privateBenefitCheck',
       'entryRefundsFamily', 'tierReimbursements', 'earnedTierFor', 'applyTierWaivers', 'salesOnlyTierMap'].map(slice).join('\n')}
    function familyKeyOf(s) { return (s && s.familyId) || (s && s.id) || ''; }
    function linePerFamily(l) { return l.basis === 'per-family'; }
    function lineDens(l) { return l.dens || []; }
    function lineRoster(l) { return scoutsInDens(activeScouts(), lineDens(l)); }
    var SCOUTS = [{ id: 'bea', den: 'Bear' }, { id: 'tig', den: 'Tiger', familyId: 'bea' }, { id: 'web', den: 'Webelos' }];
    function activeScouts() { return SCOUTS; }
    function getScout(id) { return SCOUTS.filter(function (s) { return s.id === id; })[0] || null; }
    function chargeFamilyKey(id) { return familyKeyOf(getScout(id)); }
    function tierCoverageConfigured() { return true; }
    var FAM = { id: 'FAM', basis: 'per-family', scoutRateCents: 5000 };
    var DIR = { id: 'DIR', basis: 'per-family', scoutRateCents: 3000 };
    var BFAM = { id: 'BFAM', basis: 'per-family', scoutRateCents: 4000, dens: ['Bear'] };
    var LINES = [{ key: 'FAM', line: FAM }, { key: 'DIR', line: DIR }, { key: 'BFAM', line: BFAM }];
    function coverableLines() { return LINES; }
    function coverableShares() {
      return [{ coverKey: 'FAM', item: FAM, rate: 5000, reimburse: false, who: 'scout' },
              { coverKey: 'DIR', item: DIR, rate: 3000, reimburse: true, who: 'scout' },
              { coverKey: 'BFAM', item: BFAM, rate: 4000, reimburse: false, who: 'scout' }];
    }
    var T = { id: 't', thresholdCents: 100, covers: ['FAM', 'DIR', 'BFAM'] };
    function sortedTiers() { return [T]; }
    var EARNED = ${JSON.stringify({ t: earned })};
    function tierEarnedMap() { return EARNED; }
    function computePackTotals() { return { commission: 100000 }; }
    function getBudgetLine(id) { return [FAM, DIR, BFAM].filter(function (l) { return l.id === id; })[0] || null; }
    var state = {
      budget: { expenses: [FAM, DIR, BFAM], activities: [] },
      charges: [
        { id: 'c1', scoutId: 'bea', lineId: 'FAM', who: 'scout', amountCents: 5000, waivedBy: '', forgiven: null },
        { id: 'c2', scoutId: 'bea', lineId: 'BFAM', who: 'scout', amountCents: 4000, waivedBy: '', forgiven: null }
      ],
      ledger: []
    };
    applyTierWaivers();`, ctx);
  const sc = (id) => ctx.SCOUTS.find((s) => s.id === id);
  const waived = () => ctx.state.charges.map((c) => c.waivedBy);
  return { ctx, sc, waived };
}

test('7c: only the younger sibling earns the tier, and the family fee is waived — once, and only in her dens', () => {
  const { ctx, sc, waived } = siblingSandbox({ tig: 'earned' });
  eq(waived(), ['t', ''], 'FAM is waived for the family; BFAM (Bear only) is not — Tig is a Tiger');
  const rows = ctx.tierReimbursements();
  eq(rows.map((r) => [r.share.coverKey, r.scout.id, r.earner.id]), [['DIR', 'bea', 'tig']],
    'one reimbursement row, on the billing scout, earned by the sibling');
  eq(JSON.parse(JSON.stringify(ctx.packCoverageByScout())), { tig: 8000 }, 'the family fees are credited to the sibling who earned them');
  eq(ctx.privateBenefitCheck().back, 8000, 'what goes back');
  // What a tier is still worth to each of them: Bea's family already has FAM and DIR through Tig,
  // so only the Bear-only fee is left for her to earn; Tig is credited, and BFAM was never his.
  const cov = ctx.packCoverage();
  eq(ctx.tierCoverCentsPerScout(ctx.T, sc('bea'), cov), 4000, 'Bea is offered the family fee her brother already covered');
  eq(ctx.tierCoverCentsPerScout(ctx.T, sc('tig'), cov), 8000, 'Tig');
  eq(ctx.coverValueOfKeys({ FAM: true, DIR: true }, sc('bea'), cov), 0, 'reaching it is worth the family fee to Bea again');
});

test('7c: both siblings earn it, and the family fee is waived once with no double reimbursement', () => {
  const { ctx, sc, waived } = siblingSandbox({ bea: 'earned', tig: 'earned' });
  eq(waived(), ['t', 't'], 'both of Bea’s charges are waived');
  let rows = ctx.tierReimbursements();
  eq(rows.map((r) => [r.share.coverKey, r.scout.id, r.earner.id]), [['DIR', 'bea', 'bea']], 'one row, credited to the billing scout');
  // Paid back against Tig: the family's one row is settled, and no second one appears.
  ctx.state.ledger = [{ direction: 'out', lineId: 'DIR', scoutId: 'tig', amountCents: 3000, source: '', reimbursement: true }];
  rows = ctx.tierReimbursements();
  eq(rows.map((r) => [r.paid, r.left]), [[3000, 0]], 'the family is reimbursed twice');
  eq(JSON.parse(JSON.stringify(ctx.packCoverageByScout())), { bea: 12000 }, 'a sibling is credited the same family fee');
  eq(ctx.privateBenefitCheck().back, 12000, 'the family fee counted per sibling');
  const cov = ctx.packCoverage();
  eq(ctx.tierCoverCentsPerScout(ctx.T, sc('tig'), cov), 0, 'Tig is credited family fees his sister holds');
});

test('7c: no sibling earns it, and nothing is waived', () => {
  const { ctx, sc, waived } = siblingSandbox({});
  eq(waived(), ['', ''], 'a fee is waived with nobody earning it');
  eq(ctx.tierReimbursements().length, 0, 'a reimbursement is owed');
  eq(JSON.parse(JSON.stringify(ctx.packCoverageByScout())), {}, 'coverage');
  eq(ctx.privateBenefitCheck().back, 0, 'what goes back');
  // Nobody holds it, so reaching it is worth the family fee to whichever of them gets there.
  const cov = ctx.packCoverage();
  eq(ctx.tierCoverCentsPerScout(ctx.T, sc('bea'), cov), 12000, 'Bea');
  eq(ctx.tierCoverCentsPerScout(ctx.T, sc('tig'), cov), 8000, 'Tig (not the Bear-only fee)');
});

test('7c: a sibling in a den outside the line’s dens does not count', () => {
  // Web earning it covers nothing of Bea's family's, and Tig's tier cannot reach the Bear-only fee.
  const a = siblingSandbox({ web: 'earned' });
  eq(a.waived(), ['', ''], 'another family’s tier waived this family’s fee');
  const b = siblingSandbox({ tig: 'earned' });
  eq(b.waived()[1], '', 'a Tiger’s tier waived a Bear-only family fee');
  eq(b.ctx.familyFeeHolder(b.ctx.BFAM, 'BFAM', b.ctx.packCoverage(), 'bea'), '', 'the out-of-den sibling is a holder');
});

test('7c: a sibling’s make-up covers the family fee once, and never shows on the published board', () => {
  const { ctx, sc, waived } = siblingSandbox({ tig: 'madeUp' });
  eq(waived(), ['t', ''], 'a make-up by a sibling does not cover the family fee');
  eq(ctx.tierReimbursements().length, 1, 'one reimbursement row');
  // Bea's make-up cap for the same tier does not include the fee Tig already paid towards.
  eq(ctx.tierCoverCentsPerScout(ctx.T, sc('bea'), ctx.packCoverage()), 4000, 'the family could pay towards the fee twice');
  // Published: built from the sales-only map, where Tig's make-up does not exist — so Bea's
  // "what reaching it takes off" still shows the fee, and nothing reveals the payment.
  const pub = ctx.packCoverage(ctx.salesOnlyTierMap(ctx.EARNED));
  eq(ctx.coverValueOfKeys({ FAM: true }, sc('bea'), pub), 5000, 'the published board reveals a sibling’s make-up');
  // By selling, it is public anyway, and the board says so: $0 off.
  const sold = siblingSandbox({ tig: 'earned' });
  eq(sold.ctx.coverValueOfKeys({ FAM: true }, sold.sc('bea'), sold.ctx.packCoverage(sold.ctx.salesOnlyTierMap(sold.ctx.EARNED))), 0,
    'the published board offers a fee a sibling already sold her way to');
  // Wiring: the progress rows read the same map for both figures.
  const tpr = slice('tierProgressRows');
  ok(/var famCov = packCoverage\(map\);/.test(tpr), 'the progress rows do not read coverage from their own map');
});

/* ========================================================================
   Enhancements wave A — program and advancement tools
   ===================================================================== */

// A7 — a reimbursement row sits on the billing scout; when a sibling's tier bought it, say whose.
test('A7: a reimbursement row says which sibling earned it, and only when that is someone else', () => {
  const ctx = sandbox(['reimbEarnerNote']);
  const bea = { id: 'bea', name: 'Bea Kent' }, tig = { id: 'tig', name: 'Tig Kent' };
  eq(ctx.reimbEarnerNote({ scout: bea, earner: tig }, { tig: 'Tig' }), 'earned by Tig', 'sibling earner');
  eq(ctx.reimbEarnerNote({ scout: bea, earner: bea }, { bea: 'Bea' }), '', 'repeats the row’s own scout');
  // No map entry: still a first name, never the surname.
  eq(ctx.reimbEarnerNote({ scout: bea, earner: tig }, {}), 'earned by Tig', 'fell back to the full name');
  ok(/var byWho = reimbEarnerNote\(r, reimbNames\);/.test(SCRIPT), 'the reimbursement row does not show the earner');
  ok(!/reimbEarnerNote/.test(BPV()), 'the earner note reached the parent view');
});

// A5 — the yearly adventure-list check.
test('A5: the adventure list carries a verified date, and the July check reads it', () => {
  const ctx = sandbox(['ADVENTURES_VERIFIED', 'adventureCheckDue']);
  ok(/^\d{4}-\d{2}-\d{2}$/.test(ctx.ADVENTURES_VERIFIED), 'ADVENTURES_VERIFIED is not an ISO date');
  const due = ctx.adventureCheckDue;
  eq(due('2026-07-18', '2027-07-01'), true, 'twelve months on, in July');
  eq(due('2026-07-18', '2027-07-31'), true, 'late July');
  eq(due('2026-07-18', '2026-07-30'), false, 'checked this July');
  eq(due('2026-09-01', '2027-07-15'), false, 'ten months is not a year');
  eq(due('2025-07-01', '2026-08-01'), false, 'only a July task');
  eq(due('2025-07-01', '2026-06-30'), false, 'June is not July');
  eq(due('', '2026-07-10'), true, 'a list never checked is due');
  const fn = /function homeTasks\(\) \{[\s\S]*?\n    return out;\n  \}/.exec(SCRIPT)[0];
  ok(/adventureCheckDue\(ADVENTURES_VERIFIED, today\)\) \{\s*add\('advancement'/.test(fn),
    'the Home task is not wired to the advancement job');
});

// A6 — the seeded slate's gaps.
test('A6: the seeded slate covers planning, recruiting, pack meetings, summer and both spring campouts', () => {
  const { SEED_ACTIVITIES, PROGRAM_MONTHS } = sandbox(['PROGRAM_MONTHS', 'PROGRAM_TURN',
    'PROGRAM_START_MONTH', 'SA_FEES', 'SEED_EXPENSES', 'SEED_ACTIVITIES']);
  const month = (n) => {
    const a = SEED_ACTIVITIES.filter((x) => x.name.indexOf(n) === 0)[0];
    ok(a, `no seeded "${n}"`);
    return PROGRAM_MONTHS[a.slot];
  };
  eq(month('Program planning conference'), 'July', 'planning conference');
  eq(month('Back-to-school recruiting night'), 'August', 'recruiting night');
  eq(month('Monthly pack meeting'), 'September', 'pack meeting placeholder');
  eq(month('Summertime Fun'), 'July', 'Summertime Fun');
  eq(month('Pack campout — Fort Yargo'), 'March', 'Fort Yargo');
  eq(month('Spring family campout'), 'April', 'spring family camp');
  eq(month('Crossover'), 'May', 'crossover stays in May');
  // Idempotence is by name, so two seeds with one name would silently seed only one.
  const names = SEED_ACTIVITIES.map((a) => a.name.toLowerCase());
  eq(names.length, new Set(names).size, 'two seeded activities share a name');
  ok(/Crossover stays in May\. Many packs hold it at the Blue & Gold/.test(SCRIPT), 'the crossover comment is gone');
});

test('A6: seeding stays additive — it never edits or removes an event a pack already has', () => {
  const fn = slice('seedStandardYear');
  ok(/if \(existing\[t\.name\.toLowerCase\(\)\]\) return;/.test(fn), 'the name-idempotence guard is gone');
  ok(!/state\.events\s*=|\.splice\(/.test(fn), 'seedStandardYear rewrites or removes events');
});

// A4 — repeat every other week, optionally as sessions of one adventure.
test('A4: a meeting repeats weekly or every other week, across a month end and DST', () => {
  const ctx = sandbox(['pad2', 'repeatDates']);
  eq(ctx.repeatDates('2026-10-20', 3, 7), ['2026-10-27', '2026-11-03', '2026-11-10'], 'weekly across DST');
  eq(ctx.repeatDates('2026-10-20', 3, 14), ['2026-11-03', '2026-11-17', '2026-12-01'], 'every other week');
  eq(ctx.repeatDates('2026-12-22', 1, 14), ['2027-01-05'], 'across the new year');
  eq(ctx.repeatDates('', 2, 7), [], 'an undated meeting has nothing to repeat');
});

test('A4: repeated copies take the adventure only when asked, and so become sessions of one run', () => {
  const h = /if \(kind === 'mtg-repeat'\) \{[\s\S]*?\n    \}/.exec(SCRIPT)[0];
  ok(/var rAdv = \(fd\.get\('sameAdv'\) && rMtg\.kind === 'den'\) \? evAdventure\(rMtg\) : '';/.test(h),
    'the adventure is copied without the opt-in, or onto a pack meeting');
  ok(/adventure: rAdv/.test(h), 'the copies do not carry the adventure');
  ok(!/noteInternal/.test(h), 'the leaders-only note is copied onto every repeat');
  ok(/'14' \? 14 : 7/.test(h), 'every other week is not read from the form');
  // End to end: three meetings tagged the same way are one run, "session n of 3".
  const ctx = runSandbox(RUN_SETUP.replace("m3: {}", "m3: {}").replace(
    "{ id: 'x1', kind: 'den', den: 'Bear', date: '2026-08-05', adventure: 'Bobcat' }",
    "{ id: 'x1', kind: 'den', den: 'Bear', date: '2026-09-01', adventure: 'Bear Strong' }," +
    "{ id: 'x2', kind: 'den', den: 'Bear', date: '2026-09-15', adventure: 'Bear Strong' }," +
    "{ id: 'x3', kind: 'den', den: 'Bear', date: '2026-09-29', adventure: 'Bear Strong' }"));
  const r = vm.runInContext("runForMeeting(state.events.filter(function (e) { return e.id === 'x2'; })[0])", ctx);
  eq([r.position, r.of], [2, 3], 'the repeated meetings are not one run');
});

// A3 — the make-up-at-home message.
test('A3: the make-up message names the scout by first name, the adventure, the night, and who signs', () => {
  const ctx = sandbox(['makeupMessage']);
  const wolf = ctx.makeupMessage({ first: 'Ben', den: 'Wolf', adventure: 'Council Fire', dates: ['Wed, Aug 12'], packName: 'Pack 569' });
  ok(/^Hi! Ben missed the Wolf den meeting on Wed, Aug 12, when we worked on the Council Fire adventure\./.test(wolf), wolf);
  ok(/do the Council Fire requirement we covered that night at home with Ben, sign it in the handbook, and tell your den leader/.test(wolf),
    'a Wolf family is not told to do it at home, sign it and tell the den leader');
  ok(/— Pack 569$/.test(wolf), 'no sign-off');
  // Webelos and Arrow of Light: the den leader signs (DESIGN-adventures.md §3).
  const web = ctx.makeupMessage({ first: 'Cy', den: 'Webelos', adventure: 'My Safety', dates: ['Sep 1', 'Sep 15'] });
  ok(/tell your den leader, who will check it and sign it off/.test(web), 'a Webelos family is told to sign it themselves');
  ok(!/sign it in the handbook/.test(web), 'a Webelos family is told to sign it themselves');
  ok(/the Webelos den meetings on Sep 1 and Sep 15/.test(web), 'two missed nights are not both named');
  for (const m of [wolf, web]) ok(!/cannot earn|forfeit|missed out/i.test(m), 'the message says the adventure is lost');
});

test('A3: the message is copy-only — first names, nothing stored, nothing published', () => {
  const btn = slice('makeupMsgBtn');
  ok(/publicNameMap\(state\.scouts\)/.test(btn), 'the button labels the scout by full name');
  const h = /if \(act === 'makeup-msg'\) \{[\s\S]*?\n    \}/.exec(SCRIPT)[0];
  ok(/var mmFirst = publicNameMap\(state\.scouts\)\[mmRow\.scout\.id\]/.test(h), 'the message uses the full name');
  ok(!/commit\(\)|save\(\)/.test(h), 'composing the message writes the pack record');
  ok(!/makeupMessage|makeup-msg/.test(BPV()), 'the make-up message reached the parent view');
  // Offered on both make-up lists: the meeting's and the Advancement card's.
  ok(/makeupMsgBtn\(r\.run, row\)/.test(slice('renderMeetingAdvMark')), 'no button on the meeting’s make-up list');
  ok(/makeupMsgBtn\(run, row\)/.test(slice('renderAdventureRunsCard')), 'no button on the Advancement make-up list');
});

// A1 — the den year planner.
function planSandbox(events) {
  const ctx = runSandbox(RUN_SETUP.replace(/var EVENTS = \[[\s\S]*?\n  \];/, `var EVENTS = ${JSON.stringify(events)};`));
  vm.runInContext(`${slice('denPlan')}\n${slice('denPlanDefaultDate')}`, ctx);
  return ctx;
}
const PLAN_EVENTS = [
  { id: 'w1', kind: 'den', den: 'Wolf', date: '2026-09-01', adventure: 'Bobcat' },
  { id: 'w2', kind: 'den', den: 'Wolf', date: '2026-09-15', adventure: 'Bobcat' },
  { id: 'w3', kind: 'den', den: 'Wolf', date: '2026-10-06', adventure: 'council fire' },   // typed lower-case
  { id: 'w4', kind: 'den', den: 'Wolf', date: '2026-10-20', adventure: 'Germs Alive!' },   // elective
  { id: 'w5', kind: 'den', den: 'Wolf', date: '2026-11-03', adventure: 'Knot night' },     // custom = elective
  { id: 'a1', kind: 'den', den: '', date: '2026-11-17', adventure: 'Safety in Numbers' },  // all dens, Wolf required
  { id: 'a2', kind: 'den', den: '', date: '2026-12-01', adventure: 'Bear Strong' },        // all dens, not a Wolf one
  { id: 'b1', kind: 'den', den: 'Bear', date: '2026-09-02', adventure: 'Footsteps' },      // another den's meeting
  { id: 'old', kind: 'den', den: 'Wolf', date: '2025-09-01', adventure: 'Footsteps' },     // last program year
  { id: 'p1', kind: 'pack', den: '', date: '2026-09-22', adventure: '' }
];

test('A1: the den planner shows which required adventures have a meeting this program year', () => {
  const ctx = planSandbox(PLAN_EVENTS);
  const plan = vm.runInContext("denPlan('Wolf', adventureRuns())", ctx);
  const req = Object.fromEntries(plan.required.map((r) => [r.name, r.sessions.map((s) => s.id)]));
  eq(req.Bobcat, ['w1', 'w2'], 'Bobcat’s two meetings');
  eq(req['Council Fire'], ['w3'], 'a lower-case tag is not the official adventure');
  eq(req['Safety in Numbers'], ['a1'], 'an All-dens meeting does not count for the den');
  eq(req.Footsteps, [], 'last year’s meeting, or the Bear den’s, counted for this year’s Wolves');
  eq(plan.unplanned.map((r) => r.name), ['Footsteps', 'Paws on the Path', 'Running with the Pack'], 'the gaps');
  ok(plan.required.find((r) => r.name === 'Safety in Numbers').allDens, 'the All-dens meeting is not marked as one');
});

test('A1: electives planned are counted against the two a rank needs', () => {
  const ctx = planSandbox(PLAN_EVENTS);
  const plan = vm.runInContext("denPlan('Wolf', adventureRuns())", ctx);
  eq(plan.electives.map((e) => e.name), ['Germs Alive!', 'Knot night'], 'electives: an official one and a custom one');
  eq([plan.electivesPlanned, plan.electivesNeeded], [2, 2], 'N of 2');
  // An All-dens meeting on another rank's adventure is not a Wolf elective.
  ok(!plan.electives.some((e) => e.name === 'Bear Strong'), 'an All-dens Bear adventure became a Wolf elective');
  const bear = vm.runInContext("denPlan('Bear', adventureRuns())", ctx);
  eq(bear.required.find((r) => r.name === 'Bear Strong').sessions.map((s) => s.id), ['a2'], 'the All-dens Bear meeting');
  eq(bear.electives.map((e) => e.name), ['Footsteps'], 'a Bear meeting on a Wolf adventure is the Bear den’s own custom elective');
});

test('A1: the planner form starts two weeks after the den’s last meeting, or today', () => {
  const ctx = planSandbox(PLAN_EVENTS);
  eq(vm.runInContext("denPlanDefaultDate('Wolf', EVENTS, '2026-09-28')", ctx), '2026-11-17', 'after Nov 3');
  eq(vm.runInContext("denPlanDefaultDate('Lion', EVENTS, '2026-09-28')", ctx), '2026-09-28', 'a den with nothing ahead');
  eq(vm.runInContext("denPlanDefaultDate('Wolf', EVENTS, '2026-12-01')", ctx), '2026-12-01', 'only meetings from today on');
});

test('A1: the planner is a Program section, writes only through a tagged den meeting, and never publishes', () => {
  const prog = nav.WORKSPACES.find((w) => w.id === 'program');
  ok(prog.sections.some((s) => s.id === 'denplan'), 'no Den plans section in Program');
  ok(/sec === 'denplan'\) v\.innerHTML = renderDenPlanner\(\)/.test(SCRIPT), 'the section is not dispatched');
  const h = /if \(kind === 'plan-adv'\) \{[\s\S]*?\n    \}/.exec(SCRIPT)[0];
  ok(/if \(!canEdit\(\)\)/.test(h), 'a viewer can add a meeting from the planner');
  ok(/freshEvent\(\{ kind: 'den', den: paDen, date: paDate[\s\S]*adventure: paName \}\)/.test(h), 'the meeting is not pre-tagged');
  ok(/advCanonicalName\(paDen, fd\.get\('name'\)\)/.test(h), 'the typed elective is not canonicalised');
  // Buttons that edit are offered only to editors — a job never decides it.
  const r = slice('renderDenPlanner');
  ok(/var edit = canEdit\(\);/.test(r) && !/hasJob\(/.test(r), 'the planner gates on something other than the role');
  ok(!/denPlan|renderDenPlanner/.test(BPV()), 'the den planner reached the parent view');
});

/* ---------------- report ---------------- */
if (fails.length) {
  console.error(`\n  ${fails.length} failing, ${pass} passing\n`);
  for (const f of fails) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log(`\n  ${pass} passing\n`);
