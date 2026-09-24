#!/usr/bin/env python3
"""hermes-subagents-export.py — Hermes delegate_task children → Mission Control.

Writes shared/bernie/subagents.json: every subagent session that is running or
ended in the last WINDOW_S, each with a timeline of its reasoning, tool calls
and tool results, plus `main` — the same timeline for Bernie's own active (or
latest) session, and `sessions` — Bernie's recent sessions with every token
they cost (aux tasks and subagents included). Mission Control's Agents tab
renders all three.

Source: ~/.hermes/state.db, opened READ-ONLY. Children are rows with
source='subagent' and parent_session_id set. Hermes flushes a child's messages
after every tool round (agent/turn_tool_round.py), so a running child's
timeline advances round by round — the call currently executing shows up once
its assistant message is flushed, and its result on the next flush.

Same exporter pattern as llamaswap-status-export.py: a LaunchAgent
(com.hermes.subagents-status) runs `--loop 5`; the Pi hosts the share, so the
atomic write is the only network hop and MC reads a local file.

Usage: hermes-subagents-export.py [--db PATH] [--out PATH] [--once | --loop SECONDS]
"""
import argparse
import json
import os
import sqlite3
import sys
import tempfile
import time
import traceback

DEFAULT_DB = os.path.expanduser("~/.hermes/state.db")

WINDOW_S = 24 * 3600          # keep ended children visible this long (matches MC's openclaw subagent window)
MAX_SESSIONS = 24
RUNNING_STALE_S = 15 * 60     # ended_at NULL but silent this long = the child died without closing
EVENTS_RUNNING = 120          # timeline tail kept per child
EVENTS_ENDED = 60
TEXT_CAP = 4000               # reasoning / assistant text
ARGS_CAP = 2000
RESULT_CAP = 2000
GOAL_CAP = 1500
MAIN_ROWS = 200               # message rows read from the tail of Bernie's active session
SESSIONS_WINDOW_S = 7 * 86400 # Bernie's token-usage table: sessions active this recently
MAX_TOKEN_SESSIONS = 20


def _share_mount():
    # ismount, not isdir: a dropped SMB share leaves a plain local directory at
    # the same path, and writing there silently never reaches the Pi.
    for p in ("/Volumes/shared", os.path.expanduser("~/smb-shared")):
        if os.path.ismount(p) and os.access(p, os.W_OK):
            return p
    return None


DEFAULT_OUT = os.path.join(_share_mount() or "/Volumes/shared", "bernie", "subagents.json")


def _cap(text, n):
    if text is None:
        return None
    text = str(text)
    return text if len(text) <= n else text[:n] + f"… [+{len(text) - n} chars]"


def _ms(ts):
    return int(ts * 1000) if ts else None


def _args_text(raw):
    """Tool-call arguments arrive as a JSON string; pretty-print when it parses."""
    if raw is None:
        return None
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError:
            return _cap(raw, ARGS_CAP)
    return _cap(json.dumps(raw, indent=1, ensure_ascii=False), ARGS_CAP)


def _args_summary(raw):
    """One-line gist of a call for the card: the command / path / query, not the JSON."""
    try:
        args = json.loads(raw) if isinstance(raw, str) else (raw or {})
    except ValueError:
        return _cap(raw, 160)
    if not isinstance(args, dict):
        return _cap(str(args), 160)
    for key in ("command", "cmd", "path", "file_path", "query", "url", "pattern", "goal", "prompt", "code"):
        if isinstance(args.get(key), str) and args[key].strip():
            return _cap(" ".join(args[key].split()), 160)
    return _cap(json.dumps(args, ensure_ascii=False), 160)


