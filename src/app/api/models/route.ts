import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { runtimeConfig } from "@/lib/runtime-config";

const OPENCLAW_CONFIG_FILE = runtimeConfig.openclawConfigFile;

type ModelOption = {
  value: string;
  label: string;
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

export async function GET() {
  try {
    const cfg = await readConfig();
    const models = toModelOptions(defaultsFromConfig(cfg));
    return NextResponse.json({ models, source: "openclaw.defaults.config", updatedAt: Date.now() });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to load models" }, { status: 500 });
  }
}
