import { createHash } from "node:crypto";
import {
  compareFlexiConfig,
  getStrategy,
  normalizeConfig,
  type ConfigComparison,
  type FlexiConfig,
  type StrategyKind,
  type StrategyRule,
} from "@ghostfx/bot";
import type { SqlExecutor } from "../db.ts";
import { ensureFlexiStrategyId, getOrCreateFlexiStrategyVersion } from "./paper.ts";

/**
 * Versioned strategy configuration.
 *
 * A strategy version is an immutable config document. Behaviour only changes by
 * inserting a new version and activating it, which is why:
 *   * a config is never edited in place (only its free-text note is),
 *   * at most one version is active (enforced by a partial unique index),
 *   * activating a different version returns a comparison report first,
 *   * every trade pins the exact version it opened under.
 */

const KIND: StrategyKind = "FLEXI";

export interface StrategyVersionView {
  strategyVersionId: string;
  strategyId: string;
  version: number;
  config: FlexiConfig;
  configHash: string;
  isActive: boolean;
  note: string | null;
  /** How many trades (paper or otherwise) ran under this exact version. */
  tradeCount: number;
  createdAt: string;
  activatedAt: string | null;
}

export interface StrategyView {
  strategyId: string;
  name: string;
  kind: StrategyKind;
  activeVersionId: string | null;
  /** Rule precedence, highest priority first. */
  rules: readonly StrategyRule[];
  versions: StrategyVersionView[];
}

export interface ActivationResult {
  version: StrategyVersionView;
  previousVersionId: string | null;
  comparison: ConfigComparison;
}

interface VersionRow {
  strategy_version_id: string;
  strategy_id: string;
  version: number;
  config: unknown;
  config_hash: string;
  is_active: boolean;
  note: string | null;
  created_at: string;
  activated_at: string | null;
  trade_count?: string | number | null;
}

function toConfig(raw: unknown): FlexiConfig {
  const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
  return normalizeConfig((obj ?? {}) as Partial<FlexiConfig>);
}

function mapVersion(r: VersionRow): StrategyVersionView {
  return {
    strategyVersionId: r.strategy_version_id,
    strategyId: r.strategy_id,
    version: Number(r.version),
    config: toConfig(r.config),
    configHash: r.config_hash,
    isActive: r.is_active,
    note: r.note,
    tradeCount: r.trade_count === undefined || r.trade_count === null ? 0 : Number(r.trade_count),
    createdAt: r.created_at,
    activatedAt: r.activated_at,
  };
}

const VERSION_SELECT = `
  SELECT sv.strategy_version_id, sv.strategy_id, sv.version, sv.config,
         sv.config_hash, sv.is_active, sv.note, sv.created_at, sv.activated_at,
         (SELECT count(*) FROM trades t
           WHERE t.strategy_version_id = sv.strategy_version_id) AS trade_count
    FROM strategy_versions sv`;

async function listVersions(
  db: SqlExecutor,
  strategyId: string,
): Promise<StrategyVersionView[]> {
  const res = await db.query<VersionRow>(
    `${VERSION_SELECT} WHERE sv.strategy_id = $1 ORDER BY sv.version DESC`,
    [strategyId],
  );
  return res.rows.map(mapVersion);
}

export async function listStrategies(
  db: SqlExecutor,
  userId: string,
): Promise<StrategyView[]> {
  // Seeds version 1 (active) on first use, so a strategy always has a config.
  await getOrCreateFlexiStrategyVersion(db, userId);
  const strats = await db.query<{ strategy_id: string; name: string }>(
    `SELECT strategy_id, name FROM strategies WHERE owner_id = $1 ORDER BY name`,
    [userId],
  );
  const out: StrategyView[] = [];
  for (const s of strats.rows) {
    const versions = await listVersions(db, s.strategy_id);
    out.push({
      strategyId: s.strategy_id,
      name: s.name,
      kind: KIND,
      activeVersionId: versions.find((v) => v.isActive)?.strategyVersionId ?? null,
      rules: getStrategy(KIND).rules,
      versions,
    });
  }
  return out;
}

export async function getVersion(
  db: SqlExecutor,
  userId: string,
  versionId: string,
): Promise<StrategyVersionView | null> {
  const res = await db.query<VersionRow>(
    `${VERSION_SELECT}
       JOIN strategies s ON s.strategy_id = sv.strategy_id
      WHERE sv.strategy_version_id = $1 AND s.owner_id = $2`,
    [versionId, userId],
  );
  return res.rows[0] ? mapVersion(res.rows[0]) : null;
}

