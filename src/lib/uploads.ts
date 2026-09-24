import { promises as fs } from "fs";
import path from "path";
import { runtimeConfig } from "@/lib/runtime-config";

/**
 * Shared attachment storage for Kanban task cards and Idea Vault ideas.
 * Files live on disk under <dataDir>/uploads/<kind>/<targetId>/; a small
 * metadata record ({name, file, size, type, at}) is appended to the target
 * item's `attachments` array so any agent reading /api/tasks or /api/ideas
 * can see and fetch the files.
 */

export type Attachment = {
  id: string;
  name: string; // original filename (display)
  file: string; // stored filename on disk
  size: number;
  type: string; // mime type
  at: string; // ISO timestamp of upload
};

export type UploadKind = "tasks" | "ideas";

const UPLOAD_ROOT = path.join(path.dirname(runtimeConfig.tasksFilePath), "uploads");
const MAX_BYTES = 15 * 1024 * 1024; // 15 MB per file

export function isUploadKind(value: unknown): value is UploadKind {
  return value === "tasks" || value === "ideas";
}

export function safeSegment(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v || v.includes("..") || !/^[A-Za-z0-9._-]+$/.test(v)) return null;
  return v;
}

function safeStoredName(originalName: string, id: string): string {
  const base = path.basename(originalName || "file").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
  return `${id}-${base}`;
}

export function uploadDir(kind: UploadKind, targetId: string): string {
  return path.join(UPLOAD_ROOT, kind, targetId);
}

export async function saveUpload(kind: UploadKind, targetId: string, file: File): Promise<Attachment> {
  if (file.size <= 0) throw new Error("Empty file");
  if (file.size > MAX_BYTES) throw new Error("File too large (15 MB max)");
  const dir = uploadDir(kind, targetId);
  await fs.mkdir(dir, { recursive: true });
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const stored = safeStoredName(file.name, id);
  const buf = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(path.join(dir, stored), buf);
  return {
    id,
    name: path.basename(file.name || "file").slice(0, 200),
    file: stored,
    size: file.size,
    type: file.type || "application/octet-stream",
    at: new Date().toISOString(),
  };
}

export async function readUpload(
  kind: UploadKind,
  targetId: string,
  storedName: string
): Promise<{ buf: Buffer; att: Attachment } | null> {
  const stored = safeSegment(storedName);
  if (!stored) return null;
  // Resolve display name/type from the target item's attachment metadata when present.
  try {
    const buf = await fs.readFile(path.join(uploadDir(kind, targetId), stored));
    return { buf, att: { id: stored, name: stored, file: stored, size: buf.length, type: guessType(stored), at: "" } };
  } catch {
    return null;
  }
}

function guessType(name: string): string {
  const ext = path.extname(name).toLowerCase();
  const map: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".pdf": "application/pdf",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/plain; charset=utf-8",
    ".csv": "text/csv; charset=utf-8",
    ".json": "application/json",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".zip": "application/zip",
  };
  return map[ext] || "application/octet-stream";
}

/** Normalize a foreign array into a clean attachments list (used by tasks/ideas routes). */
export function normalizeAttachments(value: unknown): Attachment[] {
  if (!Array.isArray(value)) return [];
  const out: Attachment[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const a = item as Record<string, unknown>;
    const file = safeSegment(a.file);
    if (!file) continue;
    out.push({
      id: typeof a.id === "string" ? a.id.slice(0, 32) : file,
      name: typeof a.name === "string" && a.name.trim() ? a.name.slice(0, 200) : file,
      file,
      size: typeof a.size === "number" && Number.isFinite(a.size) ? Math.max(0, Math.floor(a.size)) : 0,
      type: typeof a.type === "string" && a.type.trim() ? a.type.slice(0, 120) : guessType(file),
      at: typeof a.at === "string" ? a.at : new Date().toISOString(),
    });
  }
  return out.slice(0, 20); // cap per item
}

export { UPLOAD_ROOT, MAX_BYTES };
