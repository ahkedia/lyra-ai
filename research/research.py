#!/usr/bin/env python3
"""
Research Updater - Search and save research to Notion

Usage:
    python3 research.py "real estate architecture optimization"
    python3 research.py "space optimization AI architecture"
"""

import os
import sys
import json
import urllib.request
import urllib.parse

NOTION_API_KEY = os.environ.get("NOTION_API_KEY")
RESEARCH_PAGE_ID = "3267800891008105a347f44f38861009"

def search_tavily(query, count=5):
    """Search using Tavily API"""
    api_key = os.environ.get("TAVILY_API_KEY")
    if not api_key:
        return None
    
    url = "https://api.tavily.com/search"
    data = json.dumps({"api_key": api_key, "query": query, "search_depth": "basic", "max_results": count}).encode()
    
    req = urllib.request.Request(url, data=data, headers={
        "Content-Type": "application/json"
    })
    
    try:
        with urllib.request.urlopen(req) as response:
            return json.loads(response.read())
    except Exception as e:
        print(f"Search error: {e}")
        return None

def save_to_notion(topic, results):
    """Save research results to Notion"""
    if not results:
        return False
    
    # Build blocks for each result
    children = [
        {"object": "block", "type": "heading_3", "heading_3": {"rich_text": [{"text": {"content": f"🔍 {topic}"}}]}}
    ]
    
    for r in results.get("results", [])[:5]:
        title = r.get("title", "No title")
        content = r.get("content", r.get("description", ""))[:200]
        url = r.get("url", "")
        
        children.append({
            "object": "block",
            "type": "bulleted_list_item",
            "bulleted_list_item": {"rich_text": [{"text": {"content": f"{title}: {content}..."}}]}
        })
    
    # Append to page
    url = f"https://api.notion.com/v1/blocks/{RESEARCH_PAGE_ID}/children"
    data = json.dumps({"children": children}).encode()
    
    req = urllib.request.Request(url, data=data, headers={
        "Authorization": f"Bearer {NOTION_API_KEY}",
        "Notion-Version": "2025-09-03",
        "Content-Type": "application/json"
    }, method="PATCH")
    
    try:
        with urllib.request.urlopen(req):
            return True
    except Exception as e:
        print(f"Notion error: {e}")
        return False

def main():
    if len(sys.argv) < 2:
        print("Usage: python3 research.py <topic>")
        print("Example: python3 research.py 'real estate architecture optimization'")
        sys.exit(1)
    
    topic = " ".join(sys.argv[1:])
    print(f"Researching: {topic}")
    
    results = search_tavily(topic)
    if results:
        if save_to_notion(topic, results):
            print(f"✅ Saved to Notion")
        else:
            print(f"❌ Failed to save to Notion")
    else:
        print(f"❌ Search failed")

if __name__ == "__main__":
    main()
