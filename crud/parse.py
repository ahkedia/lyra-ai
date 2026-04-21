"""
Lightweight NL parsing — no LLM.
Extracts structured data from natural language CRUD requests.

Used by cli.py to parse Telegram messages before dispatching to notion.py.
"""

import re
from typing import Optional

# Strip trailing instructions so "What are my reminders? Just list them briefly." still matches.
_TRAILING_FLUFF = re.compile(
    r"(?i)[\s?.!]*(?:just\s+)?(?:please\s+)?(?:list|show|tell me)\s+(?:them\s+)?"
    r"(?:briefly|quickly|shortly|concisely)\s*[\s?.!]*$",
)


def normalize_crud_message(message: str) -> str:
    """Trim and drop common trailing meta-instructions (keeps core CRUD phrase)."""
    s = message.strip()
    s = _TRAILING_FLUFF.sub("", s).strip()
    return s


# --- Intent detection ---

CRUD_PATTERNS = [
    # List reminders / tasks
    {
        "name": "list_reminders",
        "patterns": [
            # Allow "current", extra words after core phrase (no $ anchor)
            r"^(list|show|what(?:'s| is| are)(?: in| on)?)\s+(?:my|the)\s+(?:current\s+)?(?:reminders?|tasks?)\b",
            r"^(?:show|list)(?:\s+me)?(?:\s+my)?\s+(?:current\s+)?(?:reminders?|tasks?)\b",
            r"^(?:list|show)\s+(?:my|the)\s+(?:current\s+)?(?:reminders?|tasks?)\b",
            # Telegram slash command (setMyCommands menu)
            r"^/reminders(?:@\w+)?\s*$",
        ],
        "action": "notion list-reminders",
    },
    # List meal plan
    {
        "name": "list_meals",
        "patterns": [
            r"^(?:what'?s?|show|list)(?: in| on)?(?: my)?(?: the)? meal (?:plan|planning)$",
            r"^(?:show|list) (?:me )?(?:my )?meals?$",
        ],
        "action": "notion list-db meals",
    },
    # List trips
    {
        "name": "list_trips",
        "patterns": [
            r"^(?:what'?s?|show|list)(?: my)?(?: upcoming)? trips?$",
            r"^(?:show|list) (?:me )?(?:my )?(?:upcoming )?trips?$",
        ],
        "action": "notion list-db trips",
    },
    # Add reminder
    {
        "name": "add_reminder",
        "patterns": [
            r"^remind me (?:to |about )?(.+?)(?: (?:on|by|at|tomorrow|today|next|this) .+)?$",
            r"^set (?:a )?reminder (?:to |for |about )?(.+)$",
            # Common natural phrasing that previously missed Tier 0 → LLM hallucinated writes
            r"^add (?:a )?reminder(?:\s*:\s*|\s+to\s+|\s+for\s+|\s+about\s+|\s+)(.+)$",
            r"^create (?:a )?reminder(?:\s*:\s*|\s+to\s+|\s+for\s+|\s+about\s+|\s+)(.+)$",
        ],
        "action": "notion add-reminder",
    },
    # Add item to DB
    {
        "name": "add_item",
        "patterns": [
            r"^add (.+?) to (?:(?:my |the )?(?:shopping|grocery|groceries|meal|task|todo|reminder|trip|content|idea)s? (?:list|plan|db|database)?|(?:my )?reminders?)$",
        ],
        "action": "notion add-item",
    },
    # Mark done
    {
        "name": "mark_done",
        "patterns": [
            r"^mark (.+?) (?:as )?(?:done|complete|finished)$",
            r"^(?:done|complete|finished)[:\s]+(.+)$",
        ],
        "action": "notion mark-done",
    },
]

