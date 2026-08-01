---
name: notion-reminders
description: Create reminders in Notion database for Akash or Abhigna. Routes to the correct per-person or shared Reminders DB.
---

# Notion Reminders — Cloud-Hosted Reminder System

Use Notion as the reminders backend. Route to the correct database based on who the reminder is for.

## Database IDs

| DB | database_id | For |
|---|---|---|
| Reminders - Akash | `32678008-9100-802f-ad9f-fb48ff5f4c1d` | Akash personal tasks |
| Reminders - Shared | `2054e39c-3f09-431d-8821-0e6a7513913a` | Joint household tasks (both see this) |
| Reminders - Abhigna | `5d6732b1-7e30-4856-b56b-edbf9c3df229` | Abhigna personal tasks |

## Routing Logic

| Scenario | Target DB |
|---|---|
| Akash personal reminder | Reminders - Akash |
| Abhigna personal reminder | Reminders - Abhigna |
| Joint / household / grocery / bills | Reminders - Shared |
| Abhigna asks to remind Akash | Reminders - Akash + notify Akash via Telegram |
| Akash asks to remind Abhigna | Reminders - Abhigna + notify Abhigna via Telegram |

## Add a Reminder

**Step 1**: Determine target DB from routing logic above.

**Step 2**: Write to Notion using the correct database_id.

Properties for **Reminders - Akash** and **Reminders - Abhigna**:
- `Task` (title): task description
- `Due` (date): ISO date or datetime
- `Priority` (select): High | Medium | Low
- `Done` (checkbox): false
- `List` (select): Personal / Work / Health / Finance / Travel / Relocation (Akash); Personal / Health / Shopping / Appointments (Abhigna)
- `Assigned By` (select): Akash | Abhigna | Lyra
- `Notes` (rich_text): optional detail

Properties for **Reminders - Shared**:
- `Task` (title): task description
- `Due` (date): ISO date or datetime
- `Priority` (select): High | Medium | Low
- `Done` (checkbox): false
- `List` (select): Groceries | Household | Bills | Travel | Shopping
- `For` (select): Akash | Abhigna | Both
- `Assigned By` (select): Akash | Abhigna | Lyra
- `Notes` (rich_text): optional detail

**Step 3**: Cross-notify if task is for the other person:
```
openclaw message send --channel telegram --target [RECIPIENT_ID] --message "[SENDER] asked me to tell you: [TASK] by [DATE]"
```
Akash Telegram ID: 7057922182 | Abhigna Telegram ID: 5003298152

**Step 4**: Confirm: "Added reminder: [Task] by [Date] ✓"

## List Reminders

For Akash (incomplete):
```bash
curl -s "https://api.notion.com/v1/databases/32678008-9100-802f-ad9f-fb48ff5f4c1d/query" \
  -H "Authorization: Bearer $NOTION_API_KEY" \
  -H "Notion-Version: 2022-06-28" \
  -d '{"filter": {"property": "Done", "checkbox": {"equals": false}}}'
```

For Abhigna (incomplete):
```bash
curl -s "https://api.notion.com/v1/databases/5d6732b1-7e30-4856-b56b-edbf9c3df229/query" \
  -H "Authorization: Bearer $NOTION_API_KEY" \
  -H "Notion-Version: 2022-06-28" \
  -d '{"filter": {"property": "Done", "checkbox": {"equals": false}}}'
```

For shared (incomplete):
```bash
curl -s "https://api.notion.com/v1/databases/2054e39c-3f09-431d-8821-0e6a7513913a/query" \
  -H "Authorization: Bearer $NOTION_API_KEY" \
  -H "Notion-Version: 2022-06-28" \
  -d '{"filter": {"property": "Done", "checkbox": {"equals": false}}}'
```
