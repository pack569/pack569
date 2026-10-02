-- Pack 569 — pack positions (position-based access, stage 1; the approved plan, 2026-10-01).
--
-- A leader account can now hold one or more pack POSITIONS (Committee Chair, Cubmaster, Den
-- Leader, Treasurer, …), and what it may edit follows from them (functions/_lib/access.js). Such
-- an account has the new role 'leader'. The position ids are the page's job ids (JOBS), every
-- one but 'cor' (the Chartered Org Rep is made an admin), plus 'parent'.
-- 'editor' and 'viewer' are retired (Keith, 2026-10-02): an account still holding either reads
-- everything and edits nothing until an admin gives it positions, and no invite or role change
-- makes a new one (rules.js). Both stay in the CHECKs below so those accounts, and invites
-- written before the switch, still load. 'leader' exists only on this API; the Firestore rules
-- (SETUP.md Part C) never had it.
--
-- 1. 'leader' joins the role CHECKs of members and invites. SQLite cannot change a CHECK in
--    place, so both tables are rebuilt: a new table with the new CHECK, every row copied across,
--    the old one dropped and the new one renamed. Nothing references either table, so nothing
--    else has to move. members_by_role goes with the old table and is made again.
-- 2. member_positions: the positions each account holds. invite_positions: the positions an
--    invite will give, copied to member_positions when the invite is used (/api/session).
--    `dens` (Keith, 2026-10-02: own-den scope in stage 1, for den meetings): on a Den Leader or
--    Assistant Den Leader row, the dens they lead, a JSON array of the page's DENS names (the
--    endpoints check the names; the CHECK only the shape); NULL on every other position. An
--    array, not a row per den: a position is held once. Edited in place before it was applied
--    anywhere (it had a `den` column, always NULL).
--
-- The positions are listed here as well as in access.js; the harness checks the two agree.

PRAGMA defer_foreign_keys = true;

CREATE TABLE members_new (
  pack_id    TEXT NOT NULL REFERENCES packs(id),
  uid        TEXT NOT NULL CHECK (length(uid) BETWEEN 1 AND 128),
  role       TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'viewer', 'leader', 'parent', 'pending')),
  name       TEXT NOT NULL DEFAULT '' CHECK (length(name) <= 120),
  email      TEXT NOT NULL DEFAULT '' CHECK (length(email) <= 320),
  join_code  TEXT CHECK (join_code IS NULL OR length(join_code) BETWEEN 1 AND 64),
  added_at   INTEGER NOT NULL,
  PRIMARY KEY (pack_id, uid)
);
INSERT INTO members_new (pack_id, uid, role, name, email, join_code, added_at)
  SELECT pack_id, uid, role, name, email, join_code, added_at FROM members;
DROP TABLE members;
ALTER TABLE members_new RENAME TO members;
CREATE INDEX members_by_role ON members (pack_id, role);

-- An invite still can never make an admin (or a pending request). editor and viewer stay legal for
-- invites written before the switch; rules.js INVITE_ROLES refuses new ones.
CREATE TABLE invites_new (
  pack_id         TEXT NOT NULL REFERENCES packs(id),
  email           TEXT NOT NULL CHECK (length(email) BETWEEN 3 AND 320 AND email = lower(email)
                                       AND instr(email, '@') > 1),
  role            TEXT NOT NULL CHECK (role IN ('editor', 'viewer', 'leader', 'parent')),
  invited_by_uid  TEXT NOT NULL CHECK (length(invited_by_uid) BETWEEN 1 AND 128),
  invited_at      INTEGER NOT NULL,
  PRIMARY KEY (pack_id, email)
);
INSERT INTO invites_new (pack_id, email, role, invited_by_uid, invited_at)
  SELECT pack_id, email, role, invited_by_uid, invited_at FROM invites;
DROP TABLE invites;
ALTER TABLE invites_new RENAME TO invites;

CREATE TABLE member_positions (
  pack_id   TEXT NOT NULL REFERENCES packs(id),
  uid       TEXT NOT NULL CHECK (length(uid) BETWEEN 1 AND 128),
  position  TEXT NOT NULL CHECK (position IN ('cubmaster', 'asstcub', 'chair', 'treasurer', 'secretary', 'kernel',
                                              'advancement', 'activities', 'membership', 'outdoors', 'derbychair',
                                              'comms', 'trainer', 'denleader', 'asstden', 'parent')),
  dens      TEXT CHECK (dens IS NULL OR (position IN ('denleader', 'asstden') AND length(dens) <= 200
                                         AND json_valid(dens) AND json_type(dens) = 'array')),
  PRIMARY KEY (pack_id, uid, position)
);