def build_timeline(rows, include_user=False):
    events = []
    for r in rows:
        ts = _ms(r["timestamp"])
        if r["role"] == "user" and include_user:
            if r["content"] and r["content"].strip():
                events.append({"ts": ts, "kind": "user", "text": _cap(r["content"].strip(), TEXT_CAP)})
        elif r["role"] == "assistant":
            reasoning = r["reasoning_content"] or r["reasoning"]
            if reasoning and reasoning.strip():
                events.append({"ts": ts, "kind": "reasoning", "text": _cap(reasoning.strip(), TEXT_CAP)})
            if r["content"] and r["content"].strip():
                events.append({"ts": ts, "kind": "text", "text": _cap(r["content"].strip(), TEXT_CAP)})
            try:
                calls = json.loads(r["tool_calls"]) if r["tool_calls"] else []
            except ValueError:
                calls = []
            for c in calls if isinstance(calls, list) else []:
                fn = (c or {}).get("function") or {}
                events.append({
                    "ts": ts,
                    "kind": "call",
                    "tool": fn.get("name") or "tool",
                    "callId": c.get("id") or c.get("call_id"),
                    "summary": _args_summary(fn.get("arguments")),
                    "args": _args_text(fn.get("arguments")),
                })
        elif r["role"] == "tool":
            events.append({
                "ts": ts,
                "kind": "result",
                "tool": r["tool_name"] or "tool",
                "callId": r["tool_call_id"],
                "text": _cap(r["content"], RESULT_CAP),
            })
    return events


def describe_now(status, events):
    """What the child is doing this moment, derived from its timeline tail."""
    if status != "running":
        return None
    if not events:
        return "Starting…"
    last = events[-1]
    if last["kind"] == "call":
        done = {e.get("callId") for e in events if e["kind"] == "result"}
        pending = [e for e in events if e["kind"] == "call" and e.get("callId") not in done]
        if pending:
            p = pending[-1]
            return f"Running {p['tool']}: {p['summary']}" if p.get("summary") else f"Running {p['tool']}"
    return "Thinking…"


def query(db_path):
    now = time.time()
    uri = "file:" + db_path + "?mode=ro"
    con = sqlite3.connect(uri, uri=True, timeout=5)
    con.row_factory = sqlite3.Row
    try:
        sessions = con.execute(
            """SELECT s.id, s.parent_session_id, s.model, s.started_at, s.ended_at, s.end_reason,
                      s.message_count, s.tool_call_count, s.input_tokens, s.output_tokens,
                      s.last_activity_at, p.title AS parent_title, p.source AS parent_source
                 FROM sessions s LEFT JOIN sessions p ON p.id = s.parent_session_id
                WHERE s.source = 'subagent'
                  AND (s.ended_at IS NULL OR s.ended_at > ?)
                  AND s.started_at > ?
                ORDER BY s.started_at DESC LIMIT ?""",
            (now - WINDOW_S, now - 7 * 86400, MAX_SESSIONS),
        ).fetchall()

        out = []
        for s in sessions:
            rows = con.execute(
                """SELECT role, content, tool_calls, tool_call_id, tool_name, timestamp,
                          reasoning, reasoning_content
                     FROM messages WHERE session_id = ? ORDER BY id""",
                (s["id"],),
            ).fetchall()
            goal = next((r["content"] for r in rows if r["role"] == "user" and r["content"]), None)
            last_ts = max([r["timestamp"] for r in rows] + [s["last_activity_at"] or 0, s["started_at"]])
            if s["ended_at"]:
                status = "done"
            elif now - last_ts > RUNNING_STALE_S:
                status = "stalled"
            else:
                status = "running"
            events = build_timeline(rows)
            keep = EVENTS_RUNNING if status == "running" else EVENTS_ENDED
            out.append({
                "id": s["id"],
                "parentSessionId": s["parent_session_id"],
                "parentTitle": s["parent_title"],
                "parentSource": s["parent_source"],
                "model": s["model"],
                "status": status,
                "endReason": s["end_reason"],
                "startedAt": _ms(s["started_at"]),
                "endedAt": _ms(s["ended_at"]),
                "lastActivityAt": _ms(last_ts),
                "goal": _cap(goal, GOAL_CAP),
                "now": describe_now(status, events),
                "messageCount": s["message_count"] or len(rows),
                "toolCallCount": s["tool_call_count"] or sum(1 for e in events if e["kind"] == "call"),
                "inputTokens": s["input_tokens"] or 0,
                "outputTokens": s["output_tokens"] or 0,
                "eventsTotal": len(events),
                "events": events[-keep:],
            })
    finally:
        con.close()

    order = {"running": 0, "stalled": 1, "done": 2}
    out.sort(key=lambda x: (order[x["status"]], -(x["startedAt"] or 0)))
    return out


