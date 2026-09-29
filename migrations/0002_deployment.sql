-- Pack 569 — which deployment a database belongs to (security review of Phase 2, finding 1).
--
-- wrangler.toml binds pack569-prod to production and pack569-preview to every preview, and
-- the harness and the deploy job check the ids there. That is a check on a file. This is the
-- check at the other end: each database says, in one row the owner writes once by hand, which
-- deployment it is for, and the API (functions/_lib/pack.js database()) refuses every request
-- with a 503 unless that row matches the DEPLOY_ENV the deployment was built with. So a
-- preview that somehow ends up bound to the live database answers nothing at all, rather than
-- serving the live pack to whoever can reach a preview link.
--
-- Nothing in functions/ ever writes this table. The owner seeds it once per database
-- (docs/cloudflare-setup.md, "The pack's database", step B):
--   pack569-preview:  INSERT INTO deployment (id, env) VALUES (1, 'preview');
--   pack569-prod:     INSERT INTO deployment (id, env) VALUES (1, 'prod');
-- Until it is seeded, the API answers 503 'deployment-unset' — the safe way to fail.

CREATE TABLE deployment (
  id   INTEGER PRIMARY KEY CHECK (id = 1),
  env  TEXT NOT NULL CHECK (env IN ('prod', 'preview'))
);
