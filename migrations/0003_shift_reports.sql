-- Pack 569 — families report a storefront shift's totals (shift reports).
--
-- At the end of a storefront shift the parents at the table know the two figures the pack
-- records for that block: the Trail's End amount and the cash donations. A signed-in member
-- (a parent, or any leader) sends them in and signs that they counted them; an admin or editor
-- then accepts the report as the second sign-off, and the leader's page copies the figures onto
-- the block in the pack record. Nothing reaches the standings until a leader accepts.
--
-- Parents never write the pack record, so a report lives here, in its own table, which they
-- may write to under narrow rules. WHO MAY DO WHAT is decided in functions/_lib/rules.js
-- (canSubmitShiftReport, canReviewShiftReport, shiftReportProblem) and the two endpoints under
-- functions/api/pack/[id]/shift-reports/. The CHECKs below are the backstop, so a bug in an
-- endpoint still cannot write a row the rules would have refused:
--   - amounts are whole cents, 0 to $10,000 each;
--   - a note is at most 300 characters;
--   - the status is one of four;
--   - an accepted report names a reviewer who is NOT the person who sent it (the cash box's
--     "two different adults" rule, as the page's blockCashCheck has it);
--   - at most one report per block is open or accepted at a time (the partial unique index).
--
-- Every uid, name and time is the server's, from the member row and its clock; the page never
-- sends them. A report outlives what it is about on purpose: a removed member's report, or one
-- for a block a leader has since deleted, stays here as the record of what was sent and who
-- signed it, and leaders still see it.
--
-- Times are milliseconds since 1970 (UTC), as JavaScript's Date.now() gives them.
-- Apply with:  wrangler d1 migrations apply <database> --remote   (docs/cloudflare-setup.md)

CREATE TABLE shift_reports (
  id                 TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 64),
  pack_id            TEXT NOT NULL REFERENCES packs(id),
  -- The storefront's and the block's ids in the pack record, as the parent view publishes them.
  sf_id              TEXT NOT NULL CHECK (length(sf_id) BETWEEN 1 AND 64),
  block_id           TEXT NOT NULL CHECK (length(block_id) BETWEEN 1 AND 64),
  -- The block's salesCents and donationsCents, once accepted.
  te_cents           INTEGER NOT NULL CHECK (typeof(te_cents) = 'integer' AND te_cents BETWEEN 0 AND 1000000),
  cash_cents         INTEGER NOT NULL CHECK (typeof(cash_cents) = 'integer' AND cash_cents BETWEEN 0 AND 1000000),
  note               TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 300),
  submitted_by_uid   TEXT NOT NULL CHECK (length(submitted_by_uid) BETWEEN 1 AND 128),
  submitted_by_name  TEXT NOT NULL DEFAULT '' CHECK (length(submitted_by_name) <= 120),
  submitted_at       INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL,
  status             TEXT NOT NULL CHECK (status IN ('submitted', 'accepted', 'returned', 'withdrawn')),
  -- The leader who last accepted or sent it back.
  reviewed_by_uid    TEXT CHECK (reviewed_by_uid IS NULL OR length(reviewed_by_uid) BETWEEN 1 AND 128),
  reviewed_by_name   TEXT CHECK (reviewed_by_name IS NULL OR length(reviewed_by_name) <= 120),
  reviewed_at        INTEGER,
  review_note        TEXT NOT NULL DEFAULT '' CHECK (length(review_note) <= 300),
  -- A fresh random value on every write. An audit row is written only if the row still holds
  -- the stamp its own write set, so a write that lost a race leaves no audit row behind.
  stamp              TEXT NOT NULL CHECK (length(stamp) BETWEEN 1 AND 64),
  CHECK (status != 'accepted' OR (reviewed_by_uid IS NOT NULL AND reviewed_at IS NOT NULL
                                  AND reviewed_by_uid != submitted_by_uid)),
  CHECK (status != 'returned' OR (reviewed_by_uid IS NOT NULL AND reviewed_at IS NOT NULL))
);

-- One open-or-accepted report per block. A second family's report for a block that already has
-- one waiting, or one a leader has accepted, cannot be written, however two requests interleave.
CREATE UNIQUE INDEX shift_reports_one_per_block ON shift_reports (pack_id, block_id)
  WHERE status IN ('submitted', 'accepted');
CREATE INDEX shift_reports_by_block ON shift_reports (pack_id, sf_id, block_id);
CREATE INDEX shift_reports_by_submitter ON shift_reports (pack_id, submitted_by_uid);
