import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";
import { runtimeConfig } from "@/lib/runtime-config";

const SHARED_DIR = runtimeConfig.sharedDir;
const QUEUE_FILE = join(SHARED_DIR, "messages.jsonl");

const AGENTS = [
  { id: "shuri", name: "Shuri", role: "Product Manager", emoji: "📋" },
  { id: "bob", name: "Bob", role: "Builder", emoji: "🔨" },
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

type RawInboxMessage = Partial<InboxMessage> & {
  subject?: string;
  body?: string;
  priority?: string;
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

function normalizeInboxMessage(raw: RawInboxMessage): InboxMessage {
  const fallbackId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const from = typeof raw.from === "string" && raw.from.trim() ? raw.from.trim() : "unknown";
  const type =
    typeof raw.type === "string" && raw.type.trim()
      ? raw.type.trim()
      : raw.priority === "high"
      ? "urgent"
      : "info";

  const messageParts = [raw.message, raw.subject, raw.body]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .map((part) => part.trim());

  return {
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id : fallbackId,
    from,
    type,
    message: messageParts.length ? messageParts.join("\n\n") : "(no message)",
    timestamp:
      typeof raw.timestamp === "string" && !Number.isNaN(new Date(raw.timestamp).getTime())
        ? raw.timestamp
        : new Date().toISOString(),
    read: typeof raw.read === "boolean" ? raw.read : false,
  };
}

async function readInbox(agentId: string): Promise<InboxMessage[]> {
  try {
    const inboxPath = join(SHARED_DIR, agentId, "inbox.json");
    const content = await readFile(inboxPath, "utf-8");
    const parsed = JSON.parse(content);

    // Backward/forward compatibility:
    // - legacy/current shape: []
    // - alternate shape seen in some agent tools: { items: [] }
    const rawItems: RawInboxMessage[] = Array.isArray(parsed)
      ? parsed
      : parsed && Array.isArray((parsed as { items?: unknown }).items)
      ? ((parsed as { items: RawInboxMessage[] }).items || [])
      : [];

    return rawItems.map(normalizeInboxMessage);
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
    const { action, agentId, message, from, type, to } = body;
    const { writeFile, appendFile, mkdir } = await import("fs/promises");

    if (action === "clear" && agentId) {
      // Clear read messages from inbox
      const inboxPath = join(SHARED_DIR, agentId, "inbox.json");
      const messages = await readInbox(agentId);
      const unread = messages.filter((m) => !m.read);
      await writeFile(inboxPath, JSON.stringify(unread, null, 2));
      return NextResponse.json({ success: true, remaining: unread.length });
    }

    if (action === "markRead" && agentId) {
      // Mark all as read
      const inboxPath = join(SHARED_DIR, agentId, "inbox.json");
      const messages = await readInbox(agentId);
      const updated = messages.map((m) => ({ ...m, read: true }));
      await writeFile(inboxPath, JSON.stringify(updated, null, 2));
      return NextResponse.json({ success: true });
    }

    if (action === "clearQueue") {
      // Clear the message queue
      await writeFile(QUEUE_FILE, "");
      return NextResponse.json({ success: true });
    }

    if (action === "sendInbox") {
      // Send a message to an agent's inbox
      if (!agentId || !message) {
        return NextResponse.json({ error: "agentId and message required" }, { status: 400 });
      }
      
      const agent = AGENTS.find((a) => a.id === agentId);
      if (!agent) {
        return NextResponse.json({ error: `Unknown agent: ${agentId}` }, { status: 400 });
      }
      
      const inboxDir = join(SHARED_DIR, agentId);
      const inboxPath = join(inboxDir, "inbox.json");
      
      // Ensure inbox directory exists
      try {
        await mkdir(inboxDir, { recursive: true });
      } catch {}
      
      const messages = await readInbox(agentId);
      
      const newMsg: InboxMessage = {
        id: Date.now().toString(36) + Math.random().toString(36).substr(2, 4),
        from: from || "dashboard",
        type: type || "info",
        message: message,
        timestamp: new Date().toISOString(),
        read: false,
      };
      
      messages.push(newMsg);
      await writeFile(inboxPath, JSON.stringify(messages, null, 2));
      
      return NextResponse.json({ success: true, messageId: newMsg.id });
    }

    if (action === "sendQueue") {
      // Post a message to the shared queue
      if (!message) {
        return NextResponse.json({ error: "message required" }, { status: 400 });
      }
      
      const queueMsg: QueueMessage = {
        id: Date.now().toString(36) + Math.random().toString(36).substr(2, 4),
        timestamp: new Date().toISOString(),
        from: from || "dashboard",
        to: to || "all",
        type: type || "info",
        message: message,
      };
      
      await appendFile(QUEUE_FILE, JSON.stringify(queueMsg) + "\n");
      
      return NextResponse.json({ success: true, messageId: queueMsg.id });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Action failed" },
      { status: 500 }
    );
  }
}
