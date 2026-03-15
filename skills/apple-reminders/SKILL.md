---
name: apple-reminders
description: Manage Apple Reminders via osascript. Use to add, list, and complete reminders on macOS. Works for personal lists and the shared "Shared - Akash & Abhigna" list.
---

# Apple Reminders via osascript

Use `osascript` for all Reminders operations. Do NOT use `remindctl` — it has permission issues when running as a background process.

## Available Reminder Lists

- **To Dos - Personal** — Akash's personal reminders
- **To Do - Work** — Work-related tasks
- **Shared - Akash & Abhigna** — Joint list visible to both Akash and Abhigna

## Add a reminder (no due date)

```bash
osascript << 'EOF'
tell application "Reminders"
  tell list "To Dos - Personal"
    make new reminder with properties {name: "TASK_NAME_HERE"}
  end tell
end tell
EOF
```

## Add a reminder to the shared list

```bash
osascript << 'EOF'
tell application "Reminders"
  tell list "Shared - Akash & Abhigna"
    make new reminder with properties {name: "TASK_NAME_HERE"}
  end tell
end tell
EOF
```

## Add a reminder with a due date

```bash
osascript << 'ASCRIPT'
tell application "Reminders"
  tell list "LIST_NAME_HERE"
    set dueDate to current date
    set day of dueDate to DAY_NUMBER
    set month of dueDate to MONTH_NUMBER
    set year of dueDate to YEAR_NUMBER
    set hours of dueDate to HOUR_NUMBER
    set minutes of dueDate to MINUTE_NUMBER
    set seconds of dueDate to 0
    make new reminder with properties {name: "TASK_NAME_HERE", due date: dueDate}
  end tell
end tell
ASCRIPT
```

## List all reminders in a list

```bash
osascript << 'EOF'
tell application "Reminders"
  tell list "Shared - Akash & Abhigna"
    get name of every reminder whose completed is false
  end tell
end tell
EOF
```

## List all reminders across all lists

```bash
osascript << 'EOF'
tell application "Reminders"
  set output to ""
  repeat with l in lists
    set incomplete to (reminders in l whose completed is false)
    if (count of incomplete) > 0 then
      set output to output & name of l & ":" & return
      repeat with r in incomplete
        set output to output & "  - " & name of r & return
      end repeat
    end if
  end repeat
  return output
end tell
EOF
```

## Mark a reminder complete

```bash
osascript << 'EOF'
tell application "Reminders"
  tell list "LIST_NAME_HERE"
    set completed of reminder "TASK_NAME_HERE" to true
  end tell
end tell
EOF
```

## Decision Logic

- If the task involves both Akash and Abhigna, or is about the household → use **Shared - Akash & Abhigna**
- If Abhigna asks Lyra to add a task for Akash → use **Shared - Akash & Abhigna**
- If Akash asks for a personal reminder → use **To Dos - Personal**
- If it's work-related → use **To Do - Work**

## Notes

- Always confirm after adding: "Added to [list name] ✓"
- For tasks with a specific time, always set the due date
- The Shared list syncs to Abhigna's iPhone automatically via iCloud
