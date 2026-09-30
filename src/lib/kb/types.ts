export type View = "upload" | "chat" | "explorer" | "quality";

export interface FileMeta {
  name: string;
  size: number;
  size_h: string;
  modified: number;
  modified_h: string;
  rel: string;
  title?: string;
  /** Wiki-only: word count from wiki_index.json */
  words?: number;
  /** Wiki-only: pages this one links to, as bare filenames */
  links_to?: string[];
  /** Wiki-only: pages that link here, as bare filenames */
  linked_from?: string[];
}

/** One edge of the wiki graph. Endpoints are wiki filenames. */
export type GraphEdge =
  | { a: string; b: string; type: "link"; ab: boolean; ba: boolean }
  | { a: string; b: string; type: "similar"; weight: number };

/** Why the semantic layer is or isn't available. */
export type SimilarityStatus =
  | "ready"
  | "stale"
  | "not_built"
  | "not_installed"
  | "disabled"
  | "error";

export interface GraphResponse {
  edges: GraphEdge[];
  counts: { link: number; similar: number };
  similarity: SimilarityStatus;
}

export interface LlamaCppStatus {
  running: boolean;
  models: string[];
  loaded: string | null;
  default_model?: string;
}

export interface ProviderStatus {
  name: string;
  display_name: string;
  host: string;
  running: boolean;
  loaded: string | null;
  models: string[];
}

export interface StatusResponse {
  llamacpp: LlamaCppStatus;
  providers?: ProviderStatus[];
  files: {
    raw: number;
    wiki: number;
    outputs: number;
    corrections?: number;
  };
  faiss: "ready" | "stale" | "not_built" | "not_installed" | "unavailable" | "unknown";
}

export interface IngestUrlRequest {
  urls: string[];
  crawl: boolean;
  max_depth: number;
  max_pages: number;
  same_domain: boolean;
  path_filter?: string | null;
  respect_robots: boolean;
  delay: number;
  download_images: boolean;
  max_images: number;
  timeout: number;
}

export interface CompileRequest {
  model: string;
  force: boolean;
  max_source_chars?: number;
}

export interface AskRequest {
  question: string;
  model: string;
  limit: number;
  use_faiss: boolean;
}

export interface IndexRequest {
  force: boolean;
  model?: string;
}

export interface Recommendation {
  message: string;
  action?: string;
  payload?: Record<string, unknown>;
}

export interface CommandResponse {
  returncode: number;
  output: string;
  command: string;
  recommendations?: Recommendation[];
}

export interface AskResponse extends CommandResponse {
  answer: string;
  written_file: string | null;
}

export interface HealthCheckResponse extends CommandResponse {
  report: string;
}

export interface HealthCheckRequest {
  model: string;
}

export interface FilesResponse {
  files: FileMeta[];
  count: number;
}

export interface FileContentResponse {
  content: string | null;
  previewable: boolean;
  note?: string;
}

export interface QaHistoryEntry {
  question: string;
  file: string;
  time: string;
}

export interface TrashItem {
  name: string;
  original_name: string;
  category: string;
  trashed_at: string;
  size: number;
  path: string;
}

/* ── Chat history (persisted as kb/chats/<id>.json) ─────────── */

export interface ChatToolEvent {
  name: string;
  args?: Record<string, unknown>;
  result?: string;
}

/** What the user sees in the transcript. */
export interface ChatUiMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  tools?: ChatToolEvent[];
}

/** What gets replayed to the model on the next turn. */
export interface ChatWireMessage {
  role: string;
  content?: string | null;
  tool_call_id?: string;
  name?: string;
  tool_calls?: unknown;
}

export interface Conversation {
  id: string;
  title: string;
  updatedAt: number;
  messages: ChatUiMessage[];
  wire: ChatWireMessage[];
}
