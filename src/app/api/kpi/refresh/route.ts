import { NextRequest, NextResponse } from 'next/server';
import { runtimeConfig } from '@/lib/runtime-config';
import { saveTwitterKpiRangeCache, saveTwitterKpiSnapshot } from '@/lib/twitter-kpi-storage';

const KPI_DASHBOARD_URL = runtimeConfig.kpiDashboardUrl;

async function parseJsonOrThrow(res: Response, label: string) {
  const contentType = res.headers.get('content-type') || '';
  const text = await res.text();

  if (!res.ok) {
    throw new Error(`${label} returned HTTP ${res.status}: ${text.slice(0, 180)}`);
  }

  if (!contentType.includes('application/json')) {
    throw new Error(
      `${label} returned non-JSON response (content-type: ${contentType || 'unknown'}): ${text.slice(0, 180)}`
    );
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} returned invalid JSON: ${text.slice(0, 180)}`);
  }
}

function isYmd(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { start, end } = body;

    if (!start || !end) {
      return NextResponse.json(
        { success: false, error: 'Missing start or end date' },
        { status: 400 }
      );
    }

    if (!isYmd(start) || !isYmd(end)) {
      return NextResponse.json(
        { success: false, error: 'Invalid date format. Expected YYYY-MM-DD.' },
        { status: 400 }
      );
    }

    // Fetch tweets from KPI dashboard
    const tweetsRes = await fetch(
      `${KPI_DASHBOARD_URL}/api/twitter/tweets?start=${start}&end=${end}`,
      { cache: 'no-store' }
    );
    const tweetsData = await parseJsonOrThrow(tweetsRes, 'KPI tweets endpoint');

    if (!tweetsData.success) {
      throw new Error(tweetsData.error || 'Failed to fetch tweets from Twitter API');
    }

    // Fetch user metrics
    const userRes = await fetch(`${KPI_DASHBOARD_URL}/api/twitter/user`, { cache: 'no-store' });
    const userData = await parseJsonOrThrow(userRes, 'KPI user endpoint');

    // Build daily snapshots (the KPI dashboard tweets endpoint returns tweets, not dailySnapshots)
    const tweets = Array.isArray(tweetsData.data?.tweets) ? tweetsData.data.tweets : [];
    const followers = userData?.data?.followers_count || 0;
    const tz = process.env.KPI_TIMEZONE || 'America/New_York';

    const byDate = new Map<string, any>();
    for (const t of tweets) {
      const m = t?.public_metrics || {};
      const text = String(t?.text || '');
      const isNativeRetweet = /^RT\s+@/i.test(text);
      const date = new Date(t.created_at).toLocaleDateString('en-CA', { timeZone: tz }); // YYYY-MM-DD
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
          followers,
          engagement_rate: 0,
        });
      }
      const row = byDate.get(date);
      row.posts += 1;
      row.impressions += m.impression_count || 0;
      row.likes += m.like_count || 0;
      row.replies += m.reply_count || 0;
      // Native retweets can report large retweet_count while impression_count is 0,
      // which explodes engagement rate. Exclude RT-count from numerator in this case.
      row.retweets += isNativeRetweet ? 0 : (m.retweet_count || 0);
      row.quotes += m.quote_count || 0;
      row.bookmarks += m.bookmark_count || 0;
    }

    const dailySnapshots = Array.from(byDate.values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => {
        const engagements = d.likes + d.replies + d.retweets + d.quotes + d.bookmarks;
        return {
          ...d,
          engagement_rate: d.impressions > 0 ? Number(((engagements / d.impressions) * 100).toFixed(2)) : 0,
        };
      });

    // Mission Control is now the source of truth for the dashboard cache.
    // The old dashboard on port 3001 is only used as a Twitter API adapter for manual refreshes.
    const updatedAt = new Date().toISOString();
    const cachePayload = {
      dailyData: dailySnapshots,
      postData: tweets,
      followerCount: followers,
      updatedAt,
    };

    saveTwitterKpiRangeCache(start, end, cachePayload, updatedAt);
    for (const snapshot of dailySnapshots) {
      saveTwitterKpiSnapshot(snapshot.date, snapshot, updatedAt);
    }

    return NextResponse.json({
      success: true,
      data: {
        tweets,
        dailyData: dailySnapshots,
        followerCount: followers,
        updatedAt,
        cachedLocally: true,
      },
    });
  } catch (error: any) {
    console.error('Error in POST /api/kpi/refresh:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to refresh KPI data' },
      { status: 500 }
    );
  }
}
