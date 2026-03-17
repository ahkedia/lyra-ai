#!/usr/bin/env python3
"""
Safe Web Fetch - Fetch and sanitize web content

This is a wrapper around web fetching that sanitizes content
before it's processed by the agent.

Usage:
    python3 safe_fetch.py "https://example.com"
"""

import sys
import urllib.request
import urllib.parse

# Import the sanitizer
sys.path.insert(0, '/root/.openclaw/workspace/scripts')
from sanitize import sanitize_html, html_to_text

def fetch_url(url: str) -> str:
    """Fetch URL and return sanitized content"""
    
    try:
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        })
        with urllib.request.urlopen(req, timeout=30) as response:
            html = response.read().decode('utf-8', errors='ignore')
            
            # Sanitize the HTML
            sanitized = sanitize_html(html)
            
            # Convert to plain text
            text = html_to_text(sanitized)
            
            return text
            
    except Exception as e:
        return f"Error fetching {url}: {e}"

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 safe_fetch.py <url>")
        sys.exit(1)
    
    url = sys.argv[1]
    content = fetch_url(url)
    print(content)
