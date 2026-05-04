import { NextRequest, NextResponse } from 'next/server';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname } from 'path';
import { runtimeConfig } from '@/lib/runtime-config';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { DatabaseSync } = require('node:sqlite');

const GA4_API = 'https://analyticsdata.googleapis.com/v1beta';

function initDb(dbPath: string): any {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS ga_snapshots (
      date TEXT PRIMARY KEY,
      sessions INTEGER DEFAULT 0,
      new_users INTEGER DEFAULT 0,
      total_users INTEGER DEFAULT 0,
      pageviews INTEGER DEFAULT 0,
      organic_sessions INTEGER DEFAULT 0,
      avg_engagement_time_sec REAL DEFAULT 0,
      engagement_rate REAL DEFAULT 0,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS ga_top_pages (
      cache_key TEXT NOT NULL,
      rank INTEGER NOT NULL,
      page_path TEXT,
      page_title TEXT,
      sessions INTEGER DEFAULT 0,
      pageviews INTEGER DEFAULT 0,
      avg_engagement_time_sec REAL DEFAULT 0,
      PRIMARY KEY (cache_key, rank)
    );
  `);
  return db;
}

function isYmd(v: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(v);
}

function gaDateToIso(raw: string): string {
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

async function getAccessToken(): Promise<string> {
  const clientRaw = await readFile(runtimeConfig.gaClientFile, 'utf-8');
  const tokenRaw = await readFile(runtimeConfig.gaTokenFile, 'utf-8');
  const { installed } = JSON.parse(clientRaw);
  const token = JSON.parse(tokenRaw);

  // Use existing access token if it hasn't expired (with 60s buffer)
  if (token.access_token && token.expiry_date && Date.now() < token.expiry_date - 60_000) {
    return token.access_token;
  }

  // Refresh the token
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: installed.client_id,
      client_secret: installed.client_secret,
      refresh_token: token.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  const refreshed = await res.json();
  if (!refreshed.access_token) throw new Error(`Token refresh failed: ${JSON.stringify(refreshed)}`);

  const updated = { ...token, ...refreshed, expiry_date: Date.now() + refreshed.expires_in * 1000 };
  await writeFile(runtimeConfig.gaTokenFile, JSON.stringify(updated, null, 2));
  return refreshed.access_token;
}

async function gaReport(token: string, propertyId: string, body: object): Promise<any> {
  const res = await fetch(`${GA4_API}/properties/${propertyId}:runReport`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `GA4 API error ${res.status}`);
  return data;
}

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { start, end } = body;

    if (!start || !end || !isYmd(start) || !isYmd(end)) {
      return NextResponse.json(
        { success: false, error: 'Missing or invalid start/end date (expected YYYY-MM-DD)' },
        { status: 400 }
      );
    }

    const propertyId = runtimeConfig.gaPropertyId;
    if (!propertyId) {
      return NextResponse.json(
        { success: false, error: 'GA_PROPERTY_ID is not set in the mission-control service environment.' },
        { status: 500 }
      );
    }

    await mkdir(dirname(runtimeConfig.gaDbPath), { recursive: true });

    const token = await getAccessToken();
    const dateRanges = [{ startDate: start, endDate: end }];

    const [dailyData, organicData, pagesData] = await Promise.all([
      gaReport(token, propertyId, {
        dateRanges,
        dimensions: [{ name: 'date' }],
        metrics: [
          { name: 'sessions' },
          { name: 'newUsers' },
          { name: 'totalUsers' },
          { name: 'screenPageViews' },
          { name: 'averageSessionDuration' },
          { name: 'engagementRate' },
        ],
      }),
      gaReport(token, propertyId, {
        dateRanges,
        dimensions: [{ name: 'date' }],
        metrics: [{ name: 'sessions' }],
        dimensionFilter: {
          filter: {
            fieldName: 'sessionDefaultChannelGrouping',
            stringFilter: { matchType: 'EXACT', value: 'Organic Search' },
          },
        },
      }),
      gaReport(token, propertyId, {
        dateRanges,
        dimensions: [{ name: 'pagePath' }, { name: 'pageTitle' }],
        metrics: [
          { name: 'sessions' },
          { name: 'screenPageViews' },
          { name: 'averageSessionDuration' },
        ],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 25,
      }),
    ]);

    const organicByDate = new Map<string, number>();
    for (const row of organicData.rows || []) {
      const dateRaw = row.dimensionValues?.[0]?.value || '';
      organicByDate.set(dateRaw, parseFloat(row.metricValues?.[0]?.value || '0'));
    }

    const now = new Date().toISOString();
    const db = initDb(runtimeConfig.gaDbPath);

    const upsertSnapshot = db.prepare(`
      INSERT INTO ga_snapshots
        (date, sessions, new_users, total_users, pageviews, organic_sessions,
         avg_engagement_time_sec, engagement_rate, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(date) DO UPDATE SET
        sessions = excluded.sessions,
        new_users = excluded.new_users,
        total_users = excluded.total_users,
        pageviews = excluded.pageviews,
        organic_sessions = excluded.organic_sessions,
        avg_engagement_time_sec = excluded.avg_engagement_time_sec,
        engagement_rate = excluded.engagement_rate,
        updated_at = excluded.updated_at
    `);

    let daysProcessed = 0;
    for (const row of dailyData.rows || []) {
      const dateRaw = row.dimensionValues?.[0]?.value || '';
      const isoDate = gaDateToIso(dateRaw);
      const mv = row.metricValues || [];
      upsertSnapshot.run(
        isoDate,
        parseFloat(mv[0]?.value || '0'),        // sessions
        parseFloat(mv[1]?.value || '0'),        // new_users
        parseFloat(mv[2]?.value || '0'),        // total_users
        parseFloat(mv[3]?.value || '0'),        // pageviews
        organicByDate.get(dateRaw) || 0,        // organic_sessions
        parseFloat(mv[4]?.value || '0'),        // avg_engagement_time_sec
        parseFloat(mv[5]?.value || '0') * 100, // engagement_rate (GA4 returns 0–1)
        now,
      );
      daysProcessed++;
    }

    const cacheKey = `${start}__${end}`;
    db.prepare(`DELETE FROM ga_top_pages WHERE cache_key = ?`).run(cacheKey);

    const insertPage = db.prepare(`
      INSERT INTO ga_top_pages (cache_key, rank, page_path, page_title, sessions, pageviews, avg_engagement_time_sec)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    let rank = 1;
    for (const row of pagesData.rows || []) {
      const dv = row.dimensionValues || [];
      const mv = row.metricValues || [];
      insertPage.run(
        cacheKey, rank++,
        dv[0]?.value || '',
        dv[1]?.value || '',
        parseFloat(mv[0]?.value || '0'),
        parseFloat(mv[1]?.value || '0'),
        parseFloat(mv[2]?.value || '0'),
      );
    }

    return NextResponse.json({
      success: true,
      data: { daysProcessed, topPagesCount: rank - 1, updatedAt: now },
    });
  } catch (err: any) {
    console.error('Error in POST /api/ga/refresh:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Failed to refresh GA data' },
      { status: 500 }
    );
  }
}
