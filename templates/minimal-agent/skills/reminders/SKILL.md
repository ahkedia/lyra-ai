---
name: reminders
description: Create, list, and manage reminders with due dates and priorities.
---

# Reminders

Manage personal reminders. Store in your preferred backend (Notion, local file, etc).

## Operations

### Create Reminder
User says: "Remind me to [task] by [date]"
Action: Create entry with task, due date, status=pending

### List Reminders
User says: "What are my reminders?" / "Show my tasks"
Action: Query all pending reminders, sorted by due date

### Complete Reminder
User says: "Mark [task] as done"
Action: Update status to completed

## Response Format
- Created: "Done. Reminder set: [task] by [date]"
- Listed: Bulleted list with due dates
- Completed: "Done. Marked [task] as complete."
