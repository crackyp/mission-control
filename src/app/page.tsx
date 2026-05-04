"use client";

import { DragDropContext, Draggable, Droppable } from "@hello-pangea/dnd";
import type { DropResult } from "@hello-pangea/dnd";
import { useCallback, useEffect, useMemo, useRef, useState, type TouchEvent } from "react";

type TaskStatus = "todo" | "inprogress" | "done";

type Task = {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  createdAt: string;
  assignee?: string;
  parentId?: string;
  notes?: string;
  completedAt?: string;
};

type TaskFile = {
  tasks: Task[];
};

type Reminder = {
  id: string;
  text: string;
  createdAt: string;
  done: boolean;
};

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

type Goals = {
  career: string[];
  personal: string[];
  business: string[];
};

type Service = {
  name: string;
  status: "running" | "stopped" | "failed" | "unknown";
  description: string;
  ports?: number[];
  details?: string;
};

type CronJob = {
  id: string;
  name: string;
  enabled?: boolean;
  schedule?: any;
  state?: any;
  sessionTarget?: string;
  agentId?: string;
  payload?: any;
  delivery?: any;
};

type CronRun = {
  ts?: number;
  runAtMs?: number;
  durationMs?: number;
  status?: string;
  action?: string;
  summary?: string;
  deliveryStatus?: string;
  sessionId?: string;
};

const isHeartbeatCronJob = (job: { name?: string; agentId?: string }) =>
  job.name === "heartbeat-main" ||
  (job.agentId === "main" && job.name?.toLowerCase().includes("heartbeat")) ||
  Boolean(job.name?.toLowerCase().startsWith("heartbeat-"));

type AgentFile = {
  path: string;
  name: string;
  type: "context" | "daily";
  date?: string;
  text?: string;
  modifiedAt?: number;
};

type TokenUsage = {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
};

type SessionTokenInfo = {
  sessionId: string;
  label?: string;
  updatedAt?: number;
  usage: TokenUsage;
};

type AgentTokenUsage = {
  current?: SessionTokenInfo;
  recent: SessionTokenInfo[];
  totals: TokenUsage;
  contextCurrentTokens?: number;
  contextMaxTokens?: number;
};

type LiveActivityStep = {
  label: string;
  at?: number;
  tool?: string;
};

type AgentLiveActivity = {
  now: string;
  detail?: string;
  command?: string;
  tool?: string;
  at?: number;
  elapsedMs?: number;
  history: LiveActivityStep[];
};

type ProviderUsageWindow = {
  label: string;
  usedPercent: number;
  resetAt?: number;
};

type ProviderUsageEntry = {
  provider: string;
  displayName: string;
  plan?: string;
  error?: string;
  windows: ProviderUsageWindow[];
};

type UsageSnapshot = {
  updatedAt: number;
  checkedAt?: number;
  providers: ProviderUsageEntry[];
  stale?: boolean;
};

const DEFAULT_DISCORD_CHANNEL_TO = process.env.NEXT_PUBLIC_DEFAULT_DISCORD_CHANNEL_TO || "channel:your-channel-id";

type Agent = {
  id: string;
  name: string;
  role: string;
  emoji: string;
  files: AgentFile[];
  lastActive?: number;
  currentWork?: string;
  presence?: "idle" | "waking" | "working";
  presenceTask?: string;
  presenceUpdatedAt?: number;
  tokenUsage?: AgentTokenUsage;
  liveActivity?: AgentLiveActivity;
  model?: string;
};

type WakeQueueJob = {
  id: string;
  name: string;
  enabled: boolean;
  at?: string;
  nextRunAtMs?: number;
  runningAtMs?: number;
  lastStatus?: string;
  stuck: boolean;
};

type AgentControlStatus = {
  agent: string;
  killed: boolean;
  killInfo?: { killed_at?: string; reason?: string; killed_by?: string } | null;
  status?: string;
  inboxCount?: number;
  recentHandoffs?: number;
  lastUpdate?: string | null;
  task?: string;
};

type HandoffTrace = {
  handoffs: Array<{ time: string; from: string; to: string; message: string }>;
  loops: Array<{ pair: string; count: number; warning: boolean }>;
  totalHandoffs: number;
  timeRangeHours: number;
};

type SubagentPresence = "working" | "recent" | "stale";

type Subagent = {
  id: string;
  sessionKey: string;
  label: string | null;
  model: string | null;
  updatedAt: number | null;
  presence: SubagentPresence;
  task?: string;
};

const columns: Array<{
  id: TaskStatus;
  title: string;
  color: string;
  dotColor: string;
}> = [
  {
    id: "todo",
    title: "To Do",
    color: "text-linear-text-secondary",
    dotColor: "bg-linear-text-tertiary",
  },
  {
    id: "inprogress",
    title: "In Progress",
    color: "text-linear-accent",
    dotColor: "bg-linear-accent",
  },
  {
    id: "done",
    title: "Done",
    color: "text-linear-success",
    dotColor: "bg-linear-success",
  },
];

const goalCategories: Array<{ id: keyof Goals; title: string }> = [
  { id: "career", title: "Career" },
  { id: "personal", title: "Personal" },
  { id: "business", title: "Business" },
];

const ideaStatuses: IdeaStatus[] = ["inbox", "exploring", "ready", "parked", "archived"];

const ideaStatusLabels: Record<IdeaStatus, string> = {
  inbox: "Inbox",
  exploring: "Exploring",
  ready: "Ready",
  parked: "Parked",
  archived: "Archived",
};

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Parse YYYY-MM-DD as local date (avoids UTC timezone shift)
function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatLocalYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseTagInput(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean)
    )
  );
}

function addDaysLocal(days: number): string {
  const next = new Date();
  next.setHours(0, 0, 0, 0);
  next.setDate(next.getDate() + days);
  return formatLocalYmd(next);
}

function nextSaturdayLocal(): string {
  const next = new Date();
  next.setHours(0, 0, 0, 0);
  const day = next.getDay(); // 0 Sun ... 6 Sat
  const daysUntilSaturday = day <= 6 ? (6 - day || 7) : 7;
  next.setDate(next.getDate() + daysUntilSaturday);
  return formatLocalYmd(next);
}

function formatDurationCompact(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0s";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function formatResetCountdown(resetAt?: number): string | null {
  if (!resetAt || !Number.isFinite(resetAt)) return null;
  const diffMs = resetAt - Date.now();
  if (diffMs <= 0) return "now";

  const totalMinutes = Math.floor(diffMs / 60000);
  if (totalMinutes < 60) return `${totalMinutes}m`;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 24) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;

  const days = Math.floor(hours / 24);
  const hoursRemainder = hours % 24;
  return hoursRemainder > 0 ? `${days}d ${hoursRemainder}h` : `${days}d`;
}

function reorder<T>(list: T[], startIndex: number, endIndex: number) {
  const result = Array.from(list);
  const [removed] = result.splice(startIndex, 1);
  result.splice(endIndex, 0, removed);
  return result;
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function getWeekDates() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, i) => new Date(start.getTime() + i * 24 * 60 * 60 * 1000));
}

const scheduleColorStyles = [
  "bg-amber-500/15 border-amber-400/40 text-amber-200",
  "bg-emerald-500/15 border-emerald-400/40 text-emerald-200",
  "bg-sky-500/15 border-sky-400/40 text-sky-200",
  "bg-violet-500/15 border-violet-400/40 text-violet-200",
  "bg-rose-500/15 border-rose-400/40 text-rose-200",
  "bg-orange-500/15 border-orange-400/40 text-orange-200",
  "bg-teal-500/15 border-teal-400/40 text-teal-200",
  "bg-indigo-500/15 border-indigo-400/40 text-indigo-200",
];

function colorForName(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % scheduleColorStyles.length;
  return scheduleColorStyles[index];
}

function toLocalDateTime(value?: string) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

// Linear-style icons
const Icons = {
  plus: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19"></line>
      <line x1="5" y1="12" x2="19" y2="12"></line>
    </svg>
  ),
  trash: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3,6 5,6 21,6"></polyline>
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path>
      <line x1="10" y1="11" x2="10" y2="17"></line>
      <line x1="14" y1="11" x2="14" y2="17"></line>
    </svg>
  ),
  edit: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
    </svg>
  ),
  check: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20,6 9,17 4,12"></polyline>
    </svg>
  ),
  x: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"></line>
      <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>
  ),
  inbox: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22,12 16,12 14,15 10,15 8,12 2,12"></polyline>
      <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"></path>
    </svg>
  ),
  target: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"></circle>
      <circle cx="12" cy="12" r="6"></circle>
      <circle cx="12" cy="12" r="2"></circle>
    </svg>
  ),
  settings: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"></circle>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
    </svg>
  ),
  search: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8"></circle>
      <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
    </svg>
  ),
  calendar: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
      <line x1="16" y1="2" x2="16" y2="6"></line>
      <line x1="8" y1="2" x2="8" y2="6"></line>
      <line x1="3" y1="10" x2="21" y2="10"></line>
    </svg>
  ),
  twitter: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 3a10.9 10.9 0 0 1-3.14 1.53A4.48 4.48 0 0 0 12 7.5v1A10.66 10.66 0 0 1 3 4s-4 9 5 13a11.64 11.64 0 0 1-7 2c9 5 20 0 20-11.5a4.5 4.5 0 0 0-.08-.83A7.72 7.72 0 0 0 23 3z"></path>
    </svg>
  ),
  wordpress: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"></circle>
      <path d="M7 9l4 10 4-10"></path>
      <path d="M9.5 7a2.5 2.5 0 0 1 5 0"></path>
    </svg>
  ),
  bell: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 17h5l-1.4-1.4a2 2 0 0 1-.6-1.4V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5"></path>
      <path d="M9 17a3 3 0 0 0 6 0"></path>
    </svg>
  ),
  menu: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="6" x2="21" y2="6"></line>
      <line x1="3" y1="12" x2="21" y2="12"></line>
      <line x1="3" y1="18" x2="21" y2="18"></line>
    </svg>
  ),
  chevronLeft: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15,18 9,12 15,6"></polyline>
    </svg>
  ),
  sortAsc: () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="18,15 12,9 6,15"></polyline>
    </svg>
  ),
  sortDesc: () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6,9 12,15 18,9"></polyline>
    </svg>
  ),
  brain: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z"></path>
      <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z"></path>
    </svg>
  ),
  idea: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18h6"></path>
      <path d="M10 22h4"></path>
      <path d="M8 14a6 6 0 1 1 8 0c-.6.5-1 1.3-1 2.1V17h-6v-.9c0-.8-.4-1.6-1-2.1z"></path>
    </svg>
  ),
  robot: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="10" rx="2"></rect>
      <circle cx="12" cy="5" r="2"></circle>
      <path d="M12 7v4"></path>
      <line x1="8" y1="16" x2="8" y2="16"></line>
      <line x1="16" y1="16" x2="16" y2="16"></line>
    </svg>
  ),
  mail: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
      <polyline points="22,6 12,13 2,6"></polyline>
    </svg>
  ),
  chart: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10"></line>
      <line x1="12" y1="20" x2="12" y2="4"></line>
      <line x1="6" y1="20" x2="6" y2="14"></line>
    </svg>
  ),
  chevronRight: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9,6 15,12 9,18"></polyline>
    </svg>
  ),
};