CREATE TABLE invite_positions (
  pack_id   TEXT NOT NULL REFERENCES packs(id),
  email     TEXT NOT NULL CHECK (length(email) BETWEEN 3 AND 320),
  position  TEXT NOT NULL CHECK (position IN ('cubmaster', 'asstcub', 'chair', 'treasurer', 'secretary', 'kernel',
                                              'advancement', 'activities', 'membership', 'outdoors', 'derbychair',
                                              'comms', 'trainer', 'denleader', 'asstden', 'parent')),
  dens      TEXT CHECK (dens IS NULL OR (position IN ('denleader', 'asstden') AND length(dens) <= 200
                                         AND json_valid(dens) AND json_type(dens) = 'array')),
  PRIMARY KEY (pack_id, email, position)
);

-- The backstop, as the CHECKs in 0001 are: whatever an endpoint does, a position is held only by
-- a 'leader' account, or Parent by a 'parent' one; and it never outlives the account or invite
-- that held it (the 2026-07-26 audit's lesson). A role that changes takes its positions with it
-- (an endpoint that gives positions writes them after the role, in the same batch).
CREATE TRIGGER member_positions_need_a_leader
BEFORE INSERT ON member_positions
WHEN NOT EXISTS (SELECT 1 FROM members WHERE pack_id = NEW.pack_id AND uid = NEW.uid
                 AND (role = 'leader' OR (role = 'parent' AND NEW.position = 'parent')))
BEGIN
  SELECT RAISE(ABORT, 'a position is held only by a leader');
END;

CREATE TRIGGER invite_positions_need_a_leader
BEFORE INSERT ON invite_positions
WHEN NOT EXISTS (SELECT 1 FROM invites WHERE pack_id = NEW.pack_id AND email = NEW.email
                 AND (role = 'leader' OR (role = 'parent' AND NEW.position = 'parent')))
BEGIN
  SELECT RAISE(ABORT, 'a position is given only by a leader invite');
END;

CREATE TRIGGER member_positions_follow_the_role
AFTER UPDATE OF role ON members
WHEN NEW.role IS NOT OLD.role
BEGIN
  DELETE FROM member_positions WHERE pack_id = NEW.pack_id AND uid = NEW.uid;
END;

CREATE TRIGGER member_positions_go_with_the_member
AFTER DELETE ON members
BEGIN
  DELETE FROM member_positions WHERE pack_id = OLD.pack_id AND uid = OLD.uid;
END;

CREATE TRIGGER invite_positions_follow_the_role
AFTER UPDATE OF role ON invites
WHEN NEW.role IS NOT OLD.role
BEGIN
  DELETE FROM invite_positions WHERE pack_id = NEW.pack_id AND email = NEW.email;
END;

CREATE TRIGGER invite_positions_go_with_the_invite
AFTER DELETE ON invites
BEGIN
  DELETE FROM invite_positions WHERE pack_id = OLD.pack_id AND email = OLD.email;
END;

-- 3. Undoing a record of cash from popcorn sales (shift_reports.sales_cash_outcome, 0004) needs a
--    written reason, as taking back an accept does (security and treasurer reviews of 045e7ac):
--    undoing it erases the pack's only record of who has the cash. The last undo is kept on the
--    report, with who and when, so the season's history can say it; the audit row
--    (shift.salescash.undo, detail.reason) keeps every one. Recording the cash again leaves them.
ALTER TABLE shift_reports ADD COLUMN sales_cash_undo_note TEXT
  CHECK (sales_cash_undo_note IS NULL OR length(sales_cash_undo_note) BETWEEN 1 AND 300);
ALTER TABLE shift_reports ADD COLUMN sales_cash_undo_by_name TEXT
  CHECK (sales_cash_undo_by_name IS NULL OR length(sales_cash_undo_by_name) <= 120);
ALTER TABLE shift_reports ADD COLUMN sales_cash_undo_at INTEGER
  CHECK (sales_cash_undo_at IS NULL OR typeof(sales_cash_undo_at) = 'integer');
