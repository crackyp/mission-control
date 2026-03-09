import { NextResponse } from "next/server";
import { readFile, writeFile } from "fs/promises";
import { runtimeConfig } from "@/lib/runtime-config";

const CRON_JOBS_FILE = runtimeConfig.cronJobsFile;

const AGENTS = [
  { id: "main", name: "KevBot", emoji: "🤖" },
  { id: "shuri", name: "Shuri", emoji: "📋" },
  { id: "bob", name: "Bob", emoji: "🔨" },
  { id: "chet", name: "Chet", emoji: "🎨" },
  { id: "ricky", name: "Ricky", emoji: "📚" },
  { id: "pixel", name: "Pixel", emoji: "🖥️" },
  { id: "duke", name: "Duke", emoji: "⚙️" },
  { id: "inspector-gadget", name: "Inspector Gadget", emoji: "🔍" },
];

type CronJob = {
  id: string;
  agentId?: string;
  name: string;
  enabled?: boolean;
  schedule?: {
    kind: string;
    expr?: string;
    tz?: string;
    everyMs?: number;
  };
  sessionTarget?: string;
  payload?: {
    kind: string;
    message?: string;
  };
  delivery?: {
    mode: string;
    channel?: string;
    to?: string;
  };
  state?: {
    nextRunAtMs?: number;
    lastRunAtMs?: number;
    lastStatus?: string;
  };
};

type CronJobsFile = {
  jobs: CronJob[];
};

async function loadCronJobs(): Promise<CronJob[]> {
  try {
    const content = await readFile(CRON_JOBS_FILE, "utf-8");
    const data = JSON.parse(content) as CronJobsFile;
    return data.jobs || [];
  } catch {
    return [];
  }
}

async function saveCronJobs(jobs: CronJob[]): Promise<void> {
  await writeFile(CRON_JOBS_FILE, JSON.stringify({ jobs }, null, 2));
}

function getHeartbeatJobName(agentId: string): string {
  return `heartbeat-${agentId}`;
}

function findHeartbeatJob(jobs: CronJob[], agentId: string): CronJob | undefined {
  const heartbeatName = getHeartbeatJobName(agentId);
  return jobs.find(j => j.name === heartbeatName || (j.agentId === agentId && j.name?.includes("heartbeat")));
}

function getDefaultHeartbeatMessage(agentId: string, agentName: string): string {
  if (agentId === "main") {
    return "TEAM OVERSEER HEARTBEAT: Read /home/crackypp/clawd/HEARTBEAT.md and follow it strictly. Your job is to monitor the agent team health: check agent status, review stuck tasks, verify handoffs are flowing, and ensure agents are waking and working. Alert Kev if serious issues. Reply HEARTBEAT_OK only if everything is healthy.";
  }
  return `You are ${agentName}. Heartbeat check: Read your HEARTBEAT.md at /home/crackypp/shared/${agentId}/HEARTBEAT.md and follow its instructions. Check your inbox, tasks, and take action. If nothing needs attention, reply HEARTBEAT_OK.`;
}

export async function GET() {
  try {
    const jobs = await loadCronJobs();
    
    const heartbeats = AGENTS.map(agent => {
      const job = findHeartbeatJob(jobs, agent.id);
      
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
      
      return {
        agentId: agent.id,
        agentName: agent.name,
        agentEmoji: agent.emoji,
        enabled: job?.enabled ?? false,
        frequencyMinutes,
        jobId: job?.id,
        lastRun: job?.state?.lastRunAtMs,
        lastStatus: job?.state?.lastStatus,
        nextRun: job?.state?.nextRunAtMs,
      };
    });
    
    return NextResponse.json({ heartbeats, updatedAt: Date.now() });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to load heartbeats" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { agentId, enabled, frequencyMinutes } = body;
    
    const agent = AGENTS.find(a => a.id === agentId);
    if (!agent) {
      return NextResponse.json({ error: "Unknown agent" }, { status: 400 });
    }
    
    const jobs = await loadCronJobs();
    let job = findHeartbeatJob(jobs, agentId);
    
    if (!job) {
      // Create new heartbeat job
      job = {
        id: `heartbeat-${agentId}-${Date.now().toString(36)}`,
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
          message: getDefaultHeartbeatMessage(agentId, agent.name),
        },
        delivery: {
          mode: "announce",
          channel: "discord",
          to: "channel:1470107532490969394",
        },
      };
      jobs.push(job);
    } else {
      // Update existing job
      if (typeof enabled === "boolean") {
        job.enabled = enabled;
      }
      if (typeof frequencyMinutes === "number" && frequencyMinutes > 0) {
        job.schedule = {
          kind: "every",
          everyMs: frequencyMinutes * 60000,
        };
      }
    }
    
    await saveCronJobs(jobs);
    
    // Signal OpenClaw to reload cron jobs
    try {
      const { exec } = await import("child_process");
      const { promisify } = await import("util");
      const execAsync = promisify(exec);
      await execAsync("pkill -USR1 -f openclaw-gateway || true", { timeout: 5000 });
    } catch {
      // Ignore signal errors
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
