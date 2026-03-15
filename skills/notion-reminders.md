---
name: notion-reminders
description: Create reminders in Notion database (cloud-friendly replacement for Apple Reminders). Use when Akash or Abhigna asks to add a reminder or task.
---

# Notion Reminders — Cloud-Hosted Reminder System

Use Notion as the reminders backend. All reminders sync to the "Health & Meds" database (shared with Abhigna).

## Add a Reminder

When someone requests: "Remind me to X by Y"

**Step 1**: Parse the request
- Task: X
- Due date/time: Y
- Priority (optional): normal/high/urgent
- Who: Akash or Abhigna

**Step 2**: Write to Notion Health & Meds database
- Database ID: 3d61b7c2edfe4525
- Properties:
  - Name: [Task description]
  - Type: "Reminder"
  - Due: [Date]
  - Assignee: "Akash" or "Abhigna"
  - Priority: "Normal" or "High"

**Step 3**: Send cross-user notification
If task is for someone else:
```
openclaw message send --channel telegram --target [RECIPIENT_ID] --message "[SENDER] asked me to tell you: [TASK] by [DATE]"
```

**Step 4**: Confirm
"Added reminder: [Task] by [Date] ✓"

## Database IDs for Reminders
- **Health & Meds** (shared): `3d61b7c2edfe4525`
- **Upcoming Trips**: `64215718b5944945`
- **Meal Planning**: `bac662c07cf0496a`

## Routing Logic
- If Abhigna asks to remind Akash → Write to Health & Meds + notify Akash
- If Akash asks personal reminder → Write to Health & Meds
- If related to trips → Write to Upcoming Trips
- If related to meals → Write to Meal Planning

## List Reminders
Query Notion for incomplete reminders:
```bash
curl -s "https://api.notion.com/v1/databases/3d61b7c2edfe4525/query" \
  -H "Authorization: Bearer $NOTION_API_KEY" \
  -H "Notion-Version: 2024-09-03" \
  -d '{"filter": {"property": "Status", "select": {"equals": "Incomplete"}}}'
```

