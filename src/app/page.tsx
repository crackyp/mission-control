"use client";

import { DragDropContext, Draggable, Droppable } from "@hello-pangea/dnd";
import type { DropResult } from "@hello-pangea/dnd";
import { useEffect, useMemo, useRef, useState } from "react";

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

type Goals = {
  career: string[];
  personal: string[];
  business: string[];
};

type Service = {
  name: string;
  status: "running" | "stopped" | "failed" | "unknown";
  description: string;
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

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
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
  chevronRight: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9,6 15,12 9,18"></polyline>
    </svg>
  ),
};

export default function Home() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const isDraggingRef = useRef(false);
  
  // Add task modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskDescription, setNewTaskDescription] = useState("");
  const [newTaskStatus, setNewTaskStatus] = useState<TaskStatus>("todo");
  const [newTaskAssignee, setNewTaskAssignee] = useState("");

  // Goals state
  const [goals, setGoals] = useState<Goals>({ career: [], personal: [], business: [] });
  const [activePanel, setActivePanel] = useState<"none" | "goals" | "services" | "calendar" | "twitter" | "wordpress" | "memory" | "agents" | "comms">("none");
  const [editingGoal, setEditingGoal] = useState<{ category: keyof Goals; index: number } | null>(null);
  const [editingGoalText, setEditingGoalText] = useState("");
  const [newGoalCategory, setNewGoalCategory] = useState<keyof Goals>("career");
  const [newGoalText, setNewGoalText] = useState("");

  // Services state
  const [services, setServices] = useState<Service[]>([]);

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
  };
  const [heartbeats, setHeartbeats] = useState<AgentHeartbeat[]>([]);
  const [editingHeartbeat, setEditingHeartbeat] = useState<string | null>(null);
  const [heartbeatFreq, setHeartbeatFreq] = useState<number>(30);
  const [scheduleData, setScheduleData] = useState<Record<string, Array<{
    id: string;
    name: string;
    enabled: boolean;
    nextRun: number | null;
    lastRun: number | null;
    lastStatus: string | null;
  }>>>({});
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
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [editingTaskMode, setEditingTaskMode] = useState(false);
  const [editTaskTitle, setEditTaskTitle] = useState("");
  const [editTaskDesc, setEditTaskDesc] = useState("");
  const [editTaskAssignee, setEditTaskAssignee] = useState("");
  const [selectedCronJob, setSelectedCronJob] = useState<CronJob | null>(null);
  const [selectedTweet, setSelectedTweet] = useState<any | null>(null);
  const [editingTweetText, setEditingTweetText] = useState<string | null>(null);
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
  const [isRefreshingAgents, setIsRefreshingAgents] = useState(false);
  const [isAgentsAutoRefreshHealthy, setIsAgentsAutoRefreshHealthy] = useState(true);
  const [lastAgentsAutoRefreshAt, setLastAgentsAutoRefreshAt] = useState<number>(Date.now());
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [selectedAgentFile, setSelectedAgentFile] = useState<AgentFile | null>(null);
  const [editingAgentText, setEditingAgentText] = useState<string | null>(null);
  const [isSavingAgent, setIsSavingAgent] = useState(false);

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

  const searchValue = searchQuery.trim().toLowerCase();
  const matchesSearch = (value?: string) => {
    if (!searchValue) return true;
    return (value || "").toLowerCase().includes(searchValue);
  };

  const tasksByStatus = useMemo(() => {
    const filtered = searchValue
      ? tasks.filter((task) => matchesSearch(task.title) || matchesSearch(task.description) || matchesSearch(task.id))
      : tasks;
    return {
      todo: filtered.filter((task) => task.status === "todo"),
      inprogress: filtered.filter((task) => task.status === "inprogress"),
      done: filtered.filter((task) => task.status === "done"),
    };
  }, [tasks, searchValue]);

  const filteredServices = useMemo(() => {
    if (!searchValue) return services;
    return services.filter(
      (service) =>
        matchesSearch(service.name) ||
        matchesSearch(service.description) ||
        matchesSearch(service.status)
    );
  }, [services, searchValue]);

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
  }, [twitterItems, searchValue, twitterSort, showPosted]);

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
  }, [wpFiles, searchValue, wpSort, wpStatusMap]);

  useEffect(() => {
    setTwitterPage(1);
  }, [searchValue, twitterSort.col, twitterSort.dir, showPosted, twitterPageSize]);

  useEffect(() => {
    setTwitterPage((prev) => Math.min(prev, twitterTotalPages));
  }, [twitterTotalPages]);

  const fetchTasks = async () => {
    try {
      const response = await fetch("/api/tasks", { cache: "no-store" });
      const data = (await response.json()) as TaskFile;
      if (!isDraggingRef.current) {
        setTasks(Array.isArray(data.tasks) ? data.tasks : []);
        setLastSyncedAt(new Date().toISOString());
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

  const updateHeartbeatFrequency = async (agentId: string, frequencyMinutes: number) => {
    try {
      await fetch("/api/heartbeats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId, frequencyMinutes, enabled: true }),
      });
      setEditingHeartbeat(null);
      await fetchHeartbeats();
    } catch (error) {
      console.error("Failed to update heartbeat frequency", error);
    }
  };

  const fetchSchedule = async () => {
    try {
      const response = await fetch("/api/schedule", { cache: "no-store" });
      const data = await response.json();
      setScheduleData(data);
    } catch (error) {
      console.error("Failed to fetch schedule", error);
    }
  };

  const fetchCronJobs = async () => {
    try {
      const response = await fetch("/api/cron", { cache: "no-store" });
      const data = await response.json();
      setCronJobs(Array.isArray(data.jobs) ? data.jobs : []);
    } catch (error) {
      console.error("Failed to fetch cron jobs", error);
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
      await fetchAgents();
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
      alert(`✅ Woke ${wakeModalAgent.name}${modelNote} (${data.jobId})`);
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

  const saveTweetEdit = async (id: string, newText: string) => {
    try {
      const response = await fetch("/api/twitter", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, text: newText }),
      });
      if (!response.ok) throw new Error("Failed to save");
      await fetchTwitterItems();
      setEditingTweetText(null);
      // Update selectedTweet with new text
      setSelectedTweet((prev: any) => prev ? { ...prev, text: newText } : null);
    } catch (error: any) {
      alert("Save failed: " + error.message);
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
      setLastSyncedAt(new Date().toISOString());
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
    fetchTasks();
    fetchGoals();
    fetchServices();
    fetchSchedule();
    fetchCronJobs();
    fetchTwitterItems();
    fetchWordpressFiles();
    fetchMemoryFiles();
    fetchAgents(false, true);
    fetchWakeModels();
    fetchComms();
    fetchHeartbeats();
    const taskInterval = setInterval(fetchTasks, 2000);
    const serviceInterval = setInterval(fetchServices, 5000);
    const scheduleInterval = setInterval(fetchSchedule, 60000);
    const cronInterval = setInterval(fetchCronJobs, 60000);
    const twitterInterval = setInterval(fetchTwitterItems, 60000);
    const wpInterval = setInterval(fetchWordpressFiles, 60000);
    const memoryInterval = setInterval(fetchMemoryFiles, 60000);
    const agentsInterval = setInterval(() => fetchAgents(false, true), 5000);
    const modelsInterval = setInterval(fetchWakeModels, 60000);
    const commsInterval = setInterval(fetchComms, 10000);
    return () => {
      clearInterval(taskInterval);
      clearInterval(serviceInterval);
      clearInterval(scheduleInterval);
      clearInterval(cronInterval);
      clearInterval(twitterInterval);
      clearInterval(wpInterval);
      clearInterval(memoryInterval);
      clearInterval(agentsInterval);
      clearInterval(modelsInterval);
      clearInterval(commsInterval);
    };
  }, []);

  useEffect(() => {
    const healthInterval = setInterval(() => {
      if (Date.now() - lastAgentsAutoRefreshAt > 15000) {
        setIsAgentsAutoRefreshHealthy(false);
      }
    }, 3000);

    return () => clearInterval(healthInterval);
  }, [lastAgentsAutoRefreshAt]);

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
    shuri: "#8b5cf6", // purple
    duke: "#ef4444", // red
    pixel: "#3b82f6", // blue
    chet: "#14b8a6", // teal
    "inspector-gadget": "#9ca3af", // gray
    ricky: "#22c55e", // green
    bob: "#f59e0b", // yellow
    kevbot: "#10b981", // same as Agents tab
    main: "#10b981", // KevBot alias
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
      {/* Linear-style Sidebar */}
      <aside className={`fixed left-0 top-0 h-full bg-linear-bg-secondary border-r border-linear-border flex flex-col transition-all duration-200 ${sidebarOpen ? 'w-56' : 'w-0 overflow-hidden border-r-0'}`}>
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
            onClick={() => setActivePanel("none")}
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
            onClick={() => setActivePanel(activePanel === "goals" ? "none" : "goals")}
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
            onClick={() => setActivePanel(activePanel === "services" ? "none" : "services")}
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
            onClick={() => setActivePanel(activePanel === "calendar" ? "none" : "calendar")}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              activePanel === "calendar"
                ? "bg-linear-bg-tertiary text-linear-text"
                : "text-linear-text-secondary hover:bg-linear-bg-tertiary hover:text-linear-text"
            }`}
          >
            <Icons.calendar />
            <span>Schedule</span>
          </button>

          <button
            onClick={() => setActivePanel(activePanel === "twitter" ? "none" : "twitter")}
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
            onClick={() => setActivePanel(activePanel === "wordpress" ? "none" : "wordpress")}
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
            onClick={() => setActivePanel(activePanel === "memory" ? "none" : "memory")}
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
            onClick={() => setActivePanel(activePanel === "agents" ? "none" : "agents")}
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
            onClick={() => { setActivePanel(activePanel === "comms" ? "none" : "comms"); fetchComms(); }}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              activePanel === "comms"
                ? "bg-linear-bg-tertiary text-linear-text"
                : "text-linear-text-secondary hover:bg-linear-bg-tertiary hover:text-linear-text"
            }`}
          >
            <Icons.mail />
            <span>Comms</span>
            {commsStats.totalUnread > 0 && (
              <span className="ml-auto bg-linear-accent text-white text-xs px-1.5 py-0.5 rounded-full">{commsStats.totalUnread}</span>
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
      <main className={`min-h-screen transition-all duration-200 ${sidebarOpen ? 'ml-56' : 'ml-0'}`}>
        {/* Header */}
        <header className="h-14 border-b border-linear-border flex items-center justify-between px-6 bg-linear-bg">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-1.5 rounded-md hover:bg-linear-bg-tertiary text-linear-text-secondary hover:text-linear-text transition-colors"
              title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
            >
              {sidebarOpen ? <Icons.chevronLeft /> : <Icons.menu />}
            </button>
            <h1 className="text-sm font-medium text-linear-text">
              {activePanel === "goals" ? "Goals" : activePanel === "services" ? "System Services" : activePanel === "calendar" ? "Schedule" : activePanel === "twitter" ? "Twitter" : activePanel === "wordpress" ? "WordPress" : activePanel === "memory" ? "Memory" : activePanel === "agents" ? "Agent Team" : activePanel === "comms" ? "Agent Comms" : "My Tasks"}
            </h1>
            {activePanel === "none" && (
              <span className="text-xs text-linear-text-tertiary">{tasks.length} tasks</span>
            )}
          </div>
          
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-linear-bg-secondary border border-linear-border text-xs text-linear-text-secondary">
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
        <div className="p-6">
          {activePanel === "services" && (
            <div className="animate-fadeIn">
              <div className="rounded-lg border border-linear-border bg-linear-bg-secondary overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-linear-border bg-linear-bg-tertiary">
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-linear-text-secondary uppercase tracking-wider">Service</th>
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-linear-text-secondary uppercase tracking-wider">Description</th>
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-linear-text-secondary uppercase tracking-wider">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredServices.map((service, index) => (
                      <tr key={index} className="border-b border-linear-border last:border-0 hover:bg-linear-bg-hover">
                        <td className="px-4 py-3 text-sm text-linear-text">{service.name}</td>
                        <td className="px-4 py-3 text-sm text-linear-text-secondary">{service.description}</td>
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
                      </tr>
                    ))}
                    {filteredServices.length === 0 && (
                      <tr>
                        <td colSpan={3} className="px-4 py-8 text-center text-sm text-linear-text-tertiary">
                          Loading services...
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activePanel === "calendar" && (
            <div className="animate-fadeIn space-y-4">
              {/* Agent Heartbeats */}
              <div className="rounded-lg border border-linear-border bg-linear-bg-secondary overflow-hidden">
                <div className="px-4 py-3 border-b border-linear-border bg-linear-bg-tertiary flex items-center justify-between">
                  <h3 className="text-sm font-medium text-linear-text">Agent Heartbeats</h3>
                  <button
                    onClick={fetchHeartbeats}
                    className="text-xs text-linear-text-tertiary hover:text-linear-text transition-colors"
                  >
                    Refresh
                  </button>
                </div>
                <div className="p-3">
                  <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-4">
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
                        
                        {editingHeartbeat === hb.agentId ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min="1"
                              max="1440"
                              value={heartbeatFreq}
                              onChange={(e) => setHeartbeatFreq(parseInt(e.target.value) || 30)}
                              className="w-20 px-2 py-1 text-xs bg-linear-bg border border-linear-border rounded text-linear-text"
                            />
                            <span className="text-xs text-linear-text-tertiary">min</span>
                            <button
                              onClick={() => updateHeartbeatFrequency(hb.agentId, heartbeatFreq)}
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
                        ) : (
                          <div className="flex items-center justify-between">
                            <div className="text-xs text-linear-text-tertiary">
                              {hb.frequencyMinutes > 0 ? (
                                <span>Every {hb.frequencyMinutes} min</span>
                              ) : (
                                <span>Not configured</span>
                              )}
                            </div>
                            <button
                              onClick={() => {
                                setHeartbeatFreq(hb.frequencyMinutes || 30);
                                setEditingHeartbeat(hb.agentId);
                              }}
                              className="text-xs text-linear-accent hover:text-linear-accent/80"
                            >
                              Edit
                            </button>
                          </div>
                        )}
                        
                        {hb.lastRun && (
                          <div className="mt-2 flex items-center gap-2 text-[10px] text-linear-text-tertiary">
                            <span className={`px-1.5 py-0.5 rounded ${
                              hb.lastStatus === "ok"
                                ? "bg-linear-success/20 text-linear-success"
                                : hb.lastStatus === "error"
                                ? "bg-linear-error/20 text-linear-error"
                                : "bg-linear-bg-tertiary"
                            }`}>
                              {hb.lastStatus || "—"}
                            </span>
                            <span>Last: {new Date(hb.lastRun).toLocaleTimeString()}</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Weekly Calendar */}
              <div className="rounded-lg border border-linear-border bg-linear-bg-secondary overflow-hidden">
                <div className="px-4 py-3 border-b border-linear-border bg-linear-bg-tertiary">
                  <h3 className="text-sm font-medium text-linear-text">Schedule (This Week)</h3>
                </div>
                {Object.keys(scheduleData).length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-linear-text-tertiary">
                    Loading schedule...
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-7 gap-3 p-3">
                    {getWeekDates().map((date) => {
                      const key = date.toISOString().split("T")[0];
                      const jobs = scheduleData[key] || [];
                      const filteredJobs = searchValue
                        ? jobs.filter(
                            (job) =>
                              matchesSearch(job.name) ||
                              matchesSearch(job.id) ||
                              matchesSearch(job.lastStatus || "")
                          )
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
                                  className={`border rounded-md px-2 py-1.5 shadow-sm cursor-pointer hover:opacity-80 transition-opacity ${
                                    colorForName(job.name)
                                  } ${job.enabled ? "" : "opacity-50"}`}
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-2 min-w-0">
                                      <span className={`w-2 h-2 rounded-full ${
                                        job.enabled ? "bg-linear-accent" : "bg-linear-text-tertiary"
                                      }`} />
                                      <span className="text-xs truncate">{job.name}</span>
                                    </div>
                                    <span className="text-[10px] text-linear-text-tertiary">
                                      {job.nextRun
                                        ? new Date(job.nextRun).toLocaleTimeString("en-US", {
                                            hour: "numeric",
                                            minute: "2-digit",
                                          })
                                        : "—"}
                                    </span>
                                  </div>
                                  {job.lastStatus && (
                                    <div className={`mt-1 inline-flex text-[10px] px-1.5 py-0.5 rounded ${
                                      job.lastStatus === "ok"
                                        ? "bg-linear-success/20 text-linear-success"
                                        : "bg-linear-error/20 text-linear-error"
                                    }`}>
                                      {job.lastStatus}
                                    </div>
                                  )}
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {activePanel === "twitter" && (
            <div className="animate-fadeIn space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-linear-text">Twitter Queue</h3>
                <div className="flex items-center gap-2">
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
                <table className="w-full">
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
                        <td className="px-4 py-3 text-xs text-linear-text-secondary">
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
              <div className="flex items-center justify-between text-xs text-linear-text-secondary">
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
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => { setSelectedWpFile(null); setEditingWpText(null); }}>
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
                          className="w-full h-96 px-3 py-2 bg-linear-bg border border-linear-border rounded-lg text-sm text-linear-text font-mono resize-none focus:border-linear-accent focus:outline-none"
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
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => { setSelectedMemoryFile(null); setEditingMemoryText(null); }}>
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
                          className="w-full h-full min-h-[400px] px-3 py-2 bg-linear-bg border border-linear-border rounded-md text-sm text-linear-text font-mono focus:border-linear-accent focus:outline-none resize-none"
                        />
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {activePanel === "agents" && (
            <div className="animate-fadeIn space-y-4">
              <div className="rounded-lg border border-linear-border bg-gradient-to-r from-linear-bg-secondary to-linear-bg p-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-linear-text">Agent Team ({agents.length})</h3>
                  <span className={`text-[10px] px-2 py-1 rounded-full border ${isAgentsAutoRefreshHealthy ? "border-linear-success/40 text-linear-success bg-linear-success/10" : "border-red-500/40 text-red-400 bg-red-500/10"}`}>
                    {isAgentsAutoRefreshHealthy ? "Live Ops" : "Offline"}
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <button
                  onClick={() => fetchAgents(true)}
                  disabled={isRefreshingAgents}
                  className="px-3 py-1.5 rounded-md border border-linear-border bg-linear-bg-secondary text-xs text-linear-text-secondary transition-all hover:border-linear-accent/60 hover:text-linear-text hover:bg-linear-bg disabled:opacity-60 disabled:cursor-not-allowed active:scale-[0.98]"
                >
                  {isRefreshingAgents ? "Refreshing..." : "Refresh"}
                </button>
              </div>

              {/* Agent Cards Grid */}
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {agents.map((agent) => (
                  <div
                    key={agent.id}
                    onClick={() => setSelectedAgent(agent)}
                    className="rounded-lg border border-linear-border bg-linear-bg-secondary p-4 hover:border-linear-accent/50 cursor-pointer transition-colors"
                    style={{
                      borderLeftWidth: 3,
                      borderLeftColor:
                        agent.id === "kevbot" ? "#10b981" :
                        agent.id === "shuri" ? "#8b5cf6" :
                        agent.id === "chet" ? "#06b6d4" :
                        agent.id === "ricky" ? "#22c55e" :
                        agent.id === "bob" ? "#f59e0b" :
                        agent.id === "pixel" ? "#3b82f6" :
                        agent.id === "duke" ? "#ef4444" :
                        "#a3a3a3",
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
                            ? "Waking"
                            : "Idle"}
                        </div>
                      </div>
                    </div>
                    {(agent.presenceTask || agent.currentWork) && (
                      <div className="text-xs text-linear-text-secondary mb-2 line-clamp-2">
                        {agent.presenceTask || agent.currentWork}
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
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setWakeModalAgent(agent);
                        setWakeMessage("");
                        setWakeModel("");
                        fetchWakeModels();
                      }}
                      className="w-full px-2 py-1.5 rounded-md border border-linear-border bg-linear-bg text-xs text-linear-text-secondary hover:border-linear-accent/50 hover:text-linear-text transition-colors"
                    >
                      Wake Agent
                    </button>
                  </div>
                ))}
                {agents.length === 0 && (
                  <div className="col-span-full text-center py-8 text-sm text-linear-text-tertiary">
                    Loading agents...
                  </div>
                )}
              </div>

              {/* Wake Agent Modal */}
              {wakeModalAgent && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => { if (!isWakingAgent) setWakeModalAgent(null); }}>
                  <div className="w-full max-w-lg rounded-lg border border-linear-border bg-linear-bg-secondary shadow-lg" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-between px-4 py-3 border-b border-linear-border">
                      <div>
                        <div className="text-sm font-medium text-linear-text">Wake {wakeModalAgent.name}</div>
                        <div className="text-xs text-linear-text-tertiary">Optional instructions for this wake</div>
                      </div>
                      <button
                        onClick={() => setWakeModalAgent(null)}
                        disabled={isWakingAgent}
                        className="text-linear-text-tertiary hover:text-linear-text disabled:opacity-50"
                      >
                        <Icons.x />
                      </button>
                    </div>
                    <div className="p-4 space-y-3">
                      <div>
                        <label className="block text-xs font-medium text-linear-text-secondary mb-1.5">Model</label>
                        <select
                          value={wakeModel}
                          onChange={(e) => setWakeModel(e.target.value)}
                          className="w-full px-3 py-2 bg-linear-bg border border-linear-border rounded-md text-sm text-linear-text focus:border-linear-accent focus:outline-none"
                        >
                          {wakeModels.map((m) => (
                            <option key={m.value} value={m.value}>{m.label}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-linear-text-secondary mb-1.5">Instructions (optional)</label>
                        <textarea
                          value={wakeMessage}
                          onChange={(e) => setWakeMessage(e.target.value)}
                          placeholder="Example: Check tasks.json and prioritize frontend bugs first"
                          className="w-full min-h-[100px] px-3 py-2 bg-linear-bg border border-linear-border rounded-md text-sm text-linear-text focus:border-linear-accent focus:outline-none resize-y"
                        />
                      </div>
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => setWakeModalAgent(null)}
                          disabled={isWakingAgent}
                          className="px-3 py-1.5 border border-linear-border text-linear-text-secondary text-xs font-medium rounded-md hover:bg-linear-bg-tertiary transition-colors disabled:opacity-50"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={wakeAgent}
                          disabled={isWakingAgent}
                          className="px-3 py-1.5 bg-linear-accent hover:bg-linear-accent-hover text-white text-xs font-medium rounded-md transition-colors disabled:opacity-50"
                        >
                          {isWakingAgent ? "Waking…" : "Wake Agent"}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Agent Detail Modal */}
              {selectedAgent && !selectedAgentFile && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setSelectedAgent(null)}>
                  <div className="w-full max-w-4xl rounded-lg border border-linear-border bg-linear-bg-secondary shadow-lg max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-between px-4 py-3 border-b border-linear-border flex-shrink-0">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{selectedAgent.emoji}</span>
                        <div>
                          <div className="text-sm font-medium text-linear-text">{selectedAgent.name}</div>
                          <div className="text-xs text-linear-text-tertiary">{selectedAgent.role}</div>
                          <div className="mt-1 text-[10px] text-linear-text-tertiary">
                            Status: {selectedAgent.presence === "working" ? "Working" : selectedAgent.presence === "waking" ? "Waking" : "Idle"}
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
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => { setSelectedAgentFile(null); setEditingAgentText(null); }}>
                  <div className="w-full max-w-4xl rounded-lg border border-linear-border bg-linear-bg-secondary shadow-lg max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-between px-4 py-3 border-b border-linear-border flex-shrink-0">
                      <div>
                        <div className="flex items-center gap-2">
                          {selectedAgent && <span className="text-lg">{selectedAgent.emoji}</span>}
                          <div className="text-sm font-medium text-linear-text">{selectedAgentFile.name}</div>
                        </div>
                        <div className="text-xs text-linear-text-tertiary">{selectedAgentFile.path}</div>
                      </div>
                      <div className="flex items-center gap-2">
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
                          className="w-full h-full min-h-[400px] px-3 py-2 bg-linear-bg border border-linear-border rounded-md text-sm text-linear-text font-mono focus:border-linear-accent focus:outline-none resize-none"
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
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <h3 className="text-sm font-medium text-linear-text">Agent Communications</h3>
                    <div className="flex items-center gap-3 text-xs text-linear-text-tertiary">
                      <span>{commsStats.totalUnread} unread</span>
                      <span>•</span>
                      <span>{commsStats.totalMessages} total inbox</span>
                      <span>•</span>
                      <span>{commsStats.queueSize} queue</span>
                    </div>
                  </div>
                  <button
                    onClick={fetchComms}
                    disabled={isRefreshingComms}
                    className="px-3 py-1.5 rounded-md border border-linear-border bg-linear-bg-secondary text-xs text-linear-text-secondary transition-all hover:border-linear-accent/60 hover:text-linear-text hover:bg-linear-bg disabled:opacity-60"
                  >
                    {isRefreshingComms ? "Refreshing..." : "Refresh"}
                  </button>
                </div>
              </div>

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
                            {inbox.messages.map((msg) => (
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
          <div className="w-full max-w-lg bg-linear-bg-secondary rounded-lg border border-linear-border shadow-linear-lg animate-fadeIn">
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
                  className="w-full px-3 py-2 bg-linear-bg border border-linear-border rounded-md text-sm text-linear-text placeholder:text-linear-text-tertiary focus:border-linear-accent focus:outline-none transition-colors resize-none"
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
                    <option value="shuri">📋 Shuri (PM)</option>
                    <option value="bob">🔨 Bob (Builder)</option>
                    <option value="pixel">🖥️ Pixel (Frontend)</option>
                    <option value="duke">⚙️ Duke (Backend)</option>
                    <option value="ricky">📚 Ricky (Researcher)</option>
                    <option value="inspector-gadget">🔍 Inspector Gadget (QA)</option>
                    <option value="chet">🎨 Chet (Creative)</option>
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
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => { setSelectedTask(null); setEditingTaskMode(false); }}>
          <div className="w-full max-w-lg bg-linear-bg-secondary rounded-lg border border-linear-border shadow-linear-lg animate-fadeIn" onClick={(e) => e.stopPropagation()}>
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
                      className="w-full px-3 py-2 bg-linear-bg border border-linear-border rounded-md text-sm text-linear-text resize-none"
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
                      <option value="shuri">📋 Shuri (PM)</option>
                      <option value="bob">🔨 Bob (Builder)</option>
                      <option value="pixel">🖥️ Pixel (Frontend)</option>
                      <option value="duke">⚙️ Duke (Backend)</option>
                      <option value="ricky">📚 Ricky (Researcher)</option>
                      <option value="inspector-gadget">🔍 Inspector Gadget (QA)</option>
                      <option value="chet">🎨 Chet (Creative)</option>
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
              <button onClick={() => setSelectedCronJob(null)} className="p-1 rounded hover:bg-linear-bg-tertiary text-linear-text-tertiary hover:text-linear-text-secondary">
                <Icons.x />
              </button>
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

      {/* Twitter Detail Modal */}
      {selectedTweet && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => { setSelectedTweet(null); setEditingTweetText(null); }}>
          <div className="w-full max-w-lg bg-linear-bg-secondary rounded-lg border border-linear-border shadow-linear-lg animate-fadeIn" onClick={(e) => e.stopPropagation()}>
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
            <div className="p-4 space-y-4">
              <div className="text-xs text-linear-text-tertiary">Date: {selectedTweet.date}</div>
              {editingTweetText !== null ? (
                <textarea
                  value={editingTweetText}
                  onChange={(e) => setEditingTweetText(e.target.value)}
                  className="w-full h-32 px-3 py-2 bg-linear-bg border border-linear-border rounded-lg text-sm text-linear-text resize-none focus:border-linear-accent focus:outline-none"
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
                      className="flex-1 px-4 py-2 border border-linear-border text-linear-text-secondary text-sm font-medium rounded-md hover:bg-linear-bg-tertiary transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => saveTweetEdit(selectedTweet.id, editingTweetText)}
                      className="flex-1 px-4 py-2 bg-linear-accent hover:bg-linear-accent-hover text-white text-sm font-medium rounded-md transition-colors"
                    >
                      Save
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
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
