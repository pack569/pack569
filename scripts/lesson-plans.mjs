#!/usr/bin/env node
// Pack 569 — the den lesson plans, from their markdown to the site's plans.json.
//
// docs/lesson-plans/*.md is the source of truth: Keith edits the plans there, as prose a den
// leader could read on paper. The app does not carry them inside index.html (they are about
// 1.1 MB of text, and the page is already 2.2 MB). Instead scripts/build-site.mjs runs this
// parser and writes plans.json next to index.html, and the page fetches it only when a leader
// opens a plan (loadAdventurePlans), so a parent's phone never downloads it.
//
// What is parsed, and what is refused:
//   * Only the plan files (PLAN_FILES). open-questions.md, the safety reviews, CONTINUE.md and
//     BUILD-PLAN.md are notes about the plans, not plans.
//   * In each file, everything before the first "## " is the file's introduction and is not
//     published; everything from "## Open questions" on is Keith's to-do list and is not either.
//   * Every other "## Name (Rank)" is one adventure for one den, keyed like the app's runs:
//     den + ' :: ' + adventure, spelled as ADVENTURES spells it (NAME_FIXES, DEN_FIXES).
//   * The text is kept as the markdown wrote it — **bold**, *italics*, `code`, [date]
//     placeholders — never turned into HTML here. Whatever shows it must escape it first.
//   * A line this parser does not understand stops the build with the file and line. Nothing
//     is dropped quietly: a step without a Say, a meeting whose number is out of order, a den
//     meeting whose steps add up to more than its header says, text where a list was expected.
//
// Plain Node, no npm (the repo rule). build-site.mjs and test/harness.mjs import the exports.
//
// Usage (to look at the output by hand):  node scripts/lesson-plans.mjs [--out FILE]

import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PLANS_DIR = 'docs/lesson-plans';
// The plan files, in the order their plans are written out. Adding a file here publishes it.
export const PLAN_FILES = ['lion.md', 'tiger.md', 'wolf.md', 'bear.md', 'webelos.md', 'arrow-of-light.md',
  'electives/race-time.md', 'electives/champions-for-nature.md', 'electives/lets-camp.md',
  'electives/summertime-fun.md', 'electives/range-sports.md', 'electives/cycling.md',
  'electives/fishing.md', 'electives/swimming.md'];
// The shape of plans.json. Bump it when a field changes meaning, so an old page can tell.
export const PLANS_FORMAT = 1;

// Where the markdown spells a name differently from ADVENTURES in index.html. Each entry is a
// decision, not a guess: the heading as written → the name the app stores runs under.
// (The official names are "Running With the Pack" and "Pedal With the Pack"; the app has
// always written them with a small "with", and its stored runs use that spelling.)
export const NAME_FIXES = { 'Running With the Pack': 'Running with the Pack', 'Pedal With the Pack': 'Pedal with the Pack' };
export const DEN_FIXES = { 'AoL': 'Arrow of Light' };
const DENS = ['Lion', 'Tiger', 'Wolf', 'Bear', 'Webelos', 'Arrow of Light'];

export class PlanError extends Error {}
function fail(file, line, msg) { throw new PlanError(`${file}:${line}: ${msg}`); }

// ADVENTURES as index.html declares it, read by name rather than written down a second time.
// The block is plain data (strings and arrays), so it is evaluated with nothing in scope.
export function adventuresFrom(html) {
  const m = /^  var ADVENTURES = (\{[\s\S]*?\n  \});$/m.exec(html);
  if (!m) throw new PlanError('index.html: could not find "  var ADVENTURES = { … };"');
  return vm.runInNewContext('(' + m[1] + ')', Object.create(null), { timeout: 100 });
}