async function activeConfig(
  db: SqlExecutor,
  userId: string,
): Promise<{ versionId: string; config: FlexiConfig }> {
  const ref = await getOrCreateFlexiStrategyVersion(db, userId);
  return { versionId: ref.strategyVersionId, config: ref.config };
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

function hashOf(config: FlexiConfig): string {
  return createHash("sha256").update(JSON.stringify(config)).digest("hex");
}

export interface CreateVersionResult {
  version: StrategyVersionView;
  comparison: ConfigComparison;
}

/**
 * Inserts a new, inactive draft version. Rejects a config that is behaviourally
 * identical to an existing version (`duplicate_version`) or invalid
 * (`invalid_config`), so the version history never accumulates noise.
 */
export async function createVersion(
  db: SqlExecutor,
  userId: string,
  rawConfig: unknown,
  note?: string,
): Promise<CreateVersionResult> {
  let config: FlexiConfig;
  try {
    config = normalizeConfig((rawConfig ?? {}) as Partial<FlexiConfig>);
  } catch {
    throw new Error("invalid_config");
  }

  const strategyId = await ensureFlexiStrategyId(db, userId);
  const hash = hashOf(config);

  const dup = await db.query<{ version: number }>(
    `SELECT version FROM strategy_versions WHERE strategy_id = $1 AND config_hash = $2 LIMIT 1`,
    [strategyId, hash],
  );
  if (dup.rows[0]) throw new Error("duplicate_version");

  const active = await activeConfig(db, userId);

  const next = await db.query<{ next: number }>(
    `SELECT COALESCE(MAX(version), 0) + 1 AS next FROM strategy_versions WHERE strategy_id = $1`,
    [strategyId],
  );
  const version = Number(next.rows[0]!.next);

  const inserted = await db.query<{ strategy_version_id: string }>(
    `INSERT INTO strategy_versions
       (strategy_id, version, config, config_hash, is_active, note)
     VALUES ($1, $2, $3::jsonb, $4, false, $5)
     RETURNING strategy_version_id`,
    [strategyId, version, JSON.stringify(config), hash, note?.trim() || null],
  );

  const view = (await getVersion(db, userId, inserted.rows[0]!.strategy_version_id))!;
  return { version: view, comparison: compareFlexiConfig(active.config, config) };
}

/** Updates a version's free-text note. The config itself is never touched. */
export async function updateVersionNote(
  db: SqlExecutor,
  userId: string,
  versionId: string,
  note: string | null,
): Promise<StrategyVersionView | null> {
  const existing = await getVersion(db, userId, versionId);
  if (!existing) return null;
  await db.query(
    `UPDATE strategy_versions SET note = $2 WHERE strategy_version_id = $1`,
    [versionId, note?.trim() || null],
  );
  return getVersion(db, userId, versionId);
}

export interface CompareResult {
  comparison: ConfigComparison;
  from: { strategyVersionId: string; version: number };
  to: { strategyVersionId: string; version: number };
}

/** Comparison report for switching the active version to `versionId`. */
export async function compareToActive(
  db: SqlExecutor,
  userId: string,
  versionId: string,
): Promise<CompareResult | null> {
  const target = await getVersion(db, userId, versionId);
  if (!target) return null;
  const active = await activeConfig(db, userId);
  const activeView = await getVersion(db, userId, active.versionId);
  return {
    comparison: compareFlexiConfig(active.config, target.config),
    from: {
      strategyVersionId: active.versionId,
      version: activeView?.version ?? 0,
    },
    to: { strategyVersionId: target.strategyVersionId, version: target.version },
  };
}

/**
 * Activates a version. Deactivates the currently active one first (the partial
 * unique index guarantees only one active row), then activates the target and
 * stamps activated_at. Returns the comparison against the previous version.
 */
export async function activateVersion(
  db: SqlExecutor,
  userId: string,
  versionId: string,
): Promise<ActivationResult | null> {
  const target = await getVersion(db, userId, versionId);
  if (!target) return null;

  const active = await activeConfig(db, userId);
  if (active.versionId === versionId) {
    return {
      version: target,
      previousVersionId: null,
      comparison: compareFlexiConfig(target.config, target.config),
    };
  }

  await db.query(
    `UPDATE strategy_versions SET is_active = false
      WHERE strategy_id = $1 AND is_active = true`,
    [target.strategyId],
  );
  await db.query(
    `UPDATE strategy_versions SET is_active = true, activated_at = now()
      WHERE strategy_version_id = $1`,
    [versionId],
  );

  const view = (await getVersion(db, userId, versionId))!;
  return {
    version: view,
    previousVersionId: active.versionId,
    comparison: compareFlexiConfig(active.config, view.config),
  };
}

/**
 * Deletes an inactive draft. The seed version (v1) is kept as the baseline, and
 * a version referenced by any trade can never be removed — the ledger must
 * always be able to explain which config a trade ran under.
 */
export async function deleteVersion(
  db: SqlExecutor,
  userId: string,
  versionId: string,
): Promise<boolean> {
  const existing = await getVersion(db, userId, versionId);
  if (!existing) return false;
  if (existing.isActive) throw new Error("cannot_delete_active");
  if (existing.version === 1) throw new Error("cannot_delete_seed");
  if (existing.tradeCount > 0) throw new Error("version_in_use");

  const res = await db.query(
    `DELETE FROM strategy_versions WHERE strategy_version_id = $1 RETURNING strategy_version_id`,
    [versionId],
  );
  return res.rows.length === 1;
}
