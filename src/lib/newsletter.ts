import { promises as fs } from "fs";
import path from "path";
import { runtimeConfig } from "@/lib/runtime-config";

// Monday newsletter state (kevteaches.ai Dashboard → Newsletter tab).
// Kev adds ideas and plans topics here; Bernie (Hermes on the Mac, project
// ~/Projects/kevteaches-newsletter) reads them through /api/newsletter and pushes
// each issue back after drafting. Buttondown is the source of truth for whether
// an issue is scheduled, held (draft) or sent.

export type NewsletterIdea = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  usedIn: string | null; // issue date (YYYY-MM-DD) it went out in
};

export type NewsletterTopic = {
  id: string;
  title: string;
  notes: string;
  issueDate: string | null; // a Monday, or null = in the pool for Bernie to pick from
  createdAt: string;
  usedIn: string | null;
};

export type NewsletterIssue = {
  issueDate: string;
  subject: string;
  preheader: string;
  skill: string;
  idea: string;
  topic: string;
  emailId: string;
  status: string; // Buttondown status: draft | scheduled | sent | ...
  held: boolean; // Kev pressed Hold: Bernie must not reschedule it
  publishDate: string | null;
  sendAt: string; // the Monday 7:00 am ET this issue is meant for, as UTC ISO
  words: number;
  filled: number; // bits Bernie made up (highlighted in the preview)
  headlines: string[];
  url: string;
  updatedAt: string;
};

export type EditRequest = {
  id: string;
  issueDate: string;
  text: string;
  createdAt: string;
  status: "pending" | "done" | "failed";
  result: string;
  doneAt: string | null;
};

export type NewsletterState = {
  ideas: NewsletterIdea[];
  topics: NewsletterTopic[];
  picks: Record<string, string>; // issue date -> idea id
  issues: Record<string, NewsletterIssue>;
  requests: EditRequest[];
};

const FILE = runtimeConfig.newsletterFilePath;

function empty(): NewsletterState {
  return { ideas: [], topics: [], picks: {}, issues: {}, requests: [] };
}

export function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function isYmd(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function isMonday(ymd: string) {
  return isYmd(ymd) && new Date(`${ymd}T12:00:00Z`).getUTCDay() === 1;
}

export async function readState(): Promise<NewsletterState> {
  try {
    return { ...empty(), ...JSON.parse(await fs.readFile(FILE, "utf8")) };
  } catch (error: any) {
    if (error?.code === "ENOENT") return empty();
    throw error;
  }
}

// One writer at a time inside this process; the page and Bernie both write.
let queue: Promise<unknown> = Promise.resolve();

export function updateState<T>(change: (state: NewsletterState) => T): Promise<T> {
  const run = queue.then(async () => {
    const state = await readState();
    const result = change(state);
    await fs.mkdir(path.dirname(FILE), { recursive: true });
    const temp = `${FILE}.tmp-${Date.now()}`;
    await fs.writeFile(temp, JSON.stringify(state, null, 2), "utf8");
    await fs.rename(temp, FILE);
    return result;
  });
  queue = run.catch(() => undefined);
  return run;
}

export function previewPath(issueDate: string) {
  return path.join(runtimeConfig.newsletterPreviewDir, `${issueDate}.html`);
}

export async function buttondown(method: string, apiPath: string, body?: unknown) {
  const key = runtimeConfig.buttondownApiKey;
  if (!key) throw new Error("BUTTONDOWN_API_KEY is not set in Mission Control's .env.local");
  const response = await fetch(`https://api.buttondown.com/v1${apiPath}`, {
    method,
    headers: { Authorization: `Token ${key}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Buttondown ${method} ${apiPath}: HTTP ${response.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

export const noStore = { headers: { "Cache-Control": "no-store, max-age=0" } };
