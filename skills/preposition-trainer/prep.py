#!/usr/bin/env python3
"""Preposition Trainer engine. Deterministic selection, scheduling and Notion writes.

Subcommands:
  drill            Pick today's exercise (or re-send a stale unanswered one), create the
                   open Practice row, and print the message to send to Telegram.
  grade <answer>   Grade the currently-open exercise against <answer>, update the log and
                   the spaced-repetition schedule, and print JSON for composing the reply.
  current          Print the currently-open exercise (JSON) or "none".
  stats            Print a 7-day summary (for the weekly cron).
  backfill-prep    One-time: read Correct prep from every active row and write the new
                   Preposition select field (idempotent — skips rows already set).
"""
import json, re, subprocess, sys, urllib.request, urllib.error
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

BANK_ID    = "3ae78008-9100-813e-a7a2-f684e9470baf"
PRACTICE_ID = "3ae78008-9100-81e8-bf57-f7b07ad38685"
NV   = "2022-06-28"
TZ   = ZoneInfo("Europe/Berlin")

KEY = subprocess.check_output(
    "grep -m1 NOTION_API_KEY /root/.openclaw/.env | cut -d= -f2- | "
    "tr -d '\"' | tr -d \"'\" | tr -d ' '", shell=True).decode().strip()

# ── Notion helpers ──────────────────────────────────────────────────────────────

