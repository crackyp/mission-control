import { NextResponse } from "next/server";
import { readdir, readFile, writeFile, mkdir, rename } from "fs/promises";
import { join } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { runtimeConfig } from "@/lib/runtime-config";

const execFileAsync = promisify(execFile);
const TWITTER_DIR = runtimeConfig.twitterDir;
const POSTED_DIR = join(TWITTER_DIR, "posted");
const ARCHIVE_DIR = runtimeConfig.twitterArchiveDir;
const TWITTER_SCRIPT = runtimeConfig.twitterScript;
const POSTED_LOG = runtimeConfig.twitterPostedLog;
const LEGACY_POSTED_LOG = join(TWITTER_DIR, ".posted.json");

type PostedEntry = {
  id?: string;
  filename?: string;
  date?: string;
  postedAt?: string;
  tweetId?: string;
  url?: string;
  source?: string;
  text?: string;
  content?: string;
};

type PostedLog = {
  posts: PostedEntry[];
};

const normalizeText = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();

function uniqueKey(entry: PostedEntry) {
  if (entry.id) return `id:${entry.id}`;
  if (entry.filename && entry.date) return `file:${entry.date}/${entry.filename}`;
  if (entry.tweetId) return `tweet:${entry.tweetId}`;
  if (entry.text || entry.content) {
    return `text:${normalizeText(entry.text || entry.content || "")}`;
  }
  return `misc:${entry.filename || ""}:${entry.postedAt || ""}`;
}

async function loadPostedLog(): Promise<PostedLog> {
  let posts: PostedEntry[] = [];
  try {
    const raw = await readFile(POSTED_LOG, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.posts)) posts = parsed.posts;
  } catch {
    // ignore
  }

  try {
    const rawLegacy = await readFile(LEGACY_POSTED_LOG, "utf-8");
    const parsedLegacy = JSON.parse(rawLegacy);
    const items = parsedLegacy?.items || {};
    const legacyPosts = Object.entries(items).map(([key, value]: any) => {
      const [date, filename] = key.includes("/") ? key.split("/") : [undefined, key];
      return {
        id: key.includes("/") ? key : undefined,
        filename,
        date,
        postedAt: value?.postedAt,
        tweetId: value?.tweetId,
        url: value?.url,
        source: "legacy",
      } as PostedEntry;
    });
    posts = posts.concat(legacyPosts);
  } catch {
    // ignore
  }

  const map = new Map<string, PostedEntry>();
  posts.forEach((entry) => {
    map.set(uniqueKey(entry), entry);
  });

  return { posts: Array.from(map.values()) };
}

async function savePostedLog(log: PostedLog) {
  await writeFile(POSTED_LOG, JSON.stringify(log, null, 2));
}

async function runTwitter(args: string[]) {
  try {
    const { stdout } = await execFileAsync("python3", args);
    try {
      return JSON.parse(stdout);
    } catch {
      return { success: true, output: stdout };
    }
  } catch (error: any) {
    const stdout = error?.stdout || "";
    const stderr = error?.stderr || "";
    try {
      const parsed = JSON.parse(stdout);
      return parsed;
    } catch {
      return {
        success: false,
        error: stdout?.trim() || stderr?.trim() || error?.message || "Twitter command failed",
      };
    }
  }
}

function findPostedEntry(entries: PostedEntry[], id: string, filename: string, date: string, text: string) {
  const byId = entries.find((entry) => entry.id === id);
  if (byId) return byId;

  const byFile = entries.find(
    (entry) => entry.filename === filename && (entry.date ? entry.date === date : true)
  );
  if (byFile) return byFile;

  const normalized = normalizeText(text);
  const byText = entries.find((entry) => {
    const entryText = entry.text || entry.content || "";
    if (!entryText) return false;
    const normalizedEntry = normalizeText(entryText);
    return normalizedEntry === normalized;
  });
  return byText || null;
}