/* ---------------- lines → a list tree ---------------- */
// A section (one adventure's header, or one meeting) is a markdown list. Each list item becomes
// { head, parts: [{ text } | { node }], line }; a line of text belongs to the deepest open item
// whose content starts at or left of it (a paragraph continuing that item). Blank lines separate
// paragraphs but do not close an item.
function listTree(file, lines) {
  const root = { head: null, parts: [], col: -1, line: 0 };
  const stack = [root];
  for (const { text: raw, n } of lines) {
    if (raw.trim() === '') { stack[stack.length - 1].blank = true; continue; }
    const li = /^( *)(- |\d+\. )(.*)$/.exec(raw);
    const indent = /^ */.exec(raw)[0].length;
    while (stack.length > 1 && stack[stack.length - 1].col > indent) stack.pop();
    const top = stack[stack.length - 1];
    if (li) {
      if (top === root && indent !== 0) fail(file, n, 'a list item indented under nothing');
      const node = { head: li[3], marker: li[2].trim(), parts: [], col: indent + li[2].length, line: n };
      top.parts.push({ node });
      stack.push(node);
    } else {
      if (top === root) fail(file, n, `text outside any list item: "${raw.trim().slice(0, 60)}"`);
      top.parts.push({ text: raw.trim(), line: n, afterBlank: !!top.blank });
    }
    top.blank = false;
  }
  return root.parts.map((p) => p.node);
}

// An item as data: { text, items? }. A wrapped line continues the text before it (joined with a
// space, as markdown reads it). A new paragraph — after a blank line, or after a sub-list —
// keeps its place in `items` as { text, para: true }, so a list, a paragraph and more list read
// back in the order they were written. No text in plans.json holds a line break.
function toItem(file, node) {
  const out = { text: node.head.trim() };
  const items = [];
  for (const p of node.parts) {
    const last = items[items.length - 1];
    if (p.node) items.push(toItem(file, p.node));
    else if (p.afterBlank || (last && !last.para)) items.push({ text: p.text, para: true });
    else if (last) last.text += ' ' + p.text;
    else out.text += ' ' + p.text;
  }
  if (items.length) out.items = items;
  return out;
}
// "Label: text" or "**Label:** text" → [label, text]. The label stops at the first colon.
function labelled(head) {
  const b = /^\*\*([^*:]+):\*\*\s*([\s\S]*)$/.exec(head);
  if (b) return [b[1].trim(), b[2]];
  const m = /^([^:]+):\s*([\s\S]*)$/.exec(head);
  return m ? [m[1].trim(), m[2]] : [null, head];
}
function withLabel(file, node) {
  const it = toItem(file, node);
  const [label, text] = labelled(it.text);
  return Object.assign({ label: label || '' }, it, { text: label ? text : it.text });
}

