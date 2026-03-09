import { exec } from "child_process";
import { promisify } from "util";
import { NextResponse } from "next/server";

const execAsync = promisify(exec);

type Service = {
  name: string;
  status: "running" | "stopped" | "failed" | "unknown";
  description: string;
};

export async function GET() {
  try {
    // Get user services
    const { stdout: userOutput } = await execAsync(
      'systemctl --user list-units --type=service --all --no-pager --plain --no-legend 2>/dev/null || echo ""'
    );

    // Get system services (limited to common ones)
    const { stdout: systemOutput } = await execAsync(
      'systemctl list-units --type=service --state=running --no-pager --plain --no-legend 2>/dev/null | head -20 || echo ""'
    );

    const services: Service[] = [];

    // Parse user services
    const userLines = userOutput.trim().split("\n").filter(Boolean);
    for (const line of userLines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 4) {
        const name = parts[0].replace(".service", "");
        const loadState = parts[1];
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

        services.push({
          name: `[user] ${name}`,
          status,
          description,
        });
      }
    }

    // Parse system services (just running ones)
    const systemLines = systemOutput.trim().split("\n").filter(Boolean);
    for (const line of systemLines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 4) {
        const name = parts[0].replace(".service", "");
        const description = parts.slice(4).join(" ") || name;

        // Skip internal/boring services
        if (name.startsWith("sys-") || name.startsWith("dev-") || name.includes("@")) {
          continue;
        }

        services.push({
          name,
          status: "running",
          description,
        });
      }
    }

    return NextResponse.json({ services });
  } catch (error) {
    console.error("Failed to get services:", error);
    return NextResponse.json({ services: [], error: String(error) });
  }
}
