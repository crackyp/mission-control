import { exec } from "child_process";
import { promisify } from "util";
import { NextResponse } from "next/server";

const execAsync = promisify(exec);

type Service = {
  name: string;
  status: "running" | "stopped" | "failed" | "unknown";
  description: string;
  ports?: number[];
  details?: string;
};

type PortMap = Record<string, number[]>;

function parsePortMap(ssOutput: string): PortMap {
  const map: PortMap = {};
  const lines = ssOutput.split("\n").filter(Boolean);

  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 6) continue;

    const localAddress = parts[3] || "";
    const processPart = parts.slice(5).join(" ");
    const portMatch = localAddress.match(/:(\d+)$/);
    if (!portMatch) continue;

    const port = Number(portMatch[1]);
    if (!Number.isFinite(port)) continue;

    const pidMatches = [...processPart.matchAll(/pid=(\d+)/g)];
    for (const m of pidMatches) {
      const pid = m[1];
      if (!map[pid]) map[pid] = [];
      if (!map[pid].includes(port)) map[pid].push(port);
    }
  }

  for (const pid of Object.keys(map)) {
    map[pid].sort((a, b) => a - b);
  }

  return map;
}

async function getServicePids(unitName: string, isUser = false): Promise<string[]> {
  try {
    const { stdout } = await execAsync(
      `${isUser ? "systemctl --user" : "systemctl"} show ${unitName} -p MainPID -p ControlGroup --value 2>/dev/null || echo ""`
    );

    const lines = stdout.split("\n").map((l) => l.trim()).filter(Boolean);
    const mainPid = lines[0] && lines[0] !== "0" ? lines[0] : null;
    const cgroupPath = lines[1] || "";

    const pids = new Set<string>();
    if (mainPid) pids.add(mainPid);

    if (cgroupPath) {
      const procFile = `/sys/fs/cgroup${cgroupPath}/cgroup.procs`;
      try {
        const { stdout: procOut } = await execAsync(`cat ${procFile} 2>/dev/null || echo ""`);
        procOut
          .split("\n")
          .map((p) => p.trim())
          .filter(Boolean)
          .forEach((p) => pids.add(p));
      } catch {
        // ignore
      }
    }

    return [...pids];
  } catch {
    return [];
  }
}

export async function GET() {
  try {
    const { stdout: userOutput } = await execAsync(
      'systemctl --user list-units --type=service --all --no-pager --plain --no-legend 2>/dev/null || echo ""'
    );

    const { stdout: systemOutput } = await execAsync(
      'systemctl list-units --type=service --state=running --no-pager --plain --no-legend 2>/dev/null | head -20 || echo ""'
    );

    const { stdout: ssOutput } = await execAsync('ss -ltnpH 2>/dev/null || echo ""');
    const portsByPid = parsePortMap(ssOutput);

    const services: Service[] = [];

    const userLines = userOutput.trim().split("\n").filter(Boolean);
    for (const line of userLines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 4) {
        const unitName = parts[0];
        const name = unitName.replace(".service", "");
        const activeState = parts[2];
        const subState = parts[3];
        const description = parts.slice(4).join(" ") || name;

        let status: Service["status"] = "unknown";
        if (activeState === "active" && subState === "running") {
          status = "running";
        } else if (activeState === "inactive" || subState === "dead") {
          status = "stopped";
        } else if (activeState === "failed") {
          status = "failed";
        }

        const pids = await getServicePids(unitName, true);
        const ports = [...new Set(pids.flatMap((pid) => portsByPid[pid] || []))].sort((a, b) => a - b);

        services.push({
          name: `[user] ${name}`,
          status,
          description,
          ports,
          details: pids.length ? `PID${pids.length > 1 ? "s" : ""} ${pids.slice(0, 4).join(", ")}${pids.length > 4 ? "…" : ""}` : "No process info",
        });
      }
    }

    const systemLines = systemOutput.trim().split("\n").filter(Boolean);
    for (const line of systemLines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 4) {
        const unitName = parts[0];
        const name = unitName.replace(".service", "");
        const description = parts.slice(4).join(" ") || name;

        if (name.startsWith("sys-") || name.startsWith("dev-") || name.includes("@")) {
          continue;
        }

        const pids = await getServicePids(unitName);
        const ports = [...new Set(pids.flatMap((pid) => portsByPid[pid] || []))].sort((a, b) => a - b);

        services.push({
          name,
          status: "running",
          description,
          ports,
          details: pids.length ? `PID${pids.length > 1 ? "s" : ""} ${pids.slice(0, 4).join(", ")}${pids.length > 4 ? "…" : ""}` : "No process info",
        });
      }
    }

    return NextResponse.json({ services });
  } catch (error) {
    console.error("Failed to get services:", error);
    return NextResponse.json({ services: [], error: String(error) });
  }
}
