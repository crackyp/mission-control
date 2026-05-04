import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { runtimeConfig } from "@/lib/runtime-config";

export const dynamic = "force-dynamic";

type IdeaStatus = "inbox" | "exploring" | "ready" | "parked" | "archived";

type Idea = {
  id: string;
  title: string;
  body: string;
  whyItMatters?: string;
  nextStep?: string;
  status: IdeaStatus;
  tags: string[];
  revisitAt?: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
};

const IDEAS_FILE_PATH = runtimeConfig.ideasFilePath;
const IDEAS_DIR = path.dirname(IDEAS_FILE_PATH);
const STATUSES: IdeaStatus[] = ["inbox", "exploring", "ready", "parked", "archived"];

async function atomicWrite(filePath: string, data: string) {
  const tempPath = `${filePath}.tmp-${Date.now()}`;
  await fs.writeFile(tempPath, data, "utf8");
  await fs.rename(tempPath, filePath);
}

async function ensureFile() {
  await fs.mkdir(IDEAS_DIR, { recursive: true });
  try {
    await fs.access(IDEAS_FILE_PATH);
  } catch {
    await atomicWrite(IDEAS_FILE_PATH, JSON.stringify([], null, 2));
  }
}

function normalizeStatus(value: unknown): IdeaStatus {
  if (typeof value === "string" && STATUSES.includes(value as IdeaStatus)) {
    return value as IdeaStatus;
  }
  return "inbox";
}

function normalizeTags(value: unknown): string[] {
  let raw: string[] = [];

  if (Array.isArray(value)) {
    raw = value
      .map((item) => (typeof item === "string" ? item : String(item ?? "")))
      .filter(Boolean);
  } else if (typeof value === "string") {
    raw = value.split(",");
  }

  const unique = Array.from(
    new Set(
      raw
        .map((tag) => tag.trim())
        .filter(Boolean)
    )
  );

  return unique.slice(0, 20);
}

function sanitizeIdea(item: any): Idea | null {
  if (!item || typeof item !== "object") return null;

  const id = typeof item.id === "string" ? item.id : "";
  const title = typeof item.title === "string" ? item.title.trim() : "";
  if (!id || !title) return null;

  const nowIso = new Date().toISOString();
  const body = typeof item.body === "string" ? item.body : "";
  const whyItMatters = typeof item.whyItMatters === "string" ? item.whyItMatters : "";
  const nextStep = typeof item.nextStep === "string" ? item.nextStep : "";
  const status = normalizeStatus(item.status);
  const tags = normalizeTags(item.tags);
  const revisitAt = typeof item.revisitAt === "string" && item.revisitAt.trim() ? item.revisitAt : undefined;
  const pinned = Boolean(item.pinned);
  const createdAt = typeof item.createdAt === "string" ? item.createdAt : nowIso;
  const updatedAt = typeof item.updatedAt === "string" ? item.updatedAt : createdAt;

  return {
    id,
    title,
    body,
    ...(whyItMatters ? { whyItMatters } : {}),
    ...(nextStep ? { nextStep } : {}),
    status,
    tags,
    ...(revisitAt ? { revisitAt } : {}),
    pinned,
    createdAt,
    updatedAt,
  };
}

function sortIdeas(items: Idea[]) {
  return [...items].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const aTime = new Date(a.updatedAt).getTime();
    const bTime = new Date(b.updatedAt).getTime();
    return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
  });
}

