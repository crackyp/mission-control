import { NextResponse } from "next/server";
import { readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";

const PEOPLE_FILE = "/home/crackypp/clawd/memory/people-you-met.md";

type Person = {
  name: string;
  nickname?: string;
  dateMet: string;
  dateLogged: string;
  context: string;
  note: string;
  details: string[];
};

function parseMarkdown(text: string): Person[] {
  const people: Person[] = [];
  const lines = text.split("\n");
  
  let currentPerson: Partial<Person> | null = null;
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // New person starts with "- **Name**"
    const nameMatch = trimmed.match(/^-\s+\*\*([^*]+)\*\*(?:\s+\("([^"]+)"\))?$/);
    if (nameMatch) {
      if (currentPerson && currentPerson.name) {
        people.push(currentPerson as Person);
      }
      currentPerson = {
        name: nameMatch[1],
        nickname: nameMatch[2] || undefined,
        dateMet: "",
        dateLogged: "",
        context: "",
        note: "",
        details: [],
      };
      continue;
    }
    
    if (!currentPerson) continue;
    
    // Parse fields
    const fieldMatch = trimmed.match(/^-\s+(\w+(?:\s+\w+)?):\s*(.*)$/);
    if (fieldMatch) {
      const [, key, value] = fieldMatch;
      const keyLower = key.toLowerCase();
      
      if (keyLower === "date met") {
        currentPerson.dateMet = value;
      } else if (keyLower === "date logged") {
        currentPerson.dateLogged = value;
      } else if (keyLower === "context") {
        currentPerson.context = value;
      } else if (keyLower === "note") {
        currentPerson.note = value;
      } else if (keyLower === "detail" || keyLower === "assessment") {
        currentPerson.details = currentPerson.details || [];
        currentPerson.details.push(value);
      }
    }
  }
  
  // Don't forget the last person
  if (currentPerson && currentPerson.name) {
    people.push(currentPerson as Person);
  }
  
  return people;
}

function toMarkdown(people: Person[]): string {
  const lines: string[] = [
    "# People Kev Met (Running List)",
    "",
    `Last updated: ${new Date().toISOString().split("T")[0]}`,
    "",
    "## Women",
    "",
  ];
  
  for (const person of people) {
    const nickname = person.nickname ? ` ("${person.nickname}")` : "";
    lines.push(`- **${person.name}**${nickname}`);
    lines.push(`  - Date met: ${person.dateMet}`);
    lines.push(`  - Date logged: ${person.dateLogged}`);
    lines.push(`  - Context: ${person.context}`);
    lines.push(`  - Note: ${person.note}`);
    for (const detail of person.details || []) {
      lines.push(`  - Detail: ${detail}`);
    }
    lines.push("");
  }
  
  return lines.join("\n");
}

export async function GET() {
  try {
    if (!existsSync(PEOPLE_FILE)) {
      return NextResponse.json({ people: [], raw: "" });
    }
    
    const text = await readFile(PEOPLE_FILE, "utf-8");
    const people = parseMarkdown(text);
    
    return NextResponse.json({ people, raw: text });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    if (body.action === "add") {
      // Read existing
      let people: Person[] = [];
      if (existsSync(PEOPLE_FILE)) {
        const text = await readFile(PEOPLE_FILE, "utf-8");
        people = parseMarkdown(text);
      }
      
      // Add new person
      const newPerson: Person = {
        name: body.name,
        nickname: body.nickname || undefined,
        dateMet: body.dateMet || new Date().toISOString().split("T")[0],
        dateLogged: new Date().toISOString().split("T")[0],
        context: body.context || "",
        note: body.note || "",
        details: body.details || [],
      };
      
      people.push(newPerson);
      
      // Write back
      await writeFile(PEOPLE_FILE, toMarkdown(people), "utf-8");
      
      return NextResponse.json({ success: true, person: newPerson });
    }
    
    if (body.action === "update") {
      let people: Person[] = [];
      if (existsSync(PEOPLE_FILE)) {
        const text = await readFile(PEOPLE_FILE, "utf-8");
        people = parseMarkdown(text);
      }
      
      const index = people.findIndex(p => p.name === body.originalName);
      if (index === -1) {
        return NextResponse.json({ error: "Person not found" }, { status: 404 });
      }
      
      people[index] = {
        ...people[index],
        name: body.name ?? people[index].name,
        nickname: body.nickname ?? people[index].nickname,
        dateMet: body.dateMet ?? people[index].dateMet,
        context: body.context ?? people[index].context,
        note: body.note ?? people[index].note,
        details: body.details ?? people[index].details,
      };
      
      await writeFile(PEOPLE_FILE, toMarkdown(people), "utf-8");
      
      return NextResponse.json({ success: true, person: people[index] });
    }
    
    if (body.action === "delete") {
      let people: Person[] = [];
      if (existsSync(PEOPLE_FILE)) {
        const text = await readFile(PEOPLE_FILE, "utf-8");
        people = parseMarkdown(text);
      }
      
      people = people.filter(p => p.name !== body.name);
      
      await writeFile(PEOPLE_FILE, toMarkdown(people), "utf-8");
      
      return NextResponse.json({ success: true });
    }
    
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
