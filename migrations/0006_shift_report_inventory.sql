-- Pack 569 — a shift report can say how much popcorn was left on the table (inventory count).
--
-- Keith (2026-10-08): "It may also be a good idea for the shift report to include a simple-to-fill
-- inventory report." At the end of a storefront shift the family counts the CONTAINERS still on
-- the table, per product. It is OPTIONAL: a product left blank was not counted, and a report with
-- no count at all is as it always was. The leaders see it beside the stock at the start of that
-- shift ("Kettle Corn: 12 went to this storefront · 8 left · about 4 sold this shift"; a later
-- shift starts from the earlier shift's count), purely for information: accepting a report NEVER
-- changes the pack's inventory (Keith's choice). Nobody but the leaders and the family
-- who sent it ever reads it, as with the figures.
--
-- inventory_json is the count as the server stores it: '' (nothing counted) or a JSON array of
-- { "productId": "<id>", "left": <0..10000> }, one per product counted, sorted by productId, no
-- product twice. The products are the ones the stored parent view publishes for that storefront
-- (buildParentView: { id, name } only, nothing else of the Inventory; those handed out to that
-- storefront, or every named product when none were). WHO MAY DO WHAT, and the
-- shape, are decided in functions/_lib/rules.js (shiftInventoryProblem: at most 40 products, whole
-- numbers 0 to 10,000) and the shift-report endpoints: the sender sets it when sending and may
-- change it while it waits ('edit'), an ADMIN may correct it on an accepted report ('amend'), and
-- a second parent's confirm and a leader's accept leave it as it is. The CHECKs are the backstop:
--   - it is '' or a JSON array, at most 4000 characters (40 products with the longest ids).
--
-- An admin's correction keeps the count before and after, as it keeps the figures. So
-- shift_report_amendments gains was_inventory_json and inventory_json, and its "an edit changes
-- something" CHECK must count a change to the count too. SQLite cannot change a CHECK in place, so
-- the table is rebuilt: a new table with the new columns and CHECKs, every row copied across
-- (their counts '', as nothing was counted before), the old one dropped, the new one renamed, the
-- index made again. Nothing else references that table.
--
-- ORDER: apply this to the preview database, then production, BEFORE deploying the code that uses
-- it. The endpoints select these columns, and on a database without them every shift-report call
-- fails. 0005 must already be applied (this rebuilds its table). Apply with:
--   wrangler d1 migrations apply <database> --remote   (docs/cloudflare-setup.md)

ALTER TABLE shift_reports ADD COLUMN inventory_json TEXT NOT NULL DEFAULT ''
  CHECK (length(inventory_json) <= 4000 AND (inventory_json = '' OR (json_valid(inventory_json) AND json_type(inventory_json) = 'array')));

CREATE TABLE shift_report_amendments_new (
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
  was_inventory_json   TEXT NOT NULL DEFAULT ''
    CHECK (length(was_inventory_json) <= 4000 AND (was_inventory_json = '' OR (json_valid(was_inventory_json) AND json_type(was_inventory_json) = 'array'))),
  inventory_json       TEXT NOT NULL DEFAULT ''
    CHECK (length(inventory_json) <= 4000 AND (inventory_json = '' OR (json_valid(inventory_json) AND json_type(inventory_json) = 'array'))),
  CHECK (was_te_cents != te_cents OR was_cash_cents != cash_cents OR was_sales_cash_cents != sales_cash_cents
         OR was_inventory_json != inventory_json)
);
INSERT INTO shift_report_amendments_new (id, pack_id, report_id, at, by_uid, by_name, reason, was_te_cents, was_cash_cents,
  was_sales_cash_cents, te_cents, cash_cents, sales_cash_cents)
  SELECT id, pack_id, report_id, at, by_uid, by_name, reason, was_te_cents, was_cash_cents, was_sales_cash_cents, te_cents, cash_cents,
    sales_cash_cents FROM shift_report_amendments;
DROP TABLE shift_report_amendments;
ALTER TABLE shift_report_amendments_new RENAME TO shift_report_amendments;
CREATE INDEX shift_report_amendments_by_report ON shift_report_amendments (pack_id, report_id, id);