async function readIdeas(): Promise<Idea[]> {
  await ensureFile();
  try {
    const raw = await fs.readFile(IDEAS_FILE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : [];
    return sortIdeas(list.map(sanitizeIdea).filter((idea): idea is Idea => idea !== null));
  } catch {
    await atomicWrite(IDEAS_FILE_PATH, JSON.stringify([], null, 2));
    return [];
  }
}

async function writeIdeas(ideas: Idea[]) {
  await ensureFile();
  await atomicWrite(IDEAS_FILE_PATH, JSON.stringify(sortIdeas(ideas), null, 2));
}

export async function GET() {
  const ideas = await readIdeas();
  return NextResponse.json(
    { ideas },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const ideaBody = typeof body?.body === "string" ? body.body : "";
  const whyItMatters = typeof body?.whyItMatters === "string" ? body.whyItMatters.trim() : "";
  const nextStep = typeof body?.nextStep === "string" ? body.nextStep.trim() : "";
  const status = normalizeStatus(body?.status);
  const tags = normalizeTags(body?.tags);
  const revisitAt = typeof body?.revisitAt === "string" && body.revisitAt.trim() ? body.revisitAt.trim() : undefined;
  const pinned = Boolean(body?.pinned);

  if (!title) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const idea: Idea = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    body: ideaBody,
    ...(whyItMatters ? { whyItMatters } : {}),
    ...(nextStep ? { nextStep } : {}),
    status,
    tags,
    ...(revisitAt ? { revisitAt } : {}),
    pinned,
    createdAt: now,
    updatedAt: now,
  };

  const ideas = await readIdeas();
  ideas.unshift(idea);
  await writeIdeas(ideas);

  return NextResponse.json(
    { ok: true, idea },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => ({}));
  const id = typeof body?.id === "string" ? body.id : "";

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const ideas = await readIdeas();
  const index = ideas.findIndex((idea) => idea.id === id);
  if (index === -1) {
    return NextResponse.json({ error: "Idea not found" }, { status: 404 });
  }

  const current = ideas[index];
  const updated: Idea = {
    ...current,
    updatedAt: new Date().toISOString(),
  };

  if (body?.title !== undefined) {
    if (typeof body.title !== "string" || !body.title.trim()) {
      return NextResponse.json({ error: "title must be a non-empty string" }, { status: 400 });
    }
    updated.title = body.title.trim();
  }

  if (body?.body !== undefined) {
    if (typeof body.body !== "string") {
      return NextResponse.json({ error: "body must be a string" }, { status: 400 });
    }
    updated.body = body.body;
  }

  if (body?.whyItMatters !== undefined) {
    if (typeof body.whyItMatters !== "string") {
      return NextResponse.json({ error: "whyItMatters must be a string" }, { status: 400 });
    }
    const why = body.whyItMatters.trim();
    if (why) {
      updated.whyItMatters = why;
    } else {
      delete updated.whyItMatters;
    }
  }

  if (body?.nextStep !== undefined) {
    if (typeof body.nextStep !== "string") {
      return NextResponse.json({ error: "nextStep must be a string" }, { status: 400 });
    }
    const next = body.nextStep.trim();
    if (next) {
      updated.nextStep = next;
    } else {
      delete updated.nextStep;
    }
  }

  if (body?.status !== undefined) {
    updated.status = normalizeStatus(body.status);
  }

  if (body?.tags !== undefined) {
    updated.tags = normalizeTags(body.tags);
  }

  if (body?.revisitAt !== undefined) {
    if (body.revisitAt === null || body.revisitAt === "") {
      delete updated.revisitAt;
    } else if (typeof body.revisitAt === "string") {
      updated.revisitAt = body.revisitAt.trim();
    } else {
      return NextResponse.json({ error: "revisitAt must be a string or null" }, { status: 400 });
    }
  }

  if (body?.pinned !== undefined) {
    updated.pinned = Boolean(body.pinned);
  }

  ideas[index] = updated;
  await writeIdeas(ideas);

  return NextResponse.json(
    { ok: true, idea: updated },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}

export async function DELETE(request: Request) {
  const body = await request.json().catch(() => ({}));
  const id = typeof body?.id === "string" ? body.id : "";

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const ideas = await readIdeas();
  const next = ideas.filter((idea) => idea.id !== id);

  if (next.length === ideas.length) {
    return NextResponse.json({ error: "Idea not found" }, { status: 404 });
  }

  await writeIdeas(next);

  return NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