DB_NAME_MAP = {
    "shopping": "reminders-shared",
    "grocery": "reminders-shared",
    "groceries": "reminders-shared",
    "reminder": "reminders-akash",
    "reminders": "reminders-akash",
    "task": "reminders-akash",
    "tasks": "reminders-akash",
    "todo": "reminders-akash",
    "meal": "meal-plan",
    "meals": "meal-plan",
    "trip": "trips",
    "trips": "trips",
    "content": "content-ideas",
    "idea": "content-ideas",
    "ideas": "content-ideas",
}


def detect_intent(message: str) -> Optional[dict]:
    """
    Returns a match dict if the message matches a known CRUD pattern.
    Returns None if no match (→ should go to LLM).
    """
    msg = normalize_crud_message(message).lower()

    for rule in CRUD_PATTERNS:
        for pat in rule["patterns"]:
            m = re.match(pat, msg, re.IGNORECASE)
            if m:
                return {
                    "intent": rule["name"],
                    "action": rule["action"],
                    "match": m,
                    "groups": list(m.groups()),
                    "original": message,
                }
    return None


def extract_reminder_args(message: str) -> dict:
    """
    Parses 'remind me to/about X on/by/at DATE' into text + when.
    Returns {"text": str, "when": str}
    """
    s = message.strip()
    prefix_m = re.match(
        r"(?i)^(?:"
        r"remind me (?:to |about )?"
        r"|set (?:a )?reminder (?:to |for |about )?"
        r"|add (?:a )?reminder(?:\s*:\s*|\s+to\s+|\s+for\s+|\s+about\s+|\s+)"
        r"|create (?:a )?reminder(?:\s*:\s*|\s+to\s+|\s+for\s+|\s+about\s+|\s+)"
        r")",
        s,
    )
    if prefix_m:
        s = s[prefix_m.end() :].strip()

    if not s:
        return {"text": message.strip(), "when": ""}

    m = re.match(
        r"(.+?)(?:\s+(?:on|by|at|before)\s+(.+))?$",
        s,
        re.IGNORECASE,
    )
    if not m:
        return {"text": s, "when": ""}

    text = m.group(1).strip()
    when = (m.group(2) or "").strip()

    # Strip trailing date phrases from text if they leaked through
    # e.g. "call the dentist tomorrow" → text="call the dentist", when="tomorrow"
    date_prefixes = r"(?:tomorrow|today|next\s+\w+|this\s+\w+|on\s+\w+|by\s+\w+|\d{1,2}[\/\-]\d{1,2})"
    trailing_date = re.search(r"\s+(" + date_prefixes + r".*)$", text, re.IGNORECASE)
    if trailing_date and not when:
        when = trailing_date.group(1).strip()
        text = text[: trailing_date.start()].strip()

    return {"text": text, "when": when}


def extract_add_item_args(message: str) -> dict:
    """
    Parses 'add X to Y list' into text + db.
    Returns {"text": str, "db": str}
    """
    m = re.match(
        r"add (.+?) to (?:(?:my |the )?(\w+)(?:\s+(?:list|plan|database|db))?|(?:my )?reminders?)$",
        message.strip(), re.IGNORECASE
    )
    if not m:
        return {"text": message, "db": "reminders-akash"}

    text = m.group(1).strip()
    db_word = (m.group(2) or "reminders").lower()
    db = DB_NAME_MAP.get(db_word, "reminders-akash")
    return {"text": text, "db": db}


def extract_mark_done_args(message: str) -> dict:
    """
    Parses 'mark X done' into title + db.
    Returns {"title": str, "db": str}
    """
    m = re.match(
        r"mark (.+?) (?:as )?(?:done|complete|finished)$",
        message.strip(), re.IGNORECASE
    )
    if m:
        return {"title": m.group(1).strip(), "db": "reminders-akash"}

    m = re.match(r"(?:done|complete|finished)[:\s]+(.+)$", message.strip(), re.IGNORECASE)
    if m:
        return {"title": m.group(1).strip(), "db": "reminders-akash"}

    return {"title": message, "db": "reminders-akash"}
