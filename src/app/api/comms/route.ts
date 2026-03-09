import { NextResponse } from "next/server";
import { readFile, readdir } from "fs/promises";
import { join } from "path";
import { runtimeConfig } from "@/lib/runtime-config";

const SHARED_DIR = runtimeConfig.sharedDir;
const QUEUE_FILE = join(SHARED_DIR, "messages.jsonl");

const AGENTS = [
  { id: "shuri", name: "Shuri", role: "Product Manager", emoji: "📋" },
  { id: "bob", name: "Bob", role: "Builder", emoji: "🔨" },
  { id: "chet", name: "Chet", role: "Creative", emoji: "🎨" },
  { id: "ricky", name: "Ricky", role: "Researcher", emoji: "📚" },
  { id: "pixel", name: "Pixel", role: "Frontend", emoji: "🖥️" },
  { id: "duke", name: "Duke", role: "Backend", emoji: "⚙️" },
  { id: "inspector-gadget", name: "Inspector Gadget", role: "Reviewer", emoji: "🔍" },
];

type InboxMessage = {
  id: string;
  from: string;
  type: string;
  message: string;
  timestamp: string;
  read: boolean;
};

type AgentInbox = {
  agentId: string;
  agentName: string;
  agentEmoji: string;
  messages: InboxMessage[];
  unreadCount: number;
};

type QueueMessage = {
  id: string;
  timestamp: string;
  from: string;
  to: string;
  type: string;
  message: string;
};

async function readInbox(agentId: string): Promise<InboxMessage[]> {
  try {
    const inboxPath = join(SHARED_DIR, agentId, "inbox.json");
    const content = await readFile(inboxPath, "utf-8");
    return JSON.parse(content) as InboxMessage[];
  } catch {
    return [];
  }
}

async function readQueue(limit = 100): Promise<QueueMessage[]> {
  try {
    const content = await readFile(QUEUE_FILE, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    const messages: QueueMessage[] = [];
    
    for (const line of lines.slice(-limit)) {
      try {
        messages.push(JSON.parse(line));
      } catch {
        // Skip invalid lines
      }
    }
    
    return messages.reverse(); // Most recent first
  } catch {
    return [];
  }
}

export async function GET() {
  try {
    // Fetch all agent inboxes
    const inboxes: AgentInbox[] = await Promise.all(
      AGENTS.map(async (agent) => {
        const messages = await readInbox(agent.id);
        return {
          agentId: agent.id,
          agentName: agent.name,
          agentEmoji: agent.emoji,
          messages,
          unreadCount: messages.filter((m) => !m.read).length,
        };
      })
    );

    // Fetch message queue
    const queue = await readQueue(100);

    // Calculate summary stats
    const totalUnread = inboxes.reduce((sum, inbox) => sum + inbox.unreadCount, 0);
    const totalMessages = inboxes.reduce((sum, inbox) => sum + inbox.messages.length, 0);

    return NextResponse.json({
      inboxes,
      queue,
      stats: {
        totalUnread,
        totalMessages,
        queueSize: queue.length,
      },
      updatedAt: Date.now(),
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to load comms data" },
      { status: 500 }
    );
  }
}

// POST to send a message or clear inbox
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, agentId, message, from, type } = body;

    if (action === "clear" && agentId) {
      // Clear read messages from inbox
      const inboxPath = join(SHARED_DIR, agentId, "inbox.json");
      const messages = await readInbox(agentId);
      const unread = messages.filter((m) => !m.read);
      const { writeFile } = await import("fs/promises");
      await writeFile(inboxPath, JSON.stringify(unread, null, 2));
      return NextResponse.json({ success: true, remaining: unread.length });
    }

    if (action === "markRead" && agentId) {
      // Mark all as read
      const inboxPath = join(SHARED_DIR, agentId, "inbox.json");
      const messages = await readInbox(agentId);
      const updated = messages.map((m) => ({ ...m, read: true }));
      const { writeFile } = await import("fs/promises");
      await writeFile(inboxPath, JSON.stringify(updated, null, 2));
      return NextResponse.json({ success: true });
    }

    if (action === "clearQueue") {
      // Clear the message queue
      const { writeFile } = await import("fs/promises");
      await writeFile(QUEUE_FILE, "");
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Action failed" },
      { status: 500 }
    );
  }
}