def query_main(db_path):
    """Bernie's own activity: the session holding a live turn lease (Hermes takes
    one per in-flight turn), else the most recently active non-subagent session.
    Main sessions are long-lived chats, so only the tail is read."""
    now = time.time()
    con = sqlite3.connect("file:" + db_path + "?mode=ro", uri=True, timeout=5)
    con.row_factory = sqlite3.Row
    try:
        cols = """s.id, s.source, s.title, s.model, s.started_at, s.last_activity_at,
                  s.last_activity_description, s.tool_call_count"""
        s = con.execute(
            f"""SELECT {cols}, l.acquired_at AS turn_started_at
                  FROM session_turn_leases l JOIN sessions s ON s.id = l.conversation_id
                 WHERE l.expires_at > ? AND s.source != 'subagent'
                 ORDER BY l.acquired_at DESC LIMIT 1""",
            (now,),
        ).fetchone()
        if s is None:
            s = con.execute(
                f"""SELECT {cols}, NULL AS turn_started_at FROM sessions s
                     WHERE s.source != 'subagent'
                     ORDER BY COALESCE(s.last_activity_at, s.started_at) DESC LIMIT 1"""
            ).fetchone()
        if s is None:
            return None
        rows = con.execute(
            """SELECT * FROM (SELECT id, role, content, tool_calls, tool_call_id, tool_name, timestamp,
                                     reasoning, reasoning_content
                                FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT ?)
                ORDER BY id""",
            (s["id"], MAIN_ROWS),
        ).fetchall()
    finally:
        con.close()

    working = s["turn_started_at"] is not None
    events = build_timeline(rows, include_user=True)
    last_ts = max([r["timestamp"] for r in rows] + [s["last_activity_at"] or 0, s["started_at"]])
    return {
        "id": s["id"],
        "source": s["source"],
        "title": s["title"],
        "model": s["model"],
        "status": "running" if working else "idle",
        "startedAt": _ms(s["started_at"]),
        "turnStartedAt": _ms(s["turn_started_at"]),
        "lastActivityAt": _ms(last_ts),
        "now": describe_now("running", events) if working else None,
        "activityDetail": s["last_activity_description"] if working else None,
        "toolCallCount": s["tool_call_count"] or 0,
        "eventsTotal": len(events),
        "events": events[-EVENTS_RUNNING:],
    }


def _usage(input_tokens=0, cache_read=0, output=0, calls=0):
    return {"inputTokens": input_tokens or 0, "cacheReadTokens": cache_read or 0,
            "outputTokens": output or 0, "apiCalls": calls or 0}


