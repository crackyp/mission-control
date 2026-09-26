import { NextResponse } from "next/server";
import { readFile, writeFile } from "fs/promises";
import { callCronGateway, readCronJobs, readCronRuns } from "@/lib/openclaw-cron";

const AGENTS = [
  { id: "main", name: "KevBot", emoji: "🤖" },
];

type CronJob = {
  id: string;
  agentId?: string;
  name: string;
  enabled?: boolean;
  wakeMode?: string;
  schedule?: {
    kind: string;
    expr?: string;
    tz?: string;
    everyMs?: number;
    anchorMs?: number;
  };
  sessionTarget?: string;
  payload?: {
    kind: string;
    model?: string;
    message?: string;
  };
  delivery?: {
    mode: string;
    channel?: string;
    to?: string;
  };
  state?: {
    nextRunAtMs?: number;
    runningAtMs?: number;
    lastRunAtMs?: number;
    lastStatus?: string;
    lastRunStatus?: string;
  };
};

function getHeartbeatJobName(agentId: string): string {
  return `heartbeat-${agentId}`;
}

function findHeartbeatJob(jobs: CronJob[], agentId: string): CronJob | undefined {
  const heartbeatName = getHeartbeatJobName(agentId);
  return jobs.find(j => j.name === heartbeatName || (j.agentId === agentId && j.name?.includes("heartbeat")));
}

function getDefaultHeartbeatMessage(agentId: string, agentName: string): string {
  if (agentId === "main") {
    return "KevBot MiniMax heartbeat triage. Read and follow this prompt exactly: /home/crackypp/clawd/prompts/kevbot-heartbeat-minimax-triage.md\n\nSummary: use MiniMax M2.7 for lightweight checks and triage. Check Mission Control tasks in /home/crackypp/clawd/tasks.json. Do simple safe cleanup yourself. If you find complex actionable work, update the task note/status and delegate to a clean isolated subagent using model openai-codex/gpt-5.5. If nothing needs attention, reply exactly NO_REPLY.";
  }
  return `You are ${agentName}. Heartbeat check: Read your agent HEARTBEAT.md instructions and follow them. Check your inbox, tasks, and take action. If nothing needs attention, reply NO_REPLY.`;
}

function getPromptPath(message?: string): string | null {
  const match = message?.match(/\/home\/crackypp\/clawd\/prompts\/[\w.-]+\.md/);
  return match?.[0] || null;
}

async function readPromptText(path: string | null): Promise<string> {
  if (!path) return "";
  try {
    return await readFile(path, "utf-8");
  } catch {
    return "";
  }
}

async function readLatestRun(jobId?: string): Promise<{ lastRun?: number; lastStatus?: string } | null> {
  if (!jobId) return null;
  try {
    for (const evt of readCronRuns(jobId, 20)) {
      if (evt?.action === "finished" || evt?.status) {
        return {
          lastRun: Number(evt.runAtMs || evt.ts || 0) || undefined,
          lastStatus: evt.status || evt.action,
        };
      }
    }
  } catch {
    return null;
  }
  return null;
}

