import { NextResponse } from "next/server";
import { readdir, readFile, stat, writeFile } from "fs/promises";
import { join, extname } from "path";
import { runtimeConfig } from "@/lib/runtime-config";

const CLAWD_DIR = runtimeConfig.clawdDir;
const MEMORY_DIR = runtimeConfig.memoryDir;

const CONTEXT_FILES = [
  "AGENTS.md",
  "SOUL.md",
  "USER.md",
  "MEMORY.md",
  "TOOLS.md",
  "IDENTITY.md",
  "HEARTBEAT.md",
];

type MemoryFile = {
  path: string;
  name: string;
  type: "context" | "daily";
  date?: string;
  text?: string;
  modifiedAt?: number;
};

async function readFileSafe(path: string): Promise<string> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return "";
  }
}

export async function GET() {
  try {
    const files: MemoryFile[] = [];

    // Load context files
    for (const name of CONTEXT_FILES) {
      const path = join(CLAWD_DIR, name);
      try {
        const text = await readFileSafe(path);
        if (text) {
          const info = await stat(path);
          files.push({
            path,
            name,
            type: "context",
            text,
            modifiedAt: info.mtimeMs,
          });
        }
      } catch {
        // file doesn't exist
      }
    }

    // Load daily memory logs
    try {
      const entries = await readdir(MEMORY_DIR, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (!entry.name.endsWith(".md")) continue;
        
        const path = join(MEMORY_DIR, entry.name);
        const text = await readFileSafe(path);
        const info = await stat(path);
        
        // Extract date from filename (e.g., 2026-03-05.md)
        const dateMatch = entry.name.match(/(\d{4}-\d{2}-\d{2})/);
        const date = dateMatch ? dateMatch[1] : undefined;
        
        files.push({
          path,
          name: entry.name,
          type: "daily",
          date,
          text,
          modifiedAt: info.mtimeMs,
        });
      }
    } catch {
      // memory dir doesn't exist
    }

    // Also check memory/dailynotes subdirectory
    try {
      const dailyNotesDir = join(MEMORY_DIR, "dailynotes");
      const entries = await readdir(dailyNotesDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (!entry.name.endsWith(".md")) continue;
        
        const path = join(dailyNotesDir, entry.name);
        const text = await readFileSafe(path);
        const info = await stat(path);
        
        const dateMatch = entry.name.match(/(\d{4}-\d{2}-\d{2})/);
        const date = dateMatch ? dateMatch[1] : undefined;
        
        files.push({
          path,
          name: entry.name,
          type: "daily",
          date,
          text,
          modifiedAt: info.mtimeMs,
        });
      }
    } catch {
      // dailynotes dir doesn't exist
    }

    // Sort daily files by date descending
    files.sort((a, b) => {
      if (a.type !== b.type) return a.type === "context" ? -1 : 1;
      if (a.type === "daily" && b.type === "daily") {
        return (b.date || "").localeCompare(a.date || "");
      }
      return a.name.localeCompare(b.name);
    });

    return NextResponse.json({ files });
  } catch (error) {
    console.error("Failed to list memory files", error);
    return NextResponse.json({ error: "Failed to list memory files" }, { status: 500 });
  }
}

async function saveMemoryFile(req: Request) {
  try {
    const body = await req.json();
    const filePath = body?.path;
    const text = body?.text;

    if (!filePath) return NextResponse.json({ error: "No file path provided" }, { status: 400 });
    if (text === undefined) return NextResponse.json({ error: "No text provided" }, { status: 400 });

    // Safety: only allow writes in configured clawd directory
    if (!filePath.startsWith(CLAWD_DIR + "/")) {
      return NextResponse.json({ error: "Invalid file path" }, { status: 400 });
    }

    await writeFile(filePath, text, "utf-8");
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Failed to save memory file", error);
    return NextResponse.json({ error: error?.message || "Failed to save memory file" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  return saveMemoryFile(req);
}

export async function PUT(req: Request) {
  return saveMemoryFile(req);
}
