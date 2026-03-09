import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { exec } from "child_process";
import { promisify } from "util";
import { runtimeConfig } from "@/lib/runtime-config";

const OPENCLAW_CONFIG_FILE = runtimeConfig.openclawConfigFile;
const execAsync = promisify(exec);
const OPENCLAW_BIN = runtimeConfig.openclawBin;

type ModelOption = {
  value: string;
  label: string;
};

type CliModel = {
  key?: string;
  available?: boolean;
  missing?: boolean;
};

type OpenClawConfig = {
  gateway?: {
    port?: number;
    auth?: { token?: string };
  };
  agents?: {
    defaults?: {
      model?: {
        primary?: string;
        fallbacks?: string[];
      };
      models?: Record<string, unknown>;
    };
  };
};

function prettyLabel(id: string): string {
  return id
    .replace(/^openai-codex\//, "Codex ")
    .replace(/^openai\//, "OpenAI ")
    .replace(/^anthropic\//, "Anthropic ")
    .replace(/^moonshot\//, "Moonshot ")
    .replace(/^google\//, "Google ")
    .replace(/^ollama\//, "Ollama ")
    .replace(/^modal\//, "Modal ");
}

async function readConfig(): Promise<OpenClawConfig> {
  const raw = await readFile(OPENCLAW_CONFIG_FILE, "utf-8");
  return JSON.parse(raw) as OpenClawConfig;
}

function toModelOptions(ids: string[]): ModelOption[] {
  const unique = Array.from(new Set(ids.filter(Boolean))).sort((a, b) => a.localeCompare(b));
  return unique.map((id) => ({ value: id, label: prettyLabel(id) }));
}

function defaultsFromConfig(cfg: OpenClawConfig): string[] {
  const mapKeys = Object.keys(cfg.agents?.defaults?.models || {});
  const primary = cfg.agents?.defaults?.model?.primary;
  const fallbacks = cfg.agents?.defaults?.model?.fallbacks || [];
  return [...mapKeys, ...(primary ? [primary] : []), ...fallbacks];
}

async function readAvailableModelsFromCli(cfg: OpenClawConfig): Promise<ModelOption[]> {
  const token = cfg.gateway?.auth?.token || "";
  const port = String(cfg.gateway?.port || 18789);

  const { stdout } = await execAsync(`${OPENCLAW_BIN} models list --json`, {
    timeout: 15000,
    maxBuffer: 1024 * 1024,
    cwd: runtimeConfig.clawdDir,
    env: {
      ...process.env,
      HOME: runtimeConfig.homeDir,
      PATH: `${process.env.PATH || ""}:${runtimeConfig.homeDir}/.npm-global/bin`,
      OPENCLAW_GATEWAY_PORT: port,
      OPENCLAW_GATEWAY_TOKEN: token,
    },
  });

  const parsed = JSON.parse(stdout) as { models?: CliModel[] };
  const ids = (parsed.models || [])
    .filter((m) => m && m.available !== false && m.missing !== true)
    .map((m) => m.key)
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  return toModelOptions(ids);
}

export async function GET() {
  try {
    const cfg = await readConfig();

    try {
      const models = await readAvailableModelsFromCli(cfg);
      return NextResponse.json({ models, source: "openclaw.models.list", updatedAt: Date.now() });
    } catch {
      // Deterministic fallback: OpenClaw defaults from config (no stale settings list)
      const models = toModelOptions(defaultsFromConfig(cfg));
      return NextResponse.json({ models, source: "openclaw.defaults.config", updatedAt: Date.now() });
    }
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to load models" }, { status: 500 });
  }
}