/* ---------------- leader's choices, done-at lines ---------------- */
const OPTION_RE = /^Option ([A-Z])\b\s*(?:·|:|,|—)?\s*/;
// "Leader's choice for Req 2: Option A · … / Option B · …", or the same with the options as
// sub-items. Each option keeps its words; what it changes is for the leader to read.
function choiceOf(file, node) {
  const it = withLabel(file, node);
  const about = it.label.replace(/^Leader's choice\s*/, '').replace(/^for\s+/, '');
  const choice = { label: it.label, about, options: [] };
  const rest = [];
  // Inline options may follow a sentence of their own: "the den votes … Option A · … / Option B · …".
  const at = it.text.search(/(?:^|\s)Option A\s*·/);
  if (at >= 0) {
    const intro = it.text.slice(0, at).trim();
    if (intro) choice.text = intro;
    for (const part of it.text.slice(at).trim().split(/\s+\/\s+(?=Option [A-Z]\b)/)) {
      const m = OPTION_RE.exec(part);
      if (!m) fail(file, node.line, `a leader's choice option that does not start "Option X": "${part.slice(0, 50)}"`);
      choice.options.push({ key: m[1], label: 'Option ' + m[1], text: part.slice(m[0].length) });
    }
  } else if (it.text) choice.text = it.text;
  for (const sub of it.items || []) {
    const m = OPTION_RE.exec(sub.text);
    if (m) choice.options.push(Object.assign({ key: m[1], label: 'Option ' + m[1] }, sub, { text: sub.text.slice(m[0].length) }));
    else rest.push(sub);
  }
  if (rest.length) choice.items = rest;
  const keys = choice.options.map((o) => o.key);
  if (keys.length < 2) fail(file, node.line, `a leader's choice with ${keys.length} option(s); it needs Option A and Option B`);
  keys.forEach((k, i) => { if (k !== String.fromCharCode(65 + i)) fail(file, node.line, `leader's choice options out of order: ${keys.join(', ')}`); });
  return choice;
}
// "Done at a council range: …", "Done at the pack opening (if the Wolves lead it tonight): …",
// "Done outside the den: …". Where it happens is what the Advancement board will show.
const DONE_RE = /^Done (at .+?|outside the den)(?: \((.+?)\))?$/;
function doneOf(file, node) {
  const it = withLabel(file, node);
  const m = DONE_RE.exec(it.label);
  if (!m) fail(file, node.line, `a "Done …" line that is not "Done at …:" or "Done outside the den:"`);
  const out = { label: it.label, at: m[1].replace(/^at /, '') };
  if (m[2]) out.when = m[2];
  return Object.assign(out, { text: it.text }, it.items ? { items: it.items } : {});
}
// Letters of the options a title names: "(Option A only)", "(Option A cleanup, or Option B …)".
function optionLetters(title) {
  const out = [];
  const re = /\bOption ([A-Z])\b/g;
  let m;
  while ((m = re.exec(title))) if (out.indexOf(m[1]) < 0) out.push(m[1]);
  return out;
}

/* ---------------- steps ---------------- */
// 1. **Name Toss** · den · 10 min · Reqs: 3; 1 (set-up)
const STEP_RE = /^\*\*([^*]+)\*\* · (den|closing) · (\d+) min · Reqs: (.+)$/;
// One ";"-separated group of a step's Reqs: numbers, then notes in brackets.
const REQ_GROUP_RE = /^(\d+(?:(?:, | and |, and )\d+)*)((?: \([^()]+\))*)$/;
export function parseReqs(text) {
  const out = { done: [], setup: [] };
  if (text === 'none') return out;
  for (const g of text.split(/;\s*/)) {
    const m = REQ_GROUP_RE.exec(g.trim());
    if (!m) return null;
    const nums = m[1].split(/, and |, | and /);
    const notes = (m[2].match(/\(([^()]+)\)/g) || []).map((s) => s.slice(1, -1));
    const into = notes.indexOf('set-up') >= 0 ? out.setup : out.done;
    nums.forEach((x) => { if (into.indexOf(x) < 0) into.push(x); });
  }
  return out;
}
// "1) Stand in a circle. 2) Toss. 3) …" → one entry per number. A number counts only in order
// (1, then 2, …), so "(check 2)" or "Req 3)" in the middle of a sentence cannot split it.
function splitNumbered(text, next) {
  const pieces = [];
  const re = /(^|\s)(\d{1,2})\) /g;
  let m, cut = 0, n = null;
  while ((m = re.exec(text))) {
    if (+m[2] !== next) continue;
    const start = m.index + m[1].length;
    const before = text.slice(cut, start).trim();
    if (before || n !== null) pieces.push({ n, text: before });
    n = next; next += 1;
    cut = start + m[2].length + 2;
  }
  const last = text.slice(cut).trim();
  if (last || n !== null) pieces.push({ n, text: last });
  return { pieces, next };
}
// An option block inside a How: "**Option A · Fruit Salad:**" (or just "**Option A:**") at the
// start of a How paragraph, or after " / " when its own numbering starts right after it.
const HOW_OPTION_RE = /^\*\*Option ([A-Z])(?: · ([^*]+?))?:\*\*\s*/;
const HOW_OPTION_SPLIT = /\s+\/\s+(?=\*\*Option [A-Z](?: · [^*]+?)?:\*\*\s+1\) )/;
// How: numbered moves, sometimes with a sub-list under one of them, sometimes option blocks
// (the leader picks one), each numbered from 1: on lines of their own —
//   How: **Option A · Lion Safe Swim Defense:**
//     1) … 2) …
//     **Option B · Lifeguard guest:**
//     1) …
// — or on one line: "How: **Option A · Simon Says:** 1) … / **Option B · Freeze:** 1) …".
// An option named inside one numbered move ("3) **Option A · …:** … / **Option B …") is that
// move's text, not a block.
function howOf(file, node) {
  const groups = [{ how: [] }];
  let next = 1;
  const addText = (text, line) => {
    for (const para of text.split('\n')) {
      const t = para.trim();
      if (!t) continue;
      const blocks = HOW_OPTION_RE.test(t) ? t.split(HOW_OPTION_SPLIT) : [t];
      for (let b of blocks) {
        const o = HOW_OPTION_RE.exec(b);
        if (o) {
          groups.push({ key: o[1], label: 'Option ' + o[1] + (o[2] ? ' · ' + o[2] : ''), how: [] });
          next = 1;
          b = b.slice(o[0].length);
          if (!b) continue;
        }
        const r = splitNumbered(b, next);
        next = r.next;
        const how = groups[groups.length - 1].how;
        for (const p of r.pieces) {
          if (!p.text) fail(file, line, `an empty "${p.n})" in a How`);
          how.push(p.n === null ? { text: p.text } : { n: p.n, text: p.text });
        }
      }
    }
  };
  addText(node.head.replace(/^How:\s*/, ''), node.line);
  for (const p of node.parts) {
    if (p.text !== undefined) { addText(p.text, p.line); continue; }
    const how = groups[groups.length - 1].how;
    if (!how.length) fail(file, p.node.line, 'a sub-list in a How before any step of it');
    const last = how[how.length - 1];
    (last.items = last.items || []).push(toItem(file, p.node));
  }
  const main = groups[0].how;
  const options = groups.slice(1).map((g) => ({ key: g.key, label: g.label, how: g.how }));
  options.forEach((o, i) => {
    if (options.findIndex((x) => x.key === o.key) !== i) fail(file, node.line, `two How blocks for Option ${o.key}`);
    if (!o.how.length) fail(file, node.line, `How ${o.label} is empty`);
  });
  if (options.length === 1) fail(file, node.line, `a How with only ${options[0].label}`);
  if (!main.length && !options.length) fail(file, node.line, 'an empty How');
  return { how: main, options };
}
function stepOf(file, node, expectN) {
  const m = STEP_RE.exec(node.head);
  if (!m) fail(file, node.line, `a numbered line that is not a step ("N. **Title** · den|closing · M min · Reqs: …"): "${node.head.slice(0, 60)}"`);
  if (+node.marker.replace('.', '') !== expectN) fail(file, node.line, `step ${node.marker} where step ${expectN}. was expected`);
  const reqs = parseReqs(m[4]);
  if (!reqs) fail(file, node.line, `step Reqs I cannot read: "${m[4]}"`);
  const step = { n: expectN, title: m[1], kind: m[2], mins: +m[3], reqs: m[4], done: reqs.done, setup: reqs.setup };
  const forOptions = optionLetters(m[1]);
  if (forOptions.length) step.forOptions = forOptions;
  const home = [], notes = [];
  for (const p of node.parts) {
    if (!p.node) fail(file, p.line, 'text under a step that is not one of its "- Say:/How:/Tip:" lines');
    const sub = p.node;
    let s;
    if ((s = /^Say(?: \(to ([^)]+)\))?: ([\s\S]*)$/.exec(sub.head))) {
      if (step.say !== undefined) fail(file, sub.line, 'a second Say in one step');
      if (sub.parts.length) fail(file, sub.line, 'a Say with more under it');
      step.say = s[2];
      if (s[1]) step.sayTo = s[1];
    } else if (/^How:/.test(sub.head)) {
      if (step.how) fail(file, sub.line, 'a second How in one step');
      const h = howOf(file, sub);
      step.how = h.how;
      if (h.options.length) step.options = h.options;
    } else if (/^Tip:/.test(sub.head)) {
      if (step.tip !== undefined) fail(file, sub.line, 'a second Tip in one step');
      const it = toItem(file, sub);
      if (it.items) fail(file, sub.line, 'a Tip with a sub-list');
      step.tip = it.text.replace(/^Tip:\s*/, '');
    } else if (/^\(at home\)/.test(sub.head)) {
      const it = toItem(file, sub);
      if (it.items) fail(file, sub.line, 'an (at home) line with a sub-list');
      home.push(it.text.replace(/^\(at home\)\s*/, ''));
    } else {
      notes.push(withLabel(file, sub));
    }
  }
  for (const k of ['say', 'how', 'tip']) {
    if (step[k] === undefined) fail(file, node.line, `step "${m[1]}" has no ${k === 'say' ? 'Say' : k === 'how' ? 'How' : 'Tip'}`);
  }
  if (home.length) step.home = home;
  if (notes.length) step.notes = notes;
  return step;
}

