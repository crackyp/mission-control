import { NextResponse } from "next/server";
import fs from "fs";

const CALENDAR_PATH = "/home/crackypp/clawd/calendar/events.json";

export async function GET() {
  try {
    if (!fs.existsSync(CALENDAR_PATH)) {
      return NextResponse.json({ events: [] });
    }
    const data = fs.readFileSync(CALENDAR_PATH, "utf-8");
    const events = JSON.parse(data);
    return NextResponse.json({ events });
  } catch (error: any) {
    console.error("Failed to read calendar:", error);
    return NextResponse.json({ events: [], error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, event, eventId } = body;

    let events: any[] = [];
    if (fs.existsSync(CALENDAR_PATH)) {
      events = JSON.parse(fs.readFileSync(CALENDAR_PATH, "utf-8"));
    }

    if (action === "add" && event) {
      const newEvent = {
        id: Date.now().toString(16).slice(-8),
        title: event.title,
        date: event.date,
        time: event.time || null,
        duration: event.duration || null,
        description: event.description || "",
        location: event.location || "",
        recurrence: null,
        created: new Date().toISOString(),
        completed: false,
      };
      events.push(newEvent);
      fs.writeFileSync(CALENDAR_PATH, JSON.stringify(events, null, 2));
      return NextResponse.json({ success: true, event: newEvent });
    }

    if (action === "delete" && eventId) {
      events = events.filter((e) => e.id !== eventId);
      fs.writeFileSync(CALENDAR_PATH, JSON.stringify(events, null, 2));
      return NextResponse.json({ success: true });
    }

    if (action === "update" && eventId && event) {
      events = events.map((e) => (e.id === eventId ? { ...e, ...event } : e));
      fs.writeFileSync(CALENDAR_PATH, JSON.stringify(events, null, 2));
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error: any) {
    console.error("Calendar action failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
