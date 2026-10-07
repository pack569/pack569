-- Pack 569 — an admin corrects an accepted shift report, with a reason (shift report edits).
--
-- Keith (2026-10-07): a family was rained out of a storefront and sold from a wagon instead, but
-- reported the money as storefront totals. The report was accepted, and once Trail's End's own
-- figures were imported the same sales counted twice: once as the wagon sales they were, and
-- once on the storefront block. Sending the report back means a round trip to the family for a
-- figure the admin already knows. So an ADMIN (never an editor) may change an accepted report's
-- figures in place, with a written reason the family sees, and the report stays accepted.
--
-- The report row holds the figures now in force (te_cents, cash_cents, sales_cash_cents), so
-- everything that reads it already reads the corrected figures. What it held before is kept here,
-- one row per edit, oldest first, with who made it, when and why: nothing is overwritten without
-- a trace. The accept itself (accepted_*, accept_note) is never changed by an edit.
--
-- WHO MAY DO WHAT is decided in functions/_lib/rules.js (canAmendShiftReport) and
-- functions/api/pack/[id]/shift-reports/[rid].js, action 'amend'. The CHECKs below are the
-- backstop, as in 0003:
--   - every figure is whole cents, 0 to $10,000, before and after;
--   - the reason is required, at most 300 characters;
--   - an edit changes something;
--   - the uid and name are the server's, from the member row, as every other shift-report write.
-- A row is written only in the same batch as the report's own change, and only if that change
-- landed (the report's stamp), as the audit row is.
--
-- ORDER: apply this to the preview database, then production, BEFORE deploying the code that uses
-- it. The shift-report endpoints read this table, and on a database without it every shift-report
-- call fails. Apply with:  wrangler d1 migrations apply <database> --remote   (docs/cloudflare-setup.md)

CREATE TABLE shift_report_amendments (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  pack_id              TEXT NOT NULL REFERENCES packs(id),
  report_id            TEXT NOT NULL CHECK (length(report_id) BETWEEN 1 AND 64),
  at                   INTEGER NOT NULL CHECK (typeof(at) = 'integer'),
  by_uid               TEXT NOT NULL CHECK (length(by_uid) BETWEEN 1 AND 128),
  by_name              TEXT NOT NULL DEFAULT '' CHECK (length(by_name) <= 120),
  reason               TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 300),
  was_te_cents         INTEGER NOT NULL CHECK (typeof(was_te_cents) = 'integer' AND was_te_cents BETWEEN 0 AND 1000000),
  was_cash_cents       INTEGER NOT NULL CHECK (typeof(was_cash_cents) = 'integer' AND was_cash_cents BETWEEN 0 AND 1000000),
  was_sales_cash_cents INTEGER NOT NULL CHECK (typeof(was_sales_cash_cents) = 'integer' AND was_sales_cash_cents BETWEEN 0 AND 1000000),
  te_cents             INTEGER NOT NULL CHECK (typeof(te_cents) = 'integer' AND te_cents BETWEEN 0 AND 1000000),
  cash_cents           INTEGER NOT NULL CHECK (typeof(cash_cents) = 'integer' AND cash_cents BETWEEN 0 AND 1000000),
  sales_cash_cents     INTEGER NOT NULL CHECK (typeof(sales_cash_cents) = 'integer' AND sales_cash_cents BETWEEN 0 AND 1000000),
  CHECK (was_te_cents != te_cents OR was_cash_cents != cash_cents OR was_sales_cash_cents != sales_cash_cents)
);
CREATE INDEX shift_report_amendments_by_report ON shift_report_amendments (pack_id, report_id, id);
