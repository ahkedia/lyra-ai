---
name: apple-calendar
description: Add, list, and check events in Apple Calendar (Calendar.app) via osascript. Syncs to Google Calendar automatically. Use for scheduling meetings, blocking time, joint events with Abhigna.
---

# Apple Calendar via osascript

Calendar.app is synced to Google Calendar. Writing here writes to Google Calendar automatically.

## Available calendars
- **Work** → Akash's work meetings and blocks
- **Home** → Personal events
- **Akash & Abhigna** → Shared calendar, visible on both phones. Use for joint trips, date nights, shared appointments.
- **ahkedia@gmail.com** → Google Calendar default

## Routing rules
- Joint event (both Akash and Abhigna) → **Akash & Abhigna**
- Akash work → **Work**
- Akash personal → **Home**

## Add an event (with date/time)

```bash
osascript << 'EOF'
tell application "Calendar"
  tell calendar "CALENDAR_NAME_HERE"
    set startDate to current date
    set year of startDate to YEAR
    set month of startDate to MONTH
    set day of startDate to DAY
    set hours of startDate to START_HOUR
    set minutes of startDate to START_MIN
    set seconds of startDate to 0
    set endDate to startDate + (DURATION_MINUTES * minutes)
    make new event with properties {summary:"EVENT_TITLE_HERE", start date:startDate, end date:endDate}
  end tell
end tell
EOF
```

## Add an all-day event

```bash
osascript << 'EOF'
tell application "Calendar"
  tell calendar "Akash & Abhigna"
    set eventDate to current date
    set year of eventDate to YEAR
    set month of eventDate to MONTH
    set day of eventDate to DAY
    set hours of eventDate to 0
    set minutes of eventDate to 0
    set seconds of eventDate to 0
    make new event with properties {summary:"EVENT_TITLE_HERE", start date:eventDate, end date:eventDate, allday event:true}
  end tell
end tell
EOF
```

## List events for next 7 days

```bash
osascript << 'ASCRIPT'
tell application "Calendar"
  set startRange to current date
  set endRange to current date + (7 * days)
  set output to ""
  repeat with cal in {calendar "Work", calendar "Home", calendar "Akash & Abhigna"}
    set evts to (every event of cal whose start date ≥ startRange and start date ≤ endRange)
    repeat with e in evts
      set output to output & (summary of e) & " | " & (start date of e as string) & " [" & (name of cal) & "]" & return
    end repeat
  end repeat
  return output
end tell
ASCRIPT
```

## Add event with location

```bash
osascript << 'EOF'
tell application "Calendar"
  tell calendar "CALENDAR_NAME_HERE"
    -- (set up startDate and endDate as above)
    make new event with properties {summary:"EVENT_TITLE", start date:startDate, end date:endDate, location:"LOCATION_HERE"}
  end tell
end tell
EOF
```

## After adding an event, confirm with:
`"Added to [calendar name]: [title] on [date] at [time] ✓"`

## Notes
- Month in AppleScript uses integers: January=1, February=2... December=12
- Always ask: which calendar? If unsure and involves Abhigna → Akash & Abhigna
- Calendar.app syncs to Google Calendar within ~30 seconds
