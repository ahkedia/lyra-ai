#!/usr/bin/env python3
"""DevLog Updater - Add conversational entries to Lyra Dev Log in Notion"""

import os
import sys
import json
from datetime import datetime

NOTION_API_KEY = os.environ.get("NOTION_API_KEY")
DEVLOG_PAGE_ID = "3257800891008166a2c1db67b324f25e"

TONE_INTROS = [
    "So here's the thing — ",
    "Just a quick update — ",
    "Been working on something interesting: ",
    "Here's what's new under the hood: ",
    "Just pushed a change that I think you'll like: ",
]

TONE_OUTROS = [
    "Pretty cool, right?",
    "Making progress, one step at a time.",
    "That's the gist of it.",
    "More coming soon.",
    "Keeping things moving.",
]

def generate_conversational_message(message):
    import random
    intro = random.choice(TONE_INTROS)
    outro = random.choice(TONE_OUTROS)
    message = message[0].upper() + message[1:] if message else message
    return f"{intro}{message}. {outro}"

def add_entry_to_notion(message):
    if not NOTION_API_KEY:
        print("ERROR: NOTION_API_KEY not set")
        return False
    
    conversational = generate_conversational_message(message)
    
    blocks = {
        "children": [
            {
                "object": "block",
                "type": "paragraph",
                "paragraph": {"rich_text": [{"text": {"content": conversational}}]}
            }
        ]
    }
    
    import urllib.request
    url = f"https://api.notion.com/v1/blocks/{DEVLOG_PAGE_ID}/children"
    data = json.dumps(blocks).encode()
    
    req = urllib.request.Request(url, data=data, headers={
        "Authorization": f"Bearer {NOTION_API_KEY}",
        "Notion-Version": "2025-09-03",
        "Content-Type": "application/json"
    }, method="PATCH")
    
    try:
        with urllib.request.urlopen(req):
            print(f"✅ Added to Dev Log: {conversational[:50]}...")
            return True
    except Exception as e:
        print(f"❌ Error: {e}")
        return False

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 updater.py --message 'Your update'")
        sys.exit(1)
    
    message = " ".join(sys.argv[1:]).replace("--message ", "").replace("-m ", "")
    add_entry_to_notion(message)
