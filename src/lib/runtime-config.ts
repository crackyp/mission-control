import { join } from "path";

const HOME = process.env.MC_HOME_DIR || process.env.HOME || process.env.USERPROFILE || "/home/user";
const CWD = process.env.MC_CLAWD_DIR || join(HOME, "clawd");
const SHARED = process.env.MC_SHARED_DIR || join(HOME, "shared");
const OPENCLAW_DIR = process.env.MC_OPENCLAW_DIR || join(HOME, ".openclaw");
// mac → ~/.hermes/cron/jobs.json, pi → $SHARED/bernie/jobs.json (mirrored).
const MAC_HERMES_JOBS_SEGMENTS = process.env.MC_SHARED_DIR
  ? null // resolved via join(SHARED, ...) below — SHARED is absolute on the Pi
  : [".hermes", "cron", "jobs.json"];
const PROJECT_ROOT = process.env.MC_PROJECT_ROOT || process.cwd();

export const runtimeConfig = {
  homeDir: HOME,
  clawdDir: CWD,
  sharedDir: SHARED,
  openclawDir: OPENCLAW_DIR,
  projectRoot: PROJECT_ROOT,

  sessionsDir:
    process.env.MC_SESSIONS_DIR ||
    join(OPENCLAW_DIR, "agents", "main", "sessions"),

  // OpenClaw 2026.7.35+ keeps cron jobs and run history in the gateway's SQLite
  // state DB (cron_jobs / cron_run_logs); cron/jobs.json is gone. Read-only
  // here — see src/lib/openclaw-cron.ts.
  openclawStateDb:
    process.env.MC_OPENCLAW_STATE_DB || join(OPENCLAW_DIR, "state", "openclaw.sqlite"),

  agentStatusFile:
    process.env.MC_AGENT_STATUS_FILE || join(SHARED, "agent-status.json"),

  // Hermes runs on a different machine than Mission Control, so its state.db
  // is not reachable here. Realtime token-usage snapshot written every minute
  // by the token-usage-export cron on the Hermes host (Mac); its
  // data.activeSessions is Bernie's live presence source.
  tokenUsageFile:
    process.env.MC_TOKEN_USAGE_FILE || join(SHARED, "bernie", "token-usage.json"),

  // Same exporter pattern, written every minute by the Windows PC's
  // llama-swap-token-usage-export scheduled task. Separate host, separate file.
  tokenUsagePcFile:
    process.env.MC_TOKEN_USAGE_PC_FILE || join(SHARED, "bernie", "token-usage-pc.json"),

  // Realtime llama-swap RUNTIME status (resident models, in-flight requests,
  // wedged/off verdict, GPU/RAM gauges) written every minute by the
  // llamaswap-status-export cron on the Mac. Powers MC's LLM tab.
  llamaswapStatusFile:
    process.env.MC_LLAMASWAP_STATUS_FILE || join(SHARED, "bernie", "llamaswap-status.json"),

  // Hermes delegate_task children (running + last 24h) with their reasoning /
  // tool-call timelines, written every 5s by the hermes-subagents-export
  // LaunchAgent on the Mac. Powers the Hermes subagent cards on the Agents tab.
  hermesSubagentsFile:
    process.env.MC_HERMES_SUBAGENTS_FILE || join(SHARED, "bernie", "subagents.json"),

  // H3 Studio (render-studio/h3-dashboard.py) on the Mac. Unlike llama-swap it
  // binds 0.0.0.0, so the Pi reaches it directly; /api/h3studio proxies to it.
  h3StudioUrl:
    process.env.MC_H3_STUDIO_URL || "http://192.168.4.38:8189",

  // Media Studio backend (media-studio/server.py) on the Windows PC:
  // Qwen-Image-2.1 on its local ComfyUI. /api/mediastudio proxies to it.
  mediaStudioUrl:
    process.env.MC_MEDIA_STUDIO_URL || "http://192.168.4.36:8190",

  messagesFile:
    process.env.MC_MESSAGES_FILE || join(SHARED, "messages.jsonl"),

  openclawConfigFile:
    process.env.MC_OPENCLAW_CONFIG_FILE || join(OPENCLAW_DIR, "openclaw.json"),

  openclawBin:
    process.env.MC_OPENCLAW_BIN || join(HOME, ".npm-global", "bin", "openclaw"),

  // Per-job model/provider overrides source: the Mac Hermes cron jobs.json.
  // On the Mac it's the real file under ~/.hermes/cron/; on the Pi it's the
  // mirrored copy under $MC_SHARED_DIR/bernie/ (kept in sync from the Mac).
  macHermesJobsFile:
    process.env.MC_MAC_HERMES_JOBS_FILE ||
    (MAC_HERMES_JOBS_SEGMENTS
      ? join(HOME, ...MAC_HERMES_JOBS_SEGMENTS)
      : join(SHARED, "bernie", "jobs.json")),

  tasksFilePath:
    process.env.MC_TASKS_FILE_PATH || join(PROJECT_ROOT, "data", "tasks.json"),

  remindersFilePath:
    process.env.MC_REMINDERS_FILE_PATH || join(CWD, "reminders.json"),

  ideasFilePath:
    process.env.MC_IDEAS_FILE_PATH || join(CWD, "ideas.json"),

  contentIdeasFilePath:
    // Content ideas are shared with the kevteaches marketing engine, which runs
    // on a different host (the Mac) that mounts this same share. Keep the file
    // on the shared drive — NOT in the Pi-local clawd dir — so both sides
    // read/write the same file. Engine side: engine/util.py content_ideas_file().
    process.env.MC_CONTENT_IDEAS_FILE_PATH || join(SHARED, "clawd", "content-ideas.json"),

  memoryDir:
    process.env.MC_MEMORY_DIR || join(CWD, "memory"),

  twitterDir:
    process.env.MC_TWITTER_DIR || join(SHARED, "deliverables", "kevteaches", "content", "twitter"),

  twitterArchiveDir:
    process.env.MC_TWITTER_ARCHIVE_DIR || join(SHARED, "deliverables", ".archive", "twitter"),

  twitterScript:
    process.env.MC_TWITTER_SCRIPT || join(OPENCLAW_DIR, "skills", "twitter", "twitter.py"),

  twitterPostedLog:
    process.env.MC_TWITTER_POSTED_LOG || join(CWD, "data", "twitter_posted.json"),

  wpWebDir:
    process.env.MC_WP_WEB_DIR || join(SHARED, "deliverables", "kevteaches-content", "web", "content", "drafts"),

  wpArchiveDir:
    process.env.MC_WP_ARCHIVE_DIR || join(SHARED, "deliverables", ".archive", "wordpress"),

  wpProxy:
    process.env.MC_WP_PROXY || "http://127.0.0.1:8082/wp-proxy",

  wpCredsFile:
    process.env.MC_WP_CREDS_FILE || join(OPENCLAW_DIR, "skills", "wordpress", "credentials.env"),

  marketingDbPath:
    process.env.MC_MARKETING_DB || join(SHARED, "Projects", "kevteaches-marketing-engine", "data", "marketing.db"),

  // Editing a draft here invalidates its stored compliance verdict, so the
  // review API re-runs the engine's own gate rather than reimplementing it.
  marketingEngineDir:
    process.env.MC_MARKETING_ENGINE_DIR || join(SHARED, "Projects", "kevteaches-marketing-engine"),

  pythonBin: process.env.MC_PYTHON_BIN || "python",

  defaultDiscordChannelTo:
    process.env.MC_DEFAULT_DISCORD_CHANNEL_TO || "channel:your-channel-id",

  mainDiscordSessionKey:
    process.env.MC_MAIN_DISCORD_SESSION_KEY || "",

  gaPropertyId:
    process.env.GA_PROPERTY_ID || "",

  gaClientFile:
    process.env.GA_CLIENT_FILE || join(OPENCLAW_DIR, "secrets", "client_secret_34331223700-g8eumr5383b7k0g939vnbfsevnudatj1.apps.googleusercontent.com.json"),

  gaTokenFile:
    process.env.GA_TOKEN_FILE || join(OPENCLAW_DIR, "secrets", "ga-token.json"),

  gaServiceAccountFile:
    process.env.GA_SERVICE_ACCOUNT_FILE || join(OPENCLAW_DIR, "secrets", "gen-lang-client-0826792438-4b7a29379ee3.json"),

  gaDbPath:
    process.env.GA_DB_PATH || join(PROJECT_ROOT, "data", "ga-kpi.db"),

  twitterKpiDbPath:
    process.env.TWITTER_KPI_DB_PATH || join(PROJECT_ROOT, "data", "twitter-kpi.db"),

  kpiDashboardUrl:
    process.env.KPI_DASHBOARD_URL || "http://localhost:3001",

};

// Snapshot path for any Hermes agent with a card (src/lib/hermes-agents.ts).
// Bernie's comes from the Mac; Edward and Lucy are Hermes profiles on the PC,
// whose hermes-agents-export.py writes shared/<id>/subagents.json every 5s.
export function hermesSubagentsFileFor(agentId: string): string {
  return agentId === "bernie" ? runtimeConfig.hermesSubagentsFile : join(SHARED, agentId, "subagents.json");
}