def api(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req  = urllib.request.Request(
        f"https://api.notion.com/v1{path}", data=data, method=method,
        headers={"Authorization": f"Bearer {KEY}", "Notion-Version": NV,
                 "Content-Type": "application/json"})
    with urllib.request.urlopen(req) as r:
        return json.load(r)

def today():
    return datetime.now(TZ).date()

def rt(prop):
    """Extract plain text from a rich_text or title property."""
    return "".join(t.get("plain_text", "") for t in prop.get("rich_text", []))

def title(prop):
    return "".join(t.get("plain_text", "") for t in prop.get("title", []))

def blank_sentence(example, prep):
    """Replace the first standalone occurrence of `prep` in `example` with ___. """
    new, n = re.subn(r"\b" + re.escape(prep) + r"\b", "___", example,
                     count=1, flags=re.I)
    if n:
        return new
    return f"Fill the blank: ___ ({example})"

# ── Drill selection ─────────────────────────────────────────────────────────────

def find_open():
    r = api("POST", f"/databases/{PRACTICE_ID}/query", {
        "filter":   {"property": "Result", "select": {"equals": "open"}},
        "sorts":    [{"property": "Date", "direction": "descending"}],
        "page_size": 1})
    res = r.get("results", [])
    return res[0] if res else None

def drill():
    open_row = find_open()
    if open_row:
        p       = open_row["properties"]
        d       = (p.get("Date", {}).get("date") or {}).get("start", "")
        sentence = title(p["Sentence"])
        if d and d < today().isoformat():
            print(f"⏳ Yesterday's drill is still open — finish this one first:\n\n"
                  f"📝 {sentence}\n\nReply with just the missing word.")
        else:
            print(f"📝 Preposition drill — fill the blank:\n\n{sentence}\n\n"
                  f"Reply with just the missing word.")
        return

    # Selection order:
    #  1. Hardest (difficulty 3) first — traps and contrasts come first
    #  2. Within same difficulty, group by Preposition so related items cluster
    #  3. Within same preposition, earliest-due first (spaced repetition)
    q = api("POST", f"/databases/{BANK_ID}/query", {
        "filter":   {"property": "Active", "checkbox": {"equals": True}},
        "sorts":    [
            {"property": "Difficulty",   "direction": "descending"},
            {"property": "Preposition",  "direction": "ascending"},
            {"property": "Next review",   "direction": "ascending"},
        ],
        "page_size": 1})

    picks = q.get("results", [])
    if not picks:
        print("🎉 No active preposition items left — you've graduated the whole bank!")
        return

    item = picks[0]; ip = item["properties"]
    coll = title(ip["Collocation"])
    prep = rt(ip["Correct prep"])
    ex   = rt(ip["Example"])
    sentence = blank_sentence(ex, prep)

    api("POST", "/pages", {"parent": {"database_id": PRACTICE_ID}, "properties": {
        "Sentence":        {"title":       [{"text": {"content": sentence}}]},
        "Date":            {"date":        {"start": today().isoformat()}},
        "Collocation":     {"rich_text":  [{"text": {"content": coll}}]},
        "Correct answer":  {"rich_text":  [{"text": {"content": prep}}]},
        "Result":          {"select":      {"name": "open"}}}})

    print(f"📝 Preposition drill — fill the blank:\n\n{sentence}\n\n"
          f"Reply with just the missing word.")

# ── Spaced repetition ─────────────────────────────────────────────────────────

def next_interval(i):
    for step in (1, 3, 7, 21):
        if i < step:
            return step
    return None  # graduate

# ── Grading ────────────────────────────────────────────────────────────────────

def grade(answer):
    open_row = find_open()
    if not open_row:
        print(json.dumps({"error": "no open exercise"})); return

    p       = open_row["properties"]
    correct = rt(p["Correct answer"]).strip()
    coll    = rt(p["Collocation"]).strip()
    norm    = re.sub(r"[^a-z]", "", answer.lower())
    is_correct = norm == re.sub(r"[^a-z]", "", correct.lower())
    result  = "correct" if is_correct else "wrong"

    api("PATCH", f"/pages/{open_row['id']}", {"properties": {
        "Your answer": {"rich_text": [{"text": {"content": answer[:200]}}]},
        "Result":      {"select": {"name": result}}}})

    # Update bank spaced-repetition state
    bq = api("POST", f"/databases/{BANK_ID}/query", {
        "filter":   {"property": "Collocation", "title": {"equals": coll}},
        "page_size": 1})

    rule = ex = ""
    if bq.get("results"):
        item = bq["results"][0]; ip = item["properties"]
        rule = rt(ip["Rule"]); ex = rt(ip["Example"])
        interval = ip.get("Interval", {}).get("number") or 0
        tr       = ip.get("Times right", {}).get("number") or 0
        tw       = ip.get("Times wrong", {}).get("number") or 0
        props    = {}

        if is_correct:
            ni = next_interval(interval)
            props["Times right"] = {"number": tr + 1}
            if ni is None:
                props["Active"] = {"checkbox": False}
            else:
                props["Interval"]     = {"number": ni}
                props["Next review"]  = {"date": {"start": (today() + timedelta(days=ni)).isoformat()}}
        else:
            props["Times wrong"]  = {"number": tw + 1}
            props["Interval"]     = {"number": 1}
            props["Next review"]   = {"date": {"start": (today() + timedelta(days=1)).isoformat()}}

        api("PATCH", f"/pages/{item['id']}", {"properties": props})

    print(json.dumps({
        "result":        result,
        "collocation":   coll,
        "correct_answer": correct,
        "your_answer":   answer,
        "rule":          rule,
        "example":       ex
    }))

# ── Current exercise ───────────────────────────────────────────────────────────

def current():
    o = find_open()
    if not o:
        print("none"); return
    p = o["properties"]
    print(json.dumps({
        "sentence":       title(p["Sentence"]),
        "collocation":    rt(p["Collocation"]),
        "correct_answer": rt(p["Correct answer"]),
        "date":           (p.get("Date", {}).get("date") or {}).get("start", "")
    }))

# ── Add collocation (organic capture) ─────────────────────────────────────────

def add(coll, prep, rule, example, category="verb+prep", difficulty="2"):
    """Add a collocation to the bank (used for organic capture of real slips)."""
    q = api("POST", f"/databases/{BANK_ID}/query", {
        "filter":   {"property": "Collocation", "title": {"equals": coll}},
        "page_size": 1})
    if q.get("results"):
        print(json.dumps({"status": "exists", "collocation": coll})); return

    api("POST", "/pages", {"parent": {"database_id": BANK_ID}, "properties": {
        "Collocation":   {"title":       [{"text": {"content": coll}}]},
        "Correct prep":  {"rich_text":  [{"text": {"content": prep}}]},
        "Category":      {"select":     {"name": category}},
        "Difficulty":    {"select":     {"name": difficulty}},
        "Rule":          {"rich_text":  [{"text": {"content": rule}}]},
        "Example":       {"rich_text":  [{"text": {"content": example}}]},
        "Preposition":   {"select":     {"name": prep.lower()}},
        "Source":        {"select":     {"name": "chat-slip"}},
        "Active":        {"checkbox":   True},
        "Interval":      {"number":     0},
        "Next review":   {"date":       {"start": today().isoformat()}},
        "Times right":   {"number":     0},
        "Times wrong":   {"number":     0}}})
    print(json.dumps({"status": "added", "collocation": coll}))

# ── Stats ─────────────────────────────────────────────────────────────────────

def stats():
    since = (today() - timedelta(days=7)).isoformat()
    r = api("POST", f"/databases/{PRACTICE_ID}/query", {
        "filter":   {"and": [
            {"property": "Date", "date": {"on_or_after": since}},
            {"or": [
                {"property": "Result", "select": {"equals": "correct"}},
                {"property": "Result", "select": {"equals": "wrong"}}]}]},
        "sorts":    [{"property": "Date", "direction": "ascending"}],
        "page_size": 50})
    rows  = r.get("results", [])
    right = sum(1 for x in rows
                if x["properties"]["Result"]["select"]["name"] == "correct")
    wrong = [rt(x["properties"]["Collocation"]) for x in rows
             if x["properties"]["Result"]["select"]["name"] == "wrong"]
    print(json.dumps({"total": len(rows), "correct": right, "wrong_count": len(wrong),
                       "missed_collocations": wrong}))

# ── Weekly recap ───────────────────────────────────────────────────────────────

def weekly():
    since = (today() - timedelta(days=7)).isoformat()
    r = api("POST", f"/databases/{PRACTICE_ID}/query", {
        "filter":   {"and": [
            {"property": "Date", "date": {"on_or_after": since}},
            {"or": [
                {"property": "Result", "select": {"equals": "correct"}},
                {"property": "Result", "select": {"equals": "wrong"}}]}]},
        "sorts":    [{"property": "Date", "direction": "ascending"}],
        "page_size": 100})
    rows  = r.get("results", [])
    total = len(rows)
    right = sum(1 for x in rows
                if x["properties"]["Result"]["select"]["name"] == "correct")
    missed = [(rt(x["properties"]["Collocation"]),
               rt(x["properties"]["Correct answer"]))
              for x in rows
              if x["properties"]["Result"]["select"]["name"] == "wrong"]
    graduated = api("POST", f"/databases/{BANK_ID}/query", {
        "filter":   {"and": [
            {"property": "Active",         "checkbox": {"equals": False}},
            {"property": "Times right",    "number":   {"greater_than": 0}}]},
        "page_size": 100}).get("results", [])

    L = []
    if total == 0:
        L.append("No exercises logged this week yet — reply to your daily drill "
                 "on Telegram to get the streak going. 🧩")
    else:
        pct = round(right / total * 100)
        L.append(f"This week you did {total} exercise{'s' if total != 1 else ''} "
                 f"and got {right} right ({pct}%).")
        L.append("")
        if missed:
            L.append("Still worth nailing (these come back on your review schedule):")
            seen = {}
            for coll, prep in missed:
                if coll not in seen:
                    seen[coll] = prep
            for coll, prep in seen.items():
                L.append(f"  • {coll}  →  correct: \"{prep}\"")
        else:
            L.append("Clean sweep — no misses this week. 🎯")
    L.append("")
    L.append(f"Mastered so far: {len(graduated)} collocation"
             f"{'s' if len(graduated) != 1 else ''} graduated out of the bank.")
    L.append("")
    L.append("Keep replying to the evening drill — one a day is all it takes.")
    print("\n".join(L))

# ── Backfill Preposition field ─────────────────────────────────────────────────

def backfill_prep():
    """One-time: set Preposition on rows missing it. Idempotent — skips if already set."""
    VALID_PREPS = {"in","on","at","into","of","to","for","by","from","with","about"}
    r = api("POST", f"/databases/{BANK_ID}/query", {"page_size": 100})
    rows = r.get("results", [])
    updated = skipped = 0
    for row in rows:
        props = row["properties"]
        if props.get("Preposition", {}).get("select", {}).get("name"):
            skipped += 1
            continue
        prep = "".join(t.get("plain_text", "")
                       for t in props.get("Correct prep", {}).get("rich_text", [])
                       ).strip().lower()
        normalized = prep if prep in VALID_PREPS else "other"
        api("PATCH", f"/pages/{row['id']}", {
            "properties": {"Preposition": {"select": {"name": normalized}}}})
        updated += 1
    print(json.dumps({"updated": updated, "skipped": skipped, "total": len(rows)}))

# ── Entry point ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "drill"
    if   cmd == "drill":            drill()
    elif cmd == "grade":            grade(" ".join(sys.argv[2:]) or "")
    elif cmd == "current":          current()
    elif cmd == "add":              add(*sys.argv[2:])
    elif cmd == "stats":            stats()
    elif cmd == "weekly":           weekly()
    elif cmd == "backfill-prep":    backfill_prep()
    else: print(f"unknown command: {cmd}"); sys.exit(1)
