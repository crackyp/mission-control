import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { runtimeConfig } from "@/lib/runtime-config";

export const dynamic = "force-dynamic";

const TASKS_FILE_PATH = runtimeConfig.tasksFilePath;
const TASKS_DIR = path.dirname(TASKS_FILE_PATH);

type TaskStatus = "todo" | "inprogress" | "done";

type Task = {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  createdAt: string;
};

type TaskFile = {
  tasks: Task[];
};

async function readTasksFile(): Promise<TaskFile> {
  try {
    const raw = await fs.readFile(TASKS_FILE_PATH, "utf8");
    const data = JSON.parse(raw) as TaskFile;
    if (!data || !Array.isArray(data.tasks)) {
      return { tasks: [] };
    }
    return data;
  } catch {
    const empty: TaskFile = { tasks: [] };
    await fs.mkdir(TASKS_DIR, { recursive: true });
    await fs.writeFile(TASKS_FILE_PATH, JSON.stringify(empty, null, 2), "utf8");
    return empty;
  }
}

async function writeTasksFile(data: TaskFile) {
  await fs.mkdir(TASKS_DIR, { recursive: true });
  await fs.writeFile(TASKS_FILE_PATH, JSON.stringify(data, null, 2), "utf8");
}

export async function GET() {
  const data = await readTasksFile();
  return NextResponse.json(data, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

export async function PUT(request: Request) {
  const body = (await request.json()) as TaskFile;
  const tasks = Array.isArray(body?.tasks) ? body.tasks : [];
  await writeTasksFile({ tasks });
  return NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
