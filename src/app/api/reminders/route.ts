import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { runtimeConfig } from "@/lib/runtime-config";

export const dynamic = "force-dynamic";

const REMINDERS_FILE_PATH = runtimeConfig.remindersFilePath;
const REMINDERS_DIR = path.dirname(REMINDERS_FILE_PATH);

type Reminder = {
  id: string;
  text: string;
  createdAt: string;
  done: boolean;
};

async function atomicWrite(filePath: string, data: string) {
  const tempPath = `${filePath}.tmp-${Date.now()}`;
  await fs.writeFile(tempPath, data, "utf8");
  await fs.rename(tempPath, filePath);
}

async function ensureFile() {
  await fs.mkdir(REMINDERS_DIR, { recursive: true });
  try {
    await fs.access(REMINDERS_FILE_PATH);
  } catch {
    await atomicWrite(REMINDERS_FILE_PATH, JSON.stringify([], null, 2));
  }
}

function sanitizeReminder(item: any): Reminder | null {
  if (!item || typeof item !== "object") return null;
  const id = typeof item.id === "string" ? item.id : "";
  const text = typeof item.text === "string" ? item.text.trim() : "";
  const createdAt = typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString();
  const done = Boolean(item.done);
  if (!id || !text) return null;
  return { id, text, createdAt, done };
}

async function readReminders(): Promise<Reminder[]> {
  await ensureFile();
  try {
    const raw = await fs.readFile(REMINDERS_FILE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : [];
    return list
      .map(sanitizeReminder)
      .filter((item): item is Reminder => item !== null)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } catch {
    await atomicWrite(REMINDERS_FILE_PATH, JSON.stringify([], null, 2));
    return [];
  }
}

async function writeReminders(reminders: Reminder[]) {
  await ensureFile();
  await atomicWrite(REMINDERS_FILE_PATH, JSON.stringify(reminders, null, 2));
}

export async function GET() {
  const reminders = await readReminders();
  return NextResponse.json(
    { reminders },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const text = typeof body?.text === "string" ? body.text.trim() : "";

  if (!text) {
    return NextResponse.json({ error: "Text is required" }, { status: 400 });
  }

  const reminders = await readReminders();
  const newItem: Reminder = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    text,
    createdAt: new Date().toISOString(),
    done: false,
  };

  reminders.unshift(newItem);
  await writeReminders(reminders);

  return NextResponse.json(
    { ok: true, reminder: newItem },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => ({}));
  const id = typeof body?.id === "string" ? body.id : "";

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const reminders = await readReminders();
  const index = reminders.findIndex((r) => r.id === id);
  if (index === -1) {
    return NextResponse.json({ error: "Reminder not found" }, { status: 404 });
  }

  const updated = { ...reminders[index] };

  if (typeof body?.done === "boolean") {
    updated.done = body.done;
  }

  if (body?.text !== undefined) {
    if (typeof body.text !== "string" || !body.text.trim()) {
      return NextResponse.json({ error: "text must be a non-empty string" }, { status: 400 });
    }
    updated.text = body.text.trim();
  }

  reminders[index] = updated;
  await writeReminders(reminders);

  return NextResponse.json(
    { ok: true, reminder: updated },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}

export async function DELETE(request: Request) {
  const body = await request.json().catch(() => ({}));
  const id = typeof body?.id === "string" ? body.id : "";

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const reminders = await readReminders();
  const next = reminders.filter((r) => r.id !== id);

  if (next.length === reminders.length) {
    return NextResponse.json({ error: "Reminder not found" }, { status: 404 });
  }

  await writeReminders(next);

  return NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
