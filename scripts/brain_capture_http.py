#!/usr/bin/env python3
"""Helper called by brain-capture.sh — writes a page via gbrain HTTP MCP put_page."""
import json, sys, urllib.request, urllib.parse
from datetime import datetime, timezone

url, client_id, client_secret, slug, page_type = sys.argv[1:6]
content_raw = sys.argv[6] if len(sys.argv) > 6 else ""

# Get write token
form = urllib.parse.urlencode({
    "grant_type": "client_credentials",
    "client_id": client_id,
    "client_secret": client_secret,
    "scope": "write",
}).encode()
req = urllib.request.Request(f"{url}/token", form,
    {"Content-Type": "application/x-www-form-urlencoded"}, method="POST")
with urllib.request.urlopen(req, timeout=10) as r:
    token = json.loads(r.read())["access_token"]

# Build page with frontmatter
ts = datetime.now(timezone.utc).strftime("%Y-%m-%d")
page_md = f"---\ntype: {page_type}\nslug: {slug}\ncreated: {ts}\nsource: lyra-capture\n---\n\n{content_raw}"

# put_page via MCP
payload = {"jsonrpc": "2.0", "id": "cap1", "method": "tools/call",
           "params": {"name": "put_page", "arguments": {"slug": slug, "content": page_md}}}
req = urllib.request.Request(f"{url}/mcp", json.dumps(payload).encode(),
    {"Authorization": f"Bearer {token}", "Content-Type": "application/json",
     "Accept": "application/json, text/event-stream"}, method="POST")
with urllib.request.urlopen(req, timeout=15) as r:
    body = r.read().decode()

for line in body.splitlines():
    if line.startswith("data: "):
        d = json.loads(line[6:])
        print("ok" if not d.get("error") else f"error: {d['error']}")
        sys.exit(0 if not d.get("error") else 1)

print("no-response")
sys.exit(1)