export default function Home() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const isDraggingRef = useRef(false);
  
  // Add task modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskDescription, setNewTaskDescription] = useState("");
  const [newTaskStatus, setNewTaskStatus] = useState<TaskStatus>("todo");
  const [newTaskAssignee, setNewTaskAssignee] = useState("");

  // Goals state
  const [goals, setGoals] = useState<Goals>({ career: [], personal: [], business: [] });
  const [activePanel, setActivePanel] = useState<"none" | "goals" | "services" | "calendar" | "personalCalendar" | "twitter" | "wordpress" | "reminders" | "ideas" | "memory" | "agents" | "comms" | "bitches" | "kpi" | "ga">("none");
  const [editingGoal, setEditingGoal] = useState<{ category: keyof Goals; index: number } | null>(null);
  const [editingGoalText, setEditingGoalText] = useState("");
  const [newGoalCategory, setNewGoalCategory] = useState<keyof Goals>("career");
  const [newGoalText, setNewGoalText] = useState("");

  // Services state
  const [services, setServices] = useState<Service[]>([]);
  const [selectedService, setSelectedService] = useState<Service | null>(null);

  // Reminders state
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [newReminderText, setNewReminderText] = useState("");
  const [reminderFilter, setReminderFilter] = useState<"all" | "open" | "done">("open");
  const [editingReminderId, setEditingReminderId] = useState<string | null>(null);
  const [editingReminderText, setEditingReminderText] = useState("");
  const [isLoadingReminders, setIsLoadingReminders] = useState(false);
  const [reminderError, setReminderError] = useState<string | null>(null);

  // Idea Vault state
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [isLoadingIdeas, setIsLoadingIdeas] = useState(false);
  const [ideaError, setIdeaError] = useState<string | null>(null);
  const [ideaFilter, setIdeaFilter] = useState<"all" | "due" | IdeaStatus>("all");
  const [showIdeaModal, setShowIdeaModal] = useState(false);
  const [editingIdea, setEditingIdea] = useState<Idea | null>(null);
  const [ideaModalError, setIdeaModalError] = useState<string | null>(null);
  const [quickIdeaTitle, setQuickIdeaTitle] = useState("");
  const [ideaForm, setIdeaForm] = useState<{
    title: string;
    body: string;
    whyItMatters: string;
    nextStep: string;
    status: IdeaStatus;
    tagsText: string;
    revisitAt: string;
    pinned: boolean;
  }>({
    title: "",
    body: "",
    whyItMatters: "",
    nextStep: "",
    status: "inbox",
    tagsText: "",
    revisitAt: "",
    pinned: false,
  });

  // Schedule/Calendar state
  type AgentHeartbeat = {
    agentId: string;
    agentName: string;
    agentEmoji: string;
    enabled: boolean;
    frequencyMinutes: number;
    jobId?: string;
    lastRun?: number;
    lastStatus?: string;
    nextRun?: number;
    model?: string;
    payloadMessage?: string;
    promptPath?: string | null;
    promptText?: string;
    sessionTarget?: string;
    delivery?: any;
  };
  const [heartbeats, setHeartbeats] = useState<AgentHeartbeat[]>([]);
  const [editingHeartbeat, setEditingHeartbeat] = useState<string | null>(null);
  const [heartbeatFreq, setHeartbeatFreq] = useState<number>(30);
  const [heartbeatModel, setHeartbeatModel] = useState<string>("minimax/MiniMax-M2.7");
  const [heartbeatPayloadMessage, setHeartbeatPayloadMessage] = useState<string>("");
  const [heartbeatPromptText, setHeartbeatPromptText] = useState<string>("");
  const [scheduleData, setScheduleData] = useState<Record<string, Array<{
    id: string;
    name: string;
    enabled: boolean;
    nextRun: number | null;
    lastRun: number | null;
    lastStatus: string | null;
  }>>>({});
  const [scheduleViewMode, setScheduleViewMode] = useState<"week" | "calendar">("week");
  const [scheduleMonth, setScheduleMonth] = useState<Date>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [scheduleCalendarData, setScheduleCalendarData] = useState<Record<string, { scheduled: any[]; runs: any[] }>>({});
  const [selectedScheduleDay, setSelectedScheduleDay] = useState<string | null>(null);
  const [cronJobs, setCronJobs] = useState<CronJob[]>([]);
  const [showCronManager, setShowCronManager] = useState(false);
  const [editingJob, setEditingJob] = useState<CronJob | null>(null);
  const [jobForm, setJobForm] = useState<any>(null);
  const [jobBase, setJobBase] = useState<any>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [twitterItems, setTwitterItems] = useState<any[]>([]);
  const [wpFiles, setWpFiles] = useState<any[]>([]);
  const [wpRemote, setWpRemote] = useState<{ posts: any[]; pages: any[] } | null>(null);
  const [isSyncingWp, setIsSyncingWp] = useState(false);
  const [isPostingTweet, setIsPostingTweet] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [twitterSort, setTwitterSort] = useState<{ col: string; dir: "asc" | "desc" }>({ col: "date", dir: "desc" });
  const [showPosted, setShowPosted] = useState(false);
  const [twitterPage, setTwitterPage] = useState(1);
  const [twitterPageSize, setTwitterPageSize] = useState(25);
  const [wpSort, setWpSort] = useState<{ col: string; dir: "asc" | "desc" }>({ col: "modified", dir: "desc" });
  const [selectedWpFile, setSelectedWpFile] = useState<any | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const edgeSwipeStartXRef = useRef<number | null>(null);
  const edgeSwipeStartYRef = useRef<number | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [editingTaskMode, setEditingTaskMode] = useState(false);
  const [editTaskTitle, setEditTaskTitle] = useState("");
  const [editTaskDesc, setEditTaskDesc] = useState("");
  const [editTaskAssignee, setEditTaskAssignee] = useState("");
  const [selectedCronJob, setSelectedCronJob] = useState<CronJob | null>(null);
  const [selectedCronRuns, setSelectedCronRuns] = useState<CronRun[]>([]);
  const [loadingCronRuns, setLoadingCronRuns] = useState(false);
  const [selectedTweet, setSelectedTweet] = useState<any | null>(null);
  const [editingTweetText, setEditingTweetText] = useState<string | null>(null);
  const [isSavingTweetEdit, setIsSavingTweetEdit] = useState(false);
  const [editingWpText, setEditingWpText] = useState<string | null>(null);
  const [isPublishingWp, setIsPublishingWp] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [memoryFiles, setMemoryFiles] = useState<Array<{ path: string; name: string; type: "context" | "daily"; date?: string; text?: string }>>([]);
  const [selectedMemoryFile, setSelectedMemoryFile] = useState<any | null>(null);
  const [memorySort, setMemorySort] = useState<{ col: string; dir: "asc" | "desc" }>({ col: "date", dir: "desc" });
  const [editingMemoryText, setEditingMemoryText] = useState<string | null>(null);
  const [isSavingMemory, setIsSavingMemory] = useState(false);

  // Agents state
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentsUsageSnapshot, setAgentsUsageSnapshot] = useState<UsageSnapshot | null>(null);
  const [subagents, setSubagents] = useState<Subagent[]>([]);
  const [isRefreshingAgents, setIsRefreshingAgents] = useState(false);
  const [isRefreshingAgentsUsage, setIsRefreshingAgentsUsage] = useState(false);
  const [isAgentsAutoRefreshHealthy, setIsAgentsAutoRefreshHealthy] = useState(true);
  const [lastAgentsAutoRefreshAt, setLastAgentsAutoRefreshAt] = useState<number>(Date.now());
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [selectedAgentFile, setSelectedAgentFile] = useState<AgentFile | null>(null);
  const [editingAgentText, setEditingAgentText] = useState<string | null>(null);
  const [isSavingAgent, setIsSavingAgent] = useState(false);
  const [wakeQueueJobs, setWakeQueueJobs] = useState<WakeQueueJob[]>([]);
  const [isClearingWakeQueue, setIsClearingWakeQueue] = useState(false);
  const [agentControls, setAgentControls] = useState<Record<string, AgentControlStatus>>({});
  const [handoffTrace, setHandoffTrace] = useState<HandoffTrace | null>(null);
  const [isRefreshingAgentControls, setIsRefreshingAgentControls] = useState(false);
  const [agentActionBusy, setAgentActionBusy] = useState<string | null>(null);

  // Agent wake state
  const [wakeModalAgent, setWakeModalAgent] = useState<Agent | null>(null);
  const [wakeMessage, setWakeMessage] = useState("");
  const [wakeModel, setWakeModel] = useState("");
  const [isWakingAgent, setIsWakingAgent] = useState(false);
  const [wakeModels, setWakeModels] = useState<Array<{ value: string; label: string }>>([
    { value: "", label: "Default (agent default model)" },
  ]);

  // Comms state
  type InboxMessage = { id: string; from: string; type: string; message: string; timestamp: string; read: boolean };
  type AgentInbox = { agentId: string; agentName: string; agentEmoji: string; messages: InboxMessage[]; unreadCount: number };
  type QueueMessage = { id: string; timestamp: string; from: string; to: string; type: string; message: string };
  const [commsInboxes, setCommsInboxes] = useState<AgentInbox[]>([]);
  const [commsQueue, setCommsQueue] = useState<QueueMessage[]>([]);
  const [commsStats, setCommsStats] = useState<{ totalUnread: number; totalMessages: number; queueSize: number }>({ totalUnread: 0, totalMessages: 0, queueSize: 0 });
  const [selectedInbox, setSelectedInbox] = useState<string | null>(null);
  const [isRefreshingComms, setIsRefreshingComms] = useState(false);
  
  // Compose message state
  const [showComposeModal, setShowComposeModal] = useState(false);
  const [composeTarget, setComposeTarget] = useState<"inbox" | "queue">("inbox");
  const [composeAgentId, setComposeAgentId] = useState<string>("");
  const [composeFrom, setComposeFrom] = useState<string>("kevbot");
  const [composeType, setComposeType] = useState<string>("info");
  const [composeMessage, setComposeMessage] = useState<string>("");
  const [composeTo, setComposeTo] = useState<string>("all");
  const [isSendingMessage, setIsSendingMessage] = useState(false);

  // Bitches (People Tracker) state
  type PersonEntry = {
    name: string;
    nickname?: string;
    dateMet: string;
    dateLogged: string;
    context: string;
    note: string;
    details: string[];
  };
  const [bitchesList, setBitchesList] = useState<PersonEntry[]>([]);
  const [selectedBitch, setSelectedBitch] = useState<PersonEntry | null>(null);
  const [isRefreshingBitches, setIsRefreshingBitches] = useState(false);
  const [seenBitchKeys, setSeenBitchKeys] = useState<string[]>([]);
  const [showAddBitchModal, setShowAddBitchModal] = useState(false);
  const [newBitchName, setNewBitchName] = useState("");
  const [newBitchNickname, setNewBitchNickname] = useState("");
  const [newBitchDateMet, setNewBitchDateMet] = useState("");
  const [newBitchContext, setNewBitchContext] = useState("");
  const [newBitchNote, setNewBitchNote] = useState("");
  const [editingBitch, setEditingBitch] = useState<PersonEntry | null>(null);

  // Personal Calendar state
  type CalendarEvent = {
    id: string;
    title: string;
    date: string;
    time: string | null;
    duration: number | null;
    description: string;
    location: string;
    completed: boolean;
  };
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [showAddEventModal, setShowAddEventModal] = useState(false);
  const [newEventTitle, setNewEventTitle] = useState("");
  const [newEventDate, setNewEventDate] = useState("");
  const [newEventTime, setNewEventTime] = useState("");
  const [newEventDuration, setNewEventDuration] = useState("");
  const [newEventLocation, setNewEventLocation] = useState("");
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [isSavingCalendarEvent, setIsSavingCalendarEvent] = useState(false);

  // KPI Dashboard state
  type KPIDailySnapshot = {
    date: string;
    posts: number;
    impressions: number;
    likes: number;
    replies: number;
    retweets: number;
    quotes: number;
    bookmarks: number;
    followers: number;
    engagement_rate: number;
  };
  type KPIPost = {
    id: string;
    text: string;
    created_at: string;
    public_metrics: {
      impression_count: number;
      like_count: number;
      reply_count: number;
      retweet_count: number;
      quote_count: number;
      bookmark_count: number;
    };
    engagements?: number;
    engagementRate?: number;
  };
  const [showKPIModal, setShowKPIModal] = useState(false);
  const [kpiDateRange, setKpiDateRange] = useState(() => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 29);
    return {
      start: formatLocalYmd(start),
      end: formatLocalYmd(end),
    };
  });
  const [kpiDailyData, setKpiDailyData] = useState<KPIDailySnapshot[]>([]);
  const [kpiPostData, setKpiPostData] = useState<KPIPost[]>([]);
  const [kpiFollowerCount, setKpiFollowerCount] = useState(0);
  const [kpiLastRefresh, setKpiLastRefresh] = useState<Date | null>(null);
  const [kpiLoading, setKpiLoading] = useState(false);
  const [kpiError, setKpiError] = useState<string | null>(null);
  const [kpiDailyPage, setKpiDailyPage] = useState(1);
  const [kpiDailyPageSize, setKpiDailyPageSize] = useState(25);
  const [kpiRefreshing, setKpiRefreshing] = useState(false);
  const [selectedKpiDate, setSelectedKpiDate] = useState<string | null>(null);
  const [selectedKpiPost, setSelectedKpiPost] = useState<KPIPost | null>(null);

  // GA Analytics state
  type GADailySnapshot = {
    date: string;
    sessions: number;
    new_users: number;
    total_users: number;
    pageviews: number;
    organic_sessions: number;
    avg_engagement_time_sec: number;
    engagement_rate: number;
  };
  type GATopPage = {
    rank: number;
    page_path: string;
    page_title: string;
    sessions: number;
    pageviews: number;
    avg_engagement_time_sec: number;
  };
  const [gaDateRange, setGaDateRange] = useState(() => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 29);
    return { start: formatLocalYmd(start), end: formatLocalYmd(end) };
  });
  const [gaDailyData, setGaDailyData] = useState<GADailySnapshot[]>([]);
  const [gaTopPages, setGaTopPages] = useState<GATopPage[]>([]);
  const [gaLastRefresh, setGaLastRefresh] = useState<Date | null>(null);
  const [gaLoading, setGaLoading] = useState(false);
  const [gaError, setGaError] = useState<string | null>(null);
  const [gaDailyPage, setGaDailyPage] = useState(1);
  const [gaDailyPageSize, setGaDailyPageSize] = useState(25);
  const [gaRefreshing, setGaRefreshing] = useState(false);

  const selectedKpiPosts = useMemo(() => {
    if (!selectedKpiDate) return [] as KPIPost[];
    return (kpiPostData || [])
      .filter((p) => new Date(p.created_at).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) === selectedKpiDate)
      .sort((a, b) => {
        const aImp = a.public_metrics?.impression_count || 0;
        const bImp = b.public_metrics?.impression_count || 0;
        if (bImp !== aImp) return bImp - aImp;
        return (new Date(b.created_at).getTime() || 0) - (new Date(a.created_at).getTime() || 0);
      });
  }, [selectedKpiDate, kpiPostData]);

  const searchValue = searchQuery.trim().toLowerCase();
  const matchesSearch = useCallback((value?: string) => {
    if (!searchValue) return true;
    return (value || "").toLowerCase().includes(searchValue);
  }, [searchValue]);

  const bitchKey = useCallback((person: PersonEntry) => `${person.name}::${person.dateMet}`, []);

  const newBitchesCount = useMemo(() => {
    return bitchesList.filter((p) => !seenBitchKeys.includes(bitchKey(p))).length;
  }, [bitchesList, seenBitchKeys, bitchKey]);

  const tasksByStatus = useMemo(() => {
    const filtered = searchValue
      ? tasks.filter((task) => matchesSearch(task.title) || matchesSearch(task.description) || matchesSearch(task.id))
      : tasks;

    const doneNewestFirst = filtered
      .filter((task) => task.status === "done")
      .sort((a, b) => {
        const aTime = new Date(a.createdAt).getTime();
        const bTime = new Date(b.createdAt).getTime();
        return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
      });

    return {
      todo: filtered.filter((task) => task.status === "todo"),
      inprogress: filtered.filter((task) => task.status === "inprogress"),
      done: doneNewestFirst,
    };
  }, [tasks, searchValue, matchesSearch]);

  const filteredServices = useMemo(() => {
    if (!searchValue) return services;
    return services.filter(
      (service) =>
        matchesSearch(service.name) ||
        matchesSearch(service.description) ||
        matchesSearch(service.status)
    );
  }, [services, searchValue, matchesSearch]);

  const filteredReminders = useMemo(() => {
    const byStatus = reminders.filter((item) => {
      if (reminderFilter === "open") return !item.done;
      if (reminderFilter === "done") return item.done;
      return true;
    });

    if (!searchValue) return byStatus;

    return byStatus.filter(
      (item) => matchesSearch(item.text) || matchesSearch(item.createdAt)
    );
  }, [reminders, reminderFilter, searchValue, matchesSearch]);

  const isIdeaOverdue = useCallback((idea: Idea) => {
    if (!idea.revisitAt) return false;
    const dueDate = idea.revisitAt.length === 10 ? parseLocalDate(idea.revisitAt) : new Date(idea.revisitAt);
    dueDate.setHours(23, 59, 59, 999);
    return dueDate.getTime() < Date.now() && idea.status !== "archived";
  }, []);

  const ideasView = useMemo(() => {
    let filtered = [...ideas];

    if (ideaFilter === "due") {
      filtered = filtered.filter((idea) => isIdeaOverdue(idea));
    } else if (ideaFilter !== "all") {
      filtered = filtered.filter((idea) => idea.status === ideaFilter);
    }

    if (searchValue) {
      filtered = filtered.filter((idea) =>
        matchesSearch(idea.title) ||
        matchesSearch(idea.body) ||
        matchesSearch(idea.whyItMatters || "") ||
        matchesSearch(idea.nextStep || "") ||
        matchesSearch(idea.status) ||
        idea.tags.some((tag) => matchesSearch(tag))
      );
    }

    return filtered.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      const aTime = new Date(a.updatedAt).getTime();
      const bTime = new Date(b.updatedAt).getTime();
      return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
    });
  }, [ideas, ideaFilter, searchValue, isIdeaOverdue, matchesSearch]);

  const twitterItemsView = useMemo(() => {
    const baseItems = showPosted
      ? twitterItems
      : twitterItems.filter((item) => item.status !== "posted");

    const filtered = searchValue
      ? baseItems.filter(
          (item) =>
            matchesSearch(item.filename) ||
            matchesSearch(item.text) ||
            matchesSearch(item.status) ||
            matchesSearch(item.date)
        )
      : baseItems;

    const sorted = [...filtered];
    sorted.sort((a, b) => {
      const dir = twitterSort.dir === "asc" ? 1 : -1;
      switch (twitterSort.col) {
        case "file":
          return a.filename.localeCompare(b.filename) * dir;
        case "status":
          return (a.status || "").localeCompare(b.status || "") * dir;
        case "preview":
          return (a.text || "").localeCompare(b.text || "") * dir;
        case "date":
        default:
          return (a.date > b.date ? 1 : -1) * dir;
      }
    });
    return sorted;
  }, [twitterItems, searchValue, twitterSort, showPosted, matchesSearch]);

  const twitterTotalPages = Math.max(1, Math.ceil(twitterItemsView.length / twitterPageSize));
  const twitterPageItems = useMemo(() => {
    const currentPage = Math.min(twitterPage, twitterTotalPages);
    const start = (currentPage - 1) * twitterPageSize;
    return twitterItemsView.slice(start, start + twitterPageSize);
  }, [twitterItemsView, twitterPage, twitterPageSize, twitterTotalPages]);

  const wpStatusMap = useMemo(() => {
    const map: Record<string, { status: string; type: string; link?: string }> = {};
    (wpRemote?.posts || []).forEach((post: any) => {
      if (post?.slug) {
        map[post.slug] = { status: post.status, type: "Post", link: post.link };
      }
    });
    (wpRemote?.pages || []).forEach((page: any) => {
      if (page?.slug) {
        map[page.slug] = { status: page.status, type: "Page", link: page.link };
      }
    });
    return map;
  }, [wpRemote]);

  const wpFilesView = useMemo(() => {
    const filtered = searchValue
      ? wpFiles.filter(
          (item) =>
            matchesSearch(item.name) ||
            matchesSearch(item.preview) ||
            matchesSearch(item.text) ||
            matchesSearch(wpStatusMap[item.slug]?.status || "") ||
            matchesSearch(wpStatusMap[item.slug]?.type || "")
        )
      : wpFiles;

    const sorted = [...filtered];
    sorted.sort((a, b) => {
      const dir = wpSort.dir === "asc" ? 1 : -1;
      switch (wpSort.col) {
        case "name":
          return a.name.localeCompare(b.name) * dir;
        case "status": {
          const aStatus = wpStatusMap[a.slug]?.status || "";
          const bStatus = wpStatusMap[b.slug]?.status || "";
          return aStatus.localeCompare(bStatus) * dir;
        }
        case "preview":
          return (a.preview || a.text || "").localeCompare(b.preview || b.text || "") * dir;
        case "modified":
        default:
          return (a.modifiedAt - b.modifiedAt) * dir;
      }
    });
    return sorted;
  }, [wpFiles, searchValue, wpSort, wpStatusMap, matchesSearch]);

  useEffect(() => {
    setTwitterPage(1);
  }, [searchValue, twitterSort.col, twitterSort.dir, showPosted, twitterPageSize]);

  useEffect(() => {
    setTwitterPage((prev) => Math.min(prev, twitterTotalPages));
  }, [twitterTotalPages]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1024px)");
    const syncMobile = (mobile: boolean) => {
      setIsMobile(mobile);
      setSidebarOpen(!mobile);
    };

    syncMobile(media.matches);

    const onChange = (event: MediaQueryListEvent) => syncMobile(event.matches);
    media.addEventListener("change", onChange);

    return () => {
      media.removeEventListener("change", onChange);
    };
  }, []);

  const toggleSidebar = () => {
    setSidebarOpen((prev) => !prev);
  };

  const openSidebar = () => {
    setSidebarOpen(true);
  };

  const closeSidebar = () => {
    setSidebarOpen(false);
  };

  const handlePanelChange = (panel: "none" | "goals" | "services" | "calendar" | "personalCalendar" | "twitter" | "wordpress" | "reminders" | "ideas" | "memory" | "agents" | "comms" | "bitches" | "kpi" | "ga") => {
    setActivePanel((prev) => (panel === "none" ? "none" : prev === panel ? "none" : panel));
    if (isMobile) closeSidebar();
  };

  const handleEdgeSwipeStart = (event: TouchEvent<HTMLDivElement>) => {
    if (!isMobile || sidebarOpen) return;
    const touch = event.touches[0];
    if (!touch || touch.clientX > 24) return;
    edgeSwipeStartXRef.current = touch.clientX;
    edgeSwipeStartYRef.current = touch.clientY;
  };

  const handleEdgeSwipeMove = (event: TouchEvent<HTMLDivElement>) => {
    if (edgeSwipeStartXRef.current == null || edgeSwipeStartYRef.current == null) return;
    const touch = event.touches[0];
    if (!touch) return;

    const deltaX = touch.clientX - edgeSwipeStartXRef.current;
    const deltaY = Math.abs(touch.clientY - edgeSwipeStartYRef.current);

    if (deltaX > 56 && deltaY < 42) {
      openSidebar();
      edgeSwipeStartXRef.current = null;
      edgeSwipeStartYRef.current = null;
    }
  };

  const handleEdgeSwipeEnd = () => {
    edgeSwipeStartXRef.current = null;
    edgeSwipeStartYRef.current = null;
  };

  const fetchTasks = async () => {
    try {
      const response = await fetch("/api/tasks", { cache: "no-store" });
      const data = (await response.json()) as TaskFile;
      if (!isDraggingRef.current) {
        setTasks(Array.isArray(data.tasks) ? data.tasks : []);
      }
    } catch (error) {
      console.error("Failed to fetch tasks", error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchGoals = async () => {
    try {
      const response = await fetch("/api/goals", { cache: "no-store" });
      const data = (await response.json()) as Goals;
      setGoals(data);
    } catch (error) {
      console.error("Failed to fetch goals", error);
    }
  };

  const fetchServices = async () => {
    try {
      const response = await fetch("/api/services", { cache: "no-store" });
      const data = await response.json();
      setServices(data.services || []);
    } catch (error) {
      console.error("Failed to fetch services", error);
    }
  };

  const fetchReminders = async () => {
    try {
      setIsLoadingReminders(true);
      setReminderError(null);
      const response = await fetch("/api/reminders", { cache: "no-store" });
      if (!response.ok) throw new Error("Failed to fetch reminders");
      const data = await response.json();
      setReminders(Array.isArray(data.reminders) ? data.reminders : []);
    } catch (error) {
      console.error("Failed to fetch reminders", error);
      setReminderError("Could not load reminders.");
    } finally {
      setIsLoadingReminders(false);
    }
  };

  const addReminder = async () => {
    const text = newReminderText.trim();
    if (!text) return;

    try {
      setReminderError(null);
      const response = await fetch("/api/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!response.ok) throw new Error("Failed to add reminder");
      setNewReminderText("");
      await fetchReminders();
    } catch (error) {
      console.error("Failed to add reminder", error);
      setReminderError("Could not add reminder.");
    }
  };

  const updateReminder = async (id: string, updates: { done?: boolean; text?: string }) => {
    try {
      setReminderError(null);
      const response = await fetch("/api/reminders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...updates }),
      });
      if (!response.ok) throw new Error("Failed to update reminder");
      await fetchReminders();
    } catch (error) {
      console.error("Failed to update reminder", error);
      setReminderError("Could not update reminder.");
    }
  };

  const deleteReminder = async (id: string) => {
    try {
      setReminderError(null);
      const response = await fetch("/api/reminders", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!response.ok) throw new Error("Failed to delete reminder");
      await fetchReminders();
    } catch (error) {
      console.error("Failed to delete reminder", error);
      setReminderError("Could not delete reminder.");
    }
  };

  const resetIdeaForm = useCallback(() => {
    setIdeaForm({
      title: "",
      body: "",
      whyItMatters: "",
      nextStep: "",
      status: "inbox",
      tagsText: "",
      revisitAt: "",
      pinned: false,
    });
    setIdeaModalError(null);
    setEditingIdea(null);
  }, []);

  const openNewIdeaModal = useCallback(() => {
    resetIdeaForm();
    setShowIdeaModal(true);
  }, [resetIdeaForm]);

  const openIdeaEditor = useCallback((idea: Idea) => {
    setEditingIdea(idea);
    setIdeaModalError(null);
    setIdeaForm({
      title: idea.title,
      body: idea.body || "",
      whyItMatters: idea.whyItMatters || "",
      nextStep: idea.nextStep || "",
      status: idea.status,
      tagsText: idea.tags.join(", "),
      revisitAt: idea.revisitAt || "",
      pinned: idea.pinned,
    });
    setShowIdeaModal(true);
  }, []);

  const closeIdeaModal = useCallback(() => {
    setShowIdeaModal(false);
    resetIdeaForm();
  }, [resetIdeaForm]);

  const fetchIdeas = useCallback(async () => {
    try {
      setIsLoadingIdeas(true);
      setIdeaError(null);
      const response = await fetch("/api/ideas", { cache: "no-store" });
      if (!response.ok) throw new Error("Failed to fetch ideas");
      const data = await response.json();
      setIdeas(Array.isArray(data.ideas) ? data.ideas : []);
    } catch (error) {
      console.error("Failed to fetch ideas", error);
      setIdeaError("Could not load ideas.");
    } finally {
      setIsLoadingIdeas(false);
    }
  }, []);

  const quickCaptureIdea = async () => {
    const title = quickIdeaTitle.trim();
    if (!title) return;

    try {
      setIdeaError(null);
      const response = await fetch("/api/ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          body: "",
          status: "inbox",
        }),
      });
      if (!response.ok) throw new Error("Failed to create idea");
      setQuickIdeaTitle("");
      await fetchIdeas();
    } catch (error) {
      console.error("Failed to quick-capture idea", error);
      setIdeaError("Could not save your idea.");
    }
  };

  const saveIdea = async () => {
    const title = ideaForm.title.trim();
    if (!title) {
      setIdeaModalError("Title is required.");
      return;
    }

    if (ideaForm.status === "ready" && !ideaForm.nextStep.trim()) {
      setIdeaModalError("Ready ideas need a next tiny step.");
      return;
    }

    const payload = {
      title,
      body: ideaForm.body,
      whyItMatters: ideaForm.whyItMatters.trim(),
      nextStep: ideaForm.nextStep.trim(),
      status: ideaForm.status,
      tags: parseTagInput(ideaForm.tagsText),
      revisitAt: ideaForm.revisitAt || null,
      pinned: ideaForm.pinned,
    };

    try {
      setIdeaModalError(null);
      setIdeaError(null);

      const response = await fetch("/api/ideas", {
        method: editingIdea ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingIdea ? { id: editingIdea.id, ...payload } : payload),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error || "Failed to save idea");
      }

      await fetchIdeas();
      closeIdeaModal();
    } catch (error: any) {
      console.error("Failed to save idea", error);
      setIdeaModalError(error?.message || "Could not save idea.");
    }
  };

  const deleteIdea = async (id: string) => {
    try {
      setIdeaError(null);
      const response = await fetch("/api/ideas", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!response.ok) throw new Error("Failed to delete idea");
      await fetchIdeas();
      if (editingIdea?.id === id) {
        closeIdeaModal();
      }
    } catch (error) {
      console.error("Failed to delete idea", error);
      setIdeaError("Could not delete idea.");
    }
  };

  const setIdeaRevisitPreset = (preset: "tomorrow" | "weekend" | "next-week" | "someday") => {
    const value =
      preset === "tomorrow"
        ? addDaysLocal(1)
        : preset === "weekend"
          ? nextSaturdayLocal()
          : preset === "next-week"
            ? addDaysLocal(7)
            : addDaysLocal(30);

    setIdeaForm((prev) => ({ ...prev, revisitAt: value }));
  };

  const convertIdeaToTask = async (idea: Idea) => {
    const title = idea.nextStep?.trim() || idea.title;
    const descriptionParts = [
      idea.body?.trim(),
      idea.whyItMatters ? `Why this matters:\n${idea.whyItMatters}` : "",
      idea.nextStep ? `Next tiny step:\n${idea.nextStep}` : "",
      idea.tags.length ? `Tags: ${idea.tags.join(", ")}` : "",
    ].filter(Boolean);

    const newTask: Task = {
      id: generateId(),
      title,
      description: descriptionParts.join("\n\n"),
      status: "todo",
      createdAt: new Date().toISOString(),
    };

    const nextTasks = [newTask, ...tasks];
    setTasks(nextTasks);
    await persistTasks(nextTasks);
  };

  const fetchHeartbeats = async () => {
    try {
      const response = await fetch("/api/heartbeats", { cache: "no-store" });
      const data = await response.json();
      if (data.heartbeats) setHeartbeats(data.heartbeats);
    } catch (error) {
      console.error("Failed to fetch heartbeats", error);
    }
  };

  const toggleHeartbeat = async (agentId: string, enabled: boolean) => {
    try {
      await fetch("/api/heartbeats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId, enabled }),
      });
      await fetchHeartbeats();
    } catch (error) {
      console.error("Failed to toggle heartbeat", error);
    }
  };

  const updateHeartbeatDetails = async (hb: AgentHeartbeat) => {
    try {
      await fetch("/api/heartbeats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: hb.agentId,
          frequencyMinutes: heartbeatFreq,
          enabled: true,
          model: heartbeatModel,
          payloadMessage: heartbeatPayloadMessage,
          promptPath: hb.promptPath,
          promptText: heartbeatPromptText,
        }),
      });
      setEditingHeartbeat(null);
      await Promise.all([fetchHeartbeats(), fetchSchedule(), fetchScheduleCalendar()]);
    } catch (error) {
      console.error("Failed to update heartbeat details", error);
    }
  };

  const fetchSchedule = async () => {
    try {
      const response = await fetch("/api/schedule", { cache: "no-store" });
      const data = await response.json();
      const filtered = Object.fromEntries(
        Object.entries(data || {}).map(([day, jobs]) => [
          day,
          Array.isArray(jobs) ? jobs.filter((job) => !isHeartbeatCronJob(job as any)) : [],
        ])
      );
      setScheduleData(filtered);
    } catch (error) {
      console.error("Failed to fetch schedule", error);
    }
  };

  const fetchScheduleCalendar = async (monthDate?: Date) => {
    try {
      const base = monthDate || scheduleMonth;
      const start = new Date(base.getFullYear(), base.getMonth(), 1);
      const end = new Date(base.getFullYear(), base.getMonth() + 1, 0);
      const response = await fetch(`/api/schedule/calendar?start=${formatLocalYmd(start)}&end=${formatLocalYmd(end)}`, { cache: "no-store" });
      const data = await response.json();
      const filteredDays = Object.fromEntries(
        Object.entries(data?.days || {}).map(([day, value]: [string, any]) => [
          day,
          {
            scheduled: Array.isArray(value?.scheduled) ? value.scheduled.filter((job: any) => !isHeartbeatCronJob(job)) : [],
            runs: Array.isArray(value?.runs) ? value.runs.filter((job: any) => !isHeartbeatCronJob(job)) : [],
          },
        ])
      );
      setScheduleCalendarData(filteredDays);
    } catch (error) {
      console.error("Failed to fetch calendar schedule", error);
      setScheduleCalendarData({});
    }
  };

  const fetchCronJobs = async () => {
    try {
      const response = await fetch("/api/cron", { cache: "no-store" });
      const data = await response.json();
      setCronJobs(Array.isArray(data.jobs) ? data.jobs.filter((job: CronJob) => !isHeartbeatCronJob(job)) : []);
    } catch (error) {
      console.error("Failed to fetch cron jobs", error);
    }
  };

  const fetchCronRuns = async (jobId: string) => {
    try {
      setLoadingCronRuns(true);
      const response = await fetch(`/api/cron/runs?jobId=${encodeURIComponent(jobId)}&limit=30`, { cache: "no-store" });
      const data = await response.json();
      setSelectedCronRuns(Array.isArray(data.runs) ? data.runs : []);
    } catch (error) {
      console.error("Failed to fetch cron runs", error);
      setSelectedCronRuns([]);
    } finally {
      setLoadingCronRuns(false);
    }
  };

  const fetchTwitterItems = async () => {
    try {
      const response = await fetch("/api/twitter", { cache: "no-store" });
      const data = await response.json();
      setTwitterItems(Array.isArray(data.items) ? data.items : []);
    } catch (error) {
      console.error("Failed to fetch twitter items", error);
    }
  };

  const fetchKPIData = async (startDate?: string, endDate?: string) => {
    let start = startDate || kpiDateRange.start;
    let end = endDate || kpiDateRange.end;

    if (start && end && start > end) {
      [start, end] = [end, start];
      setKpiDateRange({ start, end });
    }

    setKpiLoading(true);
    setKpiError(null);
    setKpiDailyPage(1);
    try {
      const res = await fetch(`/api/kpi?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&type=cache`, { cache: "no-store" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to load KPI data");
      if (json.data) {
        const enrichedPosts = (json.data.postData || []).map((p: any) => {
          const m = p.public_metrics || {};
          const engagements = (m.like_count || 0) + (m.reply_count || 0) + (m.retweet_count || 0) + (m.quote_count || 0) + (m.bookmark_count || 0);
          const impressions = m.impression_count || 0;
          return { ...p, engagements, engagementRate: impressions > 0 ? (engagements / impressions) * 100 : 0 };
        });

        let daily = json.data.dailyData || [];
        // Safety fallback: if cache has posts but empty daily rows, derive daily rows from post metrics.
        if ((!Array.isArray(daily) || daily.length === 0) && enrichedPosts.length > 0) {
          const byDate = new Map<string, any>();
          for (const p of enrichedPosts) {
            const m = p.public_metrics || {};
            const date = new Date(p.created_at).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
            if (!byDate.has(date)) {
              byDate.set(date, {
                date,
                posts: 0,
                impressions: 0,
                likes: 0,
                replies: 0,
                retweets: 0,
                quotes: 0,
                bookmarks: 0,
                followers: json.data.followerCount || 0,
                engagement_rate: 0,
              });
            }
            const row = byDate.get(date);
            row.posts += 1;
            row.impressions += m.impression_count || 0;
            row.likes += m.like_count || 0;
            row.replies += m.reply_count || 0;
            row.retweets += m.retweet_count || 0;
            row.quotes += m.quote_count || 0;
            row.bookmarks += m.bookmark_count || 0;
          }
          daily = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date)).map((d) => {
            const engagements = d.likes + d.replies + d.retweets + d.quotes + d.bookmarks;
            return { ...d, engagement_rate: d.impressions > 0 ? (engagements / d.impressions) * 100 : 0 };
          });
        }

        setKpiDailyData(daily);
        setKpiPostData(enrichedPosts);
        setKpiFollowerCount(json.data.followerCount || 0);
        setKpiLastRefresh(json.data.updatedAt ? new Date(json.data.updatedAt) : null);
      } else {
        // Fallback to snapshots
        const snapRes = await fetch(`/api/kpi?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&type=snapshots`, { cache: "no-store" });
        const snapJson = await snapRes.json();
        if (snapJson.success) {
          setKpiDailyData(snapJson.data || []);
          setKpiPostData([]);
        }
      }
    } catch (err: any) {
      console.error("Failed to fetch KPI data", err);
      setKpiError(err.message || "Failed to load KPI data");
    } finally {
      setKpiLoading(false);
    }
  };

  const fetchGAData = async (startDate?: string, endDate?: string) => {
    let start = startDate || gaDateRange.start;
    let end = endDate || gaDateRange.end;
    if (start && end && start > end) {
      [start, end] = [end, start];
      setGaDateRange({ start, end });
    }
    setGaLoading(true);
    setGaError(null);
    setGaDailyPage(1);
    try {
      const [snapRes, pagesRes] = await Promise.all([
        fetch(`/api/ga?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&type=snapshots`, { cache: 'no-store' }),
        fetch(`/api/ga?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&type=pages`, { cache: 'no-store' }),
      ]);
      const [snapJson, pagesJson] = await Promise.all([snapRes.json(), pagesRes.json()]);
      if (!snapJson.success) throw new Error(snapJson.error || 'Failed to load analytics data');
      setGaDailyData(snapJson.data || []);
      setGaTopPages(pagesJson.success ? (pagesJson.data || []) : []);
      if (snapJson.updatedAt) setGaLastRefresh(new Date(snapJson.updatedAt));
    } catch (err: any) {
      console.error('Failed to fetch GA data', err);
      setGaError(err.message || 'Failed to load analytics data');
    } finally {
      setGaLoading(false);
    }
  };

  const fetchWordpressFiles = async () => {
    try {
      const response = await fetch("/api/wordpress", { cache: "no-store" });
      const data = await response.json();
      setWpFiles(Array.isArray(data.items) ? data.items : []);
    } catch (error) {
      console.error("Failed to fetch wordpress files", error);
    }
  };

  const fetchMemoryFiles = async () => {
    try {
      const response = await fetch("/api/memory", { cache: "no-store" });
      const data = await response.json();
      setMemoryFiles(Array.isArray(data.files) ? data.files : []);
    } catch (error) {
      console.error("Failed to fetch memory files", error);
    }
  };

  const saveMemoryFile = async () => {
    if (!selectedMemoryFile || editingMemoryText === null) return;
    try {
      setIsSavingMemory(true);
      const response = await fetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: selectedMemoryFile.path, text: editingMemoryText }),
      });
      if (!response.ok) throw new Error("Failed to save file");

      setSelectedMemoryFile({ ...selectedMemoryFile, text: editingMemoryText });
      setMemoryFiles((prev) => prev.map((f) => (f.path === selectedMemoryFile.path ? { ...f, text: editingMemoryText } : f)));
      setEditingMemoryText(null);
    } catch (error: any) {
      alert("Save failed: " + error.message);
    } finally {
      setIsSavingMemory(false);
    }
  };

  const fetchAgents = async (showLoading = false, isAutoRefresh = false) => {
    try {
      if (showLoading) setIsRefreshingAgents(true);
      const response = await fetch("/api/agents", { cache: "no-store" });
      const data = await response.json();
      setAgents(Array.isArray(data.agents) ? data.agents : []);
      if (isAutoRefresh) {
        setIsAgentsAutoRefreshHealthy(true);
        setLastAgentsAutoRefreshAt(Date.now());
      }
    } catch (error) {
      console.error("Failed to fetch agents", error);
      if (isAutoRefresh) setIsAgentsAutoRefreshHealthy(false);
    } finally {
      if (showLoading) setIsRefreshingAgents(false);
    }
  };

  const fetchAgentsUsageSnapshot = async (force = false) => {
    try {
      setIsRefreshingAgentsUsage(true);
      const response = await fetch(`/api/agents/usage${force ? "?force=1" : ""}`, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Usage request failed (${response.status})`);
      }
      const data = await response.json();
      setAgentsUsageSnapshot(
        data?.usageSnapshot && Array.isArray(data.usageSnapshot.providers)
          ? { ...data.usageSnapshot, checkedAt: Date.now() }
          : null
      );
    } catch (error) {
      console.error("Failed to fetch usage snapshot", error);
    } finally {
      setIsRefreshingAgentsUsage(false);
    }
  };

  const fetchSubagents = async () => {
    try {
      const response = await fetch("/api/subagents", { cache: "no-store" });
      const data = await response.json();
      setSubagents(Array.isArray(data.subagents) ? data.subagents : []);
    } catch (error) {
      console.error("Failed to fetch subagents", error);
    }
  };

  const fetchWakeQueue = async () => {
    try {
      const response = await fetch("/api/agents/wake-queue", { cache: "no-store" });
      const data = await response.json();
      setWakeQueueJobs(Array.isArray(data.wakeJobs) ? data.wakeJobs : []);
    } catch (error) {
      console.error("Failed to fetch wake queue", error);
    }
  };

  const clearStuckWakeJobs = async () => {
    setIsClearingWakeQueue(true);
    try {
      await fetch("/api/agents/wake-queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clearStuck" }),
      });
      await fetchWakeQueue();
    } catch (error) {
      console.error("Failed to clear stuck wake jobs", error);
    } finally {
      setIsClearingWakeQueue(false);
    }
  };

  const clearWakeJobById = async (id: string) => {
    try {
      await fetch("/api/agents/wake-queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clearById", id }),
      });
      await fetchWakeQueue();
    } catch (error) {
      console.error("Failed to clear wake job", error);
    }
  };

  const fetchWakeModels = async () => {
    try {
      const response = await fetch("/api/models", { cache: "no-store" });
      const data = await response.json();
      const dynamicModels = Array.isArray(data?.models) ? data.models : [];
      setWakeModels([
        { value: "", label: "Default (agent default model)" },
        ...dynamicModels,
      ]);
    } catch (error) {
      console.error("Failed to fetch wake models", error);
      setWakeModels([{ value: "", label: "Default (agent default model)" }]);
    }
  };

  const fetchAgentControls = async () => {
    try {
      setIsRefreshingAgentControls(true);
      const [statusRes, traceRes] = await Promise.all([
        fetch("/api/agents/control", { cache: "no-store" }),
        fetch("/api/agents/control?action=handoff-trace&hours=6", { cache: "no-store" }),
      ]);
      const statusData = await statusRes.json();
      const traceData = await traceRes.json();
      setAgentControls(statusData?.agents || {});
      setHandoffTrace(traceData || null);
    } catch (error) {
      console.error("Failed to fetch agent controls", error);
    } finally {
      setIsRefreshingAgentControls(false);
    }
  };

  const runAgentControlAction = async (
    action: "kill" | "revive" | "kill-all" | "revive-all",
    agent?: string,
    reason?: string
  ) => {
    const key = `${action}:${agent || "all"}`;
    try {
      setAgentActionBusy(key);
      const response = await fetch("/api/agents/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, agent, reason }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error || `Failed: ${action}`);
      }
      await Promise.all([fetchAgentControls(), fetchAgents(true), fetchSubagents(), fetchWakeQueue()]);
    } catch (error: any) {
      alert(`Agent action failed: ${error?.message || "Unknown error"}`);
    } finally {
      setAgentActionBusy(null);
    }
  };

  const fetchComms = async () => {
    try {
      setIsRefreshingComms(true);
      const response = await fetch("/api/comms", { cache: "no-store" });
      const data = await response.json();
      if (data.inboxes) setCommsInboxes(data.inboxes);
      if (data.queue) setCommsQueue(data.queue);
      if (data.stats) setCommsStats(data.stats);
    } catch (error) {
      console.error("Failed to fetch comms", error);
    } finally {
      setIsRefreshingComms(false);
    }
  };

  const fetchBitches = async () => {
    try {
      setIsRefreshingBitches(true);
      const response = await fetch("/api/bitches", { cache: "no-store" });
      const data = await response.json();
      setBitchesList(Array.isArray(data.people) ? data.people : []);
    } catch (error) {
      console.error("Failed to fetch bitches", error);
    } finally {
      setIsRefreshingBitches(false);
    }
  };

  const addBitch = async () => {
    if (!newBitchName.trim()) return;
    try {
      const response = await fetch("/api/bitches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add",
          name: newBitchName.trim(),
          nickname: newBitchNickname.trim() || undefined,
          dateMet: newBitchDateMet || new Date().toISOString().split("T")[0],
          context: newBitchContext.trim(),
          note: newBitchNote.trim(),
        }),
      });
      if (!response.ok) throw new Error("Failed to add");
      await fetchBitches();
      setShowAddBitchModal(false);
      setNewBitchName("");
      setNewBitchNickname("");
      setNewBitchDateMet("");
      setNewBitchContext("");
      setNewBitchNote("");
    } catch (error: any) {
      alert("Failed to add: " + error.message);
    }
  };

  const updateBitch = async () => {
    if (!editingBitch) return;
    try {
      const response = await fetch("/api/bitches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update",
          originalName: selectedBitch?.name,
          name: editingBitch.name,
          nickname: editingBitch.nickname,
          dateMet: editingBitch.dateMet,
          context: editingBitch.context,
          note: editingBitch.note,
          details: editingBitch.details,
        }),
      });
      if (!response.ok) throw new Error("Failed to update");
      await fetchBitches();
      setEditingBitch(null);
      setSelectedBitch(editingBitch);
    } catch (error: any) {
      alert("Failed to update: " + error.message);
    }
  };

  const deleteBitch = async (name: string) => {
    if (!confirm(`Remove ${name} from the list?`)) return;
    try {
      await fetch("/api/bitches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", name }),
      });
      await fetchBitches();
      setSelectedBitch(null);
    } catch (error) {
      console.error("Failed to delete", error);
    }
  };

  const fetchCalendarEvents = async () => {
    try {
      const response = await fetch("/api/calendar", { cache: "no-store" });
      const data = await response.json();
      setCalendarEvents(Array.isArray(data.events) ? data.events : []);
    } catch (error) {
      console.error("Failed to fetch calendar events", error);
    }
  };

  const addCalendarEvent = async () => {
    if (!newEventTitle.trim() || !newEventDate || isSavingCalendarEvent) return;

    const eventPayload = {
      title: newEventTitle.trim(),
      date: newEventDate,
      time: newEventTime || null,
      duration: newEventDuration ? parseInt(newEventDuration, 10) : null,
      location: newEventLocation.trim() || "",
    };

    try {
      setIsSavingCalendarEvent(true);
      const response = await fetch("/api/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add",
          event: eventPayload,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Failed to add event");

      if (data?.event) {
        setCalendarEvents((prev) => [...prev, data.event]);
      }

      setShowAddEventModal(false);
      setEditingEvent(null);
      setNewEventTitle("");
      setNewEventDate("");
      setNewEventTime("");
      setNewEventDuration("");
      setNewEventLocation("");

      void fetchCalendarEvents();
    } catch (error: any) {
      alert("Failed to add event: " + error.message);
    } finally {
      setIsSavingCalendarEvent(false);
    }
  };

  const deleteCalendarEvent = async (eventId: string) => {
    if (!confirm("Delete this event?")) return;
    try {
      await fetch("/api/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", eventId }),
      });
      await fetchCalendarEvents();
    } catch (error) {
      console.error("Failed to delete event", error);
    }
  };

  const updateCalendarEvent = async () => {
    if (!editingEvent || !newEventTitle.trim() || !newEventDate || isSavingCalendarEvent) return;

    const updatedEvent = {
      title: newEventTitle.trim(),
      date: newEventDate,
      time: newEventTime || null,
      duration: newEventDuration ? parseInt(newEventDuration, 10) : null,
      location: newEventLocation.trim() || "",
    };

    try {
      setIsSavingCalendarEvent(true);
      const response = await fetch("/api/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update",
          eventId: editingEvent.id,
          event: updatedEvent,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Failed to update event");

      setCalendarEvents((prev) => prev.map((event) => (
        event.id === editingEvent.id ? { ...event, ...updatedEvent } : event
      )));

      setEditingEvent(null);
      setShowAddEventModal(false);
      setNewEventTitle("");
      setNewEventDate("");
      setNewEventTime("");
      setNewEventDuration("");
      setNewEventLocation("");

      void fetchCalendarEvents();
    } catch (error: any) {
      alert("Failed to update event: " + error.message);
    } finally {
      setIsSavingCalendarEvent(false);
    }
  };

  const openEditEvent = (event: CalendarEvent) => {
    setEditingEvent(event);
    setNewEventTitle(event.title);
    setNewEventDate(event.date);
    setNewEventTime(event.time || "");
    setNewEventDuration(event.duration?.toString() || "");
    setNewEventLocation(event.location || "");
    setShowAddEventModal(true);
  };

  const clearInbox = async (agentId: string) => {
    try {
      await fetch("/api/comms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear", agentId }),
      });
      await fetchComms();
    } catch (error) {
      console.error("Failed to clear inbox", error);
    }
  };

  const markInboxRead = async (agentId: string) => {
    try {
      await fetch("/api/comms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "markRead", agentId }),
      });
      await fetchComms();
    } catch (error) {
      console.error("Failed to mark inbox read", error);
    }
  };

  const sendCommsMessage = async () => {
    if (!composeMessage.trim()) return;
    
    try {
      setIsSendingMessage(true);
      
      const payload: Record<string, string> = {
        message: composeMessage.trim(),
        from: composeFrom || "dashboard",
        type: composeType || "info",
      };
      
      if (composeTarget === "inbox") {
        payload.action = "sendInbox";
        payload.agentId = composeAgentId;
        if (!composeAgentId) {
          alert("Please select an agent");
          return;
        }
      } else {
        payload.action = "sendQueue";
        payload.to = composeTo || "all";
      }
      
      const response = await fetch("/api/comms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to send");
      
      // Reset form
      setComposeMessage("");
      setShowComposeModal(false);
      await fetchComms();
    } catch (error: any) {
      alert("Send failed: " + error.message);
    } finally {
      setIsSendingMessage(false);
    }
  };

  const saveAgentFile = async () => {
    if (!selectedAgentFile || editingAgentText === null) return;
    try {
      setIsSavingAgent(true);
      const response = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: selectedAgentFile.path, text: editingAgentText }),
      });
      if (!response.ok) throw new Error("Failed to save file");

      setSelectedAgentFile({ ...selectedAgentFile, text: editingAgentText });
      // Update the agent's file in state
      if (selectedAgent) {
        setSelectedAgent({
          ...selectedAgent,
          files: selectedAgent.files.map((f) =>
            f.path === selectedAgentFile.path ? { ...f, text: editingAgentText } : f
          ),
        });
      }
      setEditingAgentText(null);
      await Promise.all([fetchAgents(), fetchSubagents()]);
    } catch (error: any) {
      alert("Save failed: " + error.message);
    } finally {
      setIsSavingAgent(false);
    }
  };

  const wakeAgent = async () => {
    if (!wakeModalAgent) return;
    try {
      setIsWakingAgent(true);
      const response = await fetch("/api/agents/wake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent: wakeModalAgent.id,
          message: wakeMessage.trim() || "Check for tasks",
          ...(wakeModel ? { model: wakeModel } : {}),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Failed to wake agent");

      const modelNote = wakeModel ? ` using ${wakeModels.find(m => m.value === wakeModel)?.label || wakeModel}` : "";
      const statusLabel = data?.status === "skipped" ? "Checked" : data?.status === "dry-run" ? "Dry run for" : "Woke";
      const sessionText = data?.sessionId
        ? `\nSession: ${data?.sessionMode || "unknown"} ${data.sessionId}`
        : "";

      const preflightText =
        typeof data?.preflightText === "string"
          ? data.preflightText
          : Array.isArray(data?.preflight)
            ? data.preflight.join("\n")
            : "";

      const warningText = Array.isArray(data?.warnings) && data.warnings.length
        ? `\n\nNote:\n${data.warnings.map((w: string) => `- ${w}`).join("\n")}`
        : "";

      const preflightBlock = preflightText ? `\n\nPreflight:\n${preflightText}` : "";
      alert(`✅ ${statusLabel} ${wakeModalAgent.name}${modelNote}.${sessionText}${preflightBlock}${warningText}`);

      await Promise.all([fetchAgents(true), fetchSubagents(), fetchWakeQueue()]);
      setWakeModalAgent(null);
      setWakeMessage("");
      setWakeModel("");
    } catch (error: any) {
      alert("Wake failed: " + error.message);
    } finally {
      setIsWakingAgent(false);
    }
  };

  const syncWordpress = async () => {
    try {
      setIsSyncingWp(true);
      const response = await fetch("/api/wordpress", { method: "POST" });
      const data = await response.json();
      setWpRemote({ posts: data.posts || [], pages: data.pages || [] });
    } catch (error) {
      console.error("Failed to sync WordPress", error);
    } finally {
      setIsSyncingWp(false);
    }
  };

  const splitThreadText = (value: string): string[] => {
    const raw = (value || "").replace(/\r\n/g, "\n").trim();
    if (!raw) return [];

    if (raw.includes("\n---\n")) {
      return raw
        .split(/\n\s*---\s*\n/g)
        .map((part) => part.trim())
        .filter(Boolean);
    }

    return [raw];
  };

  const postTweet = async (text: string, id: string) => {
    try {
      setIsPostingTweet(id);
      const response = await fetch("/api/twitter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to post");
      alert("Tweet posted" + (data.url ? `: ${data.url}` : ""));
      await fetchTwitterItems();
    } catch (error: any) {
      alert("Tweet failed: " + error.message);
    } finally {
      setIsPostingTweet(null);
    }
  };

  const postTweetThread = async (text: string, id: string) => {
    const tweets = splitThreadText(text);
    if (tweets.length < 2) {
      alert("Need at least 2 tweets. Separate each tweet with a line that contains only ---");
      return;
    }

    const overLimit = tweets
      .map((t, i) => ({ index: i + 1, len: t.length }))
      .filter((x) => x.len > 280);
    if (overLimit.length) {
      const msg = overLimit.map((x) => `Tweet ${x.index}: ${x.len}/280`).join("\n");
      alert("Thread failed: one or more tweets are over 280 chars\n\n" + msg);
      return;
    }

    try {
      setIsPostingTweet(id);
      const response = await fetch("/api/twitter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, thread: tweets }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to post thread");
      alert(`Thread posted (${data.count || tweets.length} tweets)` + (data.firstUrl ? `: ${data.firstUrl}` : ""));
      await fetchTwitterItems();
    } catch (error: any) {
      alert("Thread failed: " + error.message);
    } finally {
      setIsPostingTweet(null);
    }
  };

  const saveTweetEdit = async (id: string, newText: string) => {
    if (isSavingTweetEdit) return;

    const previousText = selectedTweet?.text;

    try {
      setIsSavingTweetEdit(true);
      setEditingTweetText(null);
      setSelectedTweet((prev: any) => prev && prev.id === id ? { ...prev, text: newText } : prev);
      setTwitterItems((prev) => prev.map((item) => item.id === id ? { ...item, text: newText } : item));

      const response = await fetch("/api/twitter", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, text: newText }),
      });

      if (!response.ok) throw new Error("Failed to save");

      void fetchTwitterItems();
    } catch (error: any) {
      if (typeof previousText === "string") {
        setSelectedTweet((prev: any) => prev && prev.id === id ? { ...prev, text: previousText } : prev);
        setTwitterItems((prev) => prev.map((item) => item.id === id ? { ...item, text: previousText } : item));
        setEditingTweetText(newText);
      }
      alert("Save failed: " + error.message);
    } finally {
      setIsSavingTweetEdit(false);
    }
  };

  const publishWordpress = async (item: any, status: "draft" | "publish") => {
    try {
      setIsPublishingWp(true);
      const response = await fetch("/api/wordpress", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: item.path, slug: item.slug, status, text: editingWpText ?? item.text }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to publish");
      alert(`${status === "draft" ? "Saved as draft" : "Published"} successfully!`);
      await syncWordpress();
      await fetchWordpressFiles();
      setEditingWpText(null);
    } catch (error: any) {
      alert("Publish failed: " + error.message);
    } finally {
      setIsPublishingWp(false);
    }
  };

  const saveWpEdit = async (item: any, newText: string) => {
    try {
      const response = await fetch("/api/wordpress", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: item.path, text: newText }),
      });
      if (!response.ok) throw new Error("Failed to save");
      await fetchWordpressFiles();
      setEditingWpText(null);
      setSelectedWpFile((prev: any) => prev ? { ...prev, text: newText } : null);
    } catch (error: any) {
      alert("Save failed: " + error.message);
    }
  };

  const unpostTweet = async (item: any) => {
    if (!item?.tweetId) {
      alert("Missing tweet ID for un-post");
      return;
    }
    if (!confirm("Delete this posted tweet from X and move it back to queue?")) return;

    try {
      setIsPostingTweet(item.id);
      const response = await fetch("/api/twitter", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, tweetId: item.tweetId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to un-post tweet");
      alert("Tweet deleted and moved back to queue.");
      await fetchTwitterItems();
      setSelectedTweet((prev: any) => (prev ? { ...prev, status: "pending", tweetUrl: null, tweetId: null, postedAt: null } : null));
    } catch (error: any) {
      alert("Un-post failed: " + error.message);
    } finally {
      setIsPostingTweet(null);
    }
  };

  const archiveTweet = async (id: string) => {
    if (!confirm("Archive this tweet? It will be moved out of the dashboard.")) return;
    try {
      setIsArchiving(true);
      const response = await fetch("/api/twitter", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!response.ok) throw new Error("Failed to archive");
      await fetchTwitterItems();
      setSelectedTweet(null);
      setEditingTweetText(null);
    } catch (error: any) {
      alert("Archive failed: " + error.message);
    } finally {
      setIsArchiving(false);
    }
  };

  const archiveWpFile = async (path: string) => {
    if (!confirm("Archive this file? It will be moved out of the dashboard.")) return;
    try {
      setIsArchiving(true);
      const response = await fetch("/api/wordpress", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      if (!response.ok) throw new Error("Failed to archive");
      await fetchWordpressFiles();
      setSelectedWpFile(null);
      setEditingWpText(null);
    } catch (error: any) {
      alert("Archive failed: " + error.message);
    } finally {
      setIsArchiving(false);
    }
  };

  const persistTasks = async (updatedTasks: Task[]) => {
    try {
      await fetch("/api/tasks", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tasks: updatedTasks }),
      });
    } catch (error) {
      console.error("Failed to save tasks", error);
    }
  };

  const persistGoals = async (updatedGoals: Goals) => {
    try {
      await fetch("/api/goals", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedGoals),
      });
    } catch (error) {
      console.error("Failed to save goals", error);
    }
  };

  useEffect(() => {
    try {
      const raw = localStorage.getItem("mission-control:bitches:seen");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setSeenBitchKeys(parsed);
      }
    } catch (error) {
      console.error("Failed to load seen bitches", error);
    }

    fetchTasks();
    fetchGoals();
    fetchServices();
    fetchReminders();
    fetchSchedule();
    fetchScheduleCalendar();
    fetchCronJobs();
    fetchTwitterItems();
    fetchWordpressFiles();
    fetchMemoryFiles();
    fetchAgents(false, true);
    fetchSubagents();
    fetchWakeQueue();
    fetchWakeModels();
    fetchAgentControls();
    fetchHeartbeats();
    fetchCalendarEvents();
    fetchBitches();
    const taskInterval = setInterval(fetchTasks, 2000);
    const serviceInterval = setInterval(fetchServices, 5000);
    const remindersInterval = setInterval(fetchReminders, 15000);
    const scheduleInterval = setInterval(fetchSchedule, 60000);
    const cronInterval = setInterval(fetchCronJobs, 60000);
    const twitterInterval = setInterval(fetchTwitterItems, 60000);
    const wpInterval = setInterval(fetchWordpressFiles, 60000);
    const memoryInterval = setInterval(fetchMemoryFiles, 60000);
    const agentsInterval = setInterval(() => {
      fetchAgents(false, true);
      fetchSubagents();
    }, 30000);
    const agentControlsInterval = setInterval(fetchAgentControls, 10000);
    const modelsInterval = setInterval(fetchWakeModels, 60000);
    const calendarInterval = setInterval(fetchCalendarEvents, 60000);
    return () => {
      clearInterval(taskInterval);
      clearInterval(serviceInterval);
      clearInterval(remindersInterval);
      clearInterval(scheduleInterval);
      clearInterval(cronInterval);
      clearInterval(twitterInterval);
      clearInterval(wpInterval);
      clearInterval(memoryInterval);
      clearInterval(agentsInterval);
      clearInterval(agentControlsInterval);
      clearInterval(modelsInterval);
      clearInterval(calendarInterval);
    };
  }, []);

  useEffect(() => {
    fetchIdeas();
    const ideasInterval = setInterval(fetchIdeas, 30000);
    return () => clearInterval(ideasInterval);
  }, [fetchIdeas]);

  useEffect(() => {
    if (!selectedCronJob?.id) {
      setSelectedCronRuns([]);
      return;
    }
    fetchCronRuns(selectedCronJob.id);
  }, [selectedCronJob?.id]);

  useEffect(() => {
    fetchScheduleCalendar(scheduleMonth);
  }, [scheduleMonth]);

  useEffect(() => {
    try {
      localStorage.setItem("mission-control:bitches:seen", JSON.stringify(seenBitchKeys));
    } catch (error) {
      console.error("Failed to save seen bitches", error);
    }
  }, [seenBitchKeys]);

  useEffect(() => {
    if (activePanel !== "bitches" || bitchesList.length === 0) return;
    const keys = bitchesList.map((p) => bitchKey(p));
    setSeenBitchKeys((prev) => Array.from(new Set([...prev, ...keys])));
  }, [activePanel, bitchesList, bitchKey]);

  useEffect(() => {
    const healthInterval = setInterval(() => {
      if (Date.now() - lastAgentsAutoRefreshAt > 15000) {
        setIsAgentsAutoRefreshHealthy(false);
      }
    }, 3000);

    return () => clearInterval(healthInterval);
  }, [lastAgentsAutoRefreshAt]);

  useEffect(() => {
    setSelectedAgent((prev) => {
      if (!prev) return prev;
      const latest = agents.find((agent) => agent.id === prev.id);
      return latest || prev;
    });
  }, [agents]);

  useEffect(() => {
    if (activePanel !== "agents") return;
    fetchAgentsUsageSnapshot();
  }, [activePanel]);

  const formatSchedule = (job: CronJob) => {
    if (!job.schedule) return "Unknown";
    if (job.schedule.kind === "cron") return `cron: ${job.schedule.expr}`;
    if (job.schedule.kind === "every") return `every ${Math.round((job.schedule.everyMs || 0) / 60000)} min`;
    if (job.schedule.kind === "at") return `at ${job.schedule.at}`;
    return job.schedule.kind || "Unknown";
  };

  const openJobEditor = (job: CronJob) => {
    setEditingJob(job);
    setJobBase(job);
    setJobForm({
      name: job.name || "",
      enabled: job.enabled !== false,
      scheduleKind: job.schedule?.kind || "cron",
      cronExpr: job.schedule?.expr || "0 9 * * *",
      cronTz: job.schedule?.tz || "America/New_York",
      everyMinutes: job.schedule?.everyMs ? Math.round(job.schedule.everyMs / 60000) : 60,
      atTime: toLocalDateTime(job.schedule?.at),
      sessionTarget: job.sessionTarget || "isolated",
      payloadKind: job.payload?.kind || "agentTurn",
      payloadMessage: job.payload?.message || "",
      payloadModel: job.payload?.model || "",
      agentId: job.agentId || "",
      deliveryMode: job.delivery?.mode || "announce",
      deliveryChannel: job.delivery?.channel || "discord",
      deliveryTo: job.delivery?.to || "",
    });
    setJobError(null);
    setShowCronManager(true);
  };

  const createNewJob = () => {
    setEditingJob(null);
    setJobBase({});
    setJobForm({
      name: "new-job",
      enabled: true,
      scheduleKind: "cron",
      cronExpr: "0 9 * * *",
      cronTz: "America/New_York",
      everyMinutes: 60,
      atTime: "",
      sessionTarget: "isolated",
      payloadKind: "agentTurn",
      payloadMessage: "",
      payloadModel: "",
      agentId: "",
      deliveryMode: "announce",
      deliveryChannel: "discord",
      deliveryTo: DEFAULT_DISCORD_CHANNEL_TO,
    });
    setJobError(null);
    setShowCronManager(true);
  };

  const saveJob = async () => {
    try {
      if (!jobForm) return;
      const schedule =
        jobForm.scheduleKind === "cron"
          ? { kind: "cron", expr: jobForm.cronExpr, tz: jobForm.cronTz }
          : jobForm.scheduleKind === "every"
          ? { kind: "every", everyMs: Number(jobForm.everyMinutes) * 60000 }
          : { kind: "at", atMs: jobForm.atTime ? new Date(jobForm.atTime).getTime() : Date.now() };

      const payload = {
        kind: jobForm.payloadKind,
        message: jobForm.payloadMessage,
        ...(jobForm.payloadModel ? { model: jobForm.payloadModel } : {}),
      };

      const updated = {
        ...jobBase,
        name: jobForm.name,
        enabled: !!jobForm.enabled,
        schedule,
        sessionTarget: jobForm.sessionTarget,
        ...(jobForm.agentId ? { agentId: jobForm.agentId } : {}),
        payload,
        delivery: {
          mode: jobForm.deliveryMode,
          channel: jobForm.deliveryChannel,
          to: jobForm.deliveryTo,
        },
      };

      const exists = updated.id && cronJobs.some((j) => j.id === updated.id);
      const res = await fetch("/api/cron", {
        method: exists ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      });
      if (!res.ok) throw new Error("Save failed");
      await fetchCronJobs();
      await fetchSchedule();
      setShowCronManager(false);
      setEditingJob(null);
      setJobForm(null);
      setJobBase(null);
    } catch (err: any) {
      setJobError(err?.message || "Save failed");
    }
  };

  const deleteJob = async (id: string) => {
    if (!confirm("Delete this job?")) return;
    await fetch("/api/cron", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    await fetchCronJobs();
    await fetchSchedule();
  };

  const toggleJob = async (job: CronJob) => {
    await fetch("/api/cron", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: job.id, enabled: !job.enabled }),
    });
    await fetchCronJobs();
    await fetchSchedule();
  };

  const assigneeColorMap: Record<string, string> = {
    kevbot: "#10b981",
    main: "#10b981",
  };

  const getAssigneeBadgeStyle = (assignee?: string) => {
    if (!assignee) return undefined;
    const key = assignee.toLowerCase();
    const color = assigneeColorMap[key];
    if (!color) return undefined;
    return {
      color,
      borderColor: `${color}66`,
      backgroundColor: `${color}1f`,
    } as const;
  };

  const handleDragStart = () => {
    isDraggingRef.current = true;
  };

  const handleDragEnd = (result: DropResult) => {
    isDraggingRef.current = false;

    const { destination, source } = result;
    if (!destination) return;
    if (
      destination.droppableId === source.droppableId &&
      destination.index === source.index
    ) {
      return;
    }

    const sourceStatus = source.droppableId as TaskStatus;
    const destinationStatus = destination.droppableId as TaskStatus;

    if (sourceStatus === destinationStatus) {
      const updatedColumn = reorder(
        tasksByStatus[sourceStatus],
        source.index,
        destination.index
      );
      const nextTasks: Task[] = [
        ...updatedColumn,
        ...tasks.filter((task) => task.status !== sourceStatus),
      ];
      setTasks(nextTasks);
      persistTasks(nextTasks);
      return;
    }

    const sourceTasks = Array.from(tasksByStatus[sourceStatus]);
    const destinationTasks = Array.from(tasksByStatus[destinationStatus]);
    const [moved] = sourceTasks.splice(source.index, 1);
    const updatedMoved = { ...moved, status: destinationStatus };
    destinationTasks.splice(destination.index, 0, updatedMoved);

    const nextTasks = [
      ...sourceTasks,
      ...destinationTasks,
      ...tasks.filter(
        (task) =>
          task.status !== sourceStatus && task.status !== destinationStatus
      ),
    ];

    setTasks(nextTasks);
    persistTasks(nextTasks);
  };

  const handleAddTask = () => {
    if (!newTaskTitle.trim()) return;
    
    const newTask: Task = {
      id: generateId(),
      title: newTaskTitle.trim(),
      description: newTaskDescription.trim() || undefined,
      status: newTaskStatus,
      createdAt: new Date().toISOString(),
      assignee: newTaskAssignee || undefined,
    };
    
    const updatedTasks = [...tasks, newTask];
    setTasks(updatedTasks);
    persistTasks(updatedTasks);

    setNewTaskTitle("");
    setNewTaskDescription("");
    setNewTaskStatus("todo");
    setNewTaskAssignee("");
    setShowAddModal(false);
  };

  const handleDeleteTask = (taskId: string) => {
    const updatedTasks = tasks.filter((task) => task.id !== taskId);
    setTasks(updatedTasks);
    persistTasks(updatedTasks);
  };

  const handleUpdateTask = (taskId: string, updates: Partial<Pick<Task, "title" | "description" | "assignee">>) => {
    const updatedTasks = tasks.map((t) => (t.id === taskId ? { ...t, ...updates } : t));
    setTasks(updatedTasks);
    persistTasks(updatedTasks);
    setSelectedTask((prev) => (prev ? { ...prev, ...updates } : null));
    setEditingTaskMode(false);
  };

  const handleAddGoal = () => {
    if (!newGoalText.trim()) return;
    const updatedGoals = {
      ...goals,
      [newGoalCategory]: [...goals[newGoalCategory], newGoalText.trim()],
    };
    setGoals(updatedGoals);
    persistGoals(updatedGoals);
    setNewGoalText("");
  };

  const handleUpdateGoal = (category: keyof Goals, index: number, newText: string) => {
    const updatedGoals = {
      ...goals,
      [category]: goals[category].map((g, i) => (i === index ? newText : g)),
    };
    setGoals(updatedGoals);
    persistGoals(updatedGoals);
    setEditingGoal(null);
    setEditingGoalText("");
  };

  const handleDeleteGoal = (category: keyof Goals, index: number) => {
    const updatedGoals = {
      ...goals,
      [category]: goals[category].filter((_, i) => i !== index),
    };
    setGoals(updatedGoals);
    persistGoals(updatedGoals);
  };

  return (
    <div className="min-h-screen bg-linear-bg text-linear-text">
      {/* Mobile edge swipe zone (secondary to floating menu button) */}
      {isMobile && !sidebarOpen && (
        <div
          className="fixed inset-y-0 left-0 z-30 w-6"
          onTouchStart={handleEdgeSwipeStart}
          onTouchMove={handleEdgeSwipeMove}
          onTouchEnd={handleEdgeSwipeEnd}
          aria-hidden="true"
        />
      )}

      {/* Backdrop for mobile sidebar */}
      {isMobile && sidebarOpen && (
        <button
          aria-label="Close menu"
          className="fixed inset-0 z-30 bg-black/40"
          onClick={closeSidebar}
        />
      )}

      {/* Linear-style Sidebar */}
      <aside className={`fixed left-0 top-0 z-40 h-full bg-linear-bg-secondary border-r border-linear-border flex flex-col transition-all duration-200 ${sidebarOpen ? 'w-56' : 'w-0 overflow-hidden border-r-0'}`}>
        {/* Logo */}
        <div className="h-14 flex items-center px-4 border-b border-linear-border">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-linear-accent flex items-center justify-center flex-shrink-0">
              <span className="text-white text-xs font-bold">K</span>
            </div>
            <span className="font-semibold text-sm tracking-tight whitespace-nowrap">Mission Control</span>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-3 px-2 space-y-1">
          <button
            onClick={() => handlePanelChange("none")}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              activePanel === "none"
                ? "bg-linear-bg-tertiary text-linear-text"
                : "text-linear-text-secondary hover:bg-linear-bg-tertiary hover:text-linear-text"
            }`}
          >
            <Icons.inbox />
            <span>Board</span>
          </button>
          
          <button
            onClick={() => handlePanelChange("goals")}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              activePanel === "goals"
                ? "bg-linear-bg-tertiary text-linear-text"
                : "text-linear-text-secondary hover:bg-linear-bg-tertiary hover:text-linear-text"
            }`}
          >
            <Icons.target />
            <span>Goals</span>
          </button>
          
          <button
            onClick={() => handlePanelChange("services")}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              activePanel === "services"
                ? "bg-linear-bg-tertiary text-linear-text"
                : "text-linear-text-secondary hover:bg-linear-bg-tertiary hover:text-linear-text"
            }`}
          >
            <Icons.settings />
            <span>Services</span>
          </button>

          <button
            onClick={() => handlePanelChange("calendar")}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              activePanel === "calendar"
                ? "bg-linear-bg-tertiary text-linear-text"
                : "text-linear-text-secondary hover:bg-linear-bg-tertiary hover:text-linear-text"
            }`}
          >
            <Icons.calendar />
            <span>Scheduled Tasks</span>
          </button>

          <button
            onClick={() => handlePanelChange("personalCalendar")}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              activePanel === "personalCalendar"
                ? "bg-linear-bg-tertiary text-linear-text"
                : "text-linear-text-secondary hover:bg-linear-bg-tertiary hover:text-linear-text"
            }`}
          >
            <Icons.calendar />
            <span>Calendar</span>
          </button>

          <button
            onClick={() => handlePanelChange("twitter")}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              activePanel === "twitter"
                ? "bg-linear-bg-tertiary text-linear-text"
                : "text-linear-text-secondary hover:bg-linear-bg-tertiary hover:text-linear-text"
            }`}
          >
            <Icons.twitter />
            <span>Twitter</span>
          </button>

          <button
            onClick={() => { handlePanelChange("kpi"); fetchKPIData(); }}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              activePanel === "kpi"
                ? "bg-linear-bg-tertiary text-linear-text"
                : "text-linear-text-secondary hover:bg-linear-bg-tertiary hover:text-linear-text"
            }`}
          >
            <Icons.chart />
            <span>KPI Dashboard</span>
          </button>

          <button
            onClick={() => { handlePanelChange("ga"); fetchGAData(); }}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              activePanel === "ga"
                ? "bg-linear-bg-tertiary text-linear-text"
                : "text-linear-text-secondary hover:bg-linear-bg-tertiary hover:text-linear-text"
            }`}
          >
            <Icons.chart />
            <span>Site Analytics</span>
          </button>

          <button
            onClick={() => handlePanelChange("wordpress")}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              activePanel === "wordpress"
                ? "bg-linear-bg-tertiary text-linear-text"
                : "text-linear-text-secondary hover:bg-linear-bg-tertiary hover:text-linear-text"
            }`}
          >
            <Icons.wordpress />
            <span>WordPress</span>
          </button>

          <button
            onClick={() => handlePanelChange("reminders")}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              activePanel === "reminders"
                ? "bg-linear-bg-tertiary text-linear-text"
                : "text-linear-text-secondary hover:bg-linear-bg-tertiary hover:text-linear-text"
            }`}
          >
            <Icons.bell />
            <span>Reminders</span>
          </button>

          <button
            onClick={() => handlePanelChange("ideas")}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              activePanel === "ideas"
                ? "bg-linear-bg-tertiary text-linear-text"
                : "text-linear-text-secondary hover:bg-linear-bg-tertiary hover:text-linear-text"
            }`}
          >
            <Icons.idea />
            <span>Idea Vault</span>
          </button>

          <button
            onClick={() => handlePanelChange("memory")}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              activePanel === "memory"
                ? "bg-linear-bg-tertiary text-linear-text"
                : "text-linear-text-secondary hover:bg-linear-bg-tertiary hover:text-linear-text"
            }`}
          >
            <Icons.brain />
            <span>Memory</span>
          </button>

          <button
            onClick={() => handlePanelChange("agents")}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              activePanel === "agents"
                ? "bg-linear-bg-tertiary text-linear-text"
                : "text-linear-text-secondary hover:bg-linear-bg-tertiary hover:text-linear-text"
            }`}
          >
            <Icons.robot />
            <span>Agents</span>
          </button>


          <button
            onClick={() => { handlePanelChange("bitches"); fetchBitches(); }}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              activePanel === "bitches"
                ? "bg-linear-bg-tertiary text-linear-text"
                : "text-linear-text-secondary hover:bg-linear-bg-tertiary hover:text-linear-text"
            }`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
            </svg>
            <span>Contacts</span>
            {newBitchesCount > 0 && (
              <span className="ml-auto bg-pink-500 text-white text-xs px-1.5 py-0.5 rounded-full">{newBitchesCount}</span>
            )}
          </button>
        </nav>

        {/* User section */}
        <div className="p-3 border-t border-linear-border">
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-linear-bg-tertiary cursor-pointer transition-colors">
            <div className="w-6 h-6 rounded-full bg-linear-accent flex items-center justify-center">
              <span className="text-white text-xs font-medium">K</span>
            </div>
            <span className="text-sm text-linear-text-secondary">Kevin</span>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className={`min-h-screen transition-all duration-200 ${sidebarOpen && !isMobile ? 'ml-56' : 'ml-0'}`}>
        {/* Header */}
        <header className="min-h-14 border-b border-linear-border flex flex-wrap items-center justify-between gap-2 px-3 sm:px-6 py-2 bg-linear-bg">
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            <button
              onClick={toggleSidebar}
              className="p-1.5 rounded-md hover:bg-linear-bg-tertiary text-linear-text-secondary hover:text-linear-text transition-colors"
              title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
            >
              {sidebarOpen ? <Icons.chevronLeft /> : <Icons.menu />}
            </button>
            <h1 className="text-sm font-medium text-linear-text">
              {activePanel === "goals" ? "Goals" : activePanel === "services" ? "System Services" : activePanel === "calendar" ? "Scheduled Tasks" : activePanel === "personalCalendar" ? "Calendar" : activePanel === "twitter" ? "Twitter" : activePanel === "kpi" ? "@kevteachesai KPIs" : activePanel === "ga" ? "kevteaches.ai Analytics" : activePanel === "wordpress" ? "WordPress" : activePanel === "reminders" ? "Reminders" : activePanel === "ideas" ? "Idea Vault" : activePanel === "memory" ? "Memory" : activePanel === "agents" ? "Agents & Subagents" : activePanel === "bitches" ? "Contacts" : "My Tasks"}
            </h1>
            {activePanel === "none" && (
              <span className="text-xs text-linear-text-tertiary">{tasks.length} tasks</span>
            )}
          </div>
          
          <div className="flex w-full sm:w-auto items-center gap-2 sm:gap-3 justify-end">
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-md bg-linear-bg-secondary border border-linear-border text-xs text-linear-text-secondary">
              <Icons.search />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={
                  activePanel === "twitter"
                    ? "Search tweets"
                    : activePanel === "wordpress"
                    ? "Search files"
                    : activePanel === "services"
                    ? "Search services"
                    : activePanel === "reminders"
                    ? "Search reminders"
                    : activePanel === "ideas"
                    ? "Search ideas"
                    : activePanel === "goals"
                    ? "Search goals"
                    : activePanel === "calendar"
                    ? "Search schedule"
                    : "Search issues"
                }
                className="bg-transparent outline-none text-xs text-linear-text-secondary placeholder:text-linear-text-tertiary w-40"
              />
              <kbd className="px-1.5 py-0.5 rounded bg-linear-bg-tertiary text-linear-text-tertiary text-[10px]">⌘K</kbd>
            </div>

            {activePanel === "calendar" && (
              <button
                onClick={() => setShowCronManager(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-linear-border bg-linear-bg-secondary hover:bg-linear-bg-tertiary text-linear-text text-sm font-medium transition-colors"
              >
                <Icons.settings />
                <span>Manage Jobs</span>
              </button>
            )}
            
            {activePanel === "ideas" && (
              <button
                onClick={openNewIdeaModal}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-linear-accent hover:bg-linear-accent-hover text-white text-sm font-medium transition-colors"
              >
                <Icons.plus />
                <span>New idea</span>
              </button>
            )}

            {activePanel === "none" && (
              <button
                onClick={() => setShowAddModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-linear-accent hover:bg-linear-accent-hover text-white text-sm font-medium transition-colors"
              >
                <Icons.plus />
                <span>New task</span>
              </button>
            )}
          </div>
        </header>

        {/* Content Area */}
        <div className="p-3 sm:p-6 overflow-x-hidden">
          {activePanel === "services" && (
            <div className="animate-fadeIn">
              <div className="rounded-lg border border-linear-border bg-linear-bg-secondary overflow-hidden">
                <div className="overflow-x-auto" style={{ WebkitOverflowScrolling: "touch" }}>
                  <table className="w-full min-w-[620px]">
                  <thead>
                    <tr className="border-b border-linear-border bg-linear-bg-tertiary">
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-linear-text-secondary uppercase tracking-wider">Service</th>
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-linear-text-secondary uppercase tracking-wider">Description</th>
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-linear-text-secondary uppercase tracking-wider">Status</th>
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-linear-text-secondary uppercase tracking-wider">Port(s)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredServices.map((service, index) => (
                      <tr key={index} className="border-b border-linear-border last:border-0 hover:bg-linear-bg-hover cursor-pointer" onClick={() => setSelectedService(service)}>
                        <td className="px-4 py-3 text-sm text-linear-text">{service.name}</td>
                        <td className="px-4 py-3 text-sm text-linear-text-secondary whitespace-normal break-words max-w-[280px]">{service.description}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1.5 text-xs ${
                            service.status === "running" ? "text-linear-success" : 
                            service.status === "failed" ? "text-linear-error" : "text-linear-text-tertiary"
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${
                              service.status === "running" ? "bg-linear-success" : 
                              service.status === "failed" ? "bg-linear-error" : "bg-linear-text-tertiary"
                            } ${service.status === "running" ? "animate-pulse" : ""}`} />
                            {service.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-linear-text-secondary">
                          {service.ports && service.ports.length > 0 ? service.ports.join(", ") : "—"}
                        </td>
                      </tr>
                    ))}
                    {filteredServices.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-center text-sm text-linear-text-tertiary">
                          Loading services...
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
                </div>
              </div>
            </div>
          )}

          {activePanel === "services" && selectedService && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
              onMouseDown={(e) => { if (e.target === e.currentTarget) setSelectedService(null); }}
            >
              <div className="w-full max-w-[calc(100vw-2rem)] max-w-xl rounded-lg border border-linear-border bg-linear-bg-secondary shadow-lg" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between px-4 py-3 border-b border-linear-border">
                  <div>
                    <div className="text-sm font-medium text-linear-text">{selectedService.name}</div>
                    <div className="text-xs text-linear-text-tertiary">Service details</div>
                  </div>
                  <button
                    onClick={() => setSelectedService(null)}
                    className="text-linear-text-tertiary hover:text-linear-text"
                  >
                    <Icons.x />
                  </button>
                </div>
                <div className="p-4 space-y-3 text-sm">
                  <div>
                    <div className="text-xs uppercase tracking-wider text-linear-text-tertiary mb-1">Description</div>
                    <div className="text-linear-text-secondary">{selectedService.description}</div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-xs uppercase tracking-wider text-linear-text-tertiary mb-1">Status</div>
                      <div className="text-linear-text">{selectedService.status}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wider text-linear-text-tertiary mb-1">Listening Port(s)</div>
                      <div className="text-linear-text">{selectedService.ports && selectedService.ports.length > 0 ? selectedService.ports.join(", ") : "None detected"}</div>
                    </div>
                  </div>
                  {selectedService.details && (
                    <div>
                      <div className="text-xs uppercase tracking-wider text-linear-text-tertiary mb-1">Process</div>
                      <div className="text-linear-text-secondary">{selectedService.details}</div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activePanel === "calendar" && (
            <div className="animate-fadeIn space-y-4">
              {/* Agent Heartbeats */}
              <div className="rounded-lg border border-linear-border bg-linear-bg-secondary overflow-hidden">
                <div className="px-4 py-3 border-b border-linear-border bg-linear-bg-tertiary flex items-center justify-between">
                  <h3 className="text-sm font-medium text-linear-text">KevBot Heartbeat</h3>
                  <button
                    onClick={fetchHeartbeats}
                    className="text-xs text-linear-text-tertiary hover:text-linear-text transition-colors"
                  >
                    Refresh
                  </button>
                </div>
                <div className="p-3">
                  <div className="grid gap-2">
                    {heartbeats.map((hb) => (
                      <div
                        key={hb.agentId}
                        className={`rounded-lg border p-3 transition-colors ${
                          hb.enabled
                            ? "border-linear-accent/30 bg-linear-accent/5"
                            : "border-linear-border bg-linear-bg"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-lg">{hb.agentEmoji}</span>
                            <span className="text-sm font-medium text-linear-text">{hb.agentName}</span>
                          </div>
                          <button
                            onClick={() => toggleHeartbeat(hb.agentId, !hb.enabled)}
                            className={`relative w-10 h-5 rounded-full transition-colors ${
                              hb.enabled ? "bg-linear-accent" : "bg-linear-bg-tertiary"
                            }`}
                          >
                            <span
                              className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                                hb.enabled ? "left-5" : "left-0.5"
                              }`}
                            />
                          </button>
                        </div>

                        <div className="mb-3 grid gap-2 md:grid-cols-2 text-xs">
                          <div className="rounded border border-linear-border bg-linear-bg/60 px-2 py-1.5">
                            <div className="text-[10px] uppercase tracking-wider text-linear-text-tertiary">Last ran</div>
                            <div className="text-linear-text-secondary">
                              {hb.lastRun ? new Date(hb.lastRun).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Never"}
                            </div>
                          </div>
                          <div className="rounded border border-linear-border bg-linear-bg/60 px-2 py-1.5">
                            <div className="text-[10px] uppercase tracking-wider text-linear-text-tertiary">Last status</div>
                            <div className={hb.lastStatus === "ok" ? "text-linear-success" : hb.lastStatus === "error" ? "text-linear-error" : "text-linear-text-secondary"}>
                              {hb.lastStatus === "ok" ? "Success" : hb.lastStatus === "error" ? "Failed" : hb.lastStatus || "No runs yet"}
                            </div>
                          </div>
                        </div>
                        
                        {editingHeartbeat === hb.agentId ? (
                          <div className="space-y-3">
                            <div className="grid gap-3 md:grid-cols-2">
                              <label className="text-xs text-linear-text-tertiary">
                                Interval minutes
                                <input
                                  type="number"
                                  min="1"
                                  max="1440"
                                  value={heartbeatFreq}
                                  onChange={(e) => setHeartbeatFreq(parseInt(e.target.value) || 30)}
                                  className="mt-1 w-full px-2 py-1.5 text-xs bg-linear-bg border border-linear-border rounded text-linear-text"
                                />
                              </label>
                              <label className="text-xs text-linear-text-tertiary">
                                Model
                                <input
                                  value={heartbeatModel}
                                  onChange={(e) => setHeartbeatModel(e.target.value)}
                                  className="mt-1 w-full px-2 py-1.5 text-xs bg-linear-bg border border-linear-border rounded text-linear-text"
                                />
                              </label>
                            </div>
                            <label className="block text-xs text-linear-text-tertiary">
                              Cron payload message
                              <textarea
                                value={heartbeatPayloadMessage}
                                onChange={(e) => setHeartbeatPayloadMessage(e.target.value)}
                                rows={5}
                                className="mt-1 w-full px-2 py-1.5 text-xs bg-linear-bg border border-linear-border rounded text-linear-text font-mono"
                              />
                            </label>
                            {hb.promptPath && (
                              <label className="block text-xs text-linear-text-tertiary">
                                Prompt file: {hb.promptPath}
                                <textarea
                                  value={heartbeatPromptText}
                                  onChange={(e) => setHeartbeatPromptText(e.target.value)}
                                  rows={12}
                                  className="mt-1 w-full px-2 py-1.5 text-xs bg-linear-bg border border-linear-border rounded text-linear-text font-mono"
                                />
                              </label>
                            )}
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => updateHeartbeatDetails(hb)}
                                className="px-2 py-1 text-xs bg-linear-accent text-white rounded hover:bg-linear-accent/90"
                              >
                                Save
                              </button>
                              <button
                                onClick={() => setEditingHeartbeat(null)}
                                className="px-2 py-1 text-xs text-linear-text-tertiary hover:text-linear-text"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <div className="grid gap-2 md:grid-cols-3 text-xs text-linear-text-tertiary">
                              <span>{hb.frequencyMinutes > 0 ? `Every ${hb.frequencyMinutes} min` : "Not configured"}</span>
                              <span>Model: {hb.model || "default"}</span>
                              <span>{hb.promptPath ? `Prompt: ${hb.promptPath.split("/").pop()}` : "Inline prompt"}</span>
                            </div>
                            <div className="rounded border border-linear-border bg-linear-bg/60 p-2 text-[11px] text-linear-text-secondary line-clamp-3 whitespace-pre-wrap">
                              {hb.payloadMessage || "No payload message"}
                            </div>
                            <button
                              onClick={() => {
                                setHeartbeatFreq(hb.frequencyMinutes || 30);
                                setHeartbeatModel(hb.model || "minimax/MiniMax-M2.7");
                                setHeartbeatPayloadMessage(hb.payloadMessage || "");
                                setHeartbeatPromptText(hb.promptText || "");
                                setEditingHeartbeat(hb.agentId);
                              }}
                              className="text-xs text-linear-accent hover:text-linear-accent/80"
                            >
                              View / Edit details
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Schedule Views */}
              <div className="rounded-lg border border-linear-border bg-linear-bg-secondary overflow-hidden">
                <div className="px-4 py-3 border-b border-linear-border bg-linear-bg-tertiary flex items-center justify-between gap-3">
                  <h3 className="text-sm font-medium text-linear-text">Schedule</h3>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setScheduleViewMode("week")}
                      className={`px-2.5 py-1 text-xs rounded border ${scheduleViewMode === "week" ? "border-linear-accent text-linear-accent" : "border-linear-border text-linear-text-tertiary"}`}
                    >
                      Week
                    </button>
                    <button
                      onClick={() => setScheduleViewMode("calendar")}
                      className={`px-2.5 py-1 text-xs rounded border ${scheduleViewMode === "calendar" ? "border-linear-accent text-linear-accent" : "border-linear-border text-linear-text-tertiary"}`}
                    >
                      Calendar
                    </button>
                  </div>
                </div>

                {scheduleViewMode === "week" ? (
                  Object.keys(scheduleData).length === 0 ? (
                    <div className="px-4 py-8 text-center text-sm text-linear-text-tertiary">Loading schedule...</div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-7 gap-3 p-3">
                      {getWeekDates().map((date) => {
                        const key = formatLocalYmd(date);
                        const jobs = scheduleData[key] || [];
                        const filteredJobs = searchValue
                          ? jobs.filter((job) => matchesSearch(job.name) || matchesSearch(job.id) || matchesSearch(job.lastStatus || ""))
                          : jobs;
                        return (
                          <div key={key} className="min-h-[550px] rounded-lg border border-linear-border bg-linear-bg-tertiary/40 shadow-sm">
                            <div className="px-3 py-2 border-b border-linear-border text-xs font-medium text-linear-text-secondary">
                              {date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                            </div>
                            <div className="p-2 space-y-2 max-h-[500px] overflow-y-auto">
                              {filteredJobs.length === 0 ? (
                                <div className="text-xs text-linear-text-tertiary">No tasks</div>
                              ) : (
                                filteredJobs.map((job) => (
                                  <div
                                    key={job.id}
                                    onClick={() => {
                                      const fullJob = cronJobs.find((cj) => cj.id === job.id);
                                      if (fullJob) setSelectedCronJob(fullJob);
                                    }}
                                    className={`border rounded-md px-2 py-1.5 shadow-sm cursor-pointer hover:opacity-80 transition-opacity ${colorForName(job.name)} ${job.enabled ? "" : "opacity-50"}`}
                                  >
                                    <div className="flex items-center justify-between gap-2">
                                      <div className="flex items-center gap-2 min-w-0">
                                        <span className={`w-2 h-2 rounded-full ${job.enabled ? "bg-linear-accent" : "bg-linear-text-tertiary"}`} />
                                        <span className="text-xs truncate">{job.name}</span>
                                      </div>
                                      <span className="text-[10px] text-linear-text-tertiary">
                                        {job.nextRun ? new Date(job.nextRun).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "—"}
                                      </span>
                                    </div>
                                  </div>
                                ))
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )
                ) : (
                  <div className="p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <button
                        onClick={() => setScheduleMonth(new Date(scheduleMonth.getFullYear(), scheduleMonth.getMonth() - 1, 1))}
                        className="px-2 py-1 text-xs rounded border border-linear-border text-linear-text-secondary"
                      >
                        ← Prev
                      </button>
                      <div className="text-sm text-linear-text font-medium">
                        {scheduleMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
                      </div>
                      <button
                        onClick={() => setScheduleMonth(new Date(scheduleMonth.getFullYear(), scheduleMonth.getMonth() + 1, 1))}
                        className="px-2 py-1 text-xs rounded border border-linear-border text-linear-text-secondary"
                      >
                        Next →
                      </button>
                    </div>
                    <div className="grid grid-cols-7 gap-2 text-[11px] text-linear-text-tertiary px-1">
                      {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d) => <div key={d}>{d}</div>)}
                    </div>
                    <div className="grid grid-cols-7 gap-2">
                      {(() => {
                        const first = new Date(scheduleMonth.getFullYear(), scheduleMonth.getMonth(), 1);
                        const last = new Date(scheduleMonth.getFullYear(), scheduleMonth.getMonth() + 1, 0);
                        const cells: Array<Date | null> = [];
                        for (let i = 0; i < first.getDay(); i++) cells.push(null);
                        for (let d = 1; d <= last.getDate(); d++) cells.push(new Date(scheduleMonth.getFullYear(), scheduleMonth.getMonth(), d));
                        while (cells.length % 7 !== 0) cells.push(null);
                        return cells.map((day, idx) => {
                          if (!day) return <div key={`empty-${idx}`} className="min-h-[92px] rounded border border-transparent" />;
                          const key = formatLocalYmd(day);
                          const dayData = scheduleCalendarData[key] || { scheduled: [], runs: [] };
                          const merged = [
                            ...dayData.scheduled.map((x: any) => ({ ...x, _kind: 'scheduled' })),
                            ...dayData.runs.map((x: any) => ({ ...x, _kind: 'run' })),
                          ].sort((a: any, b: any) => (a.timeMs || 0) - (b.timeMs || 0));
                          const preview = merged.slice(0, 3);
                          return (
                            <button
                              key={key}
                              onClick={() => setSelectedScheduleDay(key)}
                              className="min-h-[92px] rounded border border-linear-border bg-linear-bg-tertiary/30 p-1 text-left hover:border-linear-accent/50"
                            >
                              <div className="text-xs text-linear-text-secondary mb-1">{day.getDate()}</div>
                              <div className="space-y-1">
                                {preview.length === 0 ? (
                                  <div className="text-[10px] text-linear-text-tertiary">No tasks</div>
                                ) : preview.map((item: any, i: number) => (
                                  <div key={`${item.id}-${item.timeMs}-${i}`} className="text-[10px] truncate">
                                    <span className={item._kind === 'run' ? 'text-linear-success' : 'text-linear-accent'}>{item._kind === 'run' ? 'Ran' : 'Set'}</span>
                                    <span className="text-linear-text-secondary"> · {item.name}</span>
                                  </div>
                                ))}
                                {merged.length > 3 && <div className="text-[10px] text-linear-text-tertiary">+{merged.length - 3} more</div>}
                              </div>
                            </button>
                          );
                        });
                      })()}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {activePanel === "personalCalendar" && (
            <div className="animate-fadeIn space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-linear-text">Calendar ({calendarEvents.filter((e) => parseLocalDate(e.date) >= new Date(new Date().toDateString())).length} upcoming)</h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={fetchCalendarEvents}
                    className="px-3 py-1.5 rounded-md border border-linear-border bg-linear-bg-secondary text-xs text-linear-text-secondary hover:border-linear-accent/50"
                  >
                    Refresh
                  </button>
                  <button
                    onClick={() => setShowAddEventModal(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-linear-accent hover:bg-linear-accent-hover text-white text-sm font-medium transition-colors"
                  >
                    <Icons.plus />
                    <span>Add Event</span>
                  </button>
                </div>
              </div>

              {/* Upcoming Events */}
              <div className="rounded-lg border border-linear-border bg-linear-bg-secondary overflow-hidden">
                <div className="px-4 py-2 border-b border-linear-border text-xs font-medium text-linear-text-secondary uppercase">Upcoming Events</div>
                <div className="divide-y divide-linear-border">
                  {calendarEvents
                    .filter((e) => parseLocalDate(e.date) >= new Date(new Date().toDateString()))
                    .sort((a, b) => parseLocalDate(a.date).getTime() - parseLocalDate(b.date).getTime())
                    .slice(0, 10)
                    .map((event) => (
                      <div key={event.id} className="px-4 py-3 flex items-center justify-between hover:bg-linear-bg-hover group">
                        <div className="flex items-center gap-4">
                          <div className="text-center min-w-[50px]">
                            <div className="text-xs text-linear-text-tertiary uppercase">
                              {parseLocalDate(event.date).toLocaleDateString("en-US", { month: "short" })}
                            </div>
                            <div className="text-lg font-semibold text-linear-text">
                              {parseLocalDate(event.date).getDate()}
                            </div>
                          </div>
                          <div>
                            <div className="text-sm font-medium text-linear-text">{event.title}</div>
                            <div className="text-xs text-linear-text-tertiary">
                              {event.time && <span>{event.time}</span>}
                              {event.time && event.duration && <span> · {event.duration} min</span>}
                              {event.location && <span> · {event.location}</span>}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                          <button
                            onClick={() => openEditEvent(event)}
                            className="p-1 rounded hover:bg-linear-bg-tertiary text-linear-text-tertiary hover:text-linear-text"
                          >
                            <Icons.edit />
                          </button>
                          <button
                            onClick={() => deleteCalendarEvent(event.id)}
                            className="p-1 rounded hover:bg-linear-bg-tertiary text-linear-text-tertiary hover:text-linear-error"
                          >
                            <Icons.trash />
                          </button>
                        </div>
                      </div>
                    ))}
                  {calendarEvents.filter((e) => parseLocalDate(e.date) >= new Date(new Date().toDateString())).length === 0 && (
                    <div className="px-4 py-8 text-center text-sm text-linear-text-tertiary">
                      No upcoming events
                    </div>
                  )}
                </div>
              </div>

              {/* Past Events */}
              <div className="rounded-lg border border-linear-border bg-linear-bg-secondary overflow-hidden">
                <div className="px-4 py-2 border-b border-linear-border text-xs font-medium text-linear-text-secondary uppercase">Past Events</div>
                <div className="divide-y divide-linear-border max-h-[300px] overflow-y-auto">
                  {calendarEvents
                    .filter((e) => parseLocalDate(e.date) < new Date(new Date().toDateString()))
                    .sort((a, b) => parseLocalDate(b.date).getTime() - parseLocalDate(a.date).getTime())
                    .map((event) => (
                      <div key={event.id} className="px-4 py-2 flex items-center justify-between hover:bg-linear-bg-hover group opacity-60">
                        <div className="flex items-center gap-4">
                          <div className="text-xs text-linear-text-tertiary min-w-[80px]">
                            {parseLocalDate(event.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          </div>
                          <div className="text-sm text-linear-text-secondary">{event.title}</div>
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                          <button
                            onClick={() => openEditEvent(event)}
                            className="p-1 rounded hover:bg-linear-bg-tertiary text-linear-text-tertiary hover:text-linear-text"
                          >
                            <Icons.edit />
                          </button>
                          <button
                            onClick={() => deleteCalendarEvent(event.id)}
                            className="p-1 rounded hover:bg-linear-bg-tertiary text-linear-text-tertiary hover:text-linear-error"
                          >
                            <Icons.trash />
                          </button>
                        </div>
                      </div>
                    ))}
                  {calendarEvents.filter((e) => parseLocalDate(e.date) < new Date(new Date().toDateString())).length === 0 && (
                    <div className="px-4 py-6 text-center text-xs text-linear-text-tertiary">
                      No past events
                    </div>
                  )}
                </div>
              </div>

              {/* Add/Edit Event Modal */}
              {showAddEventModal && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
                  <div className="w-full max-w-md bg-linear-bg-secondary rounded-lg border border-linear-border shadow-linear-lg animate-fadeIn">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-linear-border">
                      <h2 className="text-sm font-medium text-linear-text">{editingEvent ? "Edit Event" : "Add Event"}</h2>
                      <button
                        onClick={() => { setShowAddEventModal(false); setEditingEvent(null); }}
                        className="p-1 rounded hover:bg-linear-bg-tertiary text-linear-text-tertiary hover:text-linear-text-secondary"
                      >
                        <Icons.x />
                      </button>
                    </div>
                    <div className="p-4 space-y-3">
                      <div>
                        <label className="block text-xs font-medium text-linear-text-secondary mb-1">Title</label>
                        <input
                          type="text"
                          value={newEventTitle}
                          onChange={(e) => setNewEventTitle(e.target.value)}
                          className="w-full px-3 py-2 bg-linear-bg border border-linear-border rounded-md text-sm text-linear-text focus:border-linear-accent focus:outline-none"
                          placeholder="Event title"
                          autoFocus
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-linear-text-secondary mb-1">Date</label>
                          <input
                            type="date"
                            value={newEventDate}
                            onChange={(e) => setNewEventDate(e.target.value)}
                            className="w-full px-3 py-2 bg-linear-bg border border-linear-border rounded-md text-sm text-linear-text focus:border-linear-accent focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-linear-text-secondary mb-1">Time (optional)</label>
                          <input
                            type="time"
                            value={newEventTime}
                            onChange={(e) => setNewEventTime(e.target.value)}
                            className="w-full px-3 py-2 bg-linear-bg border border-linear-border rounded-md text-sm text-linear-text focus:border-linear-accent focus:outline-none"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-linear-text-secondary mb-1">Duration (min)</label>
                          <input
                            type="number"
                            value={newEventDuration}
                            onChange={(e) => setNewEventDuration(e.target.value)}
                            className="w-full px-3 py-2 bg-linear-bg border border-linear-border rounded-md text-sm text-linear-text focus:border-linear-accent focus:outline-none"
                            placeholder="60"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-linear-text-secondary mb-1">Location</label>
                          <input
                            type="text"
                            value={newEventLocation}
                            onChange={(e) => setNewEventLocation(e.target.value)}
                            className="w-full px-3 py-2 bg-linear-bg border border-linear-border rounded-md text-sm text-linear-text focus:border-linear-accent focus:outline-none"
                            placeholder="Optional"
                          />
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-linear-border bg-linear-bg-tertiary rounded-b-lg">
                      <button
                        onClick={() => { setShowAddEventModal(false); setEditingEvent(null); }}
                        disabled={isSavingCalendarEvent}
                        className="px-3 py-1.5 text-sm text-linear-text-secondary hover:text-linear-text transition-colors disabled:opacity-50"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={editingEvent ? updateCalendarEvent : addCalendarEvent}
                        disabled={isSavingCalendarEvent || !newEventTitle.trim() || !newEventDate}
                        className="px-3 py-1.5 bg-linear-accent hover:bg-linear-accent-hover disabled:opacity-50 text-white text-sm font-medium rounded-md transition-colors"
                      >
                        {isSavingCalendarEvent ? (editingEvent ? "Saving…" : "Adding…") : (editingEvent ? "Save Changes" : "Add Event")}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {activePanel === "twitter" && (
            <div className="animate-fadeIn space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <h3 className="text-sm font-medium text-linear-text">Twitter Queue</h3>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-1 text-xs text-linear-text-secondary">
                    <input
                      type="checkbox"
                      checked={showPosted}
                      onChange={(e) => setShowPosted(e.target.checked)}
                    />
                    Show posted
                  </label>
                  <label className="flex items-center gap-1 text-xs text-linear-text-secondary">
                    Per page
                    <select
                      value={twitterPageSize}
                      onChange={(e) => setTwitterPageSize(Number(e.target.value))}
                      className="rounded-md border border-linear-border bg-linear-bg-secondary px-2 py-1 text-xs text-linear-text"
                    >
                      {[10, 25, 50, 100].map((size) => (
                        <option key={size} value={size}>{size}</option>
                      ))}
                    </select>
                  </label>
                  <button
                    onClick={fetchTwitterItems}
                    className="px-3 py-1.5 rounded-md border border-linear-border bg-linear-bg-secondary text-xs text-linear-text-secondary"
                  >
                    Refresh
                  </button>
                </div>
              </div>
              <div className="rounded-lg border border-linear-border bg-linear-bg-secondary overflow-hidden">
                <div className="overflow-x-auto" style={{ WebkitOverflowScrolling: "touch" }}>
                  <table className="w-full min-w-[760px]">
                  <thead>
                    <tr className="border-b border-linear-border bg-linear-bg-tertiary">
                      <th 
                        onClick={() => setTwitterSort(s => ({ col: "date", dir: s.col === "date" && s.dir === "asc" ? "desc" : "asc" }))}
                        className="text-left px-4 py-2.5 text-xs font-medium text-linear-text-secondary uppercase tracking-wider cursor-pointer hover:text-linear-text select-none"
                      >
                        <span className="inline-flex items-center gap-1">Date {twitterSort.col === "date" && (twitterSort.dir === "asc" ? <Icons.sortAsc /> : <Icons.sortDesc />)}</span>
                      </th>
                      <th 
                        onClick={() => setTwitterSort(s => ({ col: "file", dir: s.col === "file" && s.dir === "asc" ? "desc" : "asc" }))}
                        className="text-left px-4 py-2.5 text-xs font-medium text-linear-text-secondary uppercase tracking-wider cursor-pointer hover:text-linear-text select-none"
                      >
                        <span className="inline-flex items-center gap-1">File {twitterSort.col === "file" && (twitterSort.dir === "asc" ? <Icons.sortAsc /> : <Icons.sortDesc />)}</span>
                      </th>
                      <th 
                        onClick={() => setTwitterSort(s => ({ col: "status", dir: s.col === "status" && s.dir === "asc" ? "desc" : "asc" }))}
                        className="text-left px-4 py-2.5 text-xs font-medium text-linear-text-secondary uppercase tracking-wider cursor-pointer hover:text-linear-text select-none"
                      >
                        <span className="inline-flex items-center gap-1">Status {twitterSort.col === "status" && (twitterSort.dir === "asc" ? <Icons.sortAsc /> : <Icons.sortDesc />)}</span>
                      </th>
                      <th 
                        onClick={() => setTwitterSort(s => ({ col: "preview", dir: s.col === "preview" && s.dir === "asc" ? "desc" : "asc" }))}
                        className="text-left px-4 py-2.5 text-xs font-medium text-linear-text-secondary uppercase tracking-wider cursor-pointer hover:text-linear-text select-none"
                      >
                        <span className="inline-flex items-center gap-1">Preview {twitterSort.col === "preview" && (twitterSort.dir === "asc" ? <Icons.sortAsc /> : <Icons.sortDesc />)}</span>
                      </th>
                      <th className="text-right px-4 py-2.5 text-xs font-medium text-linear-text-secondary uppercase tracking-wider">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {twitterPageItems.map((item) => (
                      <tr key={item.id} className="border-b border-linear-border last:border-0 hover:bg-linear-bg-hover cursor-pointer" onClick={() => setSelectedTweet(item)}>
                        <td className="px-4 py-3 text-xs text-linear-text-secondary">{item.date}</td>
                        <td className="px-4 py-3 text-sm text-linear-text">{item.filename}</td>
                        <td className="px-4 py-3 text-xs">
                          {item.status === "posted" ? (
                            <span className="inline-flex items-center gap-1.5 text-linear-success">
                              <span className="w-1.5 h-1.5 rounded-full bg-linear-success" />
                              {item.tweetUrl ? (
                                <a href={item.tweetUrl} target="_blank" rel="noreferrer" className="underline">
                                  Posted
                                </a>
                              ) : (
                                "Posted"
                              )}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-linear-text-tertiary">
                              <span className="w-1.5 h-1.5 rounded-full bg-linear-text-tertiary" />
                              Queued
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-linear-text-secondary whitespace-normal break-words max-w-[320px]">
                          {item.text?.slice(0, 120)}{item.text?.length > 120 ? "…" : ""}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={(e) => { e.stopPropagation(); postTweet(item.text || "", item.id); }}
                            disabled={!!isPostingTweet || item.status === "posted"}
                            className="px-3 py-1.5 rounded-md bg-linear-accent hover:bg-linear-accent-hover text-white text-xs font-medium disabled:opacity-50"
                          >
                            {item.status === "posted"
                              ? "Posted"
                              : isPostingTweet === item.id
                              ? "Posting…"
                              : "Post"}
                          </button>
                        </td>
                      </tr>
                    ))}
                    {twitterItemsView.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-sm text-linear-text-tertiary">
                          No tweets found
                        </td>
                      </tr>
                    )}
                  </tbody>
                  </table>
                </div>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-linear-text-secondary">
                <span>
                  Showing {twitterItemsView.length === 0 ? 0 : (Math.min(twitterPage, twitterTotalPages) - 1) * twitterPageSize + 1}
                  –{Math.min(Math.min(twitterPage, twitterTotalPages) * twitterPageSize, twitterItemsView.length)} of {twitterItemsView.length}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setTwitterPage((p) => Math.max(1, p - 1))}
                    disabled={Math.min(twitterPage, twitterTotalPages) <= 1}
                    className="px-2 py-1 rounded-md border border-linear-border bg-linear-bg-secondary disabled:opacity-50"
                  >
                    Prev
                  </button>
                  <span>Page {Math.min(twitterPage, twitterTotalPages)} / {twitterTotalPages}</span>
                  <button
                    onClick={() => setTwitterPage((p) => Math.min(twitterTotalPages, p + 1))}
                    disabled={Math.min(twitterPage, twitterTotalPages) >= twitterTotalPages}
                    className="px-2 py-1 rounded-md border border-linear-border bg-linear-bg-secondary disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          )}

          {activePanel === "kpi" && (
            <div className="animate-fadeIn space-y-4">
              <div className="flex flex-col gap-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <h3 className="text-sm font-medium text-linear-text">@kevteachesai KPI Dashboard</h3>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => {
                        const end = new Date();
                        const start = new Date();
                        start.setDate(end.getDate() - 6);
                        const startStr = formatLocalYmd(start);
                        const endStr = formatLocalYmd(end);
                        setKpiDateRange({ start: startStr, end: endStr });
                        fetchKPIData(startStr, endStr);
                      }}
                      className="px-2 py-1 rounded-md border border-linear-border bg-linear-bg-secondary text-xs text-linear-text-secondary hover:bg-linear-bg-tertiary"
                    >
                      7d
                    </button>
                    <button
                      onClick={() => {
                        const end = new Date();
                        const start = new Date();
                        start.setDate(end.getDate() - 29);
                        const startStr = formatLocalYmd(start);
                        const endStr = formatLocalYmd(end);
                        setKpiDateRange({ start: startStr, end: endStr });
                        fetchKPIData(startStr, endStr);
                      }}
                      className="px-2 py-1 rounded-md border border-linear-border bg-linear-bg-secondary text-xs text-linear-text-secondary hover:bg-linear-bg-tertiary"
                    >
                      30d
                    </button>
                    <button
                      onClick={() => {
                        const now = new Date();
                        const start = new Date(now.getFullYear(), now.getMonth(), 1);
                        const startStr = formatLocalYmd(start);
                        const endStr = formatLocalYmd(now);
                        setKpiDateRange({ start: startStr, end: endStr });
                        fetchKPIData(startStr, endStr);
                      }}
                      className="px-2 py-1 rounded-md border border-linear-border bg-linear-bg-secondary text-xs text-linear-text-secondary hover:bg-linear-bg-tertiary"
                    >
                      This Month
                    </button>
                    <label className="flex items-center gap-1 text-xs text-linear-text-secondary">
                      <input
                        type="date"
                        value={kpiDateRange.start}
                        onChange={(e) => setKpiDateRange(prev => ({ ...prev, start: e.target.value }))}
                        className="rounded-md border border-linear-border bg-linear-bg-secondary px-2 py-1 text-xs text-linear-text"
                      />
                    </label>
                    <span className="text-xs text-linear-text-tertiary">to</span>
                    <label className="flex items-center gap-1 text-xs text-linear-text-secondary">
                      <input
                        type="date"
                        value={kpiDateRange.end}
                        onChange={(e) => setKpiDateRange(prev => ({ ...prev, end: e.target.value }))}
                        className="rounded-md border border-linear-border bg-linear-bg-secondary px-2 py-1 text-xs text-linear-text"
                      />
                    </label>
                    <button
                      onClick={() => fetchKPIData()}
                      disabled={kpiLoading}
                      className="px-3 py-1.5 rounded-md border border-linear-border bg-linear-bg-secondary text-xs text-linear-text-secondary disabled:opacity-50"
                    >
                      {kpiLoading ? "Loading..." : "Apply"}
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={async () => {
                      setKpiRefreshing(true);
                      setKpiError(null);
                      try {
                        const res = await fetch('/api/kpi/refresh', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ start: kpiDateRange.start, end: kpiDateRange.end }),
                        });
                        const json = await res.json();
                        if (!json.success) throw new Error(json.error || 'Refresh failed');
                        await fetchKPIData();
                      } catch (err: any) {
                        setKpiError(err.message || 'Failed to refresh from Twitter');
                      } finally {
                        setKpiRefreshing(false);
                      }
                    }}
                    disabled={kpiRefreshing || kpiLoading}
                    className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
                  >
                    {kpiRefreshing ? "Refreshing..." : "🔄 Refresh from Twitter"}
                  </button>
                  {kpiLastRefresh && (
                    <span className="text-xs text-linear-text-tertiary">
                      Last refresh: {kpiLastRefresh.toLocaleString()}
                    </span>
                  )}
                </div>
              </div>

              {kpiError && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
                  {kpiError}
                </div>
              )}

              {/* Top KPI Cards */}
              {(() => {
                const totalPosts = kpiDailyData.reduce((sum, d) => sum + d.posts, 0);
                const totalImpressions = kpiDailyData.reduce((sum, d) => sum + d.impressions, 0);
                const totalLikes = kpiDailyData.reduce((sum, d) => sum + d.likes, 0);
                const totalReplies = kpiDailyData.reduce((sum, d) => sum + d.replies, 0);
                const totalRetweets = kpiDailyData.reduce((sum, d) => sum + d.retweets, 0);
                const totalBookmarks = kpiDailyData.reduce((sum, d) => sum + d.bookmarks, 0);
                const totalQuotes = kpiDailyData.reduce((sum, d) => sum + d.quotes, 0);
                const totalEngagements = totalLikes + totalReplies + totalRetweets + totalQuotes + totalBookmarks;
                const engagementRate = totalImpressions > 0 ? (totalEngagements / totalImpressions) * 100 : 0;
                const avgImpPerPost = totalPosts > 0 ? totalImpressions / totalPosts : 0;

                const formatNum = (n: number) => new Intl.NumberFormat().format(Math.round(n));

                return (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                    <div className="rounded-lg border border-linear-border bg-linear-bg-secondary p-3">
                      <div className="text-xs text-linear-text-tertiary mb-1">Posts</div>
                      <div className="text-xl font-bold text-linear-text">{formatNum(totalPosts)}</div>
                    </div>
                    <div className="rounded-lg border border-linear-border bg-linear-bg-secondary p-3">
                      <div className="text-xs text-linear-text-tertiary mb-1">Impressions</div>
                      <div className="text-xl font-bold text-linear-text">{formatNum(totalImpressions)}</div>
                    </div>
                    <div className="rounded-lg border border-linear-border bg-linear-bg-secondary p-3">
                      <div className="text-xs text-linear-text-tertiary mb-1">Engagement Rate</div>
                      <div className={`text-xl font-bold ${engagementRate >= 3 ? "text-green-400" : "text-linear-text"}`}>{engagementRate.toFixed(2)}%</div>
                    </div>
                    <div className="rounded-lg border border-linear-border bg-linear-bg-secondary p-3">
                      <div className="text-xs text-linear-text-tertiary mb-1">Followers</div>
                      <div className="text-xl font-bold text-linear-text">{formatNum(kpiFollowerCount)}</div>
                    </div>
                    <div className="rounded-lg border border-linear-border bg-linear-bg-secondary p-3">
                      <div className="text-xs text-linear-text-tertiary mb-1">Avg Imp/Post</div>
                      <div className="text-xl font-bold text-linear-text">{formatNum(avgImpPerPost)}</div>
                    </div>
                    <div className="rounded-lg border border-linear-border bg-linear-bg-secondary p-3">
                      <div className="text-xs text-linear-text-tertiary mb-1">Likes</div>
                      <div className="text-xl font-bold text-linear-text">{formatNum(totalLikes)}</div>
                    </div>
                    <div className="rounded-lg border border-linear-border bg-linear-bg-secondary p-3">
                      <div className="text-xs text-linear-text-tertiary mb-1">Replies</div>
                      <div className="text-xl font-bold text-linear-text">{formatNum(totalReplies)}</div>
                    </div>
                    <div className="rounded-lg border border-linear-border bg-linear-bg-secondary p-3">
                      <div className="text-xs text-linear-text-tertiary mb-1">Retweets</div>
                      <div className="text-xl font-bold text-linear-text">{formatNum(totalRetweets)}</div>
                    </div>
                    <div className="rounded-lg border border-linear-border bg-linear-bg-secondary p-3">
                      <div className="text-xs text-linear-text-tertiary mb-1">Bookmarks</div>
                      <div className="text-xl font-bold text-linear-text">{formatNum(totalBookmarks)}</div>
                    </div>
                    <div className="rounded-lg border border-linear-border bg-linear-bg-secondary p-3">
                      <div className="text-xs text-linear-text-tertiary mb-1">Total Engagements</div>
                      <div className="text-xl font-bold text-linear-text">{formatNum(totalEngagements)}</div>
                    </div>
                  </div>
                );
              })()}

              {/* Trend Charts */}
              {kpiDailyData.length > 0 && (
                <div key={`charts-${kpiDateRange.start}-${kpiDateRange.end}-${kpiDailyData.length}`} className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {(() => {
                    const { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } = require('recharts');
                    const chartData = kpiDailyData.map(d => ({
                      date: d.date,
                      impressions: d.impressions,
                      engagements: d.likes + d.replies + d.retweets + d.quotes + d.bookmarks,
                      posts: d.posts,
                    }));
                    return (
                      <>
                        <div className="rounded-lg border border-linear-border bg-linear-bg-secondary p-4">
                          <h4 className="text-sm font-medium text-linear-text mb-3">Impressions Trend ({chartData.length} days)</h4>
                          <ResponsiveContainer width="100%" height={250}>
                            <LineChart data={chartData}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#253251" />
                              <XAxis dataKey="date" stroke="#9fb0d0" style={{ fontSize: '10px' }} tickFormatter={(v: string) => `${new Date(v).getMonth()+1}/${new Date(v).getDate()}`} />
                              <YAxis stroke="#9fb0d0" style={{ fontSize: '10px' }} />
                              <Tooltip contentStyle={{ backgroundColor: '#131a2e', border: '1px solid #253251', borderRadius: '8px', color: '#eef3ff' }} />
                              <Line type="monotone" dataKey="impressions" name="Impressions" stroke="#7aa2ff" strokeWidth={2} dot={{ fill: '#7aa2ff', r: 3 }} />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                        <div className="rounded-lg border border-linear-border bg-linear-bg-secondary p-4">
                          <h4 className="text-sm font-medium text-linear-text mb-3">Engagements & Posts</h4>
                          <ResponsiveContainer width="100%" height={250}>
                            <LineChart data={chartData}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#253251" />
                              <XAxis dataKey="date" stroke="#9fb0d0" style={{ fontSize: '10px' }} tickFormatter={(v: string) => `${new Date(v).getMonth()+1}/${new Date(v).getDate()}`} />
                              <YAxis stroke="#9fb0d0" style={{ fontSize: '10px' }} />
                              <Tooltip contentStyle={{ backgroundColor: '#131a2e', border: '1px solid #253251', borderRadius: '8px', color: '#eef3ff' }} />
                              <Legend wrapperStyle={{ color: '#9fb0d0' }} />
                              <Line type="monotone" dataKey="engagements" name="Engagements" stroke="#44d19d" strokeWidth={2} dot={{ fill: '#44d19d', r: 3 }} />
                              <Line type="monotone" dataKey="posts" name="Posts" stroke="#ffd166" strokeWidth={2} dot={{ fill: '#ffd166', r: 3 }} />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </>
                    );
                  })()}
                </div>
              )}

              {/* Top Posts Table */}
              {kpiPostData.length > 0 && (
                <div className="rounded-lg border border-linear-border bg-linear-bg-secondary overflow-hidden">
                  <div className="px-4 py-3 border-b border-linear-border">
                    <h4 className="text-sm font-medium text-linear-text">Top Posts (by Impressions)</h4>
                  </div>
                  <div className="overflow-x-auto" style={{ WebkitOverflowScrolling: "touch" }}>
                    <table className="w-full min-w-[800px]">
                      <thead>
                        <tr className="border-b border-linear-border bg-linear-bg-tertiary">
                          <th className="text-left px-4 py-2.5 text-xs font-medium text-linear-text-secondary uppercase">Date</th>
                          <th className="text-left px-4 py-2.5 text-xs font-medium text-linear-text-secondary uppercase">Post</th>
                          <th className="text-right px-4 py-2.5 text-xs font-medium text-linear-text-secondary uppercase">Impr</th>
                          <th className="text-right px-4 py-2.5 text-xs font-medium text-linear-text-secondary uppercase">Likes</th>
                          <th className="text-right px-4 py-2.5 text-xs font-medium text-linear-text-secondary uppercase">Replies</th>
                          <th className="text-right px-4 py-2.5 text-xs font-medium text-linear-text-secondary uppercase">RTs</th>
                          <th className="text-right px-4 py-2.5 text-xs font-medium text-linear-text-secondary uppercase">Eng%</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...kpiPostData]
                          .sort((a, b) => (b.public_metrics?.impression_count || 0) - (a.public_metrics?.impression_count || 0))
                          .slice(0, 15)
                          .map((post) => (
                            <tr key={post.id} className="border-b border-linear-border hover:bg-linear-bg-tertiary">
                              <td className="px-4 py-2.5 text-xs text-linear-text-secondary whitespace-nowrap">
                                {new Date(post.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                              </td>
                              <td className="px-4 py-2.5 text-xs text-linear-text max-w-[400px]">
                                <a
                                  href={`https://x.com/i/web/status/${post.id}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="hover:text-linear-accent"
                                >
                                  {(post.text || '').replace(/\s+/g, ' ').slice(0, 100)}{(post.text || '').length > 100 ? '…' : ''}
                                </a>
                              </td>
                              <td className="px-4 py-2.5 text-xs text-linear-text text-right">{new Intl.NumberFormat().format(post.public_metrics?.impression_count || 0)}</td>
                              <td className="px-4 py-2.5 text-xs text-linear-text text-right">{post.public_metrics?.like_count || 0}</td>
                              <td className="px-4 py-2.5 text-xs text-linear-text text-right">{post.public_metrics?.reply_count || 0}</td>
                              <td className="px-4 py-2.5 text-xs text-linear-text text-right">{post.public_metrics?.retweet_count || 0}</td>
                              <td className="px-4 py-2.5 text-xs text-linear-text text-right">{(post.engagementRate || 0).toFixed(2)}%</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Daily Breakdown */}
              {kpiDailyData.length > 0 && (() => {
                const totalPages = Math.max(1, Math.ceil(kpiDailyData.length / kpiDailyPageSize));
                const startIdx = (kpiDailyPage - 1) * kpiDailyPageSize;
                const pageRows = kpiDailyData.slice(startIdx, startIdx + kpiDailyPageSize);
                return (
                  <div className="rounded-lg border border-linear-border bg-linear-bg-secondary overflow-hidden">
                    <div className="px-4 py-3 border-b border-linear-border flex flex-wrap items-center justify-between gap-2">
                      <h4 className="text-sm font-medium text-linear-text">Daily Breakdown</h4>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-linear-text-tertiary">Show</span>
                        <select
                          value={kpiDailyPageSize}
                          onChange={(e) => { setKpiDailyPageSize(Number(e.target.value)); setKpiDailyPage(1); }}
                          className="rounded-md border border-linear-border bg-linear-bg-tertiary px-2 py-1 text-xs text-linear-text"
                        >
                          {[10, 25, 50, 100].map((size) => (
                            <option key={size} value={size}>{size}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="overflow-x-auto" style={{ WebkitOverflowScrolling: "touch" }}>
                      <table className="w-full min-w-[700px]">
                        <thead>
                          <tr className="border-b border-linear-border bg-linear-bg-tertiary">
                            <th className="text-left px-4 py-2.5 text-xs font-medium text-linear-text-secondary uppercase">Date</th>
                            <th className="text-right px-4 py-2.5 text-xs font-medium text-linear-text-secondary uppercase">Posts</th>
                            <th className="text-right px-4 py-2.5 text-xs font-medium text-linear-text-secondary uppercase">Impressions</th>
                            <th className="text-right px-4 py-2.5 text-xs font-medium text-linear-text-secondary uppercase">Likes</th>
                            <th className="text-right px-4 py-2.5 text-xs font-medium text-linear-text-secondary uppercase">Replies</th>
                            <th className="text-right px-4 py-2.5 text-xs font-medium text-linear-text-secondary uppercase">RTs</th>
                            <th className="text-right px-4 py-2.5 text-xs font-medium text-linear-text-secondary uppercase">Eng%</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pageRows.map((row, idx) => (
                            <tr key={`${row.date}-${idx}`} className="border-b border-linear-border hover:bg-linear-bg-tertiary">
                              <td className="px-4 py-2.5 text-xs text-linear-text-secondary whitespace-nowrap">
                                <button
                                  onClick={() => { setSelectedKpiDate(row.date); setSelectedKpiPost(null); }}
                                  className="text-linear-accent hover:underline"
                                  title="View posts for this date"
                                >
                                  {new Date(row.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                </button>
                              </td>
                              <td className="px-4 py-2.5 text-xs text-linear-text text-right">{row.posts}</td>
                              <td className="px-4 py-2.5 text-xs text-linear-text text-right">{new Intl.NumberFormat().format(row.impressions)}</td>
                              <td className="px-4 py-2.5 text-xs text-linear-text text-right">{row.likes}</td>
                              <td className="px-4 py-2.5 text-xs text-linear-text text-right">{row.replies}</td>
                              <td className="px-4 py-2.5 text-xs text-linear-text text-right">{row.retweets}</td>
                              <td className="px-4 py-2.5 text-xs text-linear-text text-right">{row.engagement_rate.toFixed(2)}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="px-4 py-3 border-t border-linear-border flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="text-linear-text-tertiary">
                        Showing {startIdx + 1}-{Math.min(startIdx + kpiDailyPageSize, kpiDailyData.length)} of {kpiDailyData.length}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setKpiDailyPage(p => Math.max(1, p - 1))}
                          disabled={kpiDailyPage <= 1}
                          className="px-2 py-1 rounded-md border border-linear-border bg-linear-bg-tertiary disabled:opacity-40"
                        >
                          Prev
                        </button>
                        <span className="text-linear-text-tertiary">Page {kpiDailyPage} / {totalPages}</span>
                        <button
                          onClick={() => setKpiDailyPage(p => Math.min(totalPages, p + 1))}
                          disabled={kpiDailyPage >= totalPages}
                          className="px-2 py-1 rounded-md border border-linear-border bg-linear-bg-tertiary disabled:opacity-40"
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {kpiLoading && kpiDailyData.length === 0 && (
                <div className="text-center py-8 text-linear-text-tertiary">Loading KPI data...</div>
              )}
            </div>
          )}

          {activePanel === "ga" && (
            <div className="animate-fadeIn space-y-4">
              {/* Controls */}
              <div className="flex flex-col gap-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <h3 className="text-sm font-medium text-linear-text">kevteaches.ai Analytics</h3>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => { const end = new Date(); const start = new Date(); start.setDate(end.getDate() - 6); const s = formatLocalYmd(start); const e = formatLocalYmd(end); setGaDateRange({ start: s, end: e }); fetchGAData(s, e); }}
                      className="px-2 py-1 rounded-md border border-linear-border bg-linear-bg-secondary text-xs text-linear-text-secondary hover:bg-linear-bg-tertiary"
                    >7d</button>
                    <button
                      onClick={() => { const end = new Date(); const start = new Date(); start.setDate(end.getDate() - 29); const s = formatLocalYmd(start); const e = formatLocalYmd(end); setGaDateRange({ start: s, end: e }); fetchGAData(s, e); }}
                      className="px-2 py-1 rounded-md border border-linear-border bg-linear-bg-secondary text-xs text-linear-text-secondary hover:bg-linear-bg-tertiary"
                    >30d</button>
                    <button
                      onClick={() => { const now = new Date(); const start = new Date(now.getFullYear(), now.getMonth(), 1); const s = formatLocalYmd(start); const e = formatLocalYmd(now); setGaDateRange({ start: s, end: e }); fetchGAData(s, e); }}
                      className="px-2 py-1 rounded-md border border-linear-border bg-linear-bg-secondary text-xs text-linear-text-secondary hover:bg-linear-bg-tertiary"
                    >This Month</button>
                    <input type="date" value={gaDateRange.start} onChange={(e) => setGaDateRange(prev => ({ ...prev, start: e.target.value }))} className="rounded-md border border-linear-border bg-linear-bg-secondary px-2 py-1 text-xs text-linear-text" />
                    <span className="text-xs text-linear-text-tertiary">to</span>
                    <input type="date" value={gaDateRange.end} onChange={(e) => setGaDateRange(prev => ({ ...prev, end: e.target.value }))} className="rounded-md border border-linear-border bg-linear-bg-secondary px-2 py-1 text-xs text-linear-text" />
                    <button onClick={() => fetchGAData()} disabled={gaLoading} className="px-3 py-1.5 rounded-md border border-linear-border bg-linear-bg-secondary text-xs text-linear-text-secondary disabled:opacity-50">
                      {gaLoading ? "Loading..." : "Apply"}
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={async () => {
                      setGaRefreshing(true);
                      setGaError(null);
                      try {
                        const res = await fetch('/api/ga/refresh', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ start: gaDateRange.start, end: gaDateRange.end }),
                        });
                        const json = await res.json();
                        if (!json.success) throw new Error(json.error || 'Refresh failed');
                        await fetchGAData();
                      } catch (err: any) {
                        setGaError(err.message || 'Failed to refresh from Google Analytics');
                      } finally {
                        setGaRefreshing(false);
                      }
                    }}
                    disabled={gaRefreshing || gaLoading}
                    className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
                  >
                    {gaRefreshing ? "Refreshing..." : "🔄 Refresh from Analytics"}
                  </button>
                  {gaLastRefresh && (
                    <span className="text-xs text-linear-text-tertiary">Last refresh: {gaLastRefresh.toLocaleString()}</span>
                  )}
                </div>
              </div>

              {gaError && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">{gaError}</div>
              )}

              {/* KPI Cards */}
              {gaDailyData.length > 0 && (() => {
                const fmtN = (n: number) => new Intl.NumberFormat().format(Math.round(n));
                const fmtT = (sec: number) => { if (sec < 60) return `${Math.round(sec)}s`; const m = Math.floor(sec / 60); const s = Math.round(sec % 60); return s > 0 ? `${m}m ${s}s` : `${m}m`; };
                const totalSessions = gaDailyData.reduce((s, d) => s + d.sessions, 0);
                const totalNewUsers = gaDailyData.reduce((s, d) => s + d.new_users, 0);
                const totalOrganic = gaDailyData.reduce((s, d) => s + d.organic_sessions, 0);
                const totalPageviews = gaDailyData.reduce((s, d) => s + d.pageviews, 0);
                const weightedEngTime = totalSessions > 0 ? gaDailyData.reduce((s, d) => s + d.avg_engagement_time_sec * d.sessions, 0) / totalSessions : 0;
                const weightedEngRate = totalSessions > 0 ? gaDailyData.reduce((s, d) => s + d.engagement_rate * d.sessions, 0) / totalSessions : 0;
                const pagesPerSession = totalSessions > 0 ? totalPageviews / totalSessions : 0;
                return (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div className="rounded-lg border border-linear-border bg-linear-bg-secondary p-3">
                      <div className="text-xs text-linear-text-tertiary mb-1">Sessions</div>
                      <div className="text-xl font-bold text-linear-text">{fmtN(totalSessions)}</div>
                    </div>
                    <div className="rounded-lg border border-linear-border bg-linear-bg-secondary p-3">
                      <div className="text-xs text-linear-text-tertiary mb-1">New Users</div>
                      <div className="text-xl font-bold text-linear-text">{fmtN(totalNewUsers)}</div>
                    </div>
                    <div className="rounded-lg border border-linear-border bg-linear-bg-secondary p-3">
                      <div className="text-xs text-linear-text-tertiary mb-1">Organic Search</div>
                      <div className="text-xl font-bold text-linear-text">{fmtN(totalOrganic)}</div>
                      {totalSessions > 0 && <div className="text-xs text-linear-text-tertiary mt-0.5">{((totalOrganic / totalSessions) * 100).toFixed(1)}% of sessions</div>}
                    </div>
                    <div className="rounded-lg border border-linear-border bg-linear-bg-secondary p-3">
                      <div className="text-xs text-linear-text-tertiary mb-1">Avg Engagement Time</div>
                      <div className="text-xl font-bold text-linear-text">{fmtT(weightedEngTime)}</div>
                    </div>
                    <div className="rounded-lg border border-linear-border bg-linear-bg-secondary p-3">
                      <div className="text-xs text-linear-text-tertiary mb-1">Engagement Rate</div>
                      <div className="text-xl font-bold text-linear-text">{weightedEngRate.toFixed(1)}%</div>
                    </div>
                    <div className="rounded-lg border border-linear-border bg-linear-bg-secondary p-3">
                      <div className="text-xs text-linear-text-tertiary mb-1">Pages / Session</div>
                      <div className="text-xl font-bold text-linear-text">{pagesPerSession.toFixed(2)}</div>
                    </div>
                  </div>
                );
              })()}

              {/* Trend Chart */}
              {gaDailyData.length > 0 && (() => {
                const { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } = require('recharts');
                const chartData = gaDailyData.map(d => ({ date: d.date.slice(5), sessions: d.sessions, organic: d.organic_sessions }));
                return (
                  <div className="rounded-lg border border-linear-border bg-linear-bg-secondary p-4">
                    <div className="text-xs font-medium text-linear-text-secondary mb-3">Sessions Trend</div>
                    <ResponsiveContainer width="100%" height={180}>
                      <LineChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#888' }} tickLine={false} />
                        <YAxis tick={{ fontSize: 10, fill: '#888' }} tickLine={false} axisLine={false} width={35} />
                        <Tooltip contentStyle={{ background: '#1a1a2e', border: '1px solid #333', borderRadius: '6px', fontSize: '12px' }} />
                        <Legend wrapperStyle={{ fontSize: '11px' }} />
                        <Line type="monotone" dataKey="sessions" stroke="#5b6fe6" strokeWidth={2} dot={false} name="Sessions" />
                        <Line type="monotone" dataKey="organic" stroke="#22c55e" strokeWidth={2} dot={false} name="Organic" />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                );
              })()}

              {/* Top Pages */}
              {gaTopPages.length > 0 && (() => {
                const fmtN = (n: number) => new Intl.NumberFormat().format(Math.round(n));
                const fmtT = (sec: number) => { if (sec < 60) return `${Math.round(sec)}s`; const m = Math.floor(sec / 60); const s = Math.round(sec % 60); return s > 0 ? `${m}m ${s}s` : `${m}m`; };
                return (
                  <div className="rounded-lg border border-linear-border bg-linear-bg-secondary overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-2.5 border-b border-linear-border">
                      <span className="text-xs font-medium text-linear-text-secondary">Top Pages</span>
                      <span className="text-xs text-linear-text-tertiary">{gaTopPages.length} pages</span>
                    </div>
                    <div className="divide-y divide-linear-border">
                      {gaTopPages.slice(0, 15).map((page, i) => (
                        <div key={i} className="px-4 py-2.5 flex items-center gap-3">
                          <span className="text-xs text-linear-text-tertiary w-5 shrink-0 text-right">{page.rank}</span>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs text-linear-text truncate font-mono">{page.page_path}</div>
                            {page.page_title && page.page_title !== page.page_path && (
                              <div className="text-xs text-linear-text-tertiary truncate">{page.page_title}</div>
                            )}
                          </div>
                          <div className="text-xs text-linear-text-secondary shrink-0">{fmtN(page.sessions)} sess</div>
                          <div className="text-xs text-linear-text-tertiary shrink-0">{fmtT(page.avg_engagement_time_sec)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Daily Breakdown Table */}
              {gaDailyData.length > 0 && (() => {
                const fmtN = (n: number) => new Intl.NumberFormat().format(Math.round(n));
                const fmtT = (sec: number) => { if (sec < 60) return `${Math.round(sec)}s`; const m = Math.floor(sec / 60); const s = Math.round(sec % 60); return s > 0 ? `${m}m ${s}s` : `${m}m`; };
                const totalPages = Math.max(1, Math.ceil(gaDailyData.length / gaDailyPageSize));
                const startIdx = (gaDailyPage - 1) * gaDailyPageSize;
                const pageRows = [...gaDailyData].reverse().slice(startIdx, startIdx + gaDailyPageSize);
                return (
                  <div className="rounded-lg border border-linear-border bg-linear-bg-secondary overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-2.5 border-b border-linear-border">
                      <span className="text-xs font-medium text-linear-text-secondary">Daily Breakdown</span>
                      <select value={gaDailyPageSize} onChange={(e) => { setGaDailyPageSize(Number(e.target.value)); setGaDailyPage(1); }} className="text-xs bg-linear-bg-tertiary border border-linear-border rounded px-1.5 py-0.5 text-linear-text-secondary">
                        <option value={10}>10/page</option>
                        <option value={25}>25/page</option>
                        <option value={50}>50/page</option>
                      </select>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-linear-border">
                            <th className="text-left px-4 py-2 text-linear-text-tertiary font-medium">Date</th>
                            <th className="text-right px-3 py-2 text-linear-text-tertiary font-medium">Sessions</th>
                            <th className="text-right px-3 py-2 text-linear-text-tertiary font-medium">New Users</th>
                            <th className="text-right px-3 py-2 text-linear-text-tertiary font-medium">Organic</th>
                            <th className="text-right px-3 py-2 text-linear-text-tertiary font-medium">Pageviews</th>
                            <th className="text-right px-3 py-2 text-linear-text-tertiary font-medium">Eng. Rate</th>
                            <th className="text-right px-4 py-2 text-linear-text-tertiary font-medium">Avg Time</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-linear-border/50">
                          {pageRows.map((d) => (
                            <tr key={d.date} className="hover:bg-linear-bg-tertiary/40 transition-colors">
                              <td className="px-4 py-2.5 text-linear-text-secondary">{d.date}</td>
                              <td className="px-3 py-2.5 text-right text-linear-text">{fmtN(d.sessions)}</td>
                              <td className="px-3 py-2.5 text-right text-linear-text-secondary">{fmtN(d.new_users)}</td>
                              <td className="px-3 py-2.5 text-right text-linear-text-secondary">{fmtN(d.organic_sessions)}</td>
                              <td className="px-3 py-2.5 text-right text-linear-text-secondary">{fmtN(d.pageviews)}</td>
                              <td className="px-3 py-2.5 text-right text-linear-text-secondary">{d.engagement_rate.toFixed(1)}%</td>
                              <td className="px-4 py-2.5 text-right text-linear-text-secondary">{fmtT(d.avg_engagement_time_sec)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {totalPages > 1 && (
                      <div className="flex items-center justify-between px-4 py-2.5 border-t border-linear-border">
                        <span className="text-xs text-linear-text-tertiary">
                          Showing {startIdx + 1}–{Math.min(startIdx + gaDailyPageSize, gaDailyData.length)} of {gaDailyData.length}
                        </span>
                        <div className="flex items-center gap-2">
                          <button onClick={() => setGaDailyPage(p => Math.max(1, p - 1))} disabled={gaDailyPage <= 1} className="px-2 py-1 rounded border border-linear-border text-xs text-linear-text-secondary disabled:opacity-40">Prev</button>
                          <span className="text-xs text-linear-text-tertiary">Page {gaDailyPage} / {totalPages}</span>
                          <button onClick={() => setGaDailyPage(p => Math.min(totalPages, p + 1))} disabled={gaDailyPage >= totalPages} className="px-2 py-1 rounded border border-linear-border text-xs text-linear-text-secondary disabled:opacity-40">Next</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {gaLoading && gaDailyData.length === 0 && (
                <div className="text-center py-8 text-linear-text-tertiary">Loading analytics data...</div>
              )}
              {!gaLoading && gaDailyData.length === 0 && !gaError && (
                <div className="text-center py-8 text-linear-text-tertiary">
                  No data yet — click &quot;Refresh from Analytics&quot; to fetch your GA4 data.
                </div>
              )}
            </div>
          )}

          {activePanel === "wordpress" && (
            <div className="animate-fadeIn space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <h3 className="text-sm font-medium text-linear-text">WordPress Content</h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={fetchWordpressFiles}
                    className="px-3 py-1.5 rounded-md border border-linear-border bg-linear-bg-secondary text-xs text-linear-text-secondary"
                  >
                    Refresh Files
                  </button>
                  <button
                    onClick={syncWordpress}
                    className="px-3 py-1.5 rounded-md bg-linear-accent hover:bg-linear-accent-hover text-white text-xs font-medium"
                  >
                    {isSyncingWp ? "Syncing…" : "Sync WordPress"}
                  </button>
                </div>
              </div>

              <div className="rounded-lg border border-linear-border bg-linear-bg-secondary overflow-hidden">
                <div className="px-4 py-2 border-b border-linear-border text-xs font-medium text-linear-text-secondary">Local Files</div>
                <div className="overflow-x-auto">
                <table className="w-full min-w-[760px]">
                  <thead>
                    <tr className="border-b border-linear-border bg-linear-bg-tertiary">
                      <th 
                        onClick={() => setWpSort(s => ({ col: "name", dir: s.col === "name" && s.dir === "asc" ? "desc" : "asc" }))}
                        className="text-left px-4 py-2.5 text-xs font-medium text-linear-text-secondary uppercase tracking-wider cursor-pointer hover:text-linear-text select-none"
                      >
                        <span className="inline-flex items-center gap-1">File {wpSort.col === "name" && (wpSort.dir === "asc" ? <Icons.sortAsc /> : <Icons.sortDesc />)}</span>
                      </th>
                      <th 
                        onClick={() => setWpSort(s => ({ col: "status", dir: s.col === "status" && s.dir === "asc" ? "desc" : "asc" }))}
                        className="text-left px-4 py-2.5 text-xs font-medium text-linear-text-secondary uppercase tracking-wider cursor-pointer hover:text-linear-text select-none"
                      >
                        <span className="inline-flex items-center gap-1">Status {wpSort.col === "status" && (wpSort.dir === "asc" ? <Icons.sortAsc /> : <Icons.sortDesc />)}</span>
                      </th>
                      <th 
                        onClick={() => setWpSort(s => ({ col: "preview", dir: s.col === "preview" && s.dir === "asc" ? "desc" : "asc" }))}
                        className="text-left px-4 py-2.5 text-xs font-medium text-linear-text-secondary uppercase tracking-wider cursor-pointer hover:text-linear-text select-none"
                      >
                        <span className="inline-flex items-center gap-1">Preview {wpSort.col === "preview" && (wpSort.dir === "asc" ? <Icons.sortAsc /> : <Icons.sortDesc />)}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {wpFilesView.map((item) => {
                      const status = wpStatusMap[item.slug];
                      const statusLabel = status?.status === "publish" ? "published" : status?.status;
                      return (
                        <tr
                          key={item.path}
                          className="border-b border-linear-border last:border-0 hover:bg-linear-bg-hover cursor-pointer"
                          onClick={() => setSelectedWpFile(item)}
                        >
                          <td className="px-4 py-3 text-sm text-linear-text">{item.name}</td>
                          <td className="px-4 py-3 text-xs text-linear-text-secondary">
                            {status ? (
                              <span className="inline-flex items-center gap-1.5">
                                <span
                                  className={`w-1.5 h-1.5 rounded-full ${
                                    status.status === "publish"
                                      ? "bg-linear-success"
                                      : status.status === "draft"
                                      ? "bg-amber-400"
                                      : "bg-linear-text-tertiary"
                                  }`}
                                />
                                <span className="capitalize">{statusLabel}</span>
                                <span className="text-[10px] text-linear-text-tertiary">{status.type}</span>
                              </span>
                            ) : (
                              <span className="text-linear-text-tertiary">Not synced</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-xs text-linear-text-secondary">
                            {item.preview || item.text?.slice(0, 200) || "—"}
                            {(item.preview || item.text) && (item.preview || item.text).length > 200 ? "…" : ""}
                          </td>
                        </tr>
                      );
                    })}
                    {wpFilesView.length === 0 && (
                      <tr>
                        <td colSpan={3} className="px-4 py-8 text-center text-sm text-linear-text-tertiary">
                          No WordPress files found
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
                </div>
              </div>

              {selectedWpFile && (
                <div
                  className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
                  onMouseDown={(e) => { if (e.target === e.currentTarget) { setSelectedWpFile(null); setEditingWpText(null); } }}
                >
                  <div className="w-full max-w-3xl rounded-lg border border-linear-border bg-linear-bg-secondary shadow-lg" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-between px-4 py-3 border-b border-linear-border">
                      <div className="space-y-1">
                        <div className="text-sm font-medium text-linear-text">{selectedWpFile.name}</div>
                        <div className="text-xs text-linear-text-tertiary">
                          {wpStatusMap[selectedWpFile.slug]?.status
                            ? `Status: ${wpStatusMap[selectedWpFile.slug]?.status === "publish" ? "published" : wpStatusMap[selectedWpFile.slug]?.status}`
                            : "Status: Not synced"}
                          {wpStatusMap[selectedWpFile.slug]?.link && (
                            <>
                              {" · "}
                              <a
                                href={wpStatusMap[selectedWpFile.slug]?.link}
                                target="_blank"
                                rel="noreferrer"
                                className="text-linear-accent hover:underline"
                              >
                                View
                              </a>
                            </>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => { setSelectedWpFile(null); setEditingWpText(null); }}
                        className="text-linear-text-tertiary hover:text-linear-text"
                      >
                        <Icons.x />
                      </button>
                    </div>
                    <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
                      {editingWpText !== null ? (
                        <textarea
                          value={editingWpText}
                          onChange={(e) => setEditingWpText(e.target.value)}
                          className="w-full h-96 px-3 py-2 bg-linear-bg border border-linear-border rounded-lg text-sm text-linear-text font-mono resize-y focus:border-linear-accent focus:outline-none"
                          autoFocus
                        />
                      ) : (
                        <pre className="whitespace-pre-wrap text-sm text-linear-text-secondary">
                          {selectedWpFile.text || "No content found."}
                        </pre>
                      )}
                    </div>
                    <div className="flex gap-2 px-4 py-3 border-t border-linear-border bg-linear-bg-tertiary rounded-b-lg">
                      {editingWpText !== null ? (
                        <>
                          <button
                            onClick={() => setEditingWpText(null)}
                            className="px-4 py-2 border border-linear-border text-linear-text-secondary text-sm font-medium rounded-md hover:bg-linear-bg transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => saveWpEdit(selectedWpFile, editingWpText)}
                            className="px-4 py-2 bg-linear-accent hover:bg-linear-accent-hover text-white text-sm font-medium rounded-md transition-colors"
                          >
                            Save File
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => archiveWpFile(selectedWpFile.path)}
                            disabled={isArchiving}
                            className="px-4 py-2 border border-linear-error/50 text-linear-error text-sm font-medium rounded-md hover:bg-linear-error/10 transition-colors disabled:opacity-50"
                          >
                            {isArchiving ? "Archiving…" : "Archive"}
                          </button>
                          <button
                            onClick={() => setEditingWpText(selectedWpFile.text || "")}
                            className="px-4 py-2 border border-linear-border text-linear-text-secondary text-sm font-medium rounded-md hover:bg-linear-bg transition-colors"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => publishWordpress(selectedWpFile, "draft")}
                            disabled={isPublishingWp}
                            className="px-4 py-2 border border-linear-border text-linear-text-secondary text-sm font-medium rounded-md hover:bg-linear-bg transition-colors disabled:opacity-50"
                          >
                            {isPublishingWp ? "Uploading…" : "Upload as Draft"}
                          </button>
                          <button
                            onClick={() => publishWordpress(selectedWpFile, "publish")}
                            disabled={isPublishingWp}
                            className="px-4 py-2 bg-linear-accent hover:bg-linear-accent-hover text-white text-sm font-medium rounded-md transition-colors disabled:opacity-50"
                          >
                            {isPublishingWp ? "Publishing…" : "Publish"}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {wpRemote && (
                <div className="rounded-lg border border-linear-border bg-linear-bg-secondary overflow-hidden">
                  <div className="px-4 py-2 border-b border-linear-border text-xs font-medium text-linear-text-secondary">WordPress Sync</div>
                  <div className="p-4 text-sm text-linear-text-secondary">
                    Posts: {wpRemote.posts.length} · Pages: {wpRemote.pages.length}
                  </div>
                </div>
              )}
            </div>
          )}

          {activePanel === "reminders" && (
            <div className="animate-fadeIn space-y-4">
              <div className="rounded-lg border border-linear-border bg-linear-bg-secondary p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-medium text-linear-text">Quick Reminders</h3>
                  <button
                    onClick={fetchReminders}
                    className="px-3 py-1.5 rounded-md border border-linear-border bg-linear-bg text-xs text-linear-text-secondary"
                  >
                    Refresh
                  </button>
                </div>

                <div className="flex gap-2">
                  <input
                    value={newReminderText}
                    onChange={(e) => setNewReminderText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addReminder();
                      }
                    }}
                    placeholder="Write a thought or to-do..."
                    className="flex-1 px-3 py-2 rounded-md bg-linear-bg border border-linear-border text-sm text-linear-text placeholder:text-linear-text-tertiary focus:border-linear-accent focus:outline-none"
                  />
                  <button
                    onClick={addReminder}
                    className="px-3 py-2 rounded-md bg-linear-accent hover:bg-linear-accent-hover text-white text-sm font-medium"
                  >
                    Add
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  {([
                    ["all", "All"],
                    ["open", "Open"],
                    ["done", "Done"],
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      onClick={() => setReminderFilter(value)}
                      className={`px-2.5 py-1 rounded-md text-xs border transition-colors ${
                        reminderFilter === value
                          ? "border-linear-accent text-linear-text bg-linear-accent/10"
                          : "border-linear-border text-linear-text-secondary hover:bg-linear-bg"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {reminderError && (
                  <div className="text-xs text-red-400">{reminderError}</div>
                )}
              </div>

              <div className="rounded-lg border border-linear-border bg-linear-bg-secondary overflow-hidden">
                {isLoadingReminders ? (
                  <div className="px-4 py-8 text-sm text-linear-text-tertiary text-center">Loading reminders...</div>
                ) : filteredReminders.length === 0 ? (
                  <div className="px-4 py-8 text-sm text-linear-text-tertiary text-center">No reminders yet.</div>
                ) : (
                  <div className="divide-y divide-linear-border">
                    {filteredReminders.map((item) => (
                      <div key={item.id} className="px-4 py-3 flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={item.done}
                          onChange={(e) => updateReminder(item.id, { done: e.target.checked })}
                          className="mt-1 h-4 w-4 rounded border-linear-border bg-linear-bg text-linear-accent focus:ring-linear-accent"
                        />

                        <div className="flex-1 min-w-0">
                          {editingReminderId === item.id ? (
                            <input
                              value={editingReminderText}
                              onChange={(e) => setEditingReminderText(e.target.value)}
                              onBlur={async () => {
                                const text = editingReminderText.trim();
                                if (text && text !== item.text) {
                                  await updateReminder(item.id, { text });
                                }
                                setEditingReminderId(null);
                                setEditingReminderText("");
                              }}
                              onKeyDown={async (e) => {
                                if (e.key === "Enter") {
                                  const text = editingReminderText.trim();
                                  if (text && text !== item.text) {
                                    await updateReminder(item.id, { text });
                                  }
                                  setEditingReminderId(null);
                                  setEditingReminderText("");
                                }
                                if (e.key === "Escape") {
                                  setEditingReminderId(null);
                                  setEditingReminderText("");
                                }
                              }}
                              autoFocus
                              className="w-full px-2 py-1 rounded-md bg-linear-bg border border-linear-border text-sm text-linear-text focus:border-linear-accent focus:outline-none"
                            />
                          ) : (
                            <button
                              onClick={() => {
                                setEditingReminderId(item.id);
                                setEditingReminderText(item.text);
                              }}
                              className={`text-left text-sm ${item.done ? "text-linear-text-tertiary line-through" : "text-linear-text"}`}
                            >
                              {item.text}
                            </button>
                          )}
                          <div className="text-xs text-linear-text-tertiary mt-1">
                            {new Date(item.createdAt).toLocaleString()}
                          </div>
                        </div>

                        <button
                          onClick={() => deleteReminder(item.id)}
                          className="text-linear-text-tertiary hover:text-linear-error"
                          title="Delete reminder"
                        >
                          <Icons.trash />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {activePanel === "ideas" && (
            <div className="animate-fadeIn space-y-4">
              <div className="rounded-lg border border-linear-border bg-linear-bg-secondary p-4 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-medium text-linear-text">Idea Vault</h3>
                    <div className="text-xs text-linear-text-tertiary">Capture now, expand later. {ideas.length} total ideas.</div>
                  </div>
                  <button
                    onClick={fetchIdeas}
                    className="px-3 py-1.5 rounded-md border border-linear-border bg-linear-bg text-xs text-linear-text-secondary"
                  >
                    Refresh
                  </button>
                </div>

                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    value={quickIdeaTitle}
                    onChange={(e) => setQuickIdeaTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        quickCaptureIdea();
                      }
                    }}
                    placeholder="Quick capture: one-line idea title..."
                    className="flex-1 px-3 py-2 rounded-md bg-linear-bg border border-linear-border text-sm text-linear-text placeholder:text-linear-text-tertiary focus:border-linear-accent focus:outline-none"
                  />
                  <button
                    onClick={quickCaptureIdea}
                    className="px-3 py-2 rounded-md bg-linear-accent hover:bg-linear-accent-hover text-white text-sm font-medium"
                  >
                    Capture
                  </button>
                  <button
                    onClick={openNewIdeaModal}
                    className="px-3 py-2 rounded-md border border-linear-border bg-linear-bg text-sm text-linear-text-secondary hover:bg-linear-bg-tertiary"
                  >
                    Full editor
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => setIdeaFilter("all")}
                    className={`px-2.5 py-1 rounded-md text-xs border transition-colors ${
                      ideaFilter === "all"
                        ? "border-linear-accent text-linear-text bg-linear-accent/10"
                        : "border-linear-border text-linear-text-secondary hover:bg-linear-bg"
                    }`}
                  >
                    All ({ideas.length})
                  </button>
                  {ideaStatuses.map((status) => {
                    const count = ideas.filter((idea) => idea.status === status).length;
                    return (
                      <button
                        key={status}
                        onClick={() => setIdeaFilter(status)}
                        className={`px-2.5 py-1 rounded-md text-xs border transition-colors ${
                          ideaFilter === status
                            ? "border-linear-accent text-linear-text bg-linear-accent/10"
                            : "border-linear-border text-linear-text-secondary hover:bg-linear-bg"
                        }`}
                      >
                        {ideaStatusLabels[status]} ({count})
                      </button>
                    );
                  })}
                  <button
                    onClick={() => setIdeaFilter("due")}
                    className={`px-2.5 py-1 rounded-md text-xs border transition-colors ${
                      ideaFilter === "due"
                        ? "border-red-400/60 text-red-300 bg-red-500/10"
                        : "border-linear-border text-linear-text-secondary hover:bg-linear-bg"
                    }`}
                  >
                    Due ({ideas.filter((idea) => isIdeaOverdue(idea)).length})
                  </button>
                </div>

                {ideaError && (
                  <div className="text-xs text-red-400">{ideaError}</div>
                )}
              </div>

              <div className="rounded-lg border border-linear-border bg-linear-bg-secondary overflow-hidden">
                {isLoadingIdeas ? (
                  <div className="px-4 py-8 text-sm text-linear-text-tertiary text-center">Loading ideas...</div>
                ) : ideasView.length === 0 ? (
                  <div className="px-4 py-8 text-sm text-linear-text-tertiary text-center">No ideas found. Capture one above.</div>
                ) : (
                  <div className="divide-y divide-linear-border">
                    {ideasView.map((idea) => {
                      const preview = idea.body || idea.whyItMatters || idea.nextStep || "No details yet";
                      const overdue = isIdeaOverdue(idea);
                      return (
                        <div
                          key={idea.id}
                          className={`px-4 py-3 flex items-start justify-between gap-3 ${overdue ? "bg-red-500/5" : ""}`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2 mb-1">
                              <button
                                onClick={() => openIdeaEditor(idea)}
                                className="text-left text-sm font-medium text-linear-text hover:text-linear-accent truncate"
                              >
                                {idea.pinned ? "★ " : ""}{idea.title}
                              </button>
                              <span className="text-[10px] px-1.5 py-0.5 rounded border border-linear-border text-linear-text-tertiary">
                                {ideaStatusLabels[idea.status]}
                              </span>
                              {overdue && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded border border-red-500/40 text-red-300 bg-red-500/10">Overdue</span>
                              )}
                            </div>

                            <p className="text-xs text-linear-text-secondary line-clamp-2">{preview}</p>

                            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-linear-text-tertiary">
                              {idea.tags.length > 0 && (
                                <span>#{idea.tags.join(" #")}</span>
                              )}
                              {idea.revisitAt && (
                                <span>Revisit: {idea.revisitAt.length === 10 ? parseLocalDate(idea.revisitAt).toLocaleDateString() : new Date(idea.revisitAt).toLocaleDateString()}</span>
                              )}
                              <span>Updated {new Date(idea.updatedAt).toLocaleString()}</span>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 flex-shrink-0">
                            <button
                              onClick={() => openIdeaEditor(idea)}
                              className="px-2.5 py-1 rounded-md border border-linear-border text-xs text-linear-text-secondary hover:bg-linear-bg-tertiary"
                            >
                              Open
                            </button>
                            <button
                              onClick={async () => {
                                await convertIdeaToTask(idea);
                                await fetchIdeas();
                              }}
                              className="px-2.5 py-1 rounded-md border border-linear-accent/40 text-xs text-linear-accent hover:bg-linear-accent/10"
                            >
                              To Task
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {showIdeaModal && (
                <div
                  className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
                  onMouseDown={(e) => { if (e.target === e.currentTarget) closeIdeaModal(); }}
                >
                  <div className="w-full max-w-2xl rounded-lg border border-linear-border bg-linear-bg-secondary shadow-linear-lg" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-between px-4 py-3 border-b border-linear-border">
                      <div>
                        <h4 className="text-sm font-medium text-linear-text">{editingIdea ? "Edit Idea" : "New Idea"}</h4>
                        <div className="text-xs text-linear-text-tertiary">Capture details now or expand later.</div>
                      </div>
                      <button onClick={closeIdeaModal} className="text-linear-text-tertiary hover:text-linear-text">
                        <Icons.x />
                      </button>
                    </div>

                    <div className="p-4 grid grid-cols-1 gap-3 max-h-[70vh] overflow-y-auto">
                      <input
                        value={ideaForm.title}
                        onChange={(e) => setIdeaForm((prev) => ({ ...prev, title: e.target.value }))}
                        placeholder="Idea title"
                        className="px-3 py-2 bg-linear-bg border border-linear-border rounded-md text-sm text-linear-text"
                        autoFocus
                      />

                      <textarea
                        value={ideaForm.body}
                        onChange={(e) => setIdeaForm((prev) => ({ ...prev, body: e.target.value }))}
                        placeholder="Raw idea dump"
                        className="px-3 py-2 bg-linear-bg border border-linear-border rounded-md text-sm text-linear-text min-h-[120px]"
                      />

                      <textarea
                        value={ideaForm.whyItMatters}
                        onChange={(e) => setIdeaForm((prev) => ({ ...prev, whyItMatters: e.target.value }))}
                        placeholder="Why this matters (optional)"
                        className="px-3 py-2 bg-linear-bg border border-linear-border rounded-md text-sm text-linear-text min-h-[80px]"
                      />

                      <textarea
                        value={ideaForm.nextStep}
                        onChange={(e) => setIdeaForm((prev) => ({ ...prev, nextStep: e.target.value }))}
                        placeholder="Next tiny step"
                        className="px-3 py-2 bg-linear-bg border border-linear-border rounded-md text-sm text-linear-text min-h-[80px]"
                      />

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-linear-text-secondary mb-1">Status</label>
                          <select
                            value={ideaForm.status}
                            onChange={(e) => setIdeaForm((prev) => ({ ...prev, status: e.target.value as IdeaStatus }))}
                            className="w-full px-3 py-2 bg-linear-bg border border-linear-border rounded-md text-sm text-linear-text"
                          >
                            {ideaStatuses.map((status) => (
                              <option key={status} value={status}>{ideaStatusLabels[status]}</option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-linear-text-secondary mb-1">Revisit</label>
                          <input
                            type="date"
                            value={ideaForm.revisitAt}
                            onChange={(e) => setIdeaForm((prev) => ({ ...prev, revisitAt: e.target.value }))}
                            className="w-full px-3 py-2 bg-linear-bg border border-linear-border rounded-md text-sm text-linear-text"
                          />
                        </div>

                        <label className="flex items-end gap-2 text-sm text-linear-text-secondary">
                          <input
                            type="checkbox"
                            checked={ideaForm.pinned}
                            onChange={(e) => setIdeaForm((prev) => ({ ...prev, pinned: e.target.checked }))}
                          />
                          Pinned
                        </label>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          onClick={() => setIdeaRevisitPreset("tomorrow")}
                          className="px-2.5 py-1 rounded-md border border-linear-border text-xs text-linear-text-secondary hover:bg-linear-bg"
                        >
                          Tomorrow
                        </button>
                        <button
                          onClick={() => setIdeaRevisitPreset("weekend")}
                          className="px-2.5 py-1 rounded-md border border-linear-border text-xs text-linear-text-secondary hover:bg-linear-bg"
                        >
                          This weekend
                        </button>
                        <button
                          onClick={() => setIdeaRevisitPreset("next-week")}
                          className="px-2.5 py-1 rounded-md border border-linear-border text-xs text-linear-text-secondary hover:bg-linear-bg"
                        >
                          Next week
                        </button>
                        <button
                          onClick={() => setIdeaRevisitPreset("someday")}
                          className="px-2.5 py-1 rounded-md border border-linear-border text-xs text-linear-text-secondary hover:bg-linear-bg"
                        >
                          Someday
                        </button>
                      </div>

                      <input
                        value={ideaForm.tagsText}
                        onChange={(e) => setIdeaForm((prev) => ({ ...prev, tagsText: e.target.value }))}
                        placeholder="Tags (comma separated)"
                        className="px-3 py-2 bg-linear-bg border border-linear-border rounded-md text-sm text-linear-text"
                      />

                      {ideaModalError && (
                        <div className="text-xs text-red-400">{ideaModalError}</div>
                      )}

                      {editingIdea && (
                        <div className="text-[11px] text-linear-text-tertiary">
                          Created {new Date(editingIdea.createdAt).toLocaleString()} · Updated {new Date(editingIdea.updatedAt).toLocaleString()}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-t border-linear-border bg-linear-bg-tertiary rounded-b-lg">
                      <div className="flex items-center gap-2">
                        {editingIdea && (
                          <>
                            <button
                              onClick={() => deleteIdea(editingIdea.id)}
                              className="px-3 py-1.5 text-xs rounded-md border border-red-500/40 text-red-400 hover:bg-red-500/10"
                            >
                              Delete
                            </button>
                            <button
                              onClick={async () => {
                                await convertIdeaToTask(editingIdea);
                                closeIdeaModal();
                              }}
                              className="px-3 py-1.5 text-xs rounded-md border border-linear-accent/40 text-linear-accent hover:bg-linear-accent/10"
                            >
                              Convert to task
                            </button>
                          </>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={closeIdeaModal}
                          className="px-3 py-1.5 text-sm text-linear-text-secondary hover:text-linear-text"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={saveIdea}
                          className="px-3 py-1.5 bg-linear-accent hover:bg-linear-accent-hover text-white text-sm font-medium rounded-md"
                        >
                          Save idea
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {activePanel === "memory" && (
            <div className="animate-fadeIn space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-linear-text">Memory Files</h3>
                <button
                  onClick={fetchMemoryFiles}
                  className="px-3 py-1.5 rounded-md border border-linear-border bg-linear-bg-secondary text-xs text-linear-text-secondary"
                >
                  Refresh
                </button>
              </div>

              {/* Context Files */}
              <div className="rounded-lg border border-linear-border bg-linear-bg-secondary overflow-hidden">
                <div className="px-4 py-2 border-b border-linear-border text-xs font-medium text-linear-text-secondary">Context Files</div>
                <div className="divide-y divide-linear-border">
                  {memoryFiles.filter(f => f.type === "context").map((file) => (
                    <div
                      key={file.path}
                      onClick={() => setSelectedMemoryFile(file)}
                      className="px-4 py-3 hover:bg-linear-bg-hover cursor-pointer flex items-center justify-between"
                    >
                      <span className="text-sm text-linear-text">{file.name}</span>
                      <span className="text-xs text-linear-text-tertiary">{file.path.split('/').slice(-2, -1)[0]}/</span>
                    </div>
                  ))}
                  {memoryFiles.filter(f => f.type === "context").length === 0 && (
                    <div className="px-4 py-8 text-center text-sm text-linear-text-tertiary">No context files found</div>
                  )}
                </div>
              </div>

              {/* Daily Logs */}
              <div className="rounded-lg border border-linear-border bg-linear-bg-secondary overflow-hidden">
                <div className="px-4 py-2 border-b border-linear-border text-xs font-medium text-linear-text-secondary">Daily Logs</div>
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-linear-border bg-linear-bg-tertiary">
                      <th
                        onClick={() => setMemorySort(s => ({ col: "date", dir: s.col === "date" && s.dir === "desc" ? "asc" : "desc" }))}
                        className="text-left px-4 py-2.5 text-xs font-medium text-linear-text-secondary uppercase tracking-wider cursor-pointer hover:text-linear-text select-none"
                      >
                        <span className="inline-flex items-center gap-1">Date {memorySort.col === "date" && (memorySort.dir === "asc" ? <Icons.sortAsc /> : <Icons.sortDesc />)}</span>
                      </th>
                      <th
                        onClick={() => setMemorySort(s => ({ col: "name", dir: s.col === "name" && s.dir === "asc" ? "desc" : "asc" }))}
                        className="text-left px-4 py-2.5 text-xs font-medium text-linear-text-secondary uppercase tracking-wider cursor-pointer hover:text-linear-text select-none"
                      >
                        <span className="inline-flex items-center gap-1">File {memorySort.col === "name" && (memorySort.dir === "asc" ? <Icons.sortAsc /> : <Icons.sortDesc />)}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {memoryFiles
                      .filter(f => f.type === "daily")
                      .filter(f => matchesSearch(f.name) || matchesSearch(f.date || ""))
                      .sort((a, b) => {
                        const dir = memorySort.dir === "asc" ? 1 : -1;
                        if (memorySort.col === "name") return a.name.localeCompare(b.name) * dir;
                        return ((a.date || "") > (b.date || "") ? 1 : -1) * dir;
                      })
                      .map((file) => (
                        <tr
                          key={file.path}
                          onClick={() => setSelectedMemoryFile(file)}
                          className="border-b border-linear-border last:border-0 hover:bg-linear-bg-hover cursor-pointer"
                        >
                          <td className="px-4 py-3 text-sm text-linear-text">{file.date || "—"}</td>
                          <td className="px-4 py-3 text-sm text-linear-text-secondary">{file.name}</td>
                        </tr>
                      ))}
                    {memoryFiles.filter(f => f.type === "daily").length === 0 && (
                      <tr>
                        <td colSpan={2} className="px-4 py-8 text-center text-sm text-linear-text-tertiary">No daily logs found</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Memory File Detail Modal */}
              {selectedMemoryFile && (
                <div
                  className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
                  onMouseDown={(e) => { if (e.target === e.currentTarget) { setSelectedMemoryFile(null); setEditingMemoryText(null); } }}
                >
                  <div className="w-full max-w-4xl rounded-lg border border-linear-border bg-linear-bg-secondary shadow-lg max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-between px-4 py-3 border-b border-linear-border flex-shrink-0">
                      <div>
                        <div className="text-sm font-medium text-linear-text">{selectedMemoryFile.name}</div>
                        <div className="text-xs text-linear-text-tertiary">{selectedMemoryFile.path}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        {editingMemoryText === null ? (
                          <button
                            onClick={() => setEditingMemoryText(selectedMemoryFile.text || "")}
                            className="px-3 py-1.5 border border-linear-border text-linear-text-secondary text-xs font-medium rounded-md hover:bg-linear-bg-tertiary transition-colors"
                          >
                            Edit
                          </button>
                        ) : (
                          <>
                            <button
                              onClick={() => setEditingMemoryText(null)}
                              className="px-3 py-1.5 border border-linear-border text-linear-text-secondary text-xs font-medium rounded-md hover:bg-linear-bg-tertiary transition-colors"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={saveMemoryFile}
                              disabled={isSavingMemory}
                              className="px-3 py-1.5 bg-linear-accent hover:bg-linear-accent-hover text-white text-xs font-medium rounded-md transition-colors disabled:opacity-50"
                            >
                              {isSavingMemory ? "Saving…" : "Save"}
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => { setSelectedMemoryFile(null); setEditingMemoryText(null); }}
                          className="text-linear-text-tertiary hover:text-linear-text"
                        >
                          <Icons.x />
                        </button>
                      </div>
                    </div>
                    <div className="p-4 overflow-y-auto flex-1">
                      {editingMemoryText === null ? (
                        <pre className="whitespace-pre-wrap text-sm text-linear-text-secondary font-mono">
                          {selectedMemoryFile.text || "Loading..."}
                        </pre>
                      ) : (
                        <textarea
                          value={editingMemoryText}
                          onChange={(e) => setEditingMemoryText(e.target.value)}
                          className="w-full h-full min-h-[400px] px-3 py-2 bg-linear-bg border border-linear-border rounded-md text-sm text-linear-text font-mono focus:border-linear-accent focus:outline-none resize-y"
                        />
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {activePanel === "agents" && (
            <div className="animate-fadeIn space-y-4 overflow-x-hidden">
              <div className="rounded-lg border border-linear-border bg-gradient-to-r from-linear-bg-secondary to-linear-bg p-3">
                <div className="flex items-center justify-between min-w-0">
                  <h3 className="text-sm font-medium text-linear-text truncate">Agents & Subagents ({agents.length + subagents.length})</h3>
                  <span className={`text-[10px] px-2 py-1 rounded-full border ${isAgentsAutoRefreshHealthy ? "border-linear-success/40 text-linear-success bg-linear-success/10" : "border-red-500/40 text-red-400 bg-red-500/10"}`}>
                    {isAgentsAutoRefreshHealthy ? "Live Ops" : "Offline"}
                  </span>
                </div>
              </div>

              <div className="rounded-lg border border-linear-border bg-linear-bg-secondary overflow-hidden">
                {agentsUsageSnapshot?.providers?.length ? (
                  <div className="divide-y divide-linear-border">
                    {agentsUsageSnapshot.providers.map((provider) => (
                      <div key={`agents-panel-${provider.provider}`} className="px-4 py-3">
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <div className="text-xs font-medium text-linear-text">{provider.displayName}</div>
                          {provider.plan && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded border border-linear-border text-linear-text-tertiary bg-linear-bg">
                              {provider.plan}
                            </span>
                          )}
                        </div>

                        {provider.error && (
                          <div className="text-[11px] text-red-400 mb-1">{provider.error}</div>
                        )}

                        {provider.windows.length > 0 ? (
                          <div className="space-y-1">
                            {provider.windows.map((window) => {
                              const leftPercent = Math.max(0, Math.min(100, 100 - Number(window.usedPercent || 0)));
                              const resetText = formatResetCountdown(window.resetAt);
                              return (
                                <div key={`agents-panel-${provider.provider}-${window.label}`} className="flex items-center justify-between gap-2 text-[11px]">
                                  <span className="text-linear-text-secondary">
                                    {window.label} {leftPercent.toFixed(0)}% left
                                  </span>
                                  {resetText ? (
                                    <span className="text-linear-text-tertiary">⏱{resetText}</span>
                                  ) : (
                                    <span className="text-linear-text-tertiary">—</span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ) : !provider.error ? (
                          <div className="text-[11px] text-linear-text-tertiary">No quota windows available.</div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="px-4 py-3 text-xs text-linear-text-tertiary">Usage data is not available yet.</div>
                )}

                <div className="px-4 py-2 border-t border-linear-border bg-linear-bg-tertiary flex items-center justify-between gap-3">
                  <div className="text-[11px] text-linear-text-tertiary">
                    {agentsUsageSnapshot
                      ? `Last checked ${new Date(agentsUsageSnapshot.checkedAt || agentsUsageSnapshot.updatedAt).toLocaleTimeString()}${agentsUsageSnapshot.stale ? " (cached)" : ""}`
                      : "Loading quota snapshot..."}
                  </div>
                  <button
                    onClick={() => fetchAgentsUsageSnapshot(true)}
                    disabled={isRefreshingAgentsUsage}
                    className="px-3 py-1.5 rounded-md border border-linear-border bg-linear-bg text-xs text-linear-text-secondary hover:border-linear-accent/50 hover:text-linear-text transition-all disabled:opacity-60 disabled:cursor-not-allowed active:scale-[0.98] active:bg-linear-bg-secondary"
                  >
                    {isRefreshingAgentsUsage ? "Refreshing..." : "Refresh Quota"}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 flex-wrap">
                <button
                  onClick={() => { fetchAgents(true); fetchSubagents(); }}
                  disabled={isRefreshingAgents}
                  className="px-3 py-1.5 rounded-md border border-linear-border bg-linear-bg-secondary text-xs text-linear-text-secondary transition-all hover:border-linear-accent/60 hover:text-linear-text hover:bg-linear-bg disabled:opacity-60 disabled:cursor-not-allowed active:scale-[0.98]"
                >
                  {isRefreshingAgents ? "Refreshing..." : "Refresh"}
                </button>
              </div>

              {/* Agent Cards Grid */}
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 overflow-hidden">
                {agents.map((agent) => (
                  <div
                    key={agent.id}
                    onClick={() => setSelectedAgent(agent)}
                    className="rounded-lg border border-linear-border bg-linear-bg-secondary p-4 hover:border-linear-accent/50 cursor-pointer transition-colors overflow-hidden min-w-0"
                    style={{
                      borderLeftWidth: 3,
                      borderLeftColor: agent.id === "kevbot" ? "#10b981" : "#a3a3a3",
                    }}
                  >
                    <div className="flex items-center gap-3 mb-3">
                      <span className="text-2xl">{agent.emoji}</span>
                      <div>
                        <div className="text-sm font-medium text-linear-text">{agent.name}</div>
                        <div className="text-xs text-linear-text-tertiary">{agent.role}</div>
                        <div className="mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-linear-border bg-linear-bg text-[10px] text-linear-text-tertiary">
                          <span
                            className="inline-block w-1.5 h-1.5 rounded-full"
                            style={{
                              backgroundColor:
                                agent.presence === "working"
                                  ? "#22c55e"
                                  : agent.presence === "waking"
                                  ? "#f59e0b"
                                  : "#6b7280",
                            }}
                          />
                          {agent.presence === "working"
                            ? "Working"
                            : agent.presence === "waking"
                            ? "Awake"
                            : "Idle"}
                        </div>
                        {agent.model && (
                          <div className="mt-1 text-[10px] text-linear-accent font-mono">{agent.model}</div>
                        )}
                      </div>
                    </div>
                    {(agent.presenceTask || agent.currentWork) && (
                      <div className="text-xs text-linear-text-secondary mb-2 line-clamp-2">
                        {agent.presenceTask || agent.currentWork}
                      </div>
                    )}

                    {agent.liveActivity && (
                      <div className="mb-2 px-2 py-1.5 rounded border border-linear-border bg-linear-bg">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-[11px] text-linear-text line-clamp-1">
                            {agent.liveActivity.now}
                          </div>
                          {typeof agent.liveActivity.elapsedMs === "number" && (
                            <div className="text-[10px] text-linear-text-tertiary whitespace-nowrap">
                              {formatDurationCompact(agent.liveActivity.elapsedMs)}
                            </div>
                          )}
                        </div>

                        {agent.liveActivity.detail && (
                          <div className="mt-1 text-[10px] text-linear-text-secondary line-clamp-1">
                            {agent.liveActivity.detail}
                          </div>
                        )}

                        {agent.liveActivity.command && (
                          <div className="mt-1 text-[10px] text-linear-text-tertiary font-mono line-clamp-1">
                            {agent.liveActivity.command}
                          </div>
                        )}

                        {agent.liveActivity.history.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {agent.liveActivity.history.map((step, idx) => (
                              <span key={`${agent.id}-${idx}-${step.label}`} className="text-[9px] px-1.5 py-0.5 rounded border border-linear-border text-linear-text-tertiary bg-linear-bg-secondary">
                                {step.label.replace(/…$/, "")}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    <div className="flex items-center justify-between text-[10px] text-linear-text-tertiary mb-2">
                      <span>{agent.files.filter(f => f.type === "daily").length} daily notes</span>
                      <span>
                        {agent.lastActive
                          ? `Active ${new Date(agent.lastActive).toLocaleDateString()}`
                          : "No activity"}
                      </span>
                    </div>
                    {/* Token Usage / Context Window */}
                    {agent.tokenUsage && agent.tokenUsage.totals.totalTokens > 0 && (
                      <div className="mb-3 px-2 py-1.5 rounded border border-linear-border bg-linear-bg">
                        <div className="flex items-center justify-between text-[10px]">
                          <span className="text-linear-text-tertiary">Recent tokens</span>
                          <span className="text-linear-text font-medium">
                            {agent.tokenUsage.totals.totalTokens >= 1000
                              ? `${(agent.tokenUsage.totals.totalTokens / 1000).toFixed(1)}k tokens`
                              : `${agent.tokenUsage.totals.totalTokens} tokens`}
                          </span>
                        </div>
                        {agent.tokenUsage.contextCurrentTokens && agent.tokenUsage.contextMaxTokens ? (
                          <div className="flex items-center justify-between text-[10px] mt-0.5">
                            <span className="text-linear-text-tertiary">Context window</span>
                            <span className="text-linear-text-secondary">
                              {`${(agent.tokenUsage.contextCurrentTokens / 1000).toFixed(1)}k / ${(agent.tokenUsage.contextMaxTokens / 1000).toFixed(0)}k`}
                              {` (${Math.min(999, Math.round((agent.tokenUsage.contextCurrentTokens / agent.tokenUsage.contextMaxTokens) * 100))}%)`}
                            </span>
                          </div>
                        ) : agent.tokenUsage.current && agent.tokenUsage.current.usage.totalTokens > 0 ? (
                          <div className="flex items-center justify-between text-[10px] mt-0.5">
                            <span className="text-linear-text-tertiary">Current session</span>
                            <span className="text-linear-text-secondary">
                              {agent.tokenUsage.current.usage.totalTokens >= 1000
                                ? `${(agent.tokenUsage.current.usage.totalTokens / 1000).toFixed(1)}k`
                                : agent.tokenUsage.current.usage.totalTokens}
                            </span>
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                ))}
                {subagents.map((sub) => (
                  <div
                    key={sub.sessionKey}
                    className="rounded-lg border border-linear-border bg-linear-bg-secondary/60 p-4 transition-colors overflow-hidden min-w-0"
                    style={{ borderLeftWidth: 3, borderLeftColor: "#7aa2ff" }}
                  >
                    <div className="flex items-center gap-3 mb-3">
                      <span className="text-2xl">🧩</span>
                      <div>
                        <div className="text-sm font-medium text-linear-text">Subagent</div>
                        <div className="text-xs text-linear-text-tertiary">{sub.label || sub.id.slice(0, 8)}</div>
                        <div className="mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-linear-border bg-linear-bg text-[10px] text-linear-text-tertiary">
                          <span
                            className="inline-block w-1.5 h-1.5 rounded-full"
                            style={{
                              backgroundColor:
                                sub.presence === "working"
                                  ? "#22c55e"
                                  : sub.presence === "recent"
                                  ? "#f59e0b"
                                  : "#6b7280",
                            }}
                          />
                          {sub.presence === "working" ? "Working" : sub.presence === "recent" ? "Awake" : "Idle"}
                        </div>
                      </div>
                    </div>
                    <div className="text-xs text-linear-text-secondary mb-2 line-clamp-2">
                      {sub.task || "Running sub-agent task"}
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-linear-text-tertiary">
                      <span>{sub.model || "model n/a"}</span>
                      <span>{sub.updatedAt ? `Active ${new Date(sub.updatedAt).toLocaleTimeString()}` : "No activity"}</span>
                    </div>
                  </div>
                ))}
                {agents.length === 0 && subagents.length === 0 && (
                  <div className="col-span-full text-center py-8 text-sm text-linear-text-tertiary">
                    Loading agents...
                  </div>
                )}
              </div>

              {/* Agent Detail Modal */}
              {selectedAgent && !selectedAgentFile && (
                <div
                  className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
                  onMouseDown={(e) => { if (e.target === e.currentTarget) setSelectedAgent(null); }}
                >
                  <div className="w-full max-w-[calc(100vw-2rem)] max-w-4xl rounded-lg border border-linear-border bg-linear-bg-secondary shadow-lg max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-between px-4 py-3 border-b border-linear-border flex-shrink-0">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{selectedAgent.emoji}</span>
                        <div>
                          <div className="text-sm font-medium text-linear-text">{selectedAgent.name}</div>
                          <div className="text-xs text-linear-text-tertiary">{selectedAgent.role}</div>
                          <div className="mt-1 text-[10px] text-linear-text-tertiary">
                            Status: {selectedAgent.presence === "working" ? "Working" : selectedAgent.presence === "waking" ? "Awake" : "Idle"}
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => setSelectedAgent(null)}
                        className="text-linear-text-tertiary hover:text-linear-text"
                      >
                        <Icons.x />
                      </button>
                    </div>
                    <div className="p-4 overflow-y-auto flex-1 space-y-4">
                      {selectedAgent.liveActivity && (
                        <div>
                          <div className="text-xs font-medium text-linear-text-secondary uppercase tracking-wider mb-2">Live Activity</div>
                          <div className="rounded-lg border border-linear-border bg-linear-bg p-3 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-sm text-linear-text">{selectedAgent.liveActivity.now}</div>
                              {typeof selectedAgent.liveActivity.elapsedMs === "number" && (
                                <span className="text-xs text-linear-text-tertiary">{formatDurationCompact(selectedAgent.liveActivity.elapsedMs)}</span>
                              )}
                            </div>
                            {selectedAgent.liveActivity.detail && (
                              <div className="text-xs text-linear-text-secondary">{selectedAgent.liveActivity.detail}</div>
                            )}
                            {selectedAgent.liveActivity.command && (
                              <div className="text-xs text-linear-text-tertiary font-mono break-all">{selectedAgent.liveActivity.command}</div>
                            )}
                            {selectedAgent.liveActivity.history.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 pt-1">
                                {selectedAgent.liveActivity.history.map((step, idx) => (
                                  <span key={`modal-live-${idx}-${step.label}`} className="text-[10px] px-1.5 py-0.5 rounded border border-linear-border text-linear-text-tertiary bg-linear-bg-secondary">
                                    {step.label.replace(/…$/, "")}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Context Files */}
                      <div>
                        <div className="text-xs font-medium text-linear-text-secondary uppercase tracking-wider mb-2">Context Files</div>
                        <div className="grid gap-2 md:grid-cols-2">
                          {selectedAgent.files.filter(f => f.type === "context").map((file) => (
                            <div
                              key={file.path}
                              onClick={() => setSelectedAgentFile(file)}
                              className="px-3 py-2 rounded-md border border-linear-border bg-linear-bg hover:border-linear-accent/50 cursor-pointer transition-colors"
                            >
                              <div className="text-sm text-linear-text">{file.name}</div>
                              <div className="text-[10px] text-linear-text-tertiary">
                                {file.modifiedAt ? new Date(file.modifiedAt).toLocaleString() : "—"}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Token Usage */}
                      {selectedAgent.tokenUsage && selectedAgent.tokenUsage.totals.totalTokens > 0 && (
                        <div>
                          <div className="text-xs font-medium text-linear-text-secondary uppercase tracking-wider mb-2">Token Usage (Recent Sessions)</div>
                          <div className="rounded-lg border border-linear-border bg-linear-bg overflow-hidden">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4 border-b border-linear-border bg-linear-bg-tertiary">
                              <div>
                                <div className="text-[10px] text-linear-text-tertiary uppercase">Total Tokens</div>
                                <div className="text-lg font-medium text-linear-text">{(selectedAgent.tokenUsage.totals.totalTokens / 1000).toFixed(1)}k</div>
                              </div>
                              <div>
                                <div className="text-[10px] text-linear-text-tertiary uppercase">Input</div>
                                <div className="text-lg font-medium text-linear-text">{(selectedAgent.tokenUsage.totals.inputTokens / 1000).toFixed(1)}k</div>
                              </div>
                              <div>
                                <div className="text-[10px] text-linear-text-tertiary uppercase">Output</div>
                                <div className="text-lg font-medium text-linear-text">{(selectedAgent.tokenUsage.totals.outputTokens / 1000).toFixed(1)}k</div>
                              </div>
                              <div>
                                <div className="text-[10px] text-linear-text-tertiary uppercase">Total Cost</div>
                                <div className="text-lg font-medium text-linear-accent">${selectedAgent.tokenUsage.totals.cost.toFixed(4)}</div>
                              </div>
                            </div>
                            <div className="overflow-x-auto" style={{ WebkitOverflowScrolling: "touch" }}>
                              <table className="w-full min-w-[640px]">
                                <thead>
                                  <tr className="border-b border-linear-border">
                                    <th className="text-left px-4 py-2 text-xs font-medium text-linear-text-secondary uppercase">Session</th>
                                    <th className="text-left px-4 py-2 text-xs font-medium text-linear-text-secondary uppercase">Updated</th>
                                    <th className="text-right px-4 py-2 text-xs font-medium text-linear-text-secondary uppercase">Tokens</th>
                                    <th className="text-right px-4 py-2 text-xs font-medium text-linear-text-secondary uppercase">Cost</th>
                                  </tr>
                                </thead>
                                <tbody>
                                {selectedAgent.tokenUsage.recent.map((session) => (
                                  <tr key={session.sessionId} className="border-b border-linear-border last:border-0 hover:bg-linear-bg-hover">
                                    <td className="px-4 py-2 text-sm text-linear-text">
                                      {session.label || session.sessionId.slice(0, 8)}
                                      {session === selectedAgent.tokenUsage?.current && (
                                        <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-linear-accent/20 text-linear-accent">Current</span>
                                      )}
                                    </td>
                                    <td className="px-4 py-2 text-sm text-linear-text-secondary">
                                      {session.updatedAt ? new Date(session.updatedAt).toLocaleString() : "—"}
                                    </td>
                                    <td className="px-4 py-2 text-sm text-linear-text text-right">
                                      {(session.usage.totalTokens / 1000).toFixed(1)}k
                                    </td>
                                    <td className="px-4 py-2 text-sm text-linear-accent text-right">
                                      ${session.usage.cost.toFixed(4)}
                                    </td>
                                  </tr>
                                ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Daily Notes */}
                      <div>
                        <div className="text-xs font-medium text-linear-text-secondary uppercase tracking-wider mb-2">Daily Notes ({selectedAgent.files.filter(f => f.type === "daily").length})</div>
                        <div className="rounded-lg border border-linear-border bg-linear-bg overflow-hidden">
                          <table className="w-full">
                            <thead>
                              <tr className="border-b border-linear-border bg-linear-bg-tertiary">
                                <th className="text-left px-4 py-2 text-xs font-medium text-linear-text-secondary uppercase">Date</th>
                                <th className="text-left px-4 py-2 text-xs font-medium text-linear-text-secondary uppercase">File</th>
                              </tr>
                            </thead>
                            <tbody>
                              {selectedAgent.files.filter(f => f.type === "daily").slice(0, 10).map((file) => (
                                <tr
                                  key={file.path}
                                  onClick={() => setSelectedAgentFile(file)}
                                  className="border-b border-linear-border last:border-0 hover:bg-linear-bg-hover cursor-pointer"
                                >
                                  <td className="px-4 py-2 text-sm text-linear-text">{file.date || "—"}</td>
                                  <td className="px-4 py-2 text-sm text-linear-text-secondary">{file.name}</td>
                                </tr>
                              ))}
                              {selectedAgent.files.filter(f => f.type === "daily").length === 0 && (
                                <tr>
                                  <td colSpan={2} className="px-4 py-6 text-center text-sm text-linear-text-tertiary">
                                    No daily notes found
                                  </td>
                                </tr>
                              )}
                              {selectedAgent.files.filter(f => f.type === "daily").length > 10 && (
                                <tr>
                                  <td colSpan={2} className="px-4 py-2 text-center text-xs text-linear-text-tertiary">
                                    +{selectedAgent.files.filter(f => f.type === "daily").length - 10} more
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Agent File Detail Modal */}
              {selectedAgentFile && (
                <div
                  className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2 sm:p-4"
                  onMouseDown={(e) => { if (e.target === e.currentTarget) { setSelectedAgentFile(null); setEditingAgentText(null); } }}
                >
                  <div className="w-full max-w-4xl max-w-[calc(100vw-1rem)] rounded-lg border border-linear-border bg-linear-bg-secondary shadow-lg max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
                    <div className="flex flex-wrap items-start justify-between gap-2 px-3 sm:px-4 py-3 border-b border-linear-border flex-shrink-0">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 min-w-0">
                          {selectedAgent && <span className="text-lg flex-shrink-0">{selectedAgent.emoji}</span>}
                          <div className="text-sm font-medium text-linear-text truncate">{selectedAgentFile.name}</div>
                        </div>
                        <div className="text-xs text-linear-text-tertiary truncate">{selectedAgentFile.path}</div>
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {editingAgentText === null ? (
                          <button
                            onClick={() => setEditingAgentText(selectedAgentFile.text || "")}
                            className="px-3 py-1.5 border border-linear-border text-linear-text-secondary text-xs font-medium rounded-md hover:bg-linear-bg-tertiary transition-colors"
                          >
                            Edit
                          </button>
                        ) : (
                          <>
                            <button
                              onClick={() => setEditingAgentText(null)}
                              className="px-3 py-1.5 border border-linear-border text-linear-text-secondary text-xs font-medium rounded-md hover:bg-linear-bg-tertiary transition-colors"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={saveAgentFile}
                              disabled={isSavingAgent}
                              className="px-3 py-1.5 bg-linear-accent hover:bg-linear-accent-hover text-white text-xs font-medium rounded-md transition-colors disabled:opacity-50"
                            >
                              {isSavingAgent ? "Saving…" : "Save"}
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => { setSelectedAgentFile(null); setEditingAgentText(null); }}
                          className="text-linear-text-tertiary hover:text-linear-text"
                        >
                          <Icons.x />
                        </button>
                      </div>
                    </div>
                    <div className="p-4 overflow-y-auto flex-1">
                      {editingAgentText === null ? (
                        <pre className="whitespace-pre-wrap text-sm text-linear-text-secondary font-mono">
                          {selectedAgentFile.text || "Loading..."}
                        </pre>
                      ) : (
                        <textarea
                          value={editingAgentText}
                          onChange={(e) => setEditingAgentText(e.target.value)}
                          className="w-full h-full min-h-[400px] px-3 py-2 bg-linear-bg border border-linear-border rounded-md text-sm text-linear-text font-mono focus:border-linear-accent focus:outline-none resize-y"
                        />
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {activePanel === "comms" && (
            <div className="animate-fadeIn space-y-4">
              {/* Stats Header */}
              <div className="rounded-lg border border-linear-border bg-gradient-to-r from-linear-bg-secondary to-linear-bg p-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 min-w-0">
                    <h3 className="text-sm font-medium text-linear-text">Agent Communications</h3>
                    <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs text-linear-text-tertiary">
                      <span>{commsStats.totalUnread} unread</span>
                      <span className="hidden sm:inline">•</span>
                      <span>{commsStats.totalMessages} total inbox</span>
                      <span className="hidden sm:inline">•</span>
                      <span>{commsStats.queueSize} queue</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 self-start sm:self-auto">
                    <button
                      onClick={() => { setShowComposeModal(true); setComposeAgentId(commsInboxes[0]?.agentId || ""); }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-linear-accent hover:bg-linear-accent-hover text-white text-xs font-medium transition-colors"
                    >
                      <Icons.plus />
                      <span>Compose</span>
                    </button>
                    <button
                      onClick={fetchComms}
                      disabled={isRefreshingComms}
                      className="px-3 py-1.5 rounded-md border border-linear-border bg-linear-bg-secondary text-xs text-linear-text-secondary transition-all hover:border-linear-accent/60 hover:text-linear-text hover:bg-linear-bg disabled:opacity-60"
                    >
                      {isRefreshingComms ? "Refreshing..." : "Refresh"}
                    </button>
                  </div>
                </div>
              </div>

              {/* Compose Modal */}
              {showComposeModal && (
                <div
                  className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-2 sm:p-4"
                  onMouseDown={(e) => { if (e.target === e.currentTarget) setShowComposeModal(false); }}
                >
                  <div className="w-full max-w-lg max-w-[calc(100vw-1rem)] bg-linear-bg-secondary rounded-lg border border-linear-border shadow-linear-lg animate-fadeIn" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-between px-4 py-3 border-b border-linear-border">
                      <h2 className="text-sm font-medium text-linear-text">Send Message</h2>
                      <button
                        onClick={() => setShowComposeModal(false)}
                        className="p-1 rounded hover:bg-linear-bg-tertiary text-linear-text-tertiary hover:text-linear-text-secondary"
                      >
                        <Icons.x />
                      </button>
                    </div>
                    <div className="p-4 space-y-4">
                      {/* Target: Inbox or Queue */}
                      <div className="flex gap-2">
                        <button
                          onClick={() => setComposeTarget("inbox")}
                          className={`flex-1 px-3 py-2 rounded-md border text-sm transition-colors ${
                            composeTarget === "inbox"
                              ? "border-linear-accent bg-linear-accent/10 text-linear-text"
                              : "border-linear-border bg-linear-bg text-linear-text-secondary hover:border-linear-accent/50"
                          }`}
                        >
                          📬 Agent Inbox
                        </button>
                        <button
                          onClick={() => setComposeTarget("queue")}
                          className={`flex-1 px-3 py-2 rounded-md border text-sm transition-colors ${
                            composeTarget === "queue"
                              ? "border-linear-accent bg-linear-accent/10 text-linear-text"
                              : "border-linear-border bg-linear-bg text-linear-text-secondary hover:border-linear-accent/50"
                          }`}
                        >
                          📢 Message Queue
                        </button>
                      </div>

                      {/* Agent selection (for inbox) */}
                      {composeTarget === "inbox" && (
                        <div>
                          <label className="block text-xs font-medium text-linear-text-secondary mb-1.5">To Agent</label>
                          <select
                            value={composeAgentId}
                            onChange={(e) => setComposeAgentId(e.target.value)}
                            className="w-full px-3 py-2 bg-linear-bg border border-linear-border rounded-md text-sm text-linear-text focus:border-linear-accent focus:outline-none"
                          >
                            {commsInboxes.map((inbox) => (
                              <option key={inbox.agentId} value={inbox.agentId}>
                                {inbox.agentEmoji} {inbox.agentName}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      {/* To (for queue) */}
                      {composeTarget === "queue" && (
                        <div>
                          <label className="block text-xs font-medium text-linear-text-secondary mb-1.5">To</label>
                          <select
                            value={composeTo}
                            onChange={(e) => setComposeTo(e.target.value)}
                            className="w-full px-3 py-2 bg-linear-bg border border-linear-border rounded-md text-sm text-linear-text focus:border-linear-accent focus:outline-none"
                          >
                            <option value="all">All Agents</option>
                            {commsInboxes.map((inbox) => (
                              <option key={inbox.agentId} value={inbox.agentId}>
                                {inbox.agentEmoji} {inbox.agentName}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      {/* From & Type */}
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-linear-text-secondary mb-1.5">From</label>
                          <select
                            value={composeFrom}
                            onChange={(e) => setComposeFrom(e.target.value)}
                            className="w-full px-3 py-2 bg-linear-bg border border-linear-border rounded-md text-sm text-linear-text focus:border-linear-accent focus:outline-none"
                          >
                            <option value="kevbot">KevBot</option>
                            <option value="dashboard">Dashboard</option>
                            <option value="system">System</option>
                            {commsInboxes.map((inbox) => (
                              <option key={inbox.agentId} value={inbox.agentId}>
                                {inbox.agentName}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-linear-text-secondary mb-1.5">Type</label>
                          <select
                            value={composeType}
                            onChange={(e) => setComposeType(e.target.value)}
                            className="w-full px-3 py-2 bg-linear-bg border border-linear-border rounded-md text-sm text-linear-text focus:border-linear-accent focus:outline-none"
                          >
                            <option value="info">Info</option>
                            <option value="task">Task</option>
                            <option value="handoff">Handoff</option>
                            <option value="urgent">Urgent</option>
                            <option value="update">Update</option>
                            <option value="request">Request</option>
                            <option value="alert">Alert</option>
                          </select>
                        </div>
                      </div>

                      {/* Message */}
                      <div>
                        <label className="block text-xs font-medium text-linear-text-secondary mb-1.5">Message</label>
                        <textarea
                          value={composeMessage}
                          onChange={(e) => setComposeMessage(e.target.value)}
                          placeholder="Enter your message..."
                          className="w-full min-h-[120px] px-3 py-2 bg-linear-bg border border-linear-border rounded-md text-sm text-linear-text placeholder:text-linear-text-tertiary focus:border-linear-accent focus:outline-none resize-y"
                          autoFocus
                        />
                      </div>
                    </div>
                    <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-linear-border bg-linear-bg-tertiary rounded-b-lg">
                      <button
                        onClick={() => setShowComposeModal(false)}
                        className="px-3 py-1.5 text-sm text-linear-text-secondary hover:text-linear-text transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={sendCommsMessage}
                        disabled={!composeMessage.trim() || isSendingMessage}
                        className="px-4 py-1.5 bg-linear-accent hover:bg-linear-accent-hover disabled:opacity-50 text-white text-sm font-medium rounded-md transition-colors"
                      >
                        {isSendingMessage ? "Sending..." : "Send Message"}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div className="grid gap-4 lg:grid-cols-2">
                {/* Agent Inboxes */}
                <div className="rounded-lg border border-linear-border bg-linear-bg-secondary overflow-hidden">
                  <div className="px-4 py-3 border-b border-linear-border bg-linear-bg-tertiary">
                    <h4 className="text-sm font-medium text-linear-text">Agent Inboxes</h4>
                  </div>
                  <div className="divide-y divide-linear-border">
                    {commsInboxes.map((inbox) => (
                      <div key={inbox.agentId}>
                        <div
                          onClick={() => setSelectedInbox(selectedInbox === inbox.agentId ? null : inbox.agentId)}
                          className="px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-linear-bg-hover transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            <span className="text-lg">{inbox.agentEmoji}</span>
                            <div>
                              <div className="text-sm font-medium text-linear-text">{inbox.agentName}</div>
                              <div className="text-xs text-linear-text-tertiary">{inbox.messages.length} messages</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {inbox.unreadCount > 0 && (
                              <span className="bg-linear-accent text-white text-xs px-2 py-0.5 rounded-full">{inbox.unreadCount}</span>
                            )}
                            <Icons.chevronRight />
                          </div>
                        </div>
                        {selectedInbox === inbox.agentId && inbox.messages.length > 0 && (
                          <div className="px-4 pb-3 space-y-2">
                            <div className="flex items-center gap-2 mb-2">
                              <button
                                onClick={() => markInboxRead(inbox.agentId)}
                                className="text-xs px-2 py-1 rounded border border-linear-border bg-linear-bg hover:border-linear-accent/50 transition-colors"
                              >
                                Mark all read
                              </button>
                              <button
                                onClick={() => clearInbox(inbox.agentId)}
                                className="text-xs px-2 py-1 rounded border border-linear-border bg-linear-bg hover:border-red-500/50 text-red-400 transition-colors"
                              >
                                Clear read
                              </button>
                            </div>
                            {[...inbox.messages]
                              .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
                              .map((msg) => (
                              <div
                                key={msg.id}
                                className={`p-3 rounded-md border text-xs ${msg.read ? "border-linear-border bg-linear-bg" : "border-linear-accent/30 bg-linear-accent/5"}`}
                              >
                                <div className="flex items-center justify-between mb-1">
                                  <span className={`font-medium ${msg.type === "handoff" ? "text-yellow-400" : msg.type === "urgent" ? "text-red-400" : "text-linear-text"}`}>
                                    {msg.type === "handoff" ? "🔄 " : msg.type === "urgent" ? "🚨 " : ""}{msg.type.toUpperCase()} from {msg.from}
                                  </span>
                                  <span className="text-linear-text-tertiary">{new Date(msg.timestamp).toLocaleString()}</span>
                                </div>
                                <div className="text-linear-text-secondary whitespace-pre-wrap">{msg.message}</div>
                              </div>
                            ))}
                          </div>
                        )}
                        {selectedInbox === inbox.agentId && inbox.messages.length === 0 && (
                          <div className="px-4 pb-3 text-xs text-linear-text-tertiary">No messages</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Message Queue */}
                <div className="rounded-lg border border-linear-border bg-linear-bg-secondary overflow-hidden">
                  <div className="px-4 py-3 border-b border-linear-border bg-linear-bg-tertiary flex items-center justify-between">
                    <h4 className="text-sm font-medium text-linear-text">Message Queue (Recent)</h4>
                    {commsQueue.length > 0 && (
                      <button
                        onClick={async () => {
                          if (confirm("Clear all messages from the queue?")) {
                            await fetch("/api/comms", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ action: "clearQueue" }),
                            });
                            await fetchComms();
                          }
                        }}
                        className="text-xs px-2 py-1 rounded border border-linear-border bg-linear-bg hover:border-red-500/50 text-red-400 transition-colors"
                      >
                        Clear Queue
                      </button>
                    )}
                  </div>
                  <div className="p-4 space-y-2 max-h-[500px] overflow-y-auto">
                    {commsQueue.length === 0 ? (
                      <div className="text-xs text-linear-text-tertiary text-center py-4">No messages in queue</div>
                    ) : (
                      commsQueue.map((msg) => (
                        <div key={msg.id} className="p-3 rounded-md border border-linear-border bg-linear-bg text-xs">
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-medium text-linear-text">
                              {msg.from} → {msg.to}
                            </span>
                            <span className="text-linear-text-tertiary">{new Date(msg.timestamp).toLocaleString()}</span>
                          </div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                              msg.type === "handoff" ? "bg-yellow-500/20 text-yellow-400" :
                              msg.type === "alert" ? "bg-red-500/20 text-red-400" :
                              "bg-linear-bg-tertiary text-linear-text-tertiary"
                            }`}>
                              {msg.type}
                            </span>
                          </div>
                          <div className="text-linear-text-secondary">{msg.message}</div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activePanel === "bitches" && (
            <div className="animate-fadeIn space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-linear-text">Contacts ({bitchesList.length})</h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={fetchBitches}
                    disabled={isRefreshingBitches}
                    className="px-3 py-1.5 rounded-md border border-linear-border bg-linear-bg-secondary text-xs text-linear-text-secondary"
                  >
                    {isRefreshingBitches ? "Refreshing..." : "Refresh"}
                  </button>
                  <button
                    onClick={() => {
                      setShowAddBitchModal(true);
                      setNewBitchDateMet(new Date().toISOString().split("T")[0]);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-linear-accent hover:bg-linear-accent-hover text-white text-xs font-medium"
                  >
                    <Icons.plus />
                    Add
                  </button>
                </div>
              </div>

              <div className="rounded-lg border border-linear-border bg-linear-bg-secondary overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[740px]">
                    <thead>
                      <tr className="border-b border-linear-border bg-linear-bg-tertiary">
                        <th className="text-left px-4 py-2.5 text-xs font-medium text-linear-text-secondary uppercase tracking-wider">Name</th>
                        <th className="text-left px-4 py-2.5 text-xs font-medium text-linear-text-secondary uppercase tracking-wider">Date Met</th>
                        <th className="text-left px-4 py-2.5 text-xs font-medium text-linear-text-secondary uppercase tracking-wider">Context</th>
                        <th className="text-left px-4 py-2.5 text-xs font-medium text-linear-text-secondary uppercase tracking-wider">Notes</th>
                        <th className="text-right px-4 py-2.5 text-xs font-medium text-linear-text-secondary uppercase tracking-wider">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bitchesList.map((person) => (
                        <tr
                          key={`${person.name}-${person.dateMet}`}
                          className="border-b border-linear-border last:border-0 hover:bg-linear-bg-hover cursor-pointer"
                          onClick={() => {
                            setSelectedBitch(person);
                            setEditingBitch({ ...person, details: [...(person.details || [])] });
                          }}
                        >
                          <td className="px-4 py-3 text-sm text-linear-text">
                            {person.name}
                            {person.nickname ? <span className="text-linear-text-tertiary"> ({person.nickname})</span> : null}
                          </td>
                          <td className="px-4 py-3 text-xs text-linear-text-secondary">{person.dateMet || "—"}</td>
                          <td className="px-4 py-3 text-xs text-linear-text-secondary max-w-[200px] truncate">{person.context || "—"}</td>
                          <td className="px-4 py-3 text-xs text-linear-text-secondary max-w-[280px] truncate">
                            {[person.note, ...(person.details || [])].filter(Boolean).join(" • ") || "—"}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="inline-flex items-center gap-1">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedBitch(person);
                                  setEditingBitch({ ...person, details: [...(person.details || [])] });
                                }}
                                className="p-1 rounded hover:bg-linear-bg-tertiary text-linear-text-tertiary hover:text-linear-text"
                              >
                                <Icons.edit />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  deleteBitch(person.name);
                                }}
                                className="p-1 rounded hover:bg-linear-bg-tertiary text-linear-text-tertiary hover:text-linear-error"
                              >
                                <Icons.trash />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {bitchesList.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-4 py-8 text-center text-sm text-linear-text-tertiary">No entries yet</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {showAddBitchModal && (
                <div
                  className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
                  onMouseDown={(e) => { if (e.target === e.currentTarget) setShowAddBitchModal(false); }}
                >
                  <div className="w-full max-w-[calc(100vw-2rem)] max-w-lg rounded-lg border border-linear-border bg-linear-bg-secondary shadow-lg" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-between px-4 py-3 border-b border-linear-border">
                      <h4 className="text-sm font-medium text-linear-text">Add Contact</h4>
                      <button onClick={() => setShowAddBitchModal(false)} className="text-linear-text-tertiary hover:text-linear-text"><Icons.x /></button>
                    </div>
                    <div className="p-4 grid grid-cols-1 gap-3">
                      <input value={newBitchName} onChange={(e) => setNewBitchName(e.target.value)} placeholder="Name" className="px-3 py-2 bg-linear-bg border border-linear-border rounded-md text-sm text-linear-text" />
                      <input value={newBitchNickname} onChange={(e) => setNewBitchNickname(e.target.value)} placeholder="Nickname (optional)" className="px-3 py-2 bg-linear-bg border border-linear-border rounded-md text-sm text-linear-text" />
                      <input type="date" value={newBitchDateMet} onChange={(e) => setNewBitchDateMet(e.target.value)} className="px-3 py-2 bg-linear-bg border border-linear-border rounded-md text-sm text-linear-text" />
                      <input value={newBitchContext} onChange={(e) => setNewBitchContext(e.target.value)} placeholder="Context (where met)" className="px-3 py-2 bg-linear-bg border border-linear-border rounded-md text-sm text-linear-text" />
                      <textarea value={newBitchNote} onChange={(e) => setNewBitchNote(e.target.value)} placeholder="Notes" className="px-3 py-2 bg-linear-bg border border-linear-border rounded-md text-sm text-linear-text min-h-[80px]" />
                    </div>
                    <div className="flex justify-end gap-2 px-4 py-3 border-t border-linear-border">
                      <button onClick={() => setShowAddBitchModal(false)} className="px-3 py-1.5 text-sm text-linear-text-secondary">Cancel</button>
                      <button onClick={addBitch} disabled={!newBitchName.trim()} className="px-3 py-1.5 rounded-md bg-linear-accent hover:bg-linear-accent-hover text-white text-sm disabled:opacity-50">Save</button>
                    </div>
                  </div>
                </div>
              )}

              {selectedBitch && editingBitch && (
                <div
                  className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
                  onMouseDown={(e) => { if (e.target === e.currentTarget) { setSelectedBitch(null); setEditingBitch(null); } }}
                >
                  <div className="w-full max-w-[calc(100vw-2rem)] max-w-xl rounded-lg border border-linear-border bg-linear-bg-secondary shadow-lg" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-between px-4 py-3 border-b border-linear-border">
                      <h4 className="text-sm font-medium text-linear-text">Edit: {selectedBitch.name}</h4>
                      <button onClick={() => { setSelectedBitch(null); setEditingBitch(null); }} className="text-linear-text-tertiary hover:text-linear-text"><Icons.x /></button>
                    </div>
                    <div className="p-4 grid grid-cols-1 gap-3">
                      <input value={editingBitch.name} onChange={(e) => setEditingBitch({ ...editingBitch, name: e.target.value })} className="px-3 py-2 bg-linear-bg border border-linear-border rounded-md text-sm text-linear-text" />
                      <input value={editingBitch.nickname || ""} onChange={(e) => setEditingBitch({ ...editingBitch, nickname: e.target.value })} placeholder="Nickname" className="px-3 py-2 bg-linear-bg border border-linear-border rounded-md text-sm text-linear-text" />
                      <input type="date" value={editingBitch.dateMet} onChange={(e) => setEditingBitch({ ...editingBitch, dateMet: e.target.value })} className="px-3 py-2 bg-linear-bg border border-linear-border rounded-md text-sm text-linear-text" />
                      <input value={editingBitch.context} onChange={(e) => setEditingBitch({ ...editingBitch, context: e.target.value })} className="px-3 py-2 bg-linear-bg border border-linear-border rounded-md text-sm text-linear-text" />
                      <textarea value={editingBitch.note} onChange={(e) => setEditingBitch({ ...editingBitch, note: e.target.value })} className="px-3 py-2 bg-linear-bg border border-linear-border rounded-md text-sm text-linear-text min-h-[80px]" />
                      <textarea
                        value={(editingBitch.details || []).join("\n")}
                        onChange={(e) => setEditingBitch({ ...editingBitch, details: e.target.value.split("\n").map(s => s.trim()).filter(Boolean) })}
                        placeholder="One detail per line"
                        className="px-3 py-2 bg-linear-bg border border-linear-border rounded-md text-sm text-linear-text min-h-[100px]"
                      />
                    </div>
                    <div className="flex justify-end gap-2 px-4 py-3 border-t border-linear-border">
                      <button onClick={() => { setSelectedBitch(null); setEditingBitch(null); }} className="px-3 py-1.5 text-sm text-linear-text-secondary">Cancel</button>
                      <button onClick={updateBitch} className="px-3 py-1.5 rounded-md bg-linear-accent hover:bg-linear-accent-hover text-white text-sm">Save Changes</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {activePanel === "goals" && (
            <div className="animate-fadeIn space-y-6">
              <div className="grid gap-6 md:grid-cols-3">
                {goalCategories.map((cat) => (
                  <div
                    key={cat.id}
                    className="rounded-lg border border-linear-border bg-linear-bg-secondary overflow-hidden"
                    style={{
                      borderTopWidth: 2,
                      borderTopColor:
                        cat.id === "career" ? "#3b82f6" :
                        cat.id === "personal" ? "#22c55e" :
                        "#f59e0b",
                    }}
                  >
                    <div className="px-4 py-3 border-b border-linear-border bg-linear-bg-tertiary flex items-center gap-2">
                      <span
                        className="inline-block w-2 h-2 rounded-full"
                        style={{
                          backgroundColor:
                            cat.id === "career" ? "#3b82f6" :
                            cat.id === "personal" ? "#22c55e" :
                            "#f59e0b",
                        }}
                      />
                      <h3 className="text-sm font-medium text-linear-text">{cat.title}</h3>
                    </div>
                    <div className="p-3 space-y-1">
                      {goals[cat.id]
                        .filter((goal) => matchesSearch(goal))
                        .map((goal, index) => (
                        <div key={index} className="group flex items-center gap-2 px-3 py-2 rounded-md hover:bg-linear-bg-hover">
                          {editingGoal?.category === cat.id && editingGoal?.index === index ? (
                            <div className="flex-1 flex gap-2">
                              <input
                                type="text"
                                value={editingGoalText}
                                onChange={(e) => setEditingGoalText(e.target.value)}
                                className="flex-1 px-2 py-1 text-sm bg-linear-bg border border-linear-border rounded text-linear-text focus:border-linear-accent focus:outline-none"
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    handleUpdateGoal(cat.id, index, editingGoalText);
                                  } else if (e.key === "Escape") {
                                    setEditingGoal(null);
                                    setEditingGoalText("");
                                  }
                                }}
                              />
                              <button
                                onClick={() => handleUpdateGoal(cat.id, index, editingGoalText)}
                                className="text-linear-success hover:text-linear-success/80"
                              >
                                <Icons.check />
                              </button>
                              <button
                                onClick={() => {
                                  setEditingGoal(null);
                                  setEditingGoalText("");
                                }}
                                className="text-linear-text-tertiary hover:text-linear-text-secondary"
                              >
                                <Icons.x />
                              </button>
                            </div>
                          ) : (
                            <>
                              <span className="text-sm text-linear-text-secondary flex-1">{goal}</span>
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  onClick={() => {
                                    setEditingGoal({ category: cat.id, index });
                                    setEditingGoalText(goal);
                                  }}
                                  className="p-1 rounded hover:bg-linear-bg-tertiary text-linear-text-tertiary hover:text-linear-text-secondary"
                                >
                                  <Icons.edit />
                                </button>
                                <button
                                  onClick={() => handleDeleteGoal(cat.id, index)}
                                  className="p-1 rounded hover:bg-linear-bg-tertiary text-linear-text-tertiary hover:text-linear-error"
                                >
                                  <Icons.trash />
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Add new goal */}
              <div className="flex items-center gap-3 pt-4 border-t border-linear-border">
                <select
                  value={newGoalCategory}
                  onChange={(e) => setNewGoalCategory(e.target.value as keyof Goals)}
                  className="px-3 py-2 bg-linear-bg-secondary border border-linear-border rounded-md text-sm text-linear-text focus:border-linear-accent focus:outline-none"
                >
                  <option value="career">Career</option>
                  <option value="personal">Personal</option>
                  <option value="business">Business</option>
                </select>
                <input
                  type="text"
                  value={newGoalText}
                  onChange={(e) => setNewGoalText(e.target.value)}
                  placeholder="Add a new goal..."
                  className="flex-1 max-w-md px-3 py-2 bg-linear-bg-secondary border border-linear-border rounded-md text-sm text-linear-text placeholder:text-linear-text-tertiary focus:border-linear-accent focus:outline-none"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAddGoal();
                  }}
                />
                <button
                  onClick={handleAddGoal}
                  disabled={!newGoalText.trim()}
                  className="px-4 py-2 bg-linear-accent hover:bg-linear-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-md transition-colors"
                >
                  Add
                </button>
              </div>
            </div>
          )}

          {activePanel === "none" && (
            <DragDropContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
              <section className="grid gap-4 lg:grid-cols-3">
                {columns.map((column) => {
                  const columnTasks = tasksByStatus[column.id];
                  return (
                    <div key={column.id} className="flex flex-col min-h-[500px]">
                      {/* Column Header */}
                      <div className="flex items-center justify-between mb-3 px-1">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${column.dotColor}`} />
                          <h2 className={`text-xs font-semibold uppercase tracking-wider ${column.color}`}>
                            {column.title}
                          </h2>
                          <span className="text-xs text-linear-text-tertiary">{columnTasks.length}</span>
                        </div>
                      </div>

                      {/* Column Content */}
                      <Droppable droppableId={column.id}>
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.droppableProps}
                            className={`flex-1 rounded-lg transition-colors ${
                              snapshot.isDraggingOver 
                                ? "bg-linear-bg-tertiary/50" 
                                : "bg-transparent"
                            }`}
                          >
                            <div className="space-y-2">
                              {columnTasks.map((task, index) => (
                                <Draggable key={task.id} draggableId={task.id} index={index}>
                                  {(dragProvided, dragSnapshot) => (
                                    <div
                                      ref={dragProvided.innerRef}
                                      {...dragProvided.draggableProps}
                                      {...dragProvided.dragHandleProps}
                                      onClick={() => setSelectedTask(task)}
                                      className={`group relative p-3 rounded-md border transition-all cursor-pointer ${
                                        dragSnapshot.isDragging
                                          ? "bg-linear-bg-tertiary border-linear-accent shadow-linear-lg rotate-1"
                                          : "bg-linear-bg-secondary border-linear-border-subtle hover:border-linear-border"
                                      }`}
                                    >
                                      {/* Task ID & Delete */}
                                      <div className="flex items-center justify-between mb-2">
                                        <span className="text-[10px] text-linear-text-tertiary font-mono">
                                          {task.id.slice(0, 6).toUpperCase()}
                                        </span>
                                        <button
                                          onClick={(e) => { e.stopPropagation(); handleDeleteTask(task.id); }}
                                          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-linear-bg-hover text-linear-text-tertiary hover:text-linear-error transition-all"
                                        >
                                          <Icons.trash />
                                        </button>
                                      </div>
                                      
                                      {/* Task Title */}
                                      <h3 className="text-sm font-medium text-linear-text leading-snug mb-1">
                                        {task.title}
                                      </h3>
                                      
                                      {/* Task Description Preview */}
                                      {task.description && (
                                        <p className="text-xs text-linear-text-secondary leading-relaxed mb-2">
                                          {task.description.length > 60 ? task.description.slice(0, 60) + "…" : task.description}
                                        </p>
                                      )}
                                      
                                      {/* Task Footer */}
                                      <div className="flex items-center justify-between pt-1">
                                        <span className="text-[10px] text-linear-text-tertiary">
                                          {formatDate(task.createdAt)}
                                        </span>
                                        {task.assignee && (
                                          <span
                                            className="text-[10px] px-1.5 py-0.5 rounded border"
                                            style={getAssigneeBadgeStyle(task.assignee)}
                                          >
                                            {task.assignee}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </Draggable>
                              ))}
                              {provided.placeholder}
                              
                              {!columnTasks.length && !isLoading && (
                                <div className="py-8 text-center text-xs text-linear-text-tertiary border border-dashed border-linear-border rounded-md">
                                  Drop tasks here
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </Droppable>
                    </div>
                  );
                })}
              </section>
            </DragDropContext>
          )}
        </div>
      </main>

      {/* Add Task Modal - Linear Style */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="w-full max-w-[calc(100vw-2rem)] max-w-lg bg-linear-bg-secondary rounded-lg border border-linear-border shadow-linear-lg animate-fadeIn">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-linear-border">
              <h2 className="text-sm font-medium text-linear-text">New Task</h2>
              <button
                onClick={() => {
                  setShowAddModal(false);
                  setNewTaskTitle("");
                  setNewTaskDescription("");
                  setNewTaskStatus("todo");
                }}
                className="p-1 rounded hover:bg-linear-bg-tertiary text-linear-text-tertiary hover:text-linear-text-secondary"
              >
                <Icons.x />
              </button>
            </div>
            
            {/* Modal Body */}
            <div className="p-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-linear-text-secondary uppercase tracking-wider mb-1.5">
                  Title
                </label>
                <input
                  type="text"
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  className="w-full px-3 py-2 bg-linear-bg border border-linear-border rounded-md text-sm text-linear-text placeholder:text-linear-text-tertiary focus:border-linear-accent focus:outline-none transition-colors"
                  placeholder="Issue title"
                  autoFocus
                />
              </div>
              
              <div>
                <label className="block text-xs font-medium text-linear-text-secondary uppercase tracking-wider mb-1.5">
                  Description
                </label>
                <textarea
                  value={newTaskDescription}
                  onChange={(e) => setNewTaskDescription(e.target.value)}
                  className="w-full px-3 py-2 bg-linear-bg border border-linear-border rounded-md text-sm text-linear-text placeholder:text-linear-text-tertiary focus:border-linear-accent focus:outline-none transition-colors resize-y"
                  placeholder="Add a description..."
                  rows={3}
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-linear-text-secondary uppercase tracking-wider mb-1.5">
                    Status
                  </label>
                  <select
                    value={newTaskStatus}
                    onChange={(e) => setNewTaskStatus(e.target.value as TaskStatus)}
                    className="w-full px-3 py-2 bg-linear-bg border border-linear-border rounded-md text-sm text-linear-text focus:border-linear-accent focus:outline-none"
                  >
                    <option value="todo">To Do</option>
                    <option value="inprogress">In Progress</option>
                    <option value="done">Done</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-linear-text-secondary uppercase tracking-wider mb-1.5">
                    Assignee
                  </label>
                  <select
                    value={newTaskAssignee}
                    onChange={(e) => setNewTaskAssignee(e.target.value)}
                    className="w-full px-3 py-2 bg-linear-bg border border-linear-border rounded-md text-sm text-linear-text focus:border-linear-accent focus:outline-none"
                  >
                    <option value="">Unassigned</option>
                  </select>
                </div>
              </div>
            </div>
            
            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-linear-border bg-linear-bg-tertiary rounded-b-lg">
              <button
                onClick={() => {
                  setShowAddModal(false);
                  setNewTaskTitle("");
                  setNewTaskDescription("");
                  setNewTaskStatus("todo");
                  setNewTaskAssignee("");
                }}
                className="px-3 py-1.5 text-sm text-linear-text-secondary hover:text-linear-text transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAddTask}
                disabled={!newTaskTitle.trim()}
                className="px-3 py-1.5 bg-linear-accent hover:bg-linear-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-md transition-colors"
              >
                Create Task
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cron Manager Modal */}
      {showCronManager && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="w-full max-w-3xl bg-linear-bg-secondary rounded-lg border border-linear-border shadow-linear-lg animate-fadeIn">
            <div className="flex items-center justify-between px-4 py-3 border-b border-linear-border">
              <h2 className="text-sm font-medium text-linear-text">Cron Manager</h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={createNewJob}
                  className="px-3 py-1.5 rounded-md bg-linear-accent hover:bg-linear-accent-hover text-white text-sm font-medium transition-colors"
                >
                  New Job
                </button>
                <button
                  onClick={() => {
                    setShowCronManager(false);
                    setEditingJob(null);
                    setJobForm(null);
                    setJobBase(null);
                  }}
                  className="p-1 rounded hover:bg-linear-bg-tertiary text-linear-text-tertiary hover:text-linear-text-secondary"
                >
                  <Icons.x />
                </button>
              </div>
            </div>

            <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
              <div className="rounded-lg border border-linear-border bg-linear-bg overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-linear-border bg-linear-bg-tertiary">
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-linear-text-secondary uppercase tracking-wider">Name</th>
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-linear-text-secondary uppercase tracking-wider">Schedule</th>
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-linear-text-secondary uppercase tracking-wider">Enabled</th>
                      <th className="text-right px-4 py-2.5 text-xs font-medium text-linear-text-secondary uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cronJobs.map((job) => (
                      <tr key={job.id} className="border-b border-linear-border last:border-0 hover:bg-linear-bg-hover">
                        <td className="px-4 py-3 text-sm text-linear-text">{job.name}</td>
                        <td className="px-4 py-3 text-sm text-linear-text-secondary">{formatSchedule(job)}</td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => toggleJob(job)}
                            className={`px-2 py-1 rounded text-xs ${job.enabled ? "bg-linear-success/20 text-linear-success" : "bg-linear-text-tertiary/20 text-linear-text-tertiary"}`}
                          >
                            {job.enabled ? "On" : "Off"}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => {
                              setSelectedCronJob(job);
                              fetchCronRuns(job.id);
                            }}
                            className="text-xs text-linear-accent hover:text-linear-accent/80 mr-3"
                          >
                            Runs
                          </button>
                          <button
                            onClick={() => openJobEditor(job)}
                            className="text-xs text-linear-text-secondary hover:text-linear-text mr-3"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => deleteJob(job.id)}
                            className="text-xs text-linear-error hover:text-linear-error/80"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                    {cronJobs.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-center text-sm text-linear-text-tertiary">
                          No jobs found
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="rounded-lg border border-linear-border bg-linear-bg-secondary">
                <div className="px-4 py-2 border-b border-linear-border text-xs font-medium text-linear-text-secondary">
                  {editingJob ? "Edit Job" : "New Job"}
                </div>
                {jobForm ? (
                  <div className="p-4 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-linear-text-secondary uppercase tracking-wider mb-1.5">Name</label>
                        <input
                          value={jobForm.name}
                          onChange={(e) => setJobForm({ ...jobForm, name: e.target.value })}
                          className="w-full px-3 py-2 bg-linear-bg border border-linear-border rounded-md text-sm text-linear-text"
                        />
                      </div>
                      <div className="flex items-end gap-2">
                        <label className="flex items-center gap-2 text-sm text-linear-text-secondary">
                          <input
                            type="checkbox"
                            checked={!!jobForm.enabled}
                            onChange={(e) => setJobForm({ ...jobForm, enabled: e.target.checked })}
                          />
                          Enabled
                        </label>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-linear-text-secondary uppercase tracking-wider mb-1.5">Schedule Type</label>
                        <select
                          value={jobForm.scheduleKind}
                          onChange={(e) => setJobForm({ ...jobForm, scheduleKind: e.target.value })}
                          className="w-full px-3 py-2 bg-linear-bg border border-linear-border rounded-md text-sm text-linear-text"
                        >
                          <option value="cron">Cron</option>
                          <option value="every">Every</option>
                          <option value="at">At</option>
                        </select>
                      </div>
                      {jobForm.scheduleKind === "cron" && (
                        <>
                          <div>
                            <label className="block text-xs font-medium text-linear-text-secondary uppercase tracking-wider mb-1.5">
                              Cron Expr
                              <span className="ml-2 text-[10px] font-normal text-linear-text-tertiary normal-case tracking-normal">
                                or pick a daily time →
                              </span>
                            </label>
                            <input
                              value={jobForm.cronExpr}
                              onChange={(e) => setJobForm({ ...jobForm, cronExpr: e.target.value })}
                              className="w-full px-3 py-2 bg-linear-bg border border-linear-border rounded-md text-sm text-linear-text font-mono"
                              placeholder="0 9 * * *"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-linear-text-secondary uppercase tracking-wider mb-1.5">Daily at time</label>
                            <input
                              type="time"
                              onChange={(e) => {
                                const val = e.target.value; // HH:MM
                                if (!val) return;
                                const [hh, mm] = val.split(":");
                                setJobForm({ ...jobForm, cronExpr: `${parseInt(mm)} ${parseInt(hh)} * * *` });
                              }}
                              defaultValue={(() => {
                                const m = jobForm.cronExpr.match(/^(\d+)\s+(\d+)\s+\*\s+\*\s+\*$/);
                                if (m) return `${m[2].padStart(2, "0")}:${m[1].padStart(2, "0")}`;
                                return "";
                              })()}
                              className="w-full px-3 py-2 bg-linear-bg border border-linear-border rounded-md text-sm text-linear-text"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-linear-text-secondary uppercase tracking-wider mb-1.5">Time Zone</label>
                            <input
                              value={jobForm.cronTz}
                              onChange={(e) => setJobForm({ ...jobForm, cronTz: e.target.value })}
                              className="w-full px-3 py-2 bg-linear-bg border border-linear-border rounded-md text-sm text-linear-text"
                            />
                          </div>
                        </>
                      )}
                      {jobForm.scheduleKind === "every" && (
                        <div>
                          <label className="block text-xs font-medium text-linear-text-secondary uppercase tracking-wider mb-1.5">Every (minutes)</label>
                          <input
                            type="number"
                            min="1"
                            value={jobForm.everyMinutes}
                            onChange={(e) => setJobForm({ ...jobForm, everyMinutes: e.target.value })}
                            className="w-full px-3 py-2 bg-linear-bg border border-linear-border rounded-md text-sm text-linear-text"
                          />
                        </div>
                      )}
                      {jobForm.scheduleKind === "at" && (
                        <div>
                          <label className="block text-xs font-medium text-linear-text-secondary uppercase tracking-wider mb-1.5">Run At</label>
                          <input
                            type="datetime-local"
                            value={jobForm.atTime}
                            onChange={(e) => setJobForm({ ...jobForm, atTime: e.target.value })}
                            className="w-full px-3 py-2 bg-linear-bg border border-linear-border rounded-md text-sm text-linear-text"
                          />
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-linear-text-secondary uppercase tracking-wider mb-1.5">Session Target</label>
                        <select
                          value={jobForm.sessionTarget}
                          onChange={(e) => setJobForm({ ...jobForm, sessionTarget: e.target.value })}
                          className="w-full px-3 py-2 bg-linear-bg border border-linear-border rounded-md text-sm text-linear-text"
                        >
                          <option value="isolated">isolated</option>
                          <option value="main">main</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-linear-text-secondary uppercase tracking-wider mb-1.5">Payload Kind</label>
                        <select
                          value={jobForm.payloadKind}
                          onChange={(e) => setJobForm({ ...jobForm, payloadKind: e.target.value })}
                          className="w-full px-3 py-2 bg-linear-bg border border-linear-border rounded-md text-sm text-linear-text"
                        >
                          <option value="agentTurn">agentTurn</option>
                          <option value="systemEvent">systemEvent</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-linear-text-secondary uppercase tracking-wider mb-1.5">Payload Message</label>
                      <textarea
                        value={jobForm.payloadMessage}
                        onChange={(e) => setJobForm({ ...jobForm, payloadMessage: e.target.value })}
                        className="w-full h-24 px-3 py-2 bg-linear-bg border border-linear-border rounded-md text-sm text-linear-text"
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-linear-text-secondary uppercase tracking-wider mb-1.5">Agent</label>
                        <select
                          value={jobForm.agentId}
                          onChange={(e) => setJobForm({ ...jobForm, agentId: e.target.value })}
                          className="w-full px-3 py-2 bg-linear-bg border border-linear-border rounded-md text-sm text-linear-text"
                        >
                          <option value="">Default (main)</option>
                          {agents.map((agent) => (
                            <option key={agent.id} value={agent.id}>
                              {agent.emoji} {agent.name} ({agent.role})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-linear-text-secondary uppercase tracking-wider mb-1.5">Model</label>
                        <select
                          value={jobForm.payloadModel}
                          onChange={(e) => setJobForm({ ...jobForm, payloadModel: e.target.value })}
                          className="w-full px-3 py-2 bg-linear-bg border border-linear-border rounded-md text-sm text-linear-text"
                        >
                          {wakeModels.map((m) => (
                            <option key={m.value} value={m.value}>
                              {m.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-linear-text-secondary uppercase tracking-wider mb-1.5">Delivery Mode</label>
                        <select
                          value={jobForm.deliveryMode}
                          onChange={(e) => setJobForm({ ...jobForm, deliveryMode: e.target.value })}
                          className="w-full px-3 py-2 bg-linear-bg border border-linear-border rounded-md text-sm text-linear-text"
                        >
                          <option value="announce">announce</option>
                          <option value="webhook">webhook</option>
                          <option value="none">none</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-linear-text-secondary uppercase tracking-wider mb-1.5">Channel</label>
                        <input
                          value={jobForm.deliveryChannel}
                          onChange={(e) => setJobForm({ ...jobForm, deliveryChannel: e.target.value })}
                          className="w-full px-3 py-2 bg-linear-bg border border-linear-border rounded-md text-sm text-linear-text"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-linear-text-secondary uppercase tracking-wider mb-1.5">Delivery To</label>
                        <input
                          value={jobForm.deliveryTo}
                          onChange={(e) => setJobForm({ ...jobForm, deliveryTo: e.target.value })}
                          className="w-full px-3 py-2 bg-linear-bg border border-linear-border rounded-md text-sm text-linear-text"
                        />
                      </div>
                    </div>

                    {jobError && (
                      <div className="text-xs text-linear-error">{jobError}</div>
                    )}

                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => {
                          setEditingJob(null);
                          setJobForm(null);
                        }}
                        className="px-3 py-1.5 text-sm text-linear-text-secondary hover:text-linear-text transition-colors"
                      >
                        Clear
                      </button>
                      <button
                        onClick={saveJob}
                        className="px-3 py-1.5 bg-linear-accent hover:bg-linear-accent-hover text-white text-sm font-medium rounded-md transition-colors"
                      >
                        Save Job
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="p-4 text-sm text-linear-text-tertiary">
                    Select a job from the list above or click <strong>New Job</strong>.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Task Detail Modal */}
      {selectedTask && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setSelectedTask(null);
              setEditingTaskMode(false);
            }
          }}
        >
          <div
            className="w-full max-w-[calc(100vw-2rem)] max-w-lg bg-linear-bg-secondary rounded-lg border border-linear-border shadow-linear-lg animate-fadeIn"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-linear-border">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-linear-text-tertiary font-mono bg-linear-bg-tertiary px-1.5 py-0.5 rounded">
                  {selectedTask.id.slice(0, 6).toUpperCase()}
                </span>
                <span className={`text-xs px-2 py-0.5 rounded ${
                  selectedTask.status === "done" ? "bg-linear-success/20 text-linear-success" :
                  selectedTask.status === "inprogress" ? "bg-linear-accent/20 text-linear-accent" :
                  "bg-linear-text-tertiary/20 text-linear-text-tertiary"
                }`}>
                  {selectedTask.status === "inprogress" ? "In Progress" : selectedTask.status === "done" ? "Done" : "To Do"}
                </span>
              </div>
              <div className="flex items-center gap-1">
                {!editingTaskMode && (
                  <button
                    onClick={() => { setEditTaskTitle(selectedTask.title); setEditTaskDesc(selectedTask.description || ""); setEditTaskAssignee(selectedTask.assignee || ""); setEditingTaskMode(true); }}
                    className="px-2 py-1 text-xs rounded hover:bg-linear-bg-tertiary text-linear-text-tertiary hover:text-linear-text-secondary"
                  >
                    Edit
                  </button>
                )}
                <button onClick={() => { setSelectedTask(null); setEditingTaskMode(false); }} className="p-1 rounded hover:bg-linear-bg-tertiary text-linear-text-tertiary hover:text-linear-text-secondary">
                  <Icons.x />
                </button>
              </div>
            </div>
            <div className="p-4 space-y-4">
              {editingTaskMode ? (
                <>
                  <div>
                    <label className="block text-xs font-medium text-linear-text-secondary uppercase tracking-wider mb-1.5">Title</label>
                    <input
                      value={editTaskTitle}
                      onChange={(e) => setEditTaskTitle(e.target.value)}
                      className="w-full px-3 py-2 bg-linear-bg border border-linear-border rounded-md text-sm text-linear-text"
                      placeholder="Task title"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-linear-text-secondary uppercase tracking-wider mb-1.5">Description</label>
                    <textarea
                      value={editTaskDesc}
                      onChange={(e) => setEditTaskDesc(e.target.value)}
                      rows={4}
                      className="w-full px-3 py-2 bg-linear-bg border border-linear-border rounded-md text-sm text-linear-text resize-y"
                      placeholder="Add a description..."
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-linear-text-secondary uppercase tracking-wider mb-1.5">Assignee</label>
                    <select
                      value={editTaskAssignee}
                      onChange={(e) => setEditTaskAssignee(e.target.value)}
                      className="w-full px-3 py-2 bg-linear-bg border border-linear-border rounded-md text-sm text-linear-text"
                    >
                      <option value="">Unassigned</option>
                                </select>
                  </div>
                  <div className="flex items-center gap-2 justify-end">
                    <button
                      onClick={() => setEditingTaskMode(false)}
                      className="px-3 py-1.5 text-sm rounded-md border border-linear-border text-linear-text-secondary hover:text-linear-text hover:bg-linear-bg-tertiary"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => handleUpdateTask(selectedTask.id, { title: editTaskTitle.trim() || selectedTask.title, description: editTaskDesc.trim() || undefined, assignee: editTaskAssignee || undefined })}
                      className="px-3 py-1.5 text-sm rounded-md bg-linear-accent text-white hover:bg-linear-accent/90"
                    >
                      Save
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <h2 className="text-lg font-medium text-linear-text">{selectedTask.title}</h2>
                  {selectedTask.description ? (
                    <p className="text-sm text-linear-text-secondary whitespace-pre-wrap">{selectedTask.description}</p>
                  ) : (
                    <p className="text-sm text-linear-text-tertiary italic">No description</p>
                  )}
                  <div className="flex items-center gap-4 text-xs text-linear-text-tertiary">
                    <span>Created: {new Date(selectedTask.createdAt).toLocaleString()}</span>
                    {selectedTask.assignee && (
                      <span
                        className="px-2 py-0.5 rounded border"
                        style={getAssigneeBadgeStyle(selectedTask.assignee)}
                      >
                        Assigned to: {selectedTask.assignee}
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Schedule Day Modal */}
      {selectedScheduleDay && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setSelectedScheduleDay(null)}>
          <div className="w-full max-w-2xl bg-linear-bg-secondary rounded-lg border border-linear-border shadow-linear-lg max-h-[80vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-linear-border">
              <div className="text-sm font-medium text-linear-text">
                {parseLocalDate(selectedScheduleDay).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" })}
              </div>
              <button onClick={() => setSelectedScheduleDay(null)} className="p-1 rounded hover:bg-linear-bg-tertiary text-linear-text-tertiary hover:text-linear-text-secondary">
                <Icons.x />
              </button>
            </div>
            <div className="p-4 overflow-y-auto max-h-[calc(80vh-56px)]">
              {(() => {
                const dayData = scheduleCalendarData[selectedScheduleDay] || { scheduled: [], runs: [] };
                const items = [
                  ...dayData.scheduled.map((x: any) => ({ ...x, _kind: 'scheduled' })),
                  ...dayData.runs.map((x: any) => ({ ...x, _kind: 'run' })),
                ].sort((a: any, b: any) => (a.timeMs || 0) - (b.timeMs || 0));
                if (items.length === 0) {
                  return <div className="text-sm text-linear-text-tertiary">No tasks for this day.</div>;
                }
                return (
                  <div className="space-y-2">
                    {items.map((item: any, idx: number) => (
                      <button
                        key={`${item.id}-${item.timeMs}-${idx}`}
                        onClick={() => {
                          const fullJob = cronJobs.find((cj) => cj.id === item.id);
                          if (fullJob) {
                            setSelectedScheduleDay(null);
                            setSelectedCronJob(fullJob);
                          }
                        }}
                        className={`w-full text-left rounded border px-3 py-2 hover:opacity-90 ${colorForName(item.name || 'task')}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-xs font-medium truncate">{item.name}</div>
                          <div className="text-[10px] text-linear-text-tertiary whitespace-nowrap">{item.timeMs ? new Date(item.timeMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—'}</div>
                        </div>
                        <div className="mt-1 text-[10px]">
                          <span className={item._kind === 'run' ? 'text-linear-success' : 'text-linear-accent'}>{item._kind === 'run' ? 'Ran' : 'Scheduled'}</span>
                          {item.status && <span className="text-linear-text-secondary"> · {item.status}</span>}
                          {item.summary && <span className="text-linear-text-secondary"> · {item.summary}</span>}
                        </div>
                      </button>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Schedule Job Detail Modal */}
      {selectedCronJob && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setSelectedCronJob(null)}>
          <div className="w-full max-w-2xl bg-linear-bg-secondary rounded-lg border border-linear-border shadow-linear-lg animate-fadeIn max-h-[80vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-linear-border">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-linear-text">{selectedCronJob.name}</span>
                <span className={`text-xs px-2 py-0.5 rounded ${selectedCronJob.enabled ? "bg-linear-success/20 text-linear-success" : "bg-linear-text-tertiary/20 text-linear-text-tertiary"}`}>
                  {selectedCronJob.enabled ? "Enabled" : "Disabled"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const jobToEdit = selectedCronJob;
                    setSelectedCronJob(null);
                    openJobEditor(jobToEdit);
                  }}
                  className="px-2.5 py-1 text-xs rounded border border-linear-border bg-linear-bg-tertiary text-linear-text-secondary hover:text-linear-text hover:border-linear-accent/50"
                >
                  Edit Job
                </button>
                <button onClick={() => setSelectedCronJob(null)} className="p-1 rounded hover:bg-linear-bg-tertiary text-linear-text-tertiary hover:text-linear-text-secondary">
                  <Icons.x />
                </button>
              </div>
            </div>
            <div className="p-4 space-y-4 overflow-y-auto max-h-[calc(80vh-56px)]">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="text-xs text-linear-text-tertiary uppercase mb-1">Schedule</div>
                  <div className="text-linear-text font-mono text-xs bg-linear-bg-tertiary px-2 py-1 rounded">
                    {selectedCronJob.schedule?.kind === "cron" ? selectedCronJob.schedule.expr :
                     selectedCronJob.schedule?.kind === "every" ? `Every ${Math.round((selectedCronJob.schedule.everyMs || 0) / 60000)} min` :
                     selectedCronJob.schedule?.kind === "at" ? `At ${selectedCronJob.schedule.at}` : "Unknown"}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-linear-text-tertiary uppercase mb-1">Session Target</div>
                  <div className="text-linear-text">{selectedCronJob.sessionTarget || "isolated"}</div>
                </div>
                <div>
                  <div className="text-xs text-linear-text-tertiary uppercase mb-1">Last Run</div>
                  <div className="text-linear-text">{selectedCronJob.state?.lastRunAtMs ? new Date(selectedCronJob.state.lastRunAtMs).toLocaleString() : "Never"}</div>
                </div>
                <div>
                  <div className="text-xs text-linear-text-tertiary uppercase mb-1">Last Status</div>
                  <div className={selectedCronJob.state?.lastStatus === "ok" ? "text-linear-success" : selectedCronJob.state?.lastStatus === "error" ? "text-linear-error" : "text-linear-text-tertiary"}>
                    {selectedCronJob.state?.lastStatus || "N/A"}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-linear-text-tertiary uppercase mb-1">Next Run</div>
                  <div className="text-linear-text">{selectedCronJob.state?.nextRunAtMs ? new Date(selectedCronJob.state.nextRunAtMs).toLocaleString() : "N/A"}</div>
                </div>
                <div>
                  <div className="text-xs text-linear-text-tertiary uppercase mb-1">Delivery</div>
                  <div className="text-linear-text">{selectedCronJob.delivery?.mode || "none"} → {selectedCronJob.delivery?.channel || "N/A"}</div>
                </div>
              </div>
              <div>
                <div className="text-xs text-linear-text-tertiary uppercase mb-1">Payload Message</div>
                <pre className="text-xs text-linear-text-secondary whitespace-pre-wrap bg-linear-bg-tertiary p-3 rounded max-h-48 overflow-y-auto">
                  {selectedCronJob.payload?.message || "No message"}
                </pre>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs text-linear-text-tertiary uppercase">Recent Runs</div>
                  <button
                    onClick={() => selectedCronJob?.id && fetchCronRuns(selectedCronJob.id)}
                    className="px-2 py-1 text-xs rounded border border-linear-border bg-linear-bg-tertiary text-linear-text-secondary hover:text-linear-text"
                  >
                    Refresh
                  </button>
                </div>
                <div className="border border-linear-border rounded overflow-hidden">
                  {loadingCronRuns ? (
                    <div className="p-3 text-xs text-linear-text-tertiary">Loading run history…</div>
                  ) : selectedCronRuns.length === 0 ? (
                    <div className="p-3 text-xs text-linear-text-tertiary">No recorded runs yet.</div>
                  ) : (
                    <div className="max-h-64 overflow-y-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-linear-bg-tertiary text-linear-text-tertiary sticky top-0">
                          <tr>
                            <th className="text-left px-2 py-2">Time</th>
                            <th className="text-left px-2 py-2">Status</th>
                            <th className="text-right px-2 py-2">Duration</th>
                            <th className="text-left px-2 py-2">Summary</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedCronRuns.map((run, idx) => {
                            const runAt = run.runAtMs || run.ts || 0;
                            const status = run.status || run.action || "unknown";
                            const statusClass = status === "ok"
                              ? "text-linear-success"
                              : status === "error"
                                ? "text-linear-error"
                                : "text-linear-text-secondary";
                            return (
                              <tr key={`${runAt}-${idx}`} className="border-t border-linear-border/50 align-top">
                                <td className="px-2 py-2 whitespace-nowrap text-linear-text-secondary">{runAt ? new Date(runAt).toLocaleString() : "—"}</td>
                                <td className={`px-2 py-2 whitespace-nowrap font-medium ${statusClass}`}>{status}</td>
                                <td className="px-2 py-2 text-right whitespace-nowrap text-linear-text-secondary">{typeof run.durationMs === "number" ? `${Math.round(run.durationMs / 1000)}s` : "—"}</td>
                                <td className="px-2 py-2 text-linear-text-secondary">{run.summary || "—"}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>

              {selectedCronJob.state?.lastError && (
                <div>
                  <div className="text-xs text-linear-error uppercase mb-1">Last Error</div>
                  <pre className="text-xs text-linear-error/80 whitespace-pre-wrap bg-linear-error/10 p-3 rounded">
                    {selectedCronJob.state.lastError}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* KPI Daily Drilldown Modal */}
      {selectedKpiDate && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-start sm:items-center justify-center z-50 p-2 sm:p-3 overflow-y-auto"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setSelectedKpiDate(null);
              setSelectedKpiPost(null);
            }
          }}
        >
          <div className="w-full max-w-5xl max-h-[92dvh] bg-linear-bg-secondary rounded-lg border border-linear-border shadow-linear-lg animate-fadeIn overflow-y-auto lg:overflow-hidden my-2" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-linear-border">
              <div>
                <div className="text-sm font-medium text-linear-text">KPI Drilldown — {new Date(selectedKpiDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</div>
                <div className="text-xs text-linear-text-tertiary">{selectedKpiPosts.length} posts</div>
              </div>
              <button onClick={() => { setSelectedKpiDate(null); setSelectedKpiPost(null); }} className="p-1 rounded hover:bg-linear-bg-tertiary text-linear-text-tertiary hover:text-linear-text-secondary">
                <Icons.x />
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-0">
              <div className="lg:border-r border-linear-border max-h-none lg:max-h-[calc(92dvh-64px)] overflow-y-visible lg:overflow-y-auto">
                <div className="overflow-x-auto">
                <table className="w-full min-w-[520px]">
                  <thead className="sticky top-0 bg-linear-bg-tertiary border-b border-linear-border">
                    <tr>
                      <th className="text-left px-3 py-2 text-[11px] font-medium text-linear-text-secondary uppercase">Time</th>
                      <th className="text-left px-3 py-2 text-[11px] font-medium text-linear-text-secondary uppercase">Post</th>
                      <th className="text-right px-3 py-2 text-[11px] font-medium text-linear-text-secondary uppercase">Impr</th>
                      <th className="text-right px-3 py-2 text-[11px] font-medium text-linear-text-secondary uppercase">Eng%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedKpiPosts.length === 0 ? (
                      <tr><td colSpan={4} className="px-3 py-8 text-center text-sm text-linear-text-tertiary">No posts found for this date.</td></tr>
                    ) : selectedKpiPosts.map((post) => {
                      const m = post.public_metrics || ({} as any);
                      const eng = (m.like_count || 0) + (m.reply_count || 0) + (m.retweet_count || 0) + (m.quote_count || 0) + (m.bookmark_count || 0);
                      const imp = m.impression_count || 0;
                      const rate = imp > 0 ? (eng / imp) * 100 : 0;
                      const isSelected = selectedKpiPost?.id === post.id;
                      return (
                        <tr key={post.id} onClick={() => setSelectedKpiPost(post)} className={`border-b border-linear-border cursor-pointer hover:bg-linear-bg-hover ${isSelected ? 'bg-linear-bg-tertiary' : ''}`}>
                          <td className="px-3 py-2 text-xs text-linear-text-secondary whitespace-nowrap">{new Date(post.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</td>
                          <td className="px-3 py-2 text-xs text-linear-text line-clamp-2 max-w-[280px]">{post.text}</td>
                          <td className="px-3 py-2 text-xs text-linear-text text-right">{new Intl.NumberFormat().format(imp)}</td>
                          <td className="px-3 py-2 text-xs text-linear-text text-right">{rate.toFixed(2)}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>
              </div>

              <div className="max-h-none lg:max-h-[calc(92dvh-64px)] overflow-y-visible lg:overflow-y-auto p-4 space-y-3">
                {selectedKpiPost ? (() => {
                  const m = selectedKpiPost.public_metrics || ({} as any);
                  const eng = (m.like_count || 0) + (m.reply_count || 0) + (m.retweet_count || 0) + (m.quote_count || 0) + (m.bookmark_count || 0);
                  const imp = m.impression_count || 0;
                  return (
                    <>
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-xs text-linear-text-tertiary">{new Date(selectedKpiPost.created_at).toLocaleString()}</div>
                        {selectedKpiPost.id && (
                          <a
                            href={`https://x.com/i/web/status/${selectedKpiPost.id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-linear-accent hover:underline"
                          >
                            Open on X ↗
                          </a>
                        )}
                      </div>
                      <div className="bg-linear-bg-tertiary rounded-lg p-3 text-sm text-linear-text whitespace-pre-wrap">{selectedKpiPost.text}</div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="rounded border border-linear-border bg-linear-bg-tertiary p-2"><span className="text-linear-text-tertiary">Impressions</span><div className="text-linear-text font-medium">{new Intl.NumberFormat().format(imp)}</div></div>
                        <div className="rounded border border-linear-border bg-linear-bg-tertiary p-2"><span className="text-linear-text-tertiary">Engagement Rate</span><div className="text-linear-text font-medium">{imp > 0 ? ((eng / imp) * 100).toFixed(2) : '0.00'}%</div></div>
                        <div className="rounded border border-linear-border bg-linear-bg-tertiary p-2"><span className="text-linear-text-tertiary">Likes</span><div className="text-linear-text font-medium">{m.like_count || 0}</div></div>
                        <div className="rounded border border-linear-border bg-linear-bg-tertiary p-2"><span className="text-linear-text-tertiary">Replies</span><div className="text-linear-text font-medium">{m.reply_count || 0}</div></div>
                        <div className="rounded border border-linear-border bg-linear-bg-tertiary p-2"><span className="text-linear-text-tertiary">Retweets</span><div className="text-linear-text font-medium">{m.retweet_count || 0}</div></div>
                        <div className="rounded border border-linear-border bg-linear-bg-tertiary p-2"><span className="text-linear-text-tertiary">Quotes</span><div className="text-linear-text font-medium">{m.quote_count || 0}</div></div>
                        <div className="rounded border border-linear-border bg-linear-bg-tertiary p-2"><span className="text-linear-text-tertiary">Bookmarks</span><div className="text-linear-text font-medium">{m.bookmark_count || 0}</div></div>
                        <div className="rounded border border-linear-border bg-linear-bg-tertiary p-2"><span className="text-linear-text-tertiary">Total Engagements</span><div className="text-linear-text font-medium">{eng}</div></div>
                      </div>
                    </>
                  );
                })() : (
                  <div className="h-full flex items-center justify-center text-sm text-linear-text-tertiary">Select a post on the left to view full metrics.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Twitter Detail Modal */}
      {selectedTweet && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-3"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setSelectedTweet(null);
              setEditingTweetText(null);
            }
          }}
        >
          <div className="w-full max-w-[calc(100vw-2rem)] max-w-lg max-h-[90vh] min-w-[360px] min-h-[320px] bg-linear-bg-secondary rounded-lg border border-linear-border shadow-linear-lg animate-fadeIn overflow-auto resize" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-linear-border">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-linear-text">{selectedTweet.filename}</span>
                <span className={`text-xs px-2 py-0.5 rounded ${selectedTweet.status === "posted" ? "bg-linear-success/20 text-linear-success" : "bg-linear-text-tertiary/20 text-linear-text-tertiary"}`}>
                  {selectedTweet.status === "posted" ? "Posted" : "Queued"}
                </span>
              </div>
              <button onClick={() => { setSelectedTweet(null); setEditingTweetText(null); }} className="p-1 rounded hover:bg-linear-bg-tertiary text-linear-text-tertiary hover:text-linear-text-secondary">
                <Icons.x />
              </button>
            </div>
            <div className="p-4 space-y-4 overflow-y-auto max-h-[calc(90vh-64px)]">
              <div className="text-xs text-linear-text-tertiary">Date: {selectedTweet.date}</div>
              {editingTweetText !== null ? (
                <textarea
                  value={editingTweetText}
                  onChange={(e) => setEditingTweetText(e.target.value)}
                  className="w-full min-h-[10rem] px-3 py-2 bg-linear-bg border border-linear-border rounded-lg text-sm text-linear-text resize-y focus:border-linear-accent focus:outline-none"
                  autoFocus
                />
              ) : (
                <div className="bg-linear-bg-tertiary p-4 rounded-lg">
                  <p className="text-sm text-linear-text whitespace-pre-wrap">{selectedTweet.text}</p>
                </div>
              )}
              <div className={`text-xs ${(editingTweetText ?? selectedTweet.text)?.length > 280 ? "text-linear-error" : "text-linear-text-tertiary"}`}>
                {(editingTweetText ?? selectedTweet.text)?.length || 0} / 280 characters
              </div>
              <div className="text-xs text-linear-text-tertiary">
                Thread mode: separate tweets with a line containing only <code>---</code>.
                {splitThreadText((editingTweetText ?? selectedTweet.text) || "").length > 1
                  ? ` Detected ${splitThreadText((editingTweetText ?? selectedTweet.text) || "").length} tweets.`
                  : ""}
              </div>
              {selectedTweet.tweetUrl && (
                <a href={selectedTweet.tweetUrl} target="_blank" rel="noreferrer" className="text-sm text-linear-accent hover:underline">
                  View on Twitter →
                </a>
              )}
              <div className="flex gap-2">
                {editingTweetText !== null ? (
                  <>
                    <button
                      onClick={() => setEditingTweetText(null)}
                      disabled={isSavingTweetEdit}
                      className="flex-1 px-4 py-2 border border-linear-border text-linear-text-secondary text-sm font-medium rounded-md hover:bg-linear-bg-tertiary transition-colors disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => saveTweetEdit(selectedTweet.id, editingTweetText)}
                      disabled={isSavingTweetEdit}
                      className="flex-1 px-4 py-2 bg-linear-accent hover:bg-linear-accent-hover text-white text-sm font-medium rounded-md transition-colors disabled:opacity-50"
                    >
                      {isSavingTweetEdit ? "Saving…" : "Save"}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => archiveTweet(selectedTweet.id)}
                      disabled={isArchiving}
                      className="px-4 py-2 border border-linear-error/50 text-linear-error text-sm font-medium rounded-md hover:bg-linear-error/10 transition-colors disabled:opacity-50"
                    >
                      {isArchiving ? "Archiving…" : "Archive"}
                    </button>
                    {selectedTweet.status === "posted" && (
                      <button
                        onClick={() => unpostTweet(selectedTweet)}
                        disabled={!!isPostingTweet}
                        className="px-4 py-2 border border-linear-warning/50 text-linear-warning text-sm font-medium rounded-md hover:bg-linear-warning/10 transition-colors disabled:opacity-50"
                      >
                        {isPostingTweet === selectedTweet.id ? "Un-posting…" : "Un-post"}
                      </button>
                    )}
                    {selectedTweet.status !== "posted" && (
                      <button
                        onClick={() => setEditingTweetText(selectedTweet.text || "")}
                        className="flex-1 px-4 py-2 border border-linear-border text-linear-text-secondary text-sm font-medium rounded-md hover:bg-linear-bg-tertiary transition-colors"
                      >
                        Edit
                      </button>
                    )}
                    {selectedTweet.status !== "posted" && (
                      <button
                        onClick={() => { postTweet(selectedTweet.text || "", selectedTweet.id); setSelectedTweet(null); }}
                        disabled={!!isPostingTweet}
                        className="flex-1 px-4 py-2 bg-linear-accent hover:bg-linear-accent-hover text-white text-sm font-medium rounded-md transition-colors disabled:opacity-50"
                      >
                        {isPostingTweet === selectedTweet.id ? "Posting…" : "Post"}
                      </button>
                    )}
                    {selectedTweet.status !== "posted" && (
                      <button
                        onClick={() => { postTweetThread(selectedTweet.text || "", selectedTweet.id); setSelectedTweet(null); }}
                        disabled={!!isPostingTweet}
                        className="flex-1 px-4 py-2 bg-linear-success hover:bg-linear-success/90 text-white text-sm font-medium rounded-md transition-colors disabled:opacity-50"
                      >
                        {isPostingTweet === selectedTweet.id ? "Posting…" : "Post as Thread"}
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mobile floating menu button (primary mobile nav access) */}
      {isMobile && !sidebarOpen && (
        <button
          onClick={openSidebar}
          className="fixed bottom-4 right-4 z-50 rounded-full bg-linear-accent text-white shadow-linear-lg px-4 py-3 flex items-center gap-2"
          style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))" }}
          aria-label="Open menu"
          title="Open menu"
        >
          <Icons.menu />
          <span className="text-sm font-medium">Menu</span>
        </button>
      )}
    </div>
  );
}
