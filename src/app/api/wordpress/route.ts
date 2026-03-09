import { NextResponse } from "next/server";
import { readdir, stat, readFile, writeFile, mkdir, rename } from "fs/promises";
import { join, extname, basename, relative } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { runtimeConfig } from "@/lib/runtime-config";

const execFileAsync = promisify(execFile);
const WEB_DIR = runtimeConfig.wpWebDir;
const WP_PROXY = runtimeConfig.wpProxy;
const ARCHIVE_DIR = runtimeConfig.wpArchiveDir;
const WP_CREDS_FILE = runtimeConfig.wpCredsFile;

type WPCreds = {
  siteUrl: string;
  username: string;
  appPassword: string;
};

async function loadWpCreds(): Promise<WPCreds> {
  const raw = await readFile(WP_CREDS_FILE, "utf-8");
  const map: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [k, ...rest] = trimmed.split("=");
    map[k.trim()] = rest.join("=").trim();
  }
  const siteUrl = map.WP_SITE_URL;
  const username = map.WP_USERNAME;
  const appPassword = (map.WP_APP_PASSWORD || "").replace(/\s+/g, "");
  if (!siteUrl || !username || !appPassword) {
    throw new Error("Missing WordPress credentials");
  }
  return { siteUrl, username, appPassword };
}

async function wpRequest(creds: WPCreds, endpoint: string, init: RequestInit = {}) {
  const url = `${creds.siteUrl.replace(/\/$/, "")}/wp-json/wp/v2/${endpoint.replace(/^\//, "")}`;
  const basic = Buffer.from(`${creds.username}:${creds.appPassword}`).toString("base64");
  const headers = {
    Authorization: `Basic ${basic}`,
    "Content-Type": "application/json",
    ...(init.headers || {}),
  } as Record<string, string>;

  return fetch(url, { ...init, headers });
}

async function extractDocxText(filePath: string) {
  const { stdout } = await execFileAsync("python3", [
    "-c",
    "import sys, docx; d=docx.Document(sys.argv[1]); print('\\n'.join([p.text for p in d.paragraphs]))",
    filePath,
  ]);
  return stdout || "";
}

async function getFileText(filePath: string) {
  const ext = extname(filePath).toLowerCase();
  if (ext === ".docx") {
    return extractDocxText(filePath);
  }
  return readFile(filePath, "utf-8");
}

function slugify(name: string) {
  return name
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function walk(dir: string, items: any[] = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      await walk(full, items);
    } else if (e.isFile()) {
      if (!/\.(docx|md|html|htm|json|txt)$/i.test(e.name)) continue;
      if (e.name.startsWith("~$")) continue; // skip Office temp files
      const info = await stat(full);
      try {
        const text = await getFileText(full);
        const preview = text.replace(/\s+/g, " ").trim().slice(0, 200);
        items.push({
          path: full,
          name: e.name,
          modifiedAt: info.mtimeMs,
          slug: slugify(basename(e.name)),
          text,
          preview,
        });
      } catch (err) {
        console.warn("Skipping unreadable file", full, err);
      }
    }
  }
  return items;
}

export async function GET() {
  try {
    const items = await walk(WEB_DIR, []);
    items.sort((a, b) => b.modifiedAt - a.modifiedAt);
    return NextResponse.json({ items });
  } catch (error) {
    console.error("Failed to list WordPress files", error);
    return NextResponse.json({ error: "Failed to list WordPress files" }, { status: 500 });
  }
}

export async function POST() {
  try {
    const postsRes = await fetch(`${WP_PROXY}/posts?per_page=100`);
    const pagesRes = await fetch(`${WP_PROXY}/pages?per_page=100`);
    if (!postsRes.ok || !pagesRes.ok) {
      return NextResponse.json({ error: "WordPress sync failed" }, { status: 500 });
    }
    const posts = await postsRes.json();
    const pages = await pagesRes.json();
    return NextResponse.json({ posts, pages });
  } catch (error) {
    console.error("Failed to sync WordPress", error);
    return NextResponse.json({ error: "Failed to sync WordPress" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const { slug, status, text } = body;
    if (!slug) return NextResponse.json({ error: "No slug" }, { status: 400 });
    if (!status || !["draft", "publish"].includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    const creds = await loadWpCreds();

    // Check if post/page exists (direct WordPress API with auth)
    const existingPostRes = await wpRequest(creds, `posts?slug=${encodeURIComponent(slug)}&per_page=1&context=edit`);
    const existingPosts = await existingPostRes.json();

    const existingPageRes = await wpRequest(creds, `pages?slug=${encodeURIComponent(slug)}&per_page=1&context=edit`);
    const existingPages = await existingPageRes.json();

    const existingPost = Array.isArray(existingPosts) && existingPosts.length > 0 ? existingPosts[0] : null;
    const existingPage = Array.isArray(existingPages) && existingPages.length > 0 ? existingPages[0] : null;

    const payload = {
      title: slug.replace(/-/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()),
      content: text || "",
      status,
      slug,
    };

    let res;
    if (existingPost) {
      res = await wpRequest(creds, `posts/${existingPost.id}`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    } else if (existingPage) {
      res = await wpRequest(creds, `pages/${existingPage.id}`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    } else {
      res = await wpRequest(creds, "posts", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    }

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json({ error: errText || "WordPress publish failed" }, { status: 500 });
    }

    const result = await res.json();
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    console.error("Failed to publish to WordPress", error);
    return NextResponse.json({ error: error?.message || "Failed to publish" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const { path, text } = body;
    if (!path) return NextResponse.json({ error: "No file path" }, { status: 400 });
    if (text === undefined) return NextResponse.json({ error: "No text provided" }, { status: 400 });

    // Only allow editing files in the web content directory
    if (!path.startsWith(WEB_DIR)) {
      return NextResponse.json({ error: "Invalid file path" }, { status: 400 });
    }

    const ext = extname(path).toLowerCase();
    if (ext === ".docx") {
      return NextResponse.json({ error: "Cannot edit .docx files directly" }, { status: 400 });
    }

    await writeFile(path, text, "utf-8");
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Failed to save file", error);
    return NextResponse.json({ error: error?.message || "Failed to save" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const body = await req.json();
    const { path: filePath } = body;
    if (!filePath) return NextResponse.json({ error: "No file path" }, { status: 400 });

    // Only allow archiving files in the web content directory
    if (!filePath.startsWith(WEB_DIR)) {
      return NextResponse.json({ error: "Invalid file path" }, { status: 400 });
    }

    // Preserve relative path structure in archive
    const relPath = relative(WEB_DIR, filePath);
    const destPath = join(ARCHIVE_DIR, relPath);
    const destDir = join(destPath, "..");
    
    await mkdir(destDir, { recursive: true });
    await rename(filePath, destPath);
    
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Failed to archive file", error);
    return NextResponse.json({ error: error?.message || "Failed to archive" }, { status: 500 });
  }
}
