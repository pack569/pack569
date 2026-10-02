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
-- Apply with:  wrangler d1 migrations apply <database> --remote   (docs/cloudflare-setup.md)

ALTER TABLE shift_reports ADD COLUMN sales_cash_cents INTEGER NOT NULL DEFAULT 0
  CHECK (typeof(sales_cash_cents) = 'integer' AND sales_cash_cents BETWEEN 0 AND 1000000);
