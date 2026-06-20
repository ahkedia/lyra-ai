#!/bin/bash
# Wrapper: Query yesterday's health data from Notion for morning digest
# Outputs JSON with nutrition, workouts, and metrics from yesterday

if [ -z "$NOTION_API_KEY" ]; then
  source /root/.openclaw/.env 2>/dev/null
fi

if [ -z "$NOTION_API_KEY" ]; then
  echo '{"error": "NOTION_API_KEY not set"}' >&2
  exit 1
fi

YESTERDAY=$(date -d "yesterday" +%Y-%m-%d 2>/dev/null || date -v-1d +%Y-%m-%d)

# Notion DB IDs (from references/notion.md — Health Coach DBs)
FOOD_DB="7072c178-d7f1-42f9-8d76-0acea82a93d2"
WORKOUT_DB="e72572d2-f201-4cb1-9460-5b636ba07ad6"
METRICS_DB="53f53768-6e94-493a-9508-42cc41973ba5"

# Query food log
FOOD=$(curl -s "https://api.notion.com/v1/databases/${FOOD_DB}/query" \
  -H "Authorization: Bearer $NOTION_API_KEY" \
  -H "Notion-Version: 2022-06-28" \
  -H "Content-Type: application/json" \
  -d "{\"filter\":{\"property\":\"Date\",\"date\":{\"equals\":\"${YESTERDAY}\"}},\"page_size\":20}")

# Query workout log
WORKOUT=$(curl -s "https://api.notion.com/v1/databases/${WORKOUT_DB}/query" \
  -H "Authorization: Bearer $NOTION_API_KEY" \
  -H "Notion-Version: 2022-06-28" \
  -H "Content-Type: application/json" \
  -d "{\"filter\":{\"property\":\"Date\",\"date\":{\"equals\":\"${YESTERDAY}\"}},\"page_size\":10}")

# Query daily metrics
METRICS=$(curl -s "https://api.notion.com/v1/databases/${METRICS_DB}/query" \
  -H "Authorization: Bearer $NOTION_API_KEY" \
  -H "Notion-Version: 2022-06-28" \
  -H "Content-Type: application/json" \
  -d "{\"filter\":{\"property\":\"Date\",\"date\":{\"equals\":\"${YESTERDAY}\"}},\"page_size\":5}")

# Parse and output structured JSON
python3 - "$YESTERDAY" "$FOOD" "$WORKOUT" "$METRICS" << 'PYEOF'
import sys, json

yesterday = sys.argv[1]

def safe_parse(raw):
    try:
        return json.loads(raw)
    except:
        return {"results": []}

food_data = safe_parse(sys.argv[2])
workout_data = safe_parse(sys.argv[3])
metrics_data = safe_parse(sys.argv[4])

summary = {
    "date": yesterday,
    "meal_count": len(food_data.get("results", [])),
    "workout_count": len(workout_data.get("results", [])),
    "workouts": [],
    "meals": [],
}

# Parse meals
for r in food_data.get("results", []):
    props = r.get("properties", {})
    title_arr = props.get("Name", {}).get("title", [])
    name = title_arr[0]["text"]["content"] if title_arr else "unknown"
    meal_type = props.get("Meal Type", {}).get("select", {}).get("name", "")
    summary["meals"].append({"name": name, "type": meal_type})

# Parse workouts
for r in workout_data.get("results", []):
    props = r.get("properties", {})
    wtype = props.get("Type", {}).get("select", {}).get("name", "unknown")
    dur = props.get("Duration (min)", {}).get("number", 0)
    summary["workouts"].append({"type": wtype, "duration_min": dur})

# Parse metrics (Daily Log properties: "Weight kg", "Sleep Hours", "Steps", "Energy Level")
for r in metrics_data.get("results", []):
    props = r.get("properties", {})
    if "Weight kg" in props and props["Weight kg"].get("number"):
        summary["weight_kg"] = props["Weight kg"]["number"]
    if "Sleep Hours" in props and props["Sleep Hours"].get("number"):
        summary["sleep_hours"] = props["Sleep Hours"]["number"]
    if "Steps" in props and props["Steps"].get("number"):
        summary["steps"] = props["Steps"]["number"]
    if "Energy Level" in props and props["Energy Level"].get("select"):
        summary["energy"] = props["Energy Level"]["select"]["name"]

print(json.dumps(summary, indent=2))
PYEOF
