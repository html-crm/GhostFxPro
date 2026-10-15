-- 0008_strategy_versions.sql
-- Strategy version management: a draft note, activation timestamps, and a hard
-- guarantee that at most one version of a strategy is active at a time.
--
-- strategy_versions is immutable in spirit: a config is never edited in place.
-- Changing behaviour means inserting a new version and (re)activating one, so a
-- trade's recorded strategy_version_id always reproduces the exact config used.

BEGIN;

ALTER TABLE strategy_versions ADD COLUMN note text;
ALTER TABLE strategy_versions ADD COLUMN activated_at timestamptz;

-- Rows seeded before this migration are treated as activated when created.
UPDATE strategy_versions
   SET activated_at = created_at
 WHERE is_active = true
   AND activated_at IS NULL;

-- At most one active version per strategy. This turns "activate" into a
-- constraint the database enforces, not a convention the code must remember.
CREATE UNIQUE INDEX strategy_versions_one_active_idx
    ON strategy_versions (strategy_id)
    WHERE is_active;

COMMIT;