/* ---------------- meetings ---------------- */
// ### Meeting 1 of 2 · Meet the Den · 40 min
// ### Meeting 2 of 2 · Nature Walk (outing, about 60 min)
// ### Meeting 3 of 3 · The Pack Campout (outing, overnight)
// ### Meeting 5 of 5 · After the Campout · 15 min (add-on at the start of the next den meeting)
const MEETING_RE = /^### Meeting (\d+) of (\d+) · (.+)$/;
function meetingHeader(file, n, line) {
  const m = MEETING_RE.exec(line);
  if (!m) fail(file, n, `a "###" heading that is not "### Meeting k of N · title · length"`);
  const rest = m[3];
  let t;
  const out = { n: +m[1], of: +m[2] };
  if ((t = /^(.+) · (\d+) min$/.exec(rest))) {
    Object.assign(out, { title: t[1], kind: 'den', mins: +t[2], length: t[2] + ' min' });
  } else if ((t = /^(.+) · (\d+) min \((add-on[^()]*)\)$/.exec(rest))) {
    Object.assign(out, { title: t[1], kind: 'add-on', mins: +t[2], length: t[2] + ' min (' + t[3] + ')' });
  } else if ((t = /^(.+) \(outing, ([^()]+)\)$/.exec(rest))) {
    const mins = /^about (\d+) min$/.exec(t[2]);
    Object.assign(out, { title: t[1], kind: 'outing', mins: mins ? +mins[1] : null, length: t[2] });
  } else fail(file, n, `a meeting length I cannot read: "${rest}" (want "· N min" or "(outing, …)")`);
  const forOptions = optionLetters(out.title);
  if (forOptions.length) out.forOptions = forOptions;
  return out;
}
const MEETING_FIELDS = { 'Prep': 'prep', 'Supplies': 'supplies', 'Tell parents before they leave': 'tellParents' };
function meetingOf(file, header, body) {
  const mtg = meetingHeader(file, header.n, header.text);
  const done = [], choices = [], variants = [], notes = [], steps = [];
  for (const node of listTree(file, body)) {
    if (node.marker !== '-') {
      steps.push(stepOf(file, node, steps.length + 1));
      continue;
    }
    if (steps.length) fail(file, node.line, 'a meeting line after the steps began');
    const [label] = labelled(node.head);
    if (label && MEETING_FIELDS[label]) {
      const k = MEETING_FIELDS[label];
      if (mtg[k]) fail(file, node.line, `a second "${label}:" in one meeting`);
      const it = toItem(file, node);
      it.text = it.text.replace(/^[^:]+:\s*/, '');
      mtg[k] = it;
    } else if (/^Done (at|outside) /.test(node.head)) done.push(doneOf(file, node));
    else if (/^Leader's choice\b/.test(node.head)) choices.push(choiceOf(file, node));
    else if (OPTION_RE.test(node.head)) {
      const it = withLabel(file, node);
      variants.push(Object.assign({ key: OPTION_RE.exec(node.head)[1] }, it));
    } else notes.push(withLabel(file, node));
  }
  for (const k of ['prep', 'supplies', 'tellParents']) {
    if (!mtg[k]) fail(file, header.n, `meeting ${mtg.n} ("${mtg.title}") has no "${Object.keys(MEETING_FIELDS).find((l) => MEETING_FIELDS[l] === k)}:" line`);
  }
  if (!steps.length) fail(file, header.n, `meeting ${mtg.n} ("${mtg.title}") has no steps`);
  if (done.length) mtg.done = done;
  if (choices.length) mtg.choices = choices;
  if (variants.length) mtg.variants = variants;
  if (notes.length) mtg.notes = notes;
  mtg.steps = steps;
  const total = steps.reduce((a, s) => a + s.mins, 0);
  mtg.stepMins = total;
  // A den meeting's steps must fit in what its header says (the timer runs the steps' own
  // minutes, stepMins), and den time is 40 minutes. A header may say more than the steps: the
  // plans aim at 35–40 minutes of steps in a 40-minute slot.
  if (mtg.kind === 'den' || mtg.kind === 'add-on') {
    if (total > mtg.mins) fail(file, header.n, `meeting ${mtg.n} ("${mtg.title}") says ${mtg.mins} min but its steps add up to ${total}`);
    if (mtg.kind === 'den' && total > 40) fail(file, header.n, `meeting ${mtg.n} ("${mtg.title}") is ${total} min; den time is 40`);
  }
  return mtg;
}

/* ---------------- adventures ---------------- */
const URL_RE = /https:\/\/[^\s<>"()]+[^\s<>"'().,;:]/g;
const ADV_HEAD_RE = /^## (.+) \(([^()]+)\)$/;
// - Character & Leadership · Meetings: 2 · Official page: https://… · Other sources: https://…, … · Checked: 2026-09-29
function headerLine(file, node) {
  const it = toItem(file, node);
  const all = [it.text].concat((it.items || []).map((x) => x.text)).join(' · ');
  const parts = all.split(' · ');
  const out = { category: parts[0].trim() };
  for (const part of parts.slice(1)) {
    const [k, v] = labelled(part);
    if (k === 'Meetings') out.meetingsNote = v;
    else if (k === 'Official page') out.official = (v.match(URL_RE) || [])[0];
    else if (k === 'Checked') out.verified = v.trim();
  }
  out.sources = [];
  for (const u of all.match(URL_RE) || []) if (out.sources.indexOf(u) < 0) out.sources.push(u);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(out.verified || '')) fail(file, node.line, 'the adventure line has no "Checked: YYYY-MM-DD"');
  if (!out.official) fail(file, node.line, 'the adventure line has no "Official page: https://…"');
  if (out.meetingsNote === undefined) fail(file, node.line, 'the adventure line has no "Meetings: N"');
  return out;
}
const REQ_LINE_RE = /^(.*\S)\s+\(([\s\S]+)\)$/;
function adventureOf(file, head, body, meetings, adventures) {
  const m = ADV_HEAD_RE.exec(head.text);
  if (!m) fail(file, head.n, `a "##" heading that is not "## Adventure (Rank)"`);
  const den = DEN_FIXES[m[2]] || m[2];
  if (DENS.indexOf(den) < 0) fail(file, head.n, `unknown rank "${m[2]}"`);
  const adventure = NAME_FIXES[m[1]] || m[1];
  if (adventures) {
    const a = adventures[den];
    if (!a || (a.required.indexOf(adventure) < 0 && a.electives.indexOf(adventure) < 0)) {
      fail(file, head.n, `"${adventure}" is not a ${den} adventure in ADVENTURES (add the spelling to NAME_FIXES if it is one)`);
    }
  }
  const nodes = listTree(file, body);
  if (!nodes.length) fail(file, head.n, 'an adventure with nothing under its heading');
  if (nodes.some((n) => n.marker !== '-')) fail(file, nodes.find((n) => n.marker !== '-').line, 'a numbered line outside any meeting');
  const plan = Object.assign({ den, adventure, heading: m[1] + ' (' + m[2] + ')', file }, headerLine(file, nodes[0]));
  const done = [], choices = [], notes = [];
  for (const node of nodes.slice(1)) {
    const [label] = labelled(node.head);
    if (label === 'Summary') plan.summary = toItem(file, node).text.replace(/^Summary:\s*/, '');
    else if (label === 'Requirements (own words)') {
      plan.reqs = node.parts.map((p) => {
        if (!p.node || p.node.marker === '-' || p.node.parts.length) fail(file, p.line || p.node.line, 'a requirement that is not one numbered line');
        const r = REQ_LINE_RE.exec(p.node.head);
        if (!r) fail(file, p.node.line, 'a requirement without "(where it is done)" at the end');
        return { n: +p.node.marker.replace('.', ''), text: r[1], where: r[2] };
      });
      plan.reqs.forEach((r, i) => { if (r.n !== i + 1) fail(file, node.line, `requirements numbered out of order at ${r.n}`); });
    } else if (label === 'Safety notes') {
      const it = toItem(file, node);
      if (it.text !== 'Safety notes:' || !it.items || it.items.some((x) => x.para)) fail(file, node.line, '"Safety notes:" should be a heading over a list');
      plan.safety = it.items;
    } else if (/^Done (at|outside) /.test(node.head)) done.push(doneOf(file, node));
    else if (/^Leader's choice\b/.test(node.head)) choices.push(choiceOf(file, node));
    else notes.push(withLabel(file, node));
  }
  if (!plan.summary) fail(file, head.n, 'no "Summary:"');
  if (!plan.reqs || !plan.reqs.length) fail(file, head.n, 'no "Requirements (own words):"');
  if (!plan.safety) fail(file, head.n, 'no "Safety notes:"');
  if (done.length) plan.done = done;
  if (choices.length) plan.choices = choices;
  if (notes.length) plan.notes = notes;
  plan.meetings = meetings.map((mt) => meetingOf(file, mt.header, mt.body));
  // Numbering. "Meeting k of N" counts along one option's path, and the files count paths
  // differently: Champions for Nature (Lion) is 1 of 2, 2 of 2, then "3 of 3 · … (Option A)";
  // AoL First Aid is 1–3 of 4, "3 of 3 · … (Option B only)", 4 of 4. So what is checked is what
  // holds in all of them: k starts at 1, never goes down, skips no number, is at most its N, and
  // the highest k is the header's "Meetings: N". Two meetings share a k only when one of them
  // names the option it belongs to.
  let prev = null;
  plan.meetings.forEach((mt, i) => {
    const line = meetings[i].header.n;
    if (mt.n < 1 || mt.n > mt.of) fail(file, line, `"Meeting ${mt.n} of ${mt.of}"`);
    if (!prev && mt.n !== 1) fail(file, line, `the first meeting is "Meeting ${mt.n}"`);
    if (prev && mt.n !== prev.n && mt.n !== prev.n + 1) fail(file, line, `"Meeting ${mt.n}" after "Meeting ${prev.n}"`);
    if (prev && mt.n === prev.n && !mt.forOptions && !prev.forOptions) fail(file, line, `two "Meeting ${mt.n}"s, and neither names its option`);
    prev = mt;
  });
  const count = parseInt(plan.meetingsNote, 10);
  const top = plan.meetings.reduce((a, mt) => Math.max(a, mt.n), 0);
  if (count !== top) fail(file, head.n, `"Meetings: ${plan.meetingsNote}" but the meetings go up to ${top}`);
  if (!plan.meetings.length && !(plan.done || []).length) fail(file, head.n, 'no meetings and no "Done at …" line: where is it done?');
  return plan;
}

// One plan file → [plan]. `adventures` is ADVENTURES from index.html (optional, for the key check).
export function parsePlanFile(file, text, adventures) {
  const lines = text.split('\n');
  lines.forEach((l, i) => { if (/[\u0000-\u001f\u007f]/.test(l)) fail(file, i + 1, 'a control character (a tab, or a Windows line ending?)'); });
  let guide = null;
  const sections = [];
  let cur = null, mtg = null, stop = false;
  lines.forEach((t, i) => {
    const n = i + 1;
    if (stop) return;
    if (/^> \*\*A guide, not the rulebook\.\*\*/.test(t)) { guide = t.replace(/^> /, ''); return; }
    if (/^## Open questions/.test(t)) { stop = true; return; }
    if (/^## /.test(t)) { cur = { head: { text: t, n }, body: [], meetings: [] }; sections.push(cur); mtg = null; return; }
    if (!cur) return; // the file's introduction
    if (/^#{1,2} /.test(t) || /^#{4,} /.test(t)) fail(file, n, `a heading where an adventure or meeting was expected: "${t.slice(0, 60)}"`);
    if (/^### /.test(t)) { mtg = { header: { text: t, n }, body: [] }; cur.meetings.push(mtg); return; }
    // A rule only ever separates one adventure from the next.
    if (t === '---') {
      if (!/^## /.test(lines.slice(i + 1).find((l) => l.trim() !== '') || '')) fail(file, n, 'a "---" rule inside an adventure');
      return;
    }
    if (/^>/.test(t)) fail(file, n, 'a quote inside an adventure');
    (mtg ? mtg.body : cur.body).push({ text: t, n });
  });
  if (!guide) fail(file, 1, 'no "> **A guide, not the rulebook.**" line');
  if (!stop) fail(file, lines.length, 'no "## Open questions" section at the end (it marks where the plans stop)');
  if (!sections.length) fail(file, 1, 'no adventures');
  return { guide, plans: sections.map((s) => adventureOf(file, s.head, s.body, s.meetings, adventures)) };
}

// Every plan file → { format, guide, plans: { 'Wolf :: Bobcat': plan, … } }.
export function parsePlans({ root = ROOT, adventures = null } = {}) {
  const out = { format: PLANS_FORMAT, guide: null, plans: {} };
  for (const f of PLAN_FILES) {
    const r = parsePlanFile(f, readFileSync(join(root, PLANS_DIR, f), 'utf8'), adventures);
    if (out.guide === null) out.guide = r.guide;
    else if (r.guide !== out.guide) fail(f, 3, 'the "A guide, not the rulebook" line differs from lion.md’s');
    for (const p of r.plans) {
      const key = p.den + ' :: ' + p.adventure;
      if (out.plans[key]) fail(f, 1, `a second plan for ${key} (the first is in ${out.plans[key].file})`);
      out.plans[key] = p;
    }
  }
  return out;
}

// The most plans.json may weigh. Measured at 1,072,908 bytes on 2026-09-30 (93 plans); this is
// about 25% above that. Growing past it is a decision (split the file, or trim), not a drift.
export const PLANS_MAX_BYTES = 1340000;

// The file the site serves. Compact JSON, one line; the build writes and verifies these bytes.
// The text is markdown, shown later by a page that escapes it; still, nothing that looks like
// an HTML tag and no control character gets this far.
export function plansJson({ root = ROOT } = {}) {
  const adventures = adventuresFrom(readFileSync(join(root, 'index.html'), 'utf8'));
  const json = JSON.stringify(parsePlans({ root, adventures }));
  const tag = /<[A-Za-z!?\/]/.exec(json);
  if (tag) throw new PlanError(`plans.json would hold an HTML tag: "${json.slice(tag.index, tag.index + 40)}"`);
  // JSON.stringify writes a control character (or a lone surrogate) as \n, \t, \u00xx…; the
  // only escapes allowed are \" and \\.
  if (/\\[^"\\]/.test(json.replace(/\\\\/g, ''))) throw new PlanError('plans.json would hold a control character');
  if (Buffer.byteLength(json, 'utf8') > PLANS_MAX_BYTES) {
    throw new PlanError(`plans.json is ${Buffer.byteLength(json, 'utf8')} bytes, over the ${PLANS_MAX_BYTES}-byte cap (PLANS_MAX_BYTES)`);
  }
  return json;
}

function main() {
  try {
    const i = process.argv.indexOf('--out');
    const json = plansJson();
    if (i > 0 && process.argv[i + 1]) writeFileSync(resolve(process.argv[i + 1]), json);
    const p = JSON.parse(json).plans;
    const keys = Object.keys(p);
    const meetings = keys.reduce((a, k) => a + p[k].meetings.length, 0);
    const steps = keys.reduce((a, k) => a + p[k].meetings.reduce((b, m) => b + m.steps.length, 0), 0);
    console.log(`${keys.length} plans, ${meetings} meetings, ${steps} steps, ${json.length} bytes`);
  } catch (e) {
    if (!(e instanceof PlanError)) throw e;
    console.error(`lesson-plans: ${e.message}`);
    process.exit(1);
  }
}

const invoked = process.argv[1] ? pathToFileURL(realpathSync(resolve(process.argv[1]))).href : '';
if (import.meta.url === invoked) main();
