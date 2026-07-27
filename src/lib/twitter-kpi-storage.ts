import { existsSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { runtimeConfig } from '@/lib/runtime-config';

// node:sqlite is available in Node 22+ at runtime.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = runtimeConfig.twitterKpiDbPath;
const DEFAULT_BOOTSTRAP_DB = '/home/crackypp/shared/deliverables/.archive/apps/twitter-kpi-dashboard/data/twitter-kpi.db';

let db: any = null;
let bootstrapped = false;

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function tableCount(database: any, table: string): number {
  try {
    const row = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count?: number } | undefined;
    return Number(row?.count || 0);
  } catch {
    return 0;
  }
}

function ensureSchema(database: any) {
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS snapshots (
      date TEXT PRIMARY KEY,
      data_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS range_cache (
      cache_key TEXT PRIMARY KEY,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      daily_data_json TEXT NOT NULL,
      post_data_json TEXT NOT NULL,
      follower_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_snapshots_date ON snapshots(date);
    CREATE INDEX IF NOT EXISTS idx_range_cache_dates ON range_cache(start_date, end_date);
    CREATE INDEX IF NOT EXISTS idx_range_cache_updated_at ON range_cache(updated_at);
  `);
}

function bootstrapFromLegacyDb(database: any) {
  if (bootstrapped) return;
  bootstrapped = true;

  const hasLocalData = tableCount(database, 'snapshots') > 0 || tableCount(database, 'range_cache') > 0;
  if (hasLocalData) return;

  const bootstrapPath = resolve(process.env.TWITTER_KPI_BOOTSTRAP_DB || DEFAULT_BOOTSTRAP_DB);
  if (!existsSync(bootstrapPath) || bootstrapPath === resolve(DB_PATH)) return;

  try {
    database.exec(`ATTACH DATABASE ${sqlString(bootstrapPath)} AS legacy_kpi`);

    database.exec(`
      INSERT OR IGNORE INTO snapshots (date, data_json, updated_at)
      SELECT date, data_json, COALESCE(updated_at, datetime('now'))
      FROM legacy_kpi.snapshots;
    `);

    database.exec(`
      INSERT OR IGNORE INTO range_cache (
        cache_key, start_date, end_date, daily_data_json, post_data_json, follower_count, updated_at
      )
      SELECT cache_key, start_date, end_date, daily_data_json, post_data_json, follower_count, updated_at
      FROM legacy_kpi.range_cache;
    `);

    database.exec('DETACH DATABASE legacy_kpi');
  } catch (error) {
    try {
      database.exec('DETACH DATABASE legacy_kpi');
    } catch {}
    console.warn('Twitter KPI legacy DB bootstrap skipped:', error);
  }
}

export function getTwitterKpiDb() {
  if (db) return db;

  mkdirSync(dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH);
  ensureSchema(db);
  bootstrapFromLegacyDb(db);
  return db;
}

export function twitterKpiRangeKey(startDate: string, endDate: string) {
  return `${startDate}__${endDate}`;
}

export function saveTwitterKpiSnapshot(date: string, snapshot: any, updatedAt = new Date().toISOString()) {
  const database = getTwitterKpiDb();
  database
    .prepare(`
      INSERT INTO snapshots (date, data_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(date) DO UPDATE SET
        data_json = excluded.data_json,
        updated_at = excluded.updated_at
    `)
    .run(date, JSON.stringify(snapshot), updatedAt);
}

export function saveTwitterKpiRangeCache(startDate: string, endDate: string, data: any, updatedAt = new Date().toISOString()) {
  const database = getTwitterKpiDb();
  database
    .prepare(`
      INSERT INTO range_cache (
        cache_key, start_date, end_date, daily_data_json, post_data_json, follower_count, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET
        start_date = excluded.start_date,
        end_date = excluded.end_date,
        daily_data_json = excluded.daily_data_json,
        post_data_json = excluded.post_data_json,
        follower_count = excluded.follower_count,
        updated_at = excluded.updated_at
    `)
    .run(
      twitterKpiRangeKey(startDate, endDate),
      startDate,
      endDate,
      JSON.stringify(data?.dailyData || []),
      JSON.stringify(data?.postData || []),
      Number(data?.followerCount || 0),
      data?.updatedAt || updatedAt
    );
}

export function getTwitterKpiDataStatus() {
  const database = getTwitterKpiDb();
  const snapshots = tableCount(database, 'snapshots');
  const cachedRanges = tableCount(database, 'range_cache');
  const latestSnapshot = database.prepare('SELECT date, updated_at FROM snapshots ORDER BY date DESC LIMIT 1').get();
  const latestCache = database.prepare('SELECT start_date, end_date, updated_at FROM range_cache ORDER BY updated_at DESC LIMIT 1').get();
  return { dbPath: DB_PATH, snapshots, cachedRanges, latestSnapshot, latestCache };
}
