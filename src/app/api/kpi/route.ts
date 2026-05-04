import { NextRequest, NextResponse } from 'next/server';

// Path to the KPI dashboard's SQLite database
const DB_PATH = '/home/crackypp/shared/deliverables/apps/twitter-kpi-dashboard/data/twitter-kpi.db';

// node:sqlite is available in Node 22+
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { DatabaseSync } = require('node:sqlite');

let db: any = null;

function getDb() {
  if (db) return db;

  db = new DatabaseSync(DB_PATH, { readonly: true });
  return db;
}

function isYmd(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function inYmdRange(date: string, start: string, end: string): boolean {
  return date >= start && date <= end;
}

function toYmdInTz(value: string, tz = 'America/New_York'): string {
  return new Date(value).toLocaleDateString('en-CA', { timeZone: tz });
}

function parseRangeKey(cacheKey: string): { start: string; end: string } | null {
  const parts = cacheKey.split('__');
  if (parts.length !== 2) return null;
  const [start, end] = parts;
  if (!isYmd(start) || !isYmd(end)) return null;
  return { start, end };
}

function parseJsonArray(value: string): any[] {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const startDate = searchParams.get('start');
    const endDate = searchParams.get('end');
    const type = searchParams.get('type') || 'snapshots'; // 'snapshots' or 'cache'

    if (!startDate || !endDate) {
      return NextResponse.json(
        { success: false, error: 'Missing start or end date parameters' },
        { status: 400 }
      );
    }

    if (!isYmd(startDate) || !isYmd(endDate)) {
      return NextResponse.json(
        { success: false, error: 'Invalid date format. Expected YYYY-MM-DD.' },
        { status: 400 }
      );
    }

    const database = getDb();

    if (type === 'cache') {
      // 1) Exact range cache lookup
      const cacheKey = `${startDate}__${endDate}`;
      const exactRow = database
        .prepare(
          `SELECT cache_key, daily_data_json, post_data_json, follower_count, updated_at
           FROM range_cache
           WHERE cache_key = ?`
        )
        .get(cacheKey) as any | undefined;

      if (exactRow) {
        return NextResponse.json({
          success: true,
          data: {
            dailyData: JSON.parse(exactRow.daily_data_json || '[]'),
            postData: JSON.parse(exactRow.post_data_json || '[]'),
            followerCount: exactRow.follower_count,
            updatedAt: exactRow.updated_at,
          },
        });
      }

      // 2) If exact key is missing, use newest cached window that fully covers the requested range.
      const recentRows = database
        .prepare(
          `SELECT cache_key, daily_data_json, post_data_json, follower_count, updated_at
           FROM range_cache
           ORDER BY updated_at DESC
           LIMIT 300`
        )
        .all() as Array<any>;

      for (const row of recentRows) {
        const parsed = parseRangeKey(String(row.cache_key || ''));
        if (!parsed) continue;
        if (!(parsed.start <= startDate && parsed.end >= endDate)) continue;

        const rawDaily = parseJsonArray(row.daily_data_json);
        const rawPosts = parseJsonArray(row.post_data_json);

        const dailyData = rawDaily.filter(
          (d: any) => d && typeof d.date === 'string' && inYmdRange(d.date, startDate, endDate)
        );

        const postData = rawPosts.filter((p: any) => {
          if (!p || typeof p.created_at !== 'string') return false;
          const ymd = toYmdInTz(p.created_at);
          return inYmdRange(ymd, startDate, endDate);
        });

        return NextResponse.json({
          success: true,
          data: {
            dailyData,
            postData,
            followerCount: row.follower_count,
            updatedAt: row.updated_at,
          },
        });
      }

      // No useful cached range found. Return null so caller can fallback to snapshots.
      return NextResponse.json({ success: true, data: null });
    }

    // Default: fetch snapshots
    const rows = database
      .prepare(
        `SELECT data_json FROM snapshots WHERE date >= ? AND date <= ? ORDER BY date ASC`
      )
      .all(startDate, endDate) as Array<{ data_json: string }>;

    return NextResponse.json({
      success: true,
      data: rows.map((r) => JSON.parse(r.data_json)),
    });
  } catch (error: any) {
    console.error('Error in GET /api/kpi:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to load KPI data' },
      { status: 500 }
    );
  }
}
