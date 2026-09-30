// Client for the Knowledge Base tab. The KB backend (local-kb's FastAPI app)
// runs on the Windows PC; /api/kb is MC's pass-through to it, so every path
// below is the backend's own path behind that prefix.
const API_BASE = "/api/kb";

import type {
  StatusResponse,
  CommandResponse,
  AskResponse,
  HealthCheckResponse,
  FilesResponse,
  FileContentResponse,
  GraphResponse,
  IngestUrlRequest,
  CompileRequest,
  AskRequest,
  IndexRequest,
  HealthCheckRequest,
  TrashItem,
  Conversation,
} from "@/lib/kb/types";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, options);
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

function streamRequest(
  path: string,
  data: unknown,
  onLine: (text: string) => void,
): { promise: Promise<CommandResponse>; abort: () => void } {
  const controller = new AbortController();
  const promise = (async () => {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let result: CommandResponse | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const msg = JSON.parse(line.slice(6));
        if (msg.type === "line") {
          onLine(msg.text);
        } else if (msg.type === "done") {
          result = {
            returncode: msg.returncode,
            output: msg.output,
            command: "",
            recommendations: msg.recommendations,
          };
        }
      }
    }
    return result || { returncode: 1, output: "Stream ended unexpectedly", command: "" };
  })();

  return { promise, abort: () => controller.abort() };
}

export const api = {
  getStatus: () => request<StatusResponse>("/api/status"),

  ingestUpload: (files: File[]) => {
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    return request<{ saved: { name: string; size: number }[]; count: number }>(
      "/api/ingest/upload",
      { method: "POST", body: form }
    );
  },

  ingestUrl: (data: IngestUrlRequest) =>
    request<CommandResponse>("/api/ingest/url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),

  ingestUrlStream: (
    data: IngestUrlRequest,
    onLine: (text: string) => void,
  ): { promise: Promise<CommandResponse>; abort: () => void } =>
    streamRequest("/api/ingest/url/stream", data, onLine),

  ingestPdf: (files: File[], maxPages: number, copyOriginal: boolean) => {
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    form.append("max_pages", String(maxPages));
    form.append("copy_original", String(copyOriginal));
    return request<CommandResponse>("/api/ingest/pdf", {
      method: "POST",
      body: form,
    });
  },

  compile: (data: CompileRequest) =>
    request<CommandResponse>("/api/compile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),

  compileStream: (
    data: CompileRequest,
    onLine: (text: string) => void,
  ): { promise: Promise<CommandResponse>; abort: () => void } =>
    streamRequest("/api/compile/stream", data, onLine),

  buildIndex: (data: IndexRequest) =>
    request<CommandResponse>("/api/index", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),

  ask: (data: AskRequest) =>
    request<AskResponse>("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),

  lint: () => request<CommandResponse>("/api/lint", { method: "POST" }),

  promote: (filename: string) =>
    request<CommandResponse>("/api/promote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename }),
    }),

  correct: (question: string, correction: string) =>
    request<CommandResponse>("/api/correct", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, correction }),
    }),

  healthCheck: (data: HealthCheckRequest) =>
    request<HealthCheckResponse>("/api/health-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),

  loadModel: (model: string) =>
    request<{ ok: boolean; model: string }>("/api/load-model", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
    }),

  listFiles: (category: "raw" | "wiki" | "outputs") =>
    request<FilesResponse>(`/api/files/${category}`),

  getGraph: () => request<GraphResponse>("/api/graph"),

  getFile: (category: "raw" | "wiki" | "outputs", path: string) =>
    request<FileContentResponse>(`/api/file/${category}/${encodeURIComponent(path)}`),

  deleteFile: (category: "raw" | "wiki" | "outputs", path: string) =>
    request<{ success: boolean; deleted: string; trash?: string; trash_name?: string }>(
      `/api/file/${category}/${encodeURIComponent(path)}`,
      { method: "DELETE" }
    ),

  listTrash: (category?: string) =>
    request<{ files: TrashItem[] }>(
      `/api/trash${category ? `?category=${category}` : ""}`
    ),

  restoreTrash: (name: string, category: string) =>
    request<{ success: boolean; restored: string }>("/api/trash/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, category }),
    }),

  emptyTrash: (category?: string) =>
    request<{ success: boolean; removed: number }>(
      `/api/trash${category ? `?category=${category}` : ""}`,
      { method: "DELETE" }
    ),

  listChats: () => request<{ chats: Conversation[] }>("/api/chats"),

  saveChat: (chat: Conversation) =>
    request<{ success: boolean }>(`/api/chats/${chat.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(chat),
    }),

  deleteChat: (id: string) =>
    request<{ success: boolean }>(`/api/chats/${id}`, { method: "DELETE" }),

  chatStream: (
    data: {
      messages: Array<{
        role: string;
        content?: string | null;
        tool_call_id?: string;
        name?: string;
        tool_calls?: unknown;
      }>;
      model: string;
      temperature?: number;
      max_iters?: number;
    },
    onEvent: (event: ChatEvent) => void,
  ): { promise: Promise<void>; abort: () => void } => {
    const controller = new AbortController();
    const promise = (async () => {
      const res = await fetch(`${API_BASE}/api/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            onEvent(JSON.parse(line.slice(6)) as ChatEvent);
          } catch {
            /* ignore malformed frame */
          }
        }
      }
    })();
    return { promise, abort: () => controller.abort() };
  },
};

export type ChatEvent =
  | { type: "tool_call"; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; name: string; result: string }
  | { type: "content"; text: string }
  | { type: "error"; message: string }
  | { type: "done" };
