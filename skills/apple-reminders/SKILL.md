---
name: apple-reminders
description: Manage reminders via Notion databases. Three databases mirror Apple Reminders lists — Akash, Shared, and Abhigna. Use the Notion API to add, query, and complete reminders.
---

# Reminders — Notion-backed Checklist

Since Lyra runs on Linux (Hetzner VPS), reminders are stored in Notion databases.
The "List" property maps to Apple Reminders list names for future sync.

## Databases

| Database | database_id | data_source_id | Who |
|---|---|---|---|
| Reminders - Akash | 32678008-9100-802f-ad9f-fb48ff5f4c1d | c80025d7-782d-4159-a10d-74bd9aa622ef | Akash only |
| Reminders - Shared | 2054e39c-3f09-431d-8821-0e6a7513913a | 9f206d71-7b25-408b-ad20-02daf0b43da0 | Both |
| Reminders - Abhigna | 5d6732b1-7e30-4856-b56b-edbf9c3df229 | 1e74f66d-cb24-40f5-8697-84a3ad8ad1bc | Abhigna only |

## Schema (all 3 databases)

| Property | Type | Options |
|---|---|---|
| Task | title | — |
| Due | date | — |
| Priority | select | High, Medium, Low |
| Done | checkbox | true/false |
| List | select | Varies per DB (maps to Apple Reminders lists) |
| Recurrence | select | Once, Daily, Weekly, Monthly |
| Assigned By | select | Akash, Abhigna, Lyra |
| Notes | rich_text | — |
| For | select | Akash, Abhigna, Both (Shared DB only) |

## List Options by Database

- **Akash**: Personal, Work, Health, Finance, Travel, Relocation
- **Shared**: Groceries, Household, Bills, Travel, Shopping
- **Abhigna**: Personal, Health, Shopping, Appointments

## Add a Reminder

```bash
curl -X POST https://api.notion.com/v1/pages \
  -H "Authorization: Bearer $NOTION_API_KEY" \
  -H "Notion-Version: 2022-06-28" \
  -H "Content-Type: application/json" \
  -d '{
    "parent": { "database_id": "<database_id from table above>" },
    "properties": {
      "Task": { "title": [{ "text": { "content": "Buy groceries" } }] },
      "Due": { "date": { "start": "2026-03-20" } },
      "Priority": { "select": { "name": "Medium" } },
      "Done": { "checkbox": false },
      "List": { "select": { "name": "Groceries" } },
      "Assigned By": { "select": { "name": "Akash" } }
    }
  }'
```

## Query Incomplete Reminders

```bash
curl -X POST "https://api.notion.com/v1/databases/<database_id>/query" \
  -H "Authorization: Bearer $NOTION_API_KEY" \
  -H "Notion-Version: 2022-06-28" \
  -H "Content-Type: application/json" \
  -d '{
    "filter": { "property": "Done", "checkbox": { "equals": false } },
    "sorts": [{ "property": "Due", "direction": "ascending" }]
  }'
```

## Mark a Reminder Done

```bash
curl -X PATCH "https://api.notion.com/v1/pages/<page_id>" \
  -H "Authorization: Bearer $NOTION_API_KEY" \
  -H "Notion-Version: 2022-06-28" \
  -H "Content-Type: application/json" \
  -d '{ "properties": { "Done": { "checkbox": true } } }'
```

## Decision Logic

- Household/joint tasks → **Reminders - Shared**, set "For" to both/specific person
- Abhigna asks Lyra → **Reminders - Abhigna** (or Shared if joint)
- Akash personal → **Reminders - Akash**
- Work-related → **Reminders - Akash**, List = "Work"
- Cross-user assignment → Add to appropriate DB AND send Telegram notification

## After Adding

Always confirm: "Added to [database name] ✓" with task name and due date.