export async function GET() {
  try {
    const jobs: CronJob[] = readCronJobs();
    
    const heartbeats = await Promise.all(AGENTS.map(async agent => {
      const job = findHeartbeatJob(jobs, agent.id);
      const payloadMessage = job?.payload?.message || getDefaultHeartbeatMessage(agent.id, agent.name);
      const promptPath = getPromptPath(payloadMessage);
      
      let frequencyMinutes = 0;
      if (job?.schedule) {
        if (job.schedule.kind === "every" && job.schedule.everyMs) {
          frequencyMinutes = Math.round(job.schedule.everyMs / 60000);
        } else if (job.schedule.kind === "cron" && job.schedule.expr) {
          // Try to parse simple cron expressions like "*/30 * * * *"
          const match = job.schedule.expr.match(/^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*/);
          if (match) {
            frequencyMinutes = parseInt(match[1], 10);
          }
        }
      }
      
      const latestRun = await readLatestRun(job?.id);
      return {
        agentId: agent.id,
        agentName: agent.name,
        agentEmoji: agent.emoji,
        enabled: job?.enabled ?? false,
        frequencyMinutes,
        jobId: job?.id,
        lastRun: job?.state?.lastRunAtMs || latestRun?.lastRun,
        lastStatus: job?.state?.lastRunStatus || job?.state?.lastStatus || latestRun?.lastStatus,
        nextRun: job?.state?.nextRunAtMs,
        model: job?.payload?.model || "minimax/MiniMax-M2.7",
        payloadMessage,
        promptPath,
        promptText: await readPromptText(promptPath),
        sessionTarget: job?.sessionTarget || "isolated",
        delivery: job?.delivery || null,
      };
    }));
    
    return NextResponse.json({ heartbeats, updatedAt: Date.now() });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to load heartbeats" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { agentId, enabled, frequencyMinutes, model, payloadMessage, promptPath, promptText } = body;
    
    const agent = AGENTS.find(a => a.id === agentId);
    if (!agent) {
      return NextResponse.json({ error: "Unknown agent" }, { status: 400 });
    }
    
    const jobs: CronJob[] = readCronJobs();
    let job = findHeartbeatJob(jobs, agentId);

    if (!job) {
      // Create new heartbeat job (the gateway assigns the id)
      job = (await callCronGateway("cron.add", {
        agentId: agentId,
        name: getHeartbeatJobName(agentId),
        enabled: enabled ?? false,
        schedule: {
          kind: "every",
          everyMs: (frequencyMinutes || 30) * 60000,
        },
        sessionTarget: "isolated",
        payload: {
          kind: "agentTurn",
          model: agentId === "main" ? "minimax/MiniMax-M2.7" : undefined,
          message: getDefaultHeartbeatMessage(agentId, agent.name),
        },
        delivery: {
          mode: "announce",
          channel: "discord",
          to: "channel:1470107532490969394",
        },
      })) as CronJob;
    } else {
      // Update existing job; `patch` mirrors each change for cron.update.
      const now = Date.now();
      const wasEnabled = job.enabled !== false;
      const requestedEnabled = typeof enabled === "boolean" ? enabled : wasEnabled;
      const isReenable = !wasEnabled && requestedEnabled;
      const patch: Record<string, any> = {};

      if (typeof enabled === "boolean") {
        job.enabled = enabled;
        patch.enabled = enabled;
      }
      if (typeof frequencyMinutes === "number" && frequencyMinutes > 0) {
        job.schedule = {
          kind: "every",
          everyMs: frequencyMinutes * 60000,
        };
        patch.schedule = job.schedule;
      }
      if (!job.payload) {
        job.payload = { kind: "agentTurn" };
      }
      if (typeof model === "string" && model.trim()) {
        job.payload.model = model.trim();
        patch.payload = { ...patch.payload, kind: job.payload.kind, model: job.payload.model };
      }
      if (typeof payloadMessage === "string" && payloadMessage.trim()) {
        job.payload.message = payloadMessage;
        patch.payload = { ...patch.payload, kind: job.payload.kind, message: payloadMessage };
      }

      // Re-enable guardrails: the gateway recomputes the next run itself;
      // this keeps the first run a full interval out instead of immediate.
      if (isReenable) {
        const everyMs = Number(job.schedule?.everyMs || 0);
        if (job.schedule?.kind === "every" && Number.isFinite(everyMs) && everyMs > 0) {
          job.schedule = {
            ...job.schedule,
            anchorMs: now + everyMs,
          };
          patch.schedule = job.schedule;
        }

        if (job.wakeMode === "now") {
          job.wakeMode = "next-heartbeat";
          patch.wakeMode = job.wakeMode;
        }
      }

      if (Object.keys(patch).length > 0) {
        await callCronGateway("cron.update", { id: job.id, patch });
      }
    }

    const safePromptPath = typeof promptPath === "string" ? getPromptPath(promptPath) : getPromptPath(job.payload?.message);
    if (safePromptPath && typeof promptText === "string") {
      await writeFile(safePromptPath, promptText);
    }

    return NextResponse.json({ 
      success: true, 
      jobId: job.id,
      enabled: job.enabled,
      frequencyMinutes: job.schedule?.everyMs ? Math.round(job.schedule.everyMs / 60000) : 0,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to update heartbeat" }, { status: 500 });
  }
}
