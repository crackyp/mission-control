import { readFileSync } from "fs";

const OPENCLAW_AUTH_FILE = "/home/crackypp/.openclaw/auth-profiles.json";
const OPENCLAW_AGENT_AUTH_FILE = "/home/crackypp/.openclaw/agents/main/agent/auth-profiles.json";

type AuthCredential = {
  type?: string;
  access?: string;
  token?: string;
  accountId?: string;
};

type AuthStore = {
  profiles?: Record<string, AuthCredential>;
  order?: Record<string, string[]>;
};

function readJson(path: string): AuthStore | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as AuthStore;
  } catch {
    return null;
  }
}

function mergeStores(primary: AuthStore | null, fallback: AuthStore | null): AuthStore {
  return {
    profiles: {
      ...(fallback?.profiles || {}),
      ...(primary?.profiles || {}),
    },
    order: {
      ...(fallback?.order || {}),
      ...(primary?.order || {}),
    },
  };
}

export function resolveAuthStore(): AuthStore {
  const root = readJson(OPENCLAW_AUTH_FILE);
  const agent = readJson(OPENCLAW_AGENT_AUTH_FILE);
  return mergeStores(agent, root);
}

export function resolveProviderOrder(provider: string): string[] {
  const store = resolveAuthStore();
  return store.order?.[provider] || [];
}

export function resolveCredential(profileId: string): AuthCredential | undefined {
  return resolveAuthStore().profiles?.[profileId];
}