def query_sessions(db_path):
    """Bernie's recent sessions with ALL the tokens each one cost.

    sessions.input_tokens/output_tokens count only the main model's calls.
    Auxiliary work Hermes does on a session's behalf (vision, background
    memory review, title generation, compression) is recorded per model/task
    in session_model_usage and never folded into the session row, and a
    delegate_task child is its own session. Totals here = every
    session_model_usage row for the session + the same for its subagents."""
    now = time.time()
    con = sqlite3.connect("file:" + db_path + "?mode=ro", uri=True, timeout=5)
    con.row_factory = sqlite3.Row
    try:
        leased = {r[0] for r in con.execute(
            "SELECT conversation_id FROM session_turn_leases WHERE expires_at > ?", (now,))}
        sessions = con.execute(
            """SELECT id, source, title, model, started_at, ended_at, last_activity_at,
                      input_tokens, output_tokens, cache_read_tokens, api_call_count
                 FROM sessions
                WHERE source != 'subagent' AND COALESCE(last_activity_at, started_at) > ?
                ORDER BY COALESCE(last_activity_at, started_at) DESC LIMIT ?""",
            (now - SESSIONS_WINDOW_S, MAX_TOKEN_SESSIONS),
        ).fetchall()

        def breakdown(session_id):
            return con.execute(
                """SELECT model, task, SUM(input_tokens) i, SUM(cache_read_tokens) c,
                          SUM(output_tokens) o, SUM(api_call_count) n
                     FROM session_model_usage WHERE session_id = ? GROUP BY model, task""",
                (session_id,),
            ).fetchall()

        out = []
        for s in sessions:
            parts = []
            rows = breakdown(s["id"])
            if rows:
                for r in rows:
                    parts.append({"model": r["model"], "task": r["task"] or "main",
                                  **_usage(r["i"], r["c"], r["o"], r["n"])})
            else:  # sessions predating session_model_usage
                parts.append({"model": s["model"], "task": "main",
                              **_usage(s["input_tokens"], s["cache_read_tokens"], s["output_tokens"], s["api_call_count"])})

            children = con.execute(
                "SELECT id, model, input_tokens, cache_read_tokens, output_tokens, api_call_count "
                "FROM sessions WHERE parent_session_id = ? AND source = 'subagent'", (s["id"],)
            ).fetchall()
            sub = _usage()
            for c in children:
                c_rows = breakdown(c["id"])
                vals = ([(r["i"], r["c"], r["o"], r["n"]) for r in c_rows] if c_rows else
                        [(c["input_tokens"], c["cache_read_tokens"], c["output_tokens"], c["api_call_count"])])
                for i, cr, o, n in vals:
                    sub["inputTokens"] += i or 0
                    sub["cacheReadTokens"] += cr or 0
                    sub["outputTokens"] += o or 0
                    sub["apiCalls"] += n or 0

            total = _usage()
            for u in parts + [sub]:
                for k in total:
                    total[k] += u[k]
            out.append({
                "id": s["id"],
                "title": s["title"],
                "source": s["source"],
                "model": s["model"],
                "startedAt": _ms(s["started_at"]),
                "endedAt": _ms(s["ended_at"]),
                "lastActivityAt": _ms(s["last_activity_at"] or s["started_at"]),
                "working": s["id"] in leased,
                "total": total,
                "byModel": sorted(parts, key=lambda u: -(u["inputTokens"] + u["cacheReadTokens"] + u["outputTokens"])),
                "subagents": {"count": len(children), **sub},
            })
    finally:
        con.close()
    return out


def write_atomic(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".subagents-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(data, f, ensure_ascii=False)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def tick(args):
    subagents = query(args.db)
    now_ms = int(time.time() * 1000)
    write_atomic(args.out, {
        "schema": 1,
        "host": "mac-studio",
        "generatedAt": now_ms,
        "windowS": WINDOW_S,
        "running": sum(1 for s in subagents if s["status"] == "running"),
        "main": query_main(args.db),
        "sessions": query_sessions(args.db),
        "subagents": subagents,
    })


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=DEFAULT_DB)
    ap.add_argument("--out", default=DEFAULT_OUT)
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--once", action="store_true")
    g.add_argument("--loop", type=float, metavar="SECONDS")
    args = ap.parse_args()

    if not args.loop:
        tick(args)
        return 0
    while True:
        # Guard every iteration: this Mac does not service launchd KeepAlive
        # respawns, so the loop itself must never exit.
        try:
            tick(args)
        except Exception:
            traceback.print_exc(file=sys.stderr)
        time.sleep(args.loop)


if __name__ == "__main__":
    sys.exit(main())
