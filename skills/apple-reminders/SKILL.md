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
| Reminders - Akash | 95e1d0de-496f-478e-9fe4-2e2a356c7970 | c80025d7-782d-4159-a10d-74bd9aa622ef | Akash only |
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

{"object":"error","status":400,"code":"validation_error","message":"body failed validation. Fix one:\nbody.parent.page_id should be defined, instead was `undefined`.\nbody.parent.database_id should be a valid uuid, instead was `\"DATABASE_ID\"`.\nbody.parent.data_source_id should be defined, instead was `undefined`.\nbody.parent.workspace should be defined, instead was `undefined`.","request_id":"8a8eb504-f091-4c85-abc8-1619f3b506f6"}

## Query Incomplete Reminders

{"object":"error","status":400,"code":"invalid_request_url","message":"Invalid request URL.","request_id":"041607db-85df-4b40-bdb4-bae23a98c03f"}

## Mark a Reminder Done

{"object":"error","status":400,"code":"validation_error","message":"path failed validation: path.page_id should be a valid uuid, instead was `\"PAGE_ID\"`.","request_id":"25a4fd5a-102e-4ebb-b677-e0f4d943d284"}

## Decision Logic

- Household/joint tasks → **Reminders - Shared**, set "For" to both/specific person
- Abhigna asks Lyra → **Reminders - Abhigna** (or Shared if joint)
- Akash personal → **Reminders - Akash**
- Work-related → **Reminders - Akash**, List = "Work"
- Cross-user assignment → Add to appropriate DB AND send Telegram notification

## After Adding

Always confirm: "Added to [database name] ✓" with task name and due date.
