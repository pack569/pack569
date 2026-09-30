-- Pack 569 — the D1 schema (Phase 2 of the Cloudflare move).
--
-- Today the pack lives in Firestore: one document holding the whole pack record, plus five
-- small side documents (packmeta, members, invites, public/join, public/view). This schema
-- holds the same six things, one table each, with pack_id on every table so one database can
-- later hold more than one pack. The pack record itself stays ONE ROW (pack_state.json);
-- splitting it into tables is Phase 3.
--
-- WHO MAY READ OR WRITE WHAT is not decided here. It is decided in functions/_lib/rules.js,
-- which re-implements SETUP.md Part C rule by rule. The CHECKs below are the backstop: the
-- shapes Part C allows (a role from the list, a name of at most 120 characters, an invite that
-- can never make an admin, a join link that can only ever file a request), so a bug in an
-- endpoint still cannot write a row the rules would have refused.
--
-- Times are milliseconds since 1970 (UTC), as JavaScript's Date.now() gives them.
-- Apply with:  wrangler d1 migrations apply <database> --remote   (docs/cloudflare-setup.md)

-- One row per pack. owner_uid is Firestore's packmeta/{id}.owner: set once, never changed
-- (Part C: packmeta `allow update, delete: if false`). The trigger below holds it.
CREATE TABLE packs (
  id          TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 128),
  name        TEXT NOT NULL DEFAULT '' CHECK (length(name) <= 120),
  owner_uid   TEXT CHECK (owner_uid IS NULL OR length(owner_uid) BETWEEN 1 AND 128),
  created_at  INTEGER NOT NULL
);

CREATE TRIGGER packs_owner_is_permanent
BEFORE UPDATE OF owner_uid ON packs
WHEN OLD.owner_uid IS NOT NULL AND (NEW.owner_uid IS NULL OR NEW.owner_uid != OLD.owner_uid)
BEGIN
  SELECT RAISE(ABORT, 'the pack owner is permanent');
END;

CREATE TRIGGER packs_are_not_deleted
BEFORE DELETE ON packs
BEGIN
  SELECT RAISE(ABORT, 'a pack is not deleted here');
END;

-- A Google account's place in a pack. Part C memberKeysOk(): role, name (a string of at most
-- 120 characters), email, addedAt, joinCode — nothing else.
CREATE TABLE members (
  pack_id    TEXT NOT NULL REFERENCES packs(id),
  uid        TEXT NOT NULL CHECK (length(uid) BETWEEN 1 AND 128),
  role       TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'viewer', 'parent', 'pending')),
  name       TEXT NOT NULL DEFAULT '' CHECK (length(name) <= 120),
  email      TEXT NOT NULL DEFAULT '' CHECK (length(email) <= 320),
  -- The sign-up code a 'pending' request came in on (Part C: joinCode). Only a pending
  -- request is ever created with one; it stays on the row after approval, as in Firestore.
  join_code  TEXT CHECK (join_code IS NULL OR length(join_code) BETWEEN 1 AND 64),
  added_at   INTEGER NOT NULL,
  PRIMARY KEY (pack_id, uid)
);
CREATE INDEX members_by_role ON members (pack_id, role);

-- An admin's invitation, keyed by the LOWERCASED email (Part C: invites/{email}, matched on
-- the Google email lowercased). The role can never be admin or pending (Part C: role in
-- ['editor', 'viewer', 'parent']). invited_by_uid is the inviting admin's account id — not
-- their email, which the Firestore doc carried and every invitee could read.
CREATE TABLE invites (
  pack_id         TEXT NOT NULL REFERENCES packs(id),
  email           TEXT NOT NULL CHECK (length(email) BETWEEN 3 AND 320 AND email = lower(email)
                                       AND instr(email, '@') > 1),
  role            TEXT NOT NULL CHECK (role IN ('editor', 'viewer', 'parent')),
  invited_by_uid  TEXT NOT NULL CHECK (length(invited_by_uid) BETWEEN 1 AND 128),
  invited_at      INTEGER NOT NULL,
  PRIMARY KEY (pack_id, email)
);

-- The sign-up link switch (Firestore public/join). mode is pinned to 'request': a link plus a
-- Google account files a request an admin must approve, and there is no other mode (owner
-- directive; the client has written mode:'request' since the join link existed).
CREATE TABLE join_config (
  pack_id         TEXT PRIMARY KEY REFERENCES packs(id),
  open            INTEGER NOT NULL DEFAULT 0 CHECK (open IN (0, 1)),
  mode            TEXT NOT NULL DEFAULT 'request' CHECK (mode = 'request'),
  code            TEXT NOT NULL CHECK (length(code) BETWEEN 1 AND 64 AND code NOT GLOB '*[^A-Za-z0-9]*'),
  show_standings  INTEGER NOT NULL DEFAULT 1 CHECK (show_standings IN (0, 1)),
  show_amounts    INTEGER NOT NULL DEFAULT 1 CHECK (show_amounts IN (0, 1)),
  contact         TEXT NOT NULL DEFAULT '' CHECK (length(contact) <= 160),
  updated_at      INTEGER NOT NULL
);

-- The sanitized parent view (Firestore public/view): a JSON object a leader's device builds
-- with buildParentView. The server stores it; it never reads the pack record to make one.
CREATE TABLE parent_views (
  pack_id       TEXT PRIMARY KEY REFERENCES packs(id),
  payload       TEXT NOT NULL CHECK (length(payload) >= 2),
  generated_at  INTEGER NOT NULL
);

-- The pack record: the whole `state`, as JSON text, one row per pack. rev only ever goes up:
-- a write names the rev it started from and lands only if that is still the rev
-- (UPDATE … WHERE rev = ?), which is what D1 has instead of a transaction.
CREATE TABLE pack_state (
  pack_id     TEXT PRIMARY KEY REFERENCES packs(id),
  rev         INTEGER NOT NULL CHECK (rev >= 0),
  json        TEXT NOT NULL CHECK (length(json) >= 2),
  device      TEXT NOT NULL DEFAULT '' CHECK (length(device) <= 128),
  updated_at  INTEGER NOT NULL
);

-- The one-time copy from Firestore. A plain INSERT, so a second import fails on the primary
-- key and the whole import batch rolls back with it.
CREATE TABLE import_lock (
  pack_id  TEXT PRIMARY KEY REFERENCES packs(id),
  uid      TEXT NOT NULL,
  at       INTEGER NOT NULL
);

-- Who changed membership, roles, invites or the sign-up link, and when. Written by the server
-- in the same batch as the change it records. detail is a small JSON object; it never holds
-- the join code.
CREATE TABLE audit (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  pack_id  TEXT NOT NULL,
  at       INTEGER NOT NULL,
  uid      TEXT NOT NULL,
  action   TEXT NOT NULL CHECK (length(action) BETWEEN 1 AND 64),
  detail   TEXT NOT NULL DEFAULT '{}' CHECK (length(detail) <= 2000)
);
CREATE INDEX audit_by_pack ON audit (pack_id, at);

-- Sign-up link attempts per account, for the rate limit in /api/session. One row per account
-- per pack: the start of its current window and how many tries it has made in it.
CREATE TABLE join_attempts (
  pack_id       TEXT NOT NULL,
  uid           TEXT NOT NULL,
  window_start  INTEGER NOT NULL,
  attempts      INTEGER NOT NULL CHECK (attempts >= 0),
  PRIMARY KEY (pack_id, uid)
);
