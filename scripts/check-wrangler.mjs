#!/usr/bin/env node
// Pack 569 — the check that keeps a preview's server off the live pack's database.
//
// wrangler.toml names two D1 databases: pack569-prod for production ([env.production]) and
// pack569-preview for everything else (the top level and [env.preview]). A name is only a
// label; the database_id is what wrangler binds. So before a deploy, and in the harness on
// every push, this reads wrangler.toml and refuses it unless:
//   - every line is one of four plain shapes: blank, a '#' comment, a table header from the
//     list below, or  key = "value"  with a bare key and a one-line value holding no quote
//     or backslash. TOML allows far more (quoted keys, dotted keys, multi-line strings,
//     'literal' strings, trailing comments), and each of those lets a line mean one thing to a
//     line-by-line reader and another to wrangler: a fake [[env.production.d1_databases]]
//     inside a """ string, or a "database_id" whose quotes hide it from a grep. The security
//     re-review of stage A found exactly that, so none of it is accepted here. The file is
//     ours; it never needs any of it;
//   - every header is one of the six below, each once: so each environment has exactly one
//     d1 entry and one vars table, and every key belongs to the header it sits under;
//   - no value anywhere is a REPLACE_WITH_ placeholder, and every database_id is a D1 id;
//   - the top level and [env.preview] carry the same database_id, and [env.production] a
//     different one;
//   - DEPLOY_ENV is "preview" in the top level's [vars] and [env.preview.vars], and "prod" in
//     [env.production.vars] — by position, not by counting lines, so swapping them is refused;
//   - every vars table says FIREBASE_PROJECT_ID = "pack-569", so no deployment believes another
//     project's sign-ins; [env.production.vars] says OWNER_MODE = "fixed"; and PACK_IDS is the
//     same in all three, and is index.html's PACK_DOC_ID (the pack the page itself asks for).
//     The security review of 5690c3a..20b4fd6 (item 3) found only DEPLOY_ENV checked here.
//     (The API also treats DEPLOY_ENV "prod" as fixed owner mode whatever OWNER_MODE says:
//     functions/_lib/pack.js fixedOwnerMode.)
// The API checks the same pairing again at run time, against the bound database's own
// `deployment` row (functions/_lib/pack.js database()): this file is the first of two locks.
//
// Usage:  node scripts/check-wrangler.mjs [path/to/wrangler.toml]    (default: ./wrangler.toml)
// index.html is read from the same folder as wrangler.toml, for its PACK_DOC_ID.
// Exit 0 and one line naming the ids, or exit 1 with a GitHub ::error line per problem.
// The deploy job runs this; test/harness.mjs imports checkWrangler() and runs the same code.
// Plain Node, no npm (the repo rule).

import { readFileSync, realpathSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { liveConfig } from './build-site.mjs';

// Header -> [which environment, which kind of table, the header's bracket form].
export const WRANGLER_BLOCKS = {
  'vars': ['top', 'vars', '['],
  'd1_databases': ['top', 'd1', '[['],
  'env.preview.vars': ['preview', 'vars', '['],
  'env.preview.d1_databases': ['preview', 'd1', '[['],
  'env.production.vars': ['production', 'vars', '['],
  'env.production.d1_databases': ['production', 'd1', '[[']
};
const DEPLOY_ENV_OF = { top: 'preview', preview: 'preview', production: 'prod' };
const FIREBASE_PROJECT_ID = 'pack-569';
const TOP_KEYS = ['name', 'pages_build_output_dir', 'compatibility_date'];
const D1_KEYS = ['binding', 'database_name', 'database_id', 'migrations_dir'];
const DB_NAME_OF = { top: 'pack569-preview', preview: 'pack569-preview', production: 'pack569-prod' };
const D1_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const GUIDE = "docs/cloudflare-setup.md, The pack's database";

const LINE_BLANK = /^$/;
const LINE_COMMENT = /^#/;
const LINE_HEADER = /^(\[\[?)([a-z0-9_.]+)(\]\]?)$/;
const LINE_PAIR = /^([A-Za-z_][A-Za-z0-9_]*) = "([^"\\]*)"$/;