export async function GET() {
  try {
    const postedLog = await loadPostedLog();
    const items: Array<any> = [];
    const dateDirs = await readdir(TWITTER_DIR, { withFileTypes: true });
    for (const dir of dateDirs) {
      if (!dir.isDirectory()) continue;
      if (dir.name === "posted") continue;
      const date = dir.name;
      const folder = join(TWITTER_DIR, date);
      const files = await readdir(folder, { withFileTypes: true });
      for (const f of files) {
        if (!f.isFile()) continue;
        if (!f.name.endsWith(".txt")) continue;
        const path = join(folder, f.name);
        const text = await readFile(path, "utf-8");
        const id = `${date}/${f.name}`;
        const posted = findPostedEntry(postedLog.posts, id, f.name, date, text);
        items.push({
          id,
          date,
          filename: f.name,
          path,
          text,
          status: posted ? "posted" : "pending",
          postedAt: posted?.postedAt || null,
          tweetUrl: posted?.url || null,
          tweetId: posted?.tweetId || null,
        });
      }
    }

    try {
      const postedDirs = await readdir(POSTED_DIR, { withFileTypes: true });
      for (const dir of postedDirs) {
        if (!dir.isDirectory()) continue;
        const date = dir.name;
        const folder = join(POSTED_DIR, date);
        const files = await readdir(folder, { withFileTypes: true });
        for (const f of files) {
          if (!f.isFile()) continue;
          if (!f.name.endsWith(".txt")) continue;
          const path = join(folder, f.name);
          const text = await readFile(path, "utf-8");
          const id = `${date}/${f.name}`;
          const posted = findPostedEntry(postedLog.posts, id, f.name, date, text);
          items.push({
            id,
            date,
            filename: f.name,
            path,
            text,
            status: "posted",
            postedAt: posted?.postedAt || null,
            tweetUrl: posted?.url || null,
            tweetId: posted?.tweetId || null,
          });
        }
      }
    } catch {
      // no posted dir yet
    }

    items.sort((a, b) => (a.date < b.date ? 1 : -1));
    return NextResponse.json({ items });
  } catch (error) {
    console.error("Failed to list tweets", error);
    return NextResponse.json({ error: "Failed to list tweets" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const text = body?.text || "";
    const thread = Array.isArray(body?.thread)
      ? body.thread.map((t: any) => String(t || "").trim()).filter(Boolean)
      : [];
    const id = body?.id || "";
    const [date, filename] = id ? id.split("/") : [undefined, undefined];

    if (!text && thread.length === 0) {
      return NextResponse.json({ error: "No tweet text" }, { status: 400 });
    }

    if (thread.length > 0) {
      let replyTo = String(body?.replyTo || "").trim() || undefined;
      const postedTweets: Array<{ index: number; tweetId?: string; url?: string; text: string }> = [];

      for (let i = 0; i < thread.length; i += 1) {
        const tweetText = thread[i];
        const args = [TWITTER_SCRIPT, "post", tweetText];
        if (replyTo) args.push("--reply-to", replyTo);

        const parsed: any = await runTwitter(args);

        if (!parsed?.success) {
          throw new Error(parsed?.error || `Failed to post tweet ${i + 1}`);
        }

        postedTweets.push({
          index: i + 1,
          tweetId: parsed?.tweet_id,
          url: parsed?.url,
          text: tweetText,
        });

        if (parsed?.tweet_id) {
          replyTo = String(parsed.tweet_id);
        }
      }

      const combinedText = thread.join("\n\n---\n\n");
      const log = await loadPostedLog();
      const normalized = normalizeText(combinedText);
      log.posts = log.posts.filter((entry) => {
        if (id && entry.id === id) return false;
        if (filename && entry.filename === filename && (!entry.date || entry.date === date)) return false;
        if (entry.text || entry.content) {
          return normalizeText(entry.text || entry.content || "") !== normalized;
        }
        return true;
      });

      log.posts.push({
        id: id || `thread-${Date.now()}`,
        filename,
        date,
        postedAt: new Date().toISOString(),
        tweetId: postedTweets[0]?.tweetId,
        url: postedTweets[0]?.url,
        source: "mission-control-thread",
        text: combinedText,
      });
      await savePostedLog(log);

      if (date && filename) {
        const src = join(TWITTER_DIR, date, filename);
        const destDir = join(POSTED_DIR, date);
        const dest = join(destDir, filename);
        try {
          await mkdir(destDir, { recursive: true });
          await rename(src, dest);
        } catch (err) {
          console.warn("Failed to move posted tweet file", err);
        }
      }

      return NextResponse.json({
        success: true,
        thread: true,
        count: postedTweets.length,
        tweets: postedTweets,
        firstUrl: postedTweets[0]?.url || null,
        lastUrl: postedTweets[postedTweets.length - 1]?.url || null,
      });
    }

    const parsed: any = await runTwitter([TWITTER_SCRIPT, "post", text]);
    if (!parsed?.success) {
      return NextResponse.json({ error: parsed?.error || "Failed to post" }, { status: 500 });
    }

    const log = await loadPostedLog();
    const normalized = normalizeText(text);
    log.posts = log.posts.filter((entry) => {
      if (id && entry.id === id) return false;
      if (filename && entry.filename === filename && (!entry.date || entry.date === date)) return false;
      if (entry.text || entry.content) {
        return normalizeText(entry.text || entry.content || "") !== normalized;
      }
      return true;
    });
    log.posts.push({
      id: id || `unknown-${Date.now()}`,
      filename,
      date,
      postedAt: new Date().toISOString(),
      tweetId: parsed.tweet_id,
      url: parsed.url,
      source: "mission-control",
      text,
    });
    await savePostedLog(log);
    if (date && filename) {
      const src = join(TWITTER_DIR, date, filename);
      const destDir = join(POSTED_DIR, date);
      const dest = join(destDir, filename);
      try {
        await mkdir(destDir, { recursive: true });
        await rename(src, dest);
      } catch (err) {
        console.warn("Failed to move posted tweet file", err);
      }
    }

    return NextResponse.json({ success: true, ...parsed });
  } catch (error: any) {
    console.error("Failed to post tweet", error);
    return NextResponse.json({ error: error?.message || "Failed to post" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const id = body?.id || "";
    const newText = body?.text || "";
    if (!id) return NextResponse.json({ error: "No tweet id" }, { status: 400 });
    if (!newText) return NextResponse.json({ error: "No text provided" }, { status: 400 });

    const [date, filename] = id.split("/");
    if (!date || !filename) return NextResponse.json({ error: "Invalid id format" }, { status: 400 });

    const filePath = join(TWITTER_DIR, date, filename);
    await writeFile(filePath, newText, "utf-8");
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Failed to save tweet", error);
    return NextResponse.json({ error: error?.message || "Failed to save" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const id = body?.id || "";
    const tweetId = String(body?.tweetId || "").trim();
    if (!id) return NextResponse.json({ error: "No tweet id" }, { status: 400 });
    if (!tweetId) return NextResponse.json({ error: "No tweetId provided" }, { status: 400 });

    const { stdout } = await execFileAsync("python3", [TWITTER_SCRIPT, "delete", tweetId]);
    let parsed: any;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      parsed = { success: false, error: "Failed to parse delete response" };
    }

    if (!parsed?.success) {
      return NextResponse.json({ error: parsed?.error || "Failed to delete tweet" }, { status: 500 });
    }

    const [date, filename] = id.split("/");
    if (!date || !filename) return NextResponse.json({ error: "Invalid id format" }, { status: 400 });

    // Move file back from posted queue to active queue (if present)
    const postedPath = join(POSTED_DIR, date, filename);
    const queueDir = join(TWITTER_DIR, date);
    const queuePath = join(queueDir, filename);

    try {
      await mkdir(queueDir, { recursive: true });
      await rename(postedPath, queuePath);
    } catch {
      // ignore if file wasn't in posted folder
    }

    // Remove posted marker from log
    const log = await loadPostedLog();
    log.posts = log.posts.filter((entry) => {
      if (entry.id === id) return false;
      if (entry.tweetId && String(entry.tweetId) === tweetId) return false;
      if (entry.filename === filename && (entry.date ? entry.date === date : true)) return false;
      return true;
    });
    await savePostedLog(log);

    return NextResponse.json({ success: true, deleted: true, tweetId });
  } catch (error: any) {
    console.error("Failed to un-post tweet", error);
    return NextResponse.json({ error: error?.message || "Failed to un-post tweet" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const body = await req.json();
    const id = body?.id || "";
    if (!id) return NextResponse.json({ error: "No tweet id" }, { status: 400 });

    const [date, filename] = id.split("/");
    if (!date || !filename) return NextResponse.json({ error: "Invalid id format" }, { status: 400 });

    // Try to find file in main dir or posted dir
    let srcPath = join(TWITTER_DIR, date, filename);
    try {
      await readFile(srcPath);
    } catch {
      srcPath = join(POSTED_DIR, date, filename);
    }

    const destDir = join(ARCHIVE_DIR, date);
    const destPath = join(destDir, filename);
    
    await mkdir(destDir, { recursive: true });
    await rename(srcPath, destPath);
    
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Failed to archive tweet", error);
    return NextResponse.json({ error: error?.message || "Failed to archive" }, { status: 500 });
  }
}
