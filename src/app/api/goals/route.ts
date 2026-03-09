import { NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";

export const dynamic = "force-dynamic";

const GOALS_PATH = path.join(process.cwd(), "data", "goals.json");
const GOALS_DIR = path.dirname(GOALS_PATH);

export async function GET() {
  try {
    if (!fs.existsSync(GOALS_PATH)) {
      return NextResponse.json({ career: [], personal: [], business: [] }, {
        headers: { "Cache-Control": "no-store, max-age=0" },
      });
    }
    const content = fs.readFileSync(GOALS_PATH, "utf-8");
    return NextResponse.json(JSON.parse(content), {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    console.error("Failed to read goals:", error);
    return NextResponse.json({ career: [], personal: [], business: [] }, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  }
}

export async function PUT(request: Request) {
  try {
    const data = await request.json();
    fs.mkdirSync(GOALS_DIR, { recursive: true });
    fs.writeFileSync(GOALS_PATH, JSON.stringify(data, null, 2));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to save goals:", error);
    return NextResponse.json({ error: "Failed to save goals" }, { status: 500 });
  }
}
