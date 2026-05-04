import { join } from "path";

const HOME = process.env.MC_HOME_DIR || process.env.HOME || "/home/user";
const CWD = process.env.MC_CLAWD_DIR || join(HOME, "clawd");
const SHARED = process.env.MC_SHARED_DIR || join(HOME, "shared");
const OPENCLAW_DIR = process.env.MC_OPENCLAW_DIR || join(HOME, ".openclaw");
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

  cronJobsFile:
    process.env.MC_CRON_JOBS_FILE || join(OPENCLAW_DIR, "cron", "jobs.json"),

  agentStatusFile:
    process.env.MC_AGENT_STATUS_FILE || join(SHARED, "agent-status.json"),

  messagesFile:
    process.env.MC_MESSAGES_FILE || join(SHARED, "messages.jsonl"),

  openclawConfigFile:
    process.env.MC_OPENCLAW_CONFIG_FILE || join(OPENCLAW_DIR, "openclaw.json"),

  openclawBin:
    process.env.MC_OPENCLAW_BIN || join(HOME, ".npm-global", "bin", "openclaw"),

  tasksFilePath:
    process.env.MC_TASKS_FILE_PATH || join(PROJECT_ROOT, "data", "tasks.json"),

  remindersFilePath:
    process.env.MC_REMINDERS_FILE_PATH || join(CWD, "reminders.json"),

  ideasFilePath:
    process.env.MC_IDEAS_FILE_PATH || join(CWD, "ideas.json"),

  memoryDir:
    process.env.MC_MEMORY_DIR || join(CWD, "memory"),

  twitterDir:
    process.env.MC_TWITTER_DIR || join(SHARED, "deliverables", "kevteaches-content", "twitter"),

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

  gaDbPath:
    process.env.GA_DB_PATH || join(PROJECT_ROOT, "data", "ga-kpi.db"),

};
