import { NextRequest, NextResponse } from 'next/server';
import { getTwitterKpiDataStatus, getTwitterKpiDb } from '@/lib/twitter-kpi-storage';

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

function cacheRowToFilteredPayload(
  row: any,
  cachedRange: { start: string | null; end: string | null },
  requestedRange: { start: string; end: string }
) {
  const rawDaily = parseJsonArray(row.daily_data_json);
  const rawPosts = parseJsonArray(row.post_data_json);

  const dailyData = rawDaily.filter(
    (d: any) => d && typeof d.date === 'string' && inYmdRange(d.date, requestedRange.start, requestedRange.end)
  );

  const postData = rawPosts.filter((p: any) => {
    if (!p || typeof p.created_at !== 'string') return false;
    const ymd = toYmdInTz(p.created_at);
    return inYmdRange(ymd, requestedRange.start, requestedRange.end);
  });

  return {
    dailyData,
    postData,
    followerCount: row.follower_count,
    updatedAt: row.updated_at,
    cachedRange,
    requestedRange,
  };
}

// Re-hydrate daily/post data from snapshots when cache is empty.
// Reads raw snapshot rows and aggregates into the same shape that
// the cache endpoint would return, so the UI gets consistent data
// regardless of whether it loaded from cache or snapshots.
function buildFromSnapshots(database: any, startDate: string, endDate: string) {
  const tz = process.env.KPI_TIMEZONE || 'America/New_York';

  const rows = database
    .prepare('SELECT date, data_json FROM snapshots WHERE date >= ? AND date <= ? ORDER BY date ASC')
    .all(startDate, endDate) as Array<{ date: string; data_json: string }>;

  if (rows.length === 0) return null;

  // Aggregate all snapshot rows into a single cached-range payload
  const byDate = new Map<string, any>();
  const allPosts: any[] = [];
  let followerCount = 0;

  for (const row of rows) {
    try {
      const snap = JSON.parse(row.data_json);
      if (!snap) continue;

      // Track follower count from latest snapshot that has it
      if (snap.followers != null) followerCount = snap.followers;

      // Collect date-level metrics
      const date = row.date;
      if (!byDate.has(date)) {
        byDate.set(date, {
          date,
          posts: 0,
          impressions: 0,
          likes: 0,
          replies: 0,
          retweets: 0,
          quotes: 0,
          bookmarks: 0,
          followers: followerCount,
          engagement_rate: 0,
        });
      }
      const d = byDate.get(date);

      // Accumulate metrics from snapshot
      const add = (key: string, val: any) => {
        if (val != null && typeof val === 'number') (d as any)[key] += val;
      };
      add('posts', snap.posts);
      add('impressions', snap.impressions);
      add('likes', snap.likes);
      add('replies', snap.replies);
      add('retweets', snap.retweets);
      add('quotes', snap.quotes);
      add('bookmarks', snap.bookmarks);

      // If snapshot has per-post data, collect those too
      if (Array.isArray(snap.postData)) {
        for (const p of snap.postData) {
          if (p?.created_at) {
            const ymd = toYmdInTz(p.created_at);
            if (ymd >= startDate && ymd <= endDate) allPosts.push(p);
          }
        }
      }
    } catch {
      // Skip malformed snapshot rows
    }
  }

  const dailyData = Array.from(byDate.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d: any) => {
      const engagements = d.likes + d.replies + d.retweets + d.quotes + d.bookmarks;
      return {
        ...d,
        engagement_rate: d.impressions > 0 ? Number(((engagements / d.impressions) * 100).toFixed(2)) : 0,
      };
    });

  // Deduplicate posts by id
  const seen = new Set<string>();
  const postData = allPosts.filter((p) => {
    if (!p.id || seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });

  return {
    dailyData,
    postData,
    followerCount,
    updatedAt: rows.length > 0 ? rows[rows.length - 1].date : null,
    cachedRange: { start: startDate, end: endDate },
    requestedRange: { start: startDate, end: endDate },
  };
}

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const startDate = searchParams.get('start');
    const endDate = searchParams.get('end');
    const type = searchParams.get('type') || 'snapshots'; // 'snapshots', 'cache', or 'status'

    if (type === 'status') {
      return NextResponse.json({ success: true, data: getTwitterKpiDataStatus() });
    }

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

    const database = getTwitterKpiDb();

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
          data: cacheRowToFilteredPayload(
            exactRow,
            { start: startDate, end: endDate },
            { start: startDate, end: endDate }
          ),
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

        return NextResponse.json({
          success: true,
          data: cacheRowToFilteredPayload(
            row,
            { start: parsed.start, end: parsed.end },
            { start: startDate, end: endDate }
          ),
        });
      }

      // No exact or covering cache exists. Fall back to snapshot aggregation
      // so the UI always gets structured data (never zeros) without an API refresh.
      const fromSnapshots = buildFromSnapshots(database, startDate, endDate);
      if (fromSnapshots) {
        return NextResponse.json({ success: true, data: fromSnapshots });
      }

      // Final fallback: use the most recent cached window, but still respect the
      // user's requested range. This keeps date filters honest even when the
      // cache does not exactly cover the requested end date yet.
      const latestRow = recentRows[0];
      if (latestRow) {
        const parsed = parseRangeKey(String(latestRow.cache_key || ''));
        if (parsed) {
          return NextResponse.json({
            success: true,
            data: cacheRowToFilteredPayload(
              latestRow,
              { start: parsed.start, end: parsed.end },
              { start: startDate, end: endDate }
            ),
          });
        }
      }

      // Truly no data anywhere — return empty but structured response
      return NextResponse.json({
        success: true,
        data: {
          dailyData: [],
          postData: [],
          followerCount: 0,
          updatedAt: null,
          cachedRange: { start: startDate, end: endDate },
          requestedRange: { start: startDate, end: endDate },
        },
      });
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