// { problems: [{ title, detail }], ids: { top, preview, production }, blocks: { header: { key: value } } }
// packDocId: index.html's PACK_DOC_ID. Required: with none, the file is refused.
export function checkWrangler(text, { packDocId } = {}) {
  const problems = [];
  const say = (title, detail) => problems.push({ title, detail });
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const blocks = Object.create(null);
  blocks[''] = Object.create(null);
  let cur = '';
  String(text).split('\n').forEach((line, i) => {
    const at = 'line ' + (i + 1) + ': ';
    if (LINE_BLANK.test(line) || LINE_COMMENT.test(line)) return;
    const h = LINE_HEADER.exec(line);
    if (h) {
      const b = own(WRANGLER_BLOCKS, h[2]) ? WRANGLER_BLOCKS[h[2]] : null;
      if (!b || b[2] !== h[1] || h[3] !== h[1].replace(/\[/g, ']')) {
        say('wrangler.toml has a table this check does not know', at + line + ' — only [vars], [[d1_databases]] and their [env.preview] and [env.production] forms are allowed.');
      } else if (blocks[h[2]]) {
        say('wrangler.toml has a table twice', at + line + ' — each environment has exactly one.');
      }
      cur = h[2];
      blocks[cur] = blocks[cur] || Object.create(null);
      return;
    }
    const p = LINE_PAIR.exec(line);
    if (!p) {
      say('wrangler.toml has a line this check cannot read', at + JSON.stringify(line.slice(0, 80)) +
        ' — only blank lines, # comments, the known table headers and  key = "one-line value"  are allowed (no quoted keys, no multi-line or \'literal\' strings, no trailing comments).');
      return;
    }
    const [, key, value] = p;
    if (own(blocks[cur], key)) say('wrangler.toml sets a key twice', at + key + ' under ' + (cur || 'the top level') + '.');
    blocks[cur][key] = value;
    if (value.indexOf('REPLACE_WITH_') >= 0) {
      say('wrangler.toml still has placeholder D1 ids', at + 'Create pack569-prod and pack569-preview and paste their ids into wrangler.toml (' + GUIDE + ').');
    }
    const kind = cur ? (own(WRANGLER_BLOCKS, cur) ? WRANGLER_BLOCKS[cur][1] : null) : 'top';
    if (kind === 'top' && TOP_KEYS.indexOf(key) === -1) say('wrangler.toml has an unexpected top-level key', at + key);
    if (kind === 'd1' && D1_KEYS.indexOf(key) === -1) say('wrangler.toml has an unexpected key in a database entry', at + key);
    if (kind === 'vars' && key === 'PACK_OWNER_UID') say('wrangler.toml commits PACK_OWNER_UID', at + 'it is a secret, set in the Cloudflare dashboard.');
  });

  const ids = {};
  const packIds = [];
  for (const header of Object.keys(WRANGLER_BLOCKS)) {
    const [env, kind] = WRANGLER_BLOCKS[header];
    const b = blocks[header];
    if (!b) { say('wrangler.toml is missing a table', '[' + header + '] — every environment needs its own vars and its own database.'); continue; }
    if (kind === 'vars') {
      if (b.DEPLOY_ENV !== DEPLOY_ENV_OF[env]) {
        say('wrangler.toml DEPLOY_ENV', '[' + header + '] says DEPLOY_ENV = ' + JSON.stringify(b.DEPLOY_ENV === undefined ? null : b.DEPLOY_ENV) +
          '. The top level and [env.preview] must say DEPLOY_ENV = "preview", and [env.production] DEPLOY_ENV = "prod".');
      }
      if (b.FIREBASE_PROJECT_ID !== FIREBASE_PROJECT_ID) {
        say('wrangler.toml FIREBASE_PROJECT_ID', '[' + header + '] must say FIREBASE_PROJECT_ID = "' + FIREBASE_PROJECT_ID + '": the API accepts only that project\'s sign-ins.');
      }
      if (env === 'production' && b.OWNER_MODE !== 'fixed') {
        say('wrangler.toml OWNER_MODE', '[' + header + '] must say OWNER_MODE = "fixed": the live pack\'s owner is PACK_OWNER_UID, never whoever signs in first.');
      }
      packIds.push(b.PACK_IDS);
      continue;
    }
    if (b.binding !== 'DB') say('wrangler.toml database binding', '[[' + header + ']] must bind "DB".');
    if (b.database_name !== DB_NAME_OF[env]) say('wrangler.toml database name', '[[' + header + ']] must name ' + DB_NAME_OF[env] + '.');
    const id = b.database_id;
    ids[env] = id;
    if (id === undefined) say('wrangler.toml database ids are crossed', '[[' + header + ']] has no database_id.');
    else if (id.indexOf('REPLACE_WITH_') === -1 && !D1_ID_RE.test(id)) say('wrangler.toml database id', '[[' + header + ']] database_id is not a D1 database id.');
  }
  if (typeof packDocId !== 'string' || !packDocId) {
    say('wrangler.toml PACK_IDS', "The check was not given index.html's PACK_DOC_ID, so it cannot say which pack PACK_IDS must name.");
  } else if (packIds.some((v) => v !== packDocId)) {
    say('wrangler.toml PACK_IDS', 'Every vars table must say PACK_IDS = "' + packDocId + '", the PACK_DOC_ID in index.html (found ' +
      packIds.map((v) => JSON.stringify(v === undefined ? null : v)).join(', ') + ').');
  }
  if (ids.top !== undefined && ids.production !== undefined && (ids.top !== ids.preview || ids.top === ids.production)) {
    say('wrangler.toml database ids are crossed', "The top level and [env.preview] must both carry pack569-preview's id, and [env.production] pack569-prod's, a different one (" + GUIDE + ').');
  }
  return { problems, ids, blocks };
}

function main() {
  const file = resolve(process.argv[2] || 'wrangler.toml');
  let text;
  try { text = readFileSync(file, 'utf8'); } catch (e) {
    console.log('::error title=No wrangler.toml::' + file + ' could not be read.');
    process.exit(1);
  }
  let packDocId = null;
  const page = join(dirname(file), 'index.html');
  try { packDocId = liveConfig(readFileSync(page, 'utf8')).docId; } catch (e) {
    console.log('::error title=No index.html::' + page + ' could not be read for its PACK_DOC_ID.');
    process.exit(1);
  }
  const r = checkWrangler(text, { packDocId });
  if (r.problems.length) {
    // A workflow command's message is one line; % and newlines would be read as its syntax.
    const esc = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
    r.problems.forEach((p) => console.log('::error title=' + esc(p.title).replace(/[:,]/g, ' ') + '::' + esc(p.detail)));
    process.exit(1);
  }
  console.log('Database ids: preview ' + r.ids.top + ' (top level and [env.preview]), production ' + r.ids.production + '.');
}

const invoked = process.argv[1] ? pathToFileURL(realpathSync(resolve(process.argv[1]))).href : '';
if (import.meta.url === invoked) main();
