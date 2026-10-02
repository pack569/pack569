-- Pack 569 — a shift report says how much cash from popcorn sales a family still has (S-5).
--
-- Pack policy (Keith, 2026-10-01): before they leave the table, families convert all cash from
-- popcorn sales to credit in the Trail's End app. Sometimes they can't (no signal, a card
-- declined), and then that cash goes home with them until a leader collects it. A report now
-- carries a third figure, the cash from popcorn sales still in hand, so the leaders know whose
-- cash to collect. It is 0 on almost every report, and on every report sent before this.
--
-- It is a CUSTODY figure, not a sale: those sales were already entered in the Trail's End app, so
-- they are already inside te_cents. Nothing adds it to the block's sales or to any scout's split.
-- On accept the leader's page copies it onto the block as salesCashInHandCents, which only
-- leaders see (buildParentView never publishes it).
--
-- The same rule as the other two figures: whole cents, 0 to $10,000. That it is no more than the
-- Trail's End amount is the endpoint's rule (rules.js shiftReportFiguresProblem), not a CHECK.
--
-- What became of it (treasurer and security review, followups round 1): a leader records, on the
-- server and in the audit, that they COLLECTED the cash, that the family CONVERTED it to
-- credit after all, or (on a report sent back after it was accepted) that it was REPLACED: the same
-- cash as the newer report on the shift, so it is not counted twice. A settlement counts only
-- 'collected'. sales_cash_outcome says which (NULL: still out), with who and when, from the
-- member row and the server's clock. Only an admin or editor (never the sender, nor the sender's
-- family), only on an accepted report holding cash from sales (or one sent back after it was
-- accepted), and undoable (rules.js canReviewShiftReport; [rid].js action 'salescash'). The
-- settlement can later read the sum of what was collected from here.
--
-- ORDER: apply this to the preview database, then production, BEFORE deploying the code that uses
-- it. The endpoints select these columns, and on a database without them every shift-report call
-- fails. Apply with:  wrangler d1 migrations apply <database> --remote   (docs/cloudflare-setup.md)
-- This file was edited in place before it was ever applied. Check `wrangler d1 migrations list
-- <database> --remote` first: if 0004 has already run anywhere, stop and ask.

ALTER TABLE shift_reports ADD COLUMN sales_cash_cents INTEGER NOT NULL DEFAULT 0
  CHECK (typeof(sales_cash_cents) = 'integer' AND sales_cash_cents BETWEEN 0 AND 1000000);
ALTER TABLE shift_reports ADD COLUMN sales_cash_by_uid TEXT
  CHECK (sales_cash_by_uid IS NULL OR length(sales_cash_by_uid) BETWEEN 1 AND 128);
ALTER TABLE shift_reports ADD COLUMN sales_cash_by_name TEXT
  CHECK (sales_cash_by_name IS NULL OR length(sales_cash_by_name) <= 120);
ALTER TABLE shift_reports ADD COLUMN sales_cash_at INTEGER
  CHECK (sales_cash_at IS NULL OR typeof(sales_cash_at) = 'integer');
-- Last: its CHECK names the columns above (and SQLite checks it against them as it is added).
ALTER TABLE shift_reports ADD COLUMN sales_cash_outcome TEXT
  CHECK (sales_cash_outcome IS NULL OR (sales_cash_outcome IN ('collected', 'converted', 'replaced') AND sales_cash_cents > 0
         AND sales_cash_by_uid IS NOT NULL AND sales_cash_at IS NOT NULL));
