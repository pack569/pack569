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
--   - at most one report per block is open or accepted at a time (the partial unique index);
--   - (S-4) a second parent's confirmation is never the sender's own, and an accepted report
--     that needed one has it, or a leader's written override;
--   - (review round 1) an accepted report says who VERIFIED the cash: the confirming parent (two
--     or more families), or the accepting leader who collected and counted it (one family), or
--     else a leader's override with a written reason; and the accepting leader is never the
--     sender or the confirmer.
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
  -- S-4 (Keith, 2026-10-01): a shift with scouts from two or more families needs a SECOND parent
  -- of a scout on that shift to confirm the totals before a leader accepts them. needs_confirm is
  -- set once, on the report's insert, from the stored parent view's count of families on the
  -- shift; confirmed_by_* is that parent (cleared when the sender edits); overridden is a leader
  -- accepting without one, with the reason in review_note.
  needs_confirm      INTEGER NOT NULL DEFAULT 0 CHECK (needs_confirm IN (0, 1)),
  confirmed_by_uid   TEXT CHECK (confirmed_by_uid IS NULL OR length(confirmed_by_uid) BETWEEN 1 AND 128),
  confirmed_by_name  TEXT CHECK (confirmed_by_name IS NULL OR length(confirmed_by_name) <= 120),
  confirmed_at       INTEGER,
  overridden         INTEGER NOT NULL DEFAULT 0 CHECK (overridden IN (0, 1)),
  -- The accept itself, written once by the accepting leader and never changed afterwards (a later
  -- send-back writes reviewed_*, not these), so the season's record keeps who accepted it and why.
  -- verified_by_leader: on a one-family shift, the accepting leader collected and counted the cash.
  accepted_by_uid    TEXT CHECK (accepted_by_uid IS NULL OR length(accepted_by_uid) BETWEEN 1 AND 128),
  accepted_by_name   TEXT CHECK (accepted_by_name IS NULL OR length(accepted_by_name) <= 120),
  accepted_at        INTEGER,
  accept_note        TEXT NOT NULL DEFAULT '' CHECK (length(accept_note) <= 300),
  verified_by_leader INTEGER NOT NULL DEFAULT 0 CHECK (verified_by_leader IN (0, 1)),
  -- A fresh random value on every write. An audit row is written only if the row still holds
  -- the stamp its own write set, so a write that lost a race leaves no audit row behind.
  stamp              TEXT NOT NULL CHECK (length(stamp) BETWEEN 1 AND 64),
  CHECK (status != 'accepted' OR (reviewed_by_uid IS NOT NULL AND reviewed_at IS NOT NULL
                                  AND reviewed_by_uid != submitted_by_uid)),
  CHECK (status != 'returned' OR (reviewed_by_uid IS NOT NULL AND reviewed_at IS NOT NULL)),
  CHECK (confirmed_by_uid IS NULL OR (confirmed_by_uid != submitted_by_uid AND confirmed_at IS NOT NULL)),
  CHECK (status != 'accepted' OR (accepted_by_uid IS NOT NULL AND accepted_at IS NOT NULL)),
  CHECK (accepted_by_uid IS NULL OR (accepted_by_uid != submitted_by_uid
         AND (confirmed_by_uid IS NULL OR accepted_by_uid != confirmed_by_uid))),
  CHECK (status != 'accepted'
         OR (needs_confirm = 1 AND confirmed_by_uid IS NOT NULL)
         OR (needs_confirm = 0 AND verified_by_leader = 1)
         OR (overridden = 1 AND length(trim(accept_note)) > 0)),
  CHECK (verified_by_leader = 0 OR needs_confirm = 0)
);

-- One open-or-accepted report per block. A second family's report for a block that already has
-- one waiting, or one a leader has accepted, cannot be written, however two requests interleave.
CREATE UNIQUE INDEX shift_reports_one_per_block ON shift_reports (pack_id, block_id)
  WHERE status IN ('submitted', 'accepted');
CREATE INDEX shift_reports_by_block ON shift_reports (pack_id, sf_id, block_id);
CREATE INDEX shift_reports_by_submitter ON shift_reports (pack_id, submitted_by_uid);
