import { NextRequest, NextResponse } from 'next/server';
import { runtimeConfig } from '@/lib/runtime-config';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { DatabaseSync } = require('node:sqlite');

let db: any = null;

function getDb() {
  if (db) return db;
  db = new DatabaseSync(runtimeConfig.gaDbPath, { readonly: true });
  return db;
}

function isYmd(v: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(v);
}

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const start = sp.get('start');
    const end = sp.get('end');
    const type = sp.get('type') || 'snapshots';

    if (!start || !end || !isYmd(start) || !isYmd(end)) {
      return NextResponse.json(
        { success: false, error: 'Missing or invalid start/end date (expected YYYY-MM-DD)' },
        { status: 400 }
      );
    }

    const database = getDb();

    if (type === 'pages') {
      const cacheKey = `${start}__${end}`;
      const rows = database
        .prepare(
          `SELECT rank, page_path, page_title, sessions, pageviews, avg_engagement_time_sec
           FROM ga_top_pages WHERE cache_key = ? ORDER BY rank ASC`
        )
        .all(cacheKey) as any[];
      return NextResponse.json({ success: true, data: rows });
    }

    const rows = database
      .prepare(
        `SELECT date, sessions, new_users, total_users, pageviews, organic_sessions,
                avg_engagement_time_sec, engagement_rate
         FROM ga_snapshots WHERE date >= ? AND date <= ? ORDER BY date ASC`
      )
      .all(start, end) as any[];

    const meta = database
      .prepare(
        `SELECT MAX(updated_at) as max_updated FROM ga_snapshots WHERE date >= ? AND date <= ?`
      )
      .get(start, end) as any;

    return NextResponse.json({
      success: true,
      data: rows,
      updatedAt: meta?.max_updated || null,
    });
  } catch (err: any) {
    if (err?.code === 'ERR_INVALID_STATE' || err?.message?.includes('SQLITE_ERROR')) {
      return NextResponse.json({ success: true, data: [], updatedAt: null });
    }
    console.error('Error in GET /api/ga:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Failed to load analytics data' },
      { status: 500 }
    );
  }
}
