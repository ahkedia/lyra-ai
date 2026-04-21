#!/usr/bin/env python3
"""
Job Application Pipeline — Tier 0 orchestrator.

Two-phase flow:
  Phase A (trigger): detect job link/company/person → save state → return clarification questions
  Phase B (execute): parse clarification reply → fetch job context + wiki → call Sonnet → create Gmail drafts

Called by:
  cli.py cmd_parse() for both phases
  Directly (python3 job_application.py --execute <state_file>) for background pipeline execution

State file: /tmp/lyra-job-state.json (expires 30 min)
"""

import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from datetime import datetime

STATE_FILE = '/tmp/lyra-job-state.json'
PIPELINE_LOG = '/tmp/lyra-job-pipeline.log'
ENV_FILE = '/root/.openclaw/.env'

# Wiki DB IDs (Personal Wiki in Notion) — see notion/notion.md
WIKI_DS_ID = '33d78008-9100-8197-9f0f-000b205edfe8'  # data_source_id (fallback)
PERSONAL_WIKI_DB = '33d78008-9100-8183-850d-e7677ac46b63'  # database_id — primary query API
RECRUITER_DB_ID = '31778008910080c09b6fec080955cf00'  # database_id for page creation

NOTION_VERSION = '2025-09-03'

# Max wiki pages to pull bodies for (Voice Canon is always fetched first, outside this cap)
_MAX_WIKI_BODY_PAGES = 25


# ---------------------------------------------------------------------------
# Environment helpers
# ---------------------------------------------------------------------------

def _load_env():
    """Load env vars from .env file (fallback when not injected by systemd)."""
    env = {}
    try:
        with open(ENV_FILE) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    k, v = line.split('=', 1)
                    env[k.strip()] = v.strip()
    except OSError:
        pass
    return env


def _get_env(key: str) -> str:
    val = os.environ.get(key, '')
    if not val:
        env = _load_env()
        val = env.get(key, '')
    return val


# ---------------------------------------------------------------------------
# Phase A — trigger detection
# ---------------------------------------------------------------------------

_JOB_TRIGGER_RE = re.compile(
    r'(?:apply(?:ing)?\s+to\b'
    r'|job\s+(?:link|post|opening|at)\b'
    r'|cover\s+letter\s+(?:for|to)\b'
    r'|draft\s+.*?outreach\s+(?:to|for)\b'
    r'|linkedin\.com/jobs'
    r'|write\s+.*?cover\s+letter\b'
    r'|message\s+.*?(?:and|plus)\s+cover\s+letter\b'
    # Person-centric outreach / Gmail drafts — must hit Tier-0 (wiki + himalaya), not chat LLM
    r'|(?:draft|write|creating)\s+(?:an?\s+)?(?:outreach\s+)?message\s+(?:to|for)\b'
    r'|outreach\s+(?:message\s+)?(?:to|for)\b'
    r'|gmail\s+draft\b'
    r'|\bmessage\s+(?:to|for)\s+[A-Za-z]'  # e.g. "message for Rajneesh"
    r'|help\s+(?:me\s+)?(?:with\s+)?(?:a\s+)?(?:outreach\s+)?message\b'
    r')',
    re.IGNORECASE,
)

_CLARIFICATION_REPLY_RE = re.compile(
    r'^(?:[1-3]'
    r'|both'
    r'|outreach(?:\s+only)?'
    r'|cover(?:\s+letter)?(?:\s+only)?'
    r'|message(?:\s+only)?'
    r')(?:\s+.{0,120})?$',
    re.IGNORECASE,
)


def is_job_trigger(msg: str) -> bool:
    return bool(_JOB_TRIGGER_RE.search(msg))


def is_clarification_reply(msg: str) -> bool:
    return bool(_CLARIFICATION_REPLY_RE.match(msg.strip()))


def has_recent_state(max_age_min: int = 30) -> bool:
    if not os.path.exists(STATE_FILE):
        return False
    age_min = (time.time() - os.path.getmtime(STATE_FILE)) / 60
    return age_min < max_age_min


# ---------------------------------------------------------------------------
# Input extraction helpers
# ---------------------------------------------------------------------------

_URL_RE = re.compile(r'https?://[^\s]+', re.IGNORECASE)
_LINKEDIN_JOB_RE = re.compile(r'linkedin\.com/jobs/\S+', re.IGNORECASE)


def _extract_url(msg: str) -> str:
    m = _URL_RE.search(msg)
    return m.group(0).rstrip('.,)') if m else ''


def _extract_company(msg: str) -> str:
    # Patterns: "company X", "company is X", "at X", "for X", "from X"
    patterns = [
        r'company\s+(?:is\s+)?([A-Z][A-Za-z0-9\s&.]+?)(?:\s*[,\-\|:]|\s+(?:job|role|position|opening|link)|$)',
        r'(?:at|for|from)\s+([A-Z][A-Za-z0-9\s&.]+?)(?:\s*[,\-\|:]|\s+(?:job|role|position|opening|link|—)|$)',
    ]
    for pat in patterns:
        m = re.search(pat, msg)
        if m:
            candidate = m.group(1).strip().rstrip(':')
            if 2 < len(candidate) < 50:
                return candidate
    return ''


def _normalize_person(name: str) -> str:
    """Strip trailing ' at Company' fragments; keywords use IGNORECASE but names must not absorb 'at'."""
    if not name:
        return ''
    name = name.strip()
    parts = re.split(r'\s+at\s+', name, maxsplit=1, flags=re.IGNORECASE)
    return parts[0].strip()


def _extract_person(msg: str) -> str:
    """First/last names; single-token names (e.g. Rajneesh) are valid. Name tokens use (?-i:...) so 'at' is not matched."""
    # (?-i:...) turns off IGNORECASE for the capture — otherwise [A-Z] matches 'a' in 'at' and sucks in company.
    _nm = r'((?-i:[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*))'
    patterns = [
        # "draft a message for Sarah Chen", "write outreach message to Pat"
        r'(?:message|outreach|draft|write|creating)\s+(?:an?\s+)?(?:outreach\s+)?(?:a\s+)?message\s+(?:to|for)\s+'
        + _nm,
        # "message to Pat", "outreach for Jane", "outreach to Jane Doe at N26"
        r'(?:message|outreach|draft|write)\s+(?:to|for)\s+' + _nm,
        # "with a message for Rajneesh", "help me with message for X"
        r'(?:with\s+(?:a\s+)?|help\s+(?:me\s+)?(?:with\s+)?(?:a\s+)?)message\s+(?:to|for)\s+' + _nm,
        # standalone "message for Name" / "message to Name"
        r'\bmessage\s+(?:to|for)\s+' + _nm,
        # "to Name at Company" (two+ name parts before at)
        r'(?:to|for)\s+((?-i:[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+))\s+(?:at|from)\b',
    ]
    for pat in patterns:
        m = re.search(pat, msg, re.IGNORECASE)
        if m:
            return _normalize_person(m.group(1))
    return ''


def _extract_person_email(msg: str) -> str:
    m = re.search(r'[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}', msg)
    return m.group(0) if m else ''


# ---------------------------------------------------------------------------
# Phase A — handle trigger
# ---------------------------------------------------------------------------

def handle_trigger(msg: str) -> str:
    url = _extract_url(msg)
    company = _extract_company(msg)
    person = _extract_person(msg)
    person_email = _extract_person_email(msg)

    state = {
        'raw': msg,
        'url': url,
        'company': company,
        'person': person,
        'person_email': person_email,
        'ts': time.time(),
    }
    with open(STATE_FILE, 'w') as f:
        json.dump(state, f)

    detected = company or (url[:50] + '...' if len(url) > 50 else url) or 'this role'
    lines = [
        f"Got it — {detected}.",
        "",
        "Before I draft, quick check:",
        "",
        "1️⃣  What do you need?",
        "   1 · Outreach message only",
        "   2 · Cover letter only",
        "   3 · Both",
        "",
        "2️⃣  Tone? (optional — default is your usual voice: direct, specific, no fluff)",
        "   Add a hint after your number — e.g. '3 more formal' or '1 warmer'",
        "",
        "I'll pull from your wiki + domain knowledge as context.",
    ]
    return '\n'.join(lines)


# ---------------------------------------------------------------------------
# Phase B — parse clarification reply
# ---------------------------------------------------------------------------

def _parse_reply(reply: str) -> tuple[str, str]:
    """Returns (needs, tone). needs: 'outreach' | 'cover_letter' | 'both'"""
    reply = reply.strip().lower()

    # Extract tone hint (anything after the choice word/number)
    tone_m = re.search(
        r'^(?:[1-3]|both|outreach(?:\s+only)?|cover(?:\s+letter)?(?:\s+only)?|message(?:\s+only)?)'
        r'(?:\s+(.+))?$',
        reply,
        re.IGNORECASE,
    )
    tone = tone_m.group(1).strip() if (tone_m and tone_m.group(1)) else 'default'
    if tone == 'default':
        tone = 'direct, specific, no fluff — Akash\'s natural voice'

    # Determine what to generate
    if re.match(r'^1\b|outreach', reply, re.IGNORECASE):
        needs = 'outreach'
    elif re.match(r'^2\b|cover', reply, re.IGNORECASE):
        needs = 'cover_letter'
    else:  # "3" or "both"
        needs = 'both'

    return needs, tone


def handle_clarification_reply(reply: str) -> str:
    """Parse reply, launch background pipeline, return immediate response."""
    if not os.path.exists(STATE_FILE):
        return "No pending job application found. Send me the job link + company first."

    with open(STATE_FILE) as f:
        state = json.load(f)

    needs, tone = _parse_reply(reply)
    state['needs'] = needs
    state['tone'] = tone

    # Write updated state for the background process
    with open(STATE_FILE, 'w') as f:
        json.dump(state, f)

    # Launch background pipeline
    script_path = os.path.abspath(__file__)
    try:
        subprocess.Popen(
            [sys.executable, script_path, '--execute', STATE_FILE],
            stdout=subprocess.DEVNULL,
            stderr=open(PIPELINE_LOG, 'w'),
            close_fds=True,
            start_new_session=True,
        )
    except Exception as e:
        return f"Could not start pipeline: {e}"

    action_desc = {
        'outreach': 'outreach message',
        'cover_letter': 'cover letter',
        'both': 'cover letter + outreach message',
    }.get(needs, 'drafts')
    company = state.get('company') or 'the role'

    return (
        f"On it — generating {action_desc} for {company}.\n"
        f"Tone: {tone}\n\n"
        f"Check Gmail Drafts in ~30-40 seconds."
    )


# ---------------------------------------------------------------------------
# Pipeline execution (background process)
# ---------------------------------------------------------------------------

def _notion_req(method: str, path: str, body: dict = None) -> dict:
    key = _get_env('NOTION_API_KEY')
    if not key:
        raise ValueError('NOTION_API_KEY not set')
    url = f'https://api.notion.com/v1{path}'
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, headers={
        'Authorization': f'Bearer {key}',
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
    }, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        msg = e.read().decode()
        raise ValueError(f'Notion {e.code}: {msg}') from e


def _voice_canon_from_local_file() -> str:
    """Last-resort voice text when Notion is empty (repo snapshot)."""
    try:
        voice_path = os.path.join(os.path.dirname(__file__), '..', 'voice-system', 'VOICE.md')
        voice_path = os.path.normpath(voice_path)
        with open(voice_path, encoding='utf-8') as f:
            return f.read().strip()[:8000]
    except OSError:
        return ''


def _fetch_voice_canon_notion() -> str:
    """Always fetch Voice Canon page(s) explicitly (Type = Voice Canon)."""
    try:
        r = _notion_req(
            'POST',
            f'/databases/{PERSONAL_WIKI_DB}/query',
            {
                'filter': {'property': 'Type', 'select': {'equals': 'Voice Canon'}},
                'page_size': 10,
            },
        )
        pages = r.get('results', [])
    except Exception as e:
        return f'[Voice Canon Notion query failed: {e}]'

    parts = []
    for page in pages:
        pid = page.get('id', '')
        body = _fetch_page_content(pid)
        if body:
            parts.append(body)
    return '\n\n'.join(parts) if parts else ''


def _wiki_pages_via_database_query() -> list:
    """Primary path: same API as insight-engine / MEMORY.md (database query)."""
    all_results = []
    cursor = None
    for _ in range(5):
        body: dict = {'page_size': 100}
        if cursor:
            body['start_cursor'] = cursor
        r = _notion_req('POST', f'/databases/{PERSONAL_WIKI_DB}/query', body)
        batch = r.get('results', [])
        all_results.extend(batch)
        if not r.get('has_more') or not r.get('next_cursor'):
            break
        cursor = r['next_cursor']
    return all_results


def _wiki_pages_via_data_source() -> list:
    """Fallback if database query fails (legacy data_sources API)."""
    try:
        r = _notion_req('POST', f'/data_sources/{WIKI_DS_ID}/query', {'page_size': 100})
        return r.get('results', [])
    except Exception:
        return []


def _sort_wiki_pages_for_job(pages: list) -> list:
    """Career / interview / domain content first; skip Voice Canon here (handled separately)."""
    priority = {
        'Career': 0,
        'Interview Story': 1,
        'Domain Knowledge': 2,
        'Mental Model': 3,
        'Lenny Synthesis': 4,
        'Voice Canon': 99,
        'Inbox': 98,
    }

    def key(p):
        pt = (p.get('properties') or {}).get('Type', {}).get('select', {}) or {}
        name = pt.get('name') or ''
        return (priority.get(name, 5), name)

    filtered = []
    for p in pages:
        props = p.get('properties', {})
        page_type = props.get('Type', {}).get('select', {}).get('name', '')
        if page_type in ('Inbox', 'Voice Canon'):
            continue
        filtered.append(p)
    filtered.sort(key=key)
    return filtered[:_MAX_WIKI_BODY_PAGES]


def _fetch_wiki_pages() -> str:
    """Fetch Voice Canon + prioritized wiki pages. Database query first; data_sources fallback."""
    voice_notion = _fetch_voice_canon_notion()
    voice_local = _voice_canon_from_local_file()
    voice_block = ''
    if voice_notion and not voice_notion.startswith('[Voice Canon Notion query failed'):
        voice_block = voice_notion
    elif voice_local:
        voice_block = voice_local

    pages = []
    try:
        pages = _wiki_pages_via_database_query()
    except Exception as e:
        pages = _wiki_pages_via_data_source()
        if not pages:
            return (
                f'[Wiki unavailable: {e}]\n\n'
                f'=== VOICE (partial) ===\n{voice_block or "[none]"}'
            )

    if not pages:
        pages = _wiki_pages_via_data_source()

    ordered = _sort_wiki_pages_for_job(pages)

    sections = []
    if voice_block:
        sections.append('=== VOICE CANON — apply to every sentence; non-negotiable ===\n' + voice_block)

    for page in ordered:
        props = page.get('properties', {})
        title_rt = props.get('Title', {}).get('title', [])
        title = ''.join(t.get('plain_text', '') for t in title_rt).strip()
        page_type = props.get('Type', {}).get('select', {}).get('name', '')
        domain = props.get('Domain', {}).get('select', {}).get('name', '')
        page_id = page.get('id', '')
        content = _fetch_page_content(page_id)
        if content:
            label = f'### {title or "Untitled"}'
            if domain:
                label += f' [{domain}]'
            if page_type:
                label += f' ({page_type})'
            sections.append(f'{label}\n{content}')

    if not sections:
        fallback = voice_block or _voice_canon_from_local_file()
        if fallback:
            return '=== VOICE CANON ===\n' + fallback + '\n\n[No other wiki pages returned bodies]'
        return '[No wiki pages found]'

    return '\n\n'.join(sections)


def get_personal_wiki_bundle() -> str:
    """Voice Canon + prioritized Personal Wiki pages — shared by job and content pipelines."""
    return _fetch_wiki_pages()


def _fetch_page_content(page_id: str) -> str:
    """Fetch text content from a Notion page's blocks."""
    try:
        r = _notion_req('GET', f'/blocks/{page_id}/children?page_size=100')
        blocks = r.get('results', [])
    except Exception:
        return ''

    parts = []
    block_types = (
        'paragraph', 'heading_1', 'heading_2', 'heading_3',
        'bulleted_list_item', 'numbered_list_item', 'quote',
    )
    for block in blocks:
        btype = block.get('type', '')
        if btype in block_types:
            rt = block.get(btype, {}).get('rich_text', [])
            text = ''.join(t.get('plain_text', '') for t in rt).strip()
            if text:
                if btype.startswith('heading'):
                    parts.append(f'\n**{text}**')
                elif btype == 'bulleted_list_item':
                    parts.append(f'• {text}')
                else:
                    parts.append(text)

    return '\n'.join(parts[:60])  # cap at 60 lines per page


def _tavily_search(query: str, count: int = 3) -> str:
    """Search via Tavily API. Returns combined result text."""
    api_key = _get_env('TAVILY_API_KEY')
    if not api_key:
        return '[Tavily unavailable — TAVILY_API_KEY not set]'

    payload = {
        'api_key': api_key,
        'query': query,
        'max_results': count,
        'search_depth': 'basic',
    }
    req = urllib.request.Request(
        'https://api.tavily.com/search',
        data=json.dumps(payload).encode(),
        headers={'Content-Type': 'application/json'},
        method='POST',
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read())
        results = data.get('results', [])
        parts = []
        for r in results:
            title = r.get('title', '')
            content = r.get('content', '')[:500]
            url = r.get('url', '')
            parts.append(f'**{title}** ({url})\n{content}')
        return '\n\n'.join(parts) if parts else '[No results]'
    except Exception as e:
        return f'[Search failed: {e}]'


def _fetch_job_context(url: str, company: str) -> dict:
    """Fetch job description and company info. Returns {role, job_text, company_text}."""
    job_text = ''
    company_text = ''
    role = ''

    if url and 'linkedin' in url.lower():
        job_text = _tavily_search(f'site:linkedin.com {url}', count=2)
        if not job_text or '[' in job_text[:5]:
            job_text = _tavily_search(f'LinkedIn job posting {company} {url}', count=2)
    elif url:
        job_text = _tavily_search(url, count=2)

    if company:
        company_text = _tavily_search(f'{company} company product overview 2025', count=2)

    # Try to extract role from job text
    role_m = re.search(r'(?:Position|Role|Job Title|Title)[:\s]+([^\n]+)', job_text, re.IGNORECASE)
    if role_m:
        role = role_m.group(1).strip()[:80]
    elif company:
        # Guess from URL or message
        role = 'the role'

    return {'role': role, 'job_text': job_text, 'company_text': company_text}


def _load_prompt_template(section: str) -> str:
    """Load a named section from prompts/job-application.md."""
    prompts_path = os.path.join(os.path.dirname(__file__), '..', 'prompts', 'job-application.md')
    prompts_path = os.path.normpath(prompts_path)
    try:
        with open(prompts_path) as f:
            content = f.read()
    except OSError:
        return ''

    # Find section between "## {section}" and next "## " or end
    pattern = rf'## {re.escape(section)}\n---\n(.*?)(?=\n---\n## |\Z)'
    m = re.search(pattern, content, re.DOTALL)
    return m.group(1).strip() if m else ''


def _call_anthropic(system: str, user: str, max_tokens: int = 1500) -> str:
    api_key = _get_env('ANTHROPIC_API_KEY')
    if not api_key:
        raise ValueError('ANTHROPIC_API_KEY not set')

    payload = {
        'model': 'claude-sonnet-4-6',
        'max_tokens': max_tokens,
        'system': system,
        'messages': [{'role': 'user', 'content': user}],
    }
    req = urllib.request.Request(
        'https://api.anthropic.com/v1/messages',
        data=json.dumps(payload).encode(),
        headers={
            'x-api-key': api_key,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
        },
        method='POST',
    )
    with urllib.request.urlopen(req, timeout=90) as resp:
        data = json.loads(resp.read())
    return data['content'][0]['text'].strip()


def _create_gmail_draft(to_addr: str, subject: str, body: str) -> bool:
    """Create a Gmail draft via himalaya CLI. Returns True on success."""
    email_content = (
        f'From: Akash Kedia <ahkedia@gmail.com>\n'
        f'To: {to_addr}\n'
        f'Subject: {subject}\n'
        f'MIME-Version: 1.0\n'
        f'Content-Type: text/plain; charset=utf-8\n'
        f'\n'
        f'{body}\n'
    )

    # Try himalaya v1 syntax
    try:
        result = subprocess.run(
            ['himalaya', 'message', 'save', '--folder', 'Drafts'],
            input=email_content.encode('utf-8'),
            capture_output=True,
            timeout=30,
        )
        if result.returncode == 0:
            return True
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass

    # Fallback: write to temp file and use himalaya with file arg
    try:
        with tempfile.NamedTemporaryFile(
            mode='w', suffix='.eml', delete=False, encoding='utf-8'
        ) as f:
            f.write(email_content)
            tmp_path = f.name

        with open(tmp_path, 'rb') as f:
            result = subprocess.run(
                ['himalaya', 'message', 'save', '-f', 'Drafts'],
                stdin=f,
                capture_output=True,
                timeout=30,
            )
        os.unlink(tmp_path)
        return result.returncode == 0
    except Exception as e:
        print(f'himalaya fallback failed: {e}', file=sys.stderr)
        return False


def _upsert_recruiter_tracker(company: str, role: str, person: str) -> None:
    """Try to add a row to Recruiter Tracker. Silently skip on permission error."""
    try:
        today = datetime.now().strftime('%Y-%m-%d')
        props = {
            'Contact Name': {'title': [{'type': 'text', 'text': {'content': person or company or 'Unknown'}}]},
            'Company': {'rich_text': [{'type': 'text', 'text': {'content': company or ''}}]},
            'Status': {'select': {'name': 'Applied'}},
            'Next Action': {'rich_text': [{'type': 'text', 'text': {'content': f'Sent application — {today}'}}]},
        }
        _notion_req('POST', '/pages', {
            'parent': {'database_id': RECRUITER_DB_ID},
            'properties': props,
        })
    except Exception:
        pass  # Recruiter Tracker may not be accessible via API — skip silently


def execute_pipeline(state_file: str) -> None:
    """Run the full pipeline (called as background process)."""
    try:
        with open(state_file) as f:
            state = json.load(f)
    except Exception as e:
        print(f'Could not load state: {e}', file=sys.stderr)
        return

    url = state.get('url', '')
    company = state.get('company', '')
    person = state.get('person', '')
    person_email = state.get('person_email', '')
    needs = state.get('needs', 'both')
    tone = state.get('tone', "direct, specific, no fluff — Akash's natural voice")
    raw_msg = (state.get('raw') or '').strip()
    thread_context = raw_msg[:6000] if raw_msg else '_(none — no extra thread text in state)_'

    print(f'[job_application] Starting pipeline: needs={needs}, company={company}', file=sys.stderr)

    # 1. Fetch job context
    print('[job_application] Fetching job context via Tavily...', file=sys.stderr)
    job_ctx = _fetch_job_context(url, company)
    role = job_ctx.get('role') or 'the role'
    job_context_text = f"**Job description:**\n{job_ctx['job_text']}\n\n**Company:**\n{job_ctx['company_text']}"

    # 2. Fetch wiki pages
    print('[job_application] Fetching wiki pages from Notion...', file=sys.stderr)
    wiki_text = _fetch_wiki_pages()

    # 3. Load prompt templates
    cl_system_tpl = _load_prompt_template('COVER_LETTER_SYSTEM')
    cl_user_tpl = _load_prompt_template('COVER_LETTER_USER')
    out_system_tpl = _load_prompt_template('OUTREACH_SYSTEM')
    out_user_tpl = _load_prompt_template('OUTREACH_USER')

    drafts_created = []

    # 4. Generate and draft
    if needs in ('cover_letter', 'both'):
        print('[job_application] Generating cover letter...', file=sys.stderr)
        try:
            system = cl_system_tpl.format(wiki_context=wiki_text, tone=tone)
            user = cl_user_tpl.format(
                company=company or 'the company',
                role=role,
                job_context=job_context_text,
                thread_context=thread_context,
            )
            cover_letter = _call_anthropic(system, user, max_tokens=1200)
            subject = f'Application — {role} at {company}' if company else f'Application — {role}'
            ok = _create_gmail_draft('', subject, cover_letter)
            if ok:
                drafts_created.append(f'📄 Cover letter — {subject}')
                print(f'[job_application] Cover letter draft created: {subject}', file=sys.stderr)
            else:
                print('[job_application] Failed to create cover letter draft', file=sys.stderr)
        except Exception as e:
            print(f'[job_application] Cover letter error: {e}', file=sys.stderr)

    if needs in ('outreach', 'both'):
        print('[job_application] Generating outreach message...', file=sys.stderr)
        try:
            system = out_system_tpl.format(wiki_context=wiki_text, tone=tone)
            user = out_user_tpl.format(
                person=person or (company + ' team'),
                company=company or 'the company',
                job_context=job_context_text,
                thread_context=thread_context,
            )
            outreach = _call_anthropic(system, user, max_tokens=500)
            to_addr = person_email or ''
            subj_name = person or company or 'the team'
            subject = f'Quick note — {subj_name}'
            ok = _create_gmail_draft(to_addr, subject, outreach)
            if ok:
                drafts_created.append(f'💬 Outreach — {subject}')
                print(f'[job_application] Outreach draft created: {subject}', file=sys.stderr)
            else:
                print('[job_application] Failed to create outreach draft', file=sys.stderr)
        except Exception as e:
            print(f'[job_application] Outreach error: {e}', file=sys.stderr)

    # 5. Recruiter tracker (best-effort)
    if drafts_created:
        _upsert_recruiter_tracker(company, role, person)

    # 6. Clean up state file
    try:
        os.remove(state_file)
    except OSError:
        pass

    print(f'[job_application] Done. Drafts: {drafts_created}', file=sys.stderr)


# ---------------------------------------------------------------------------
# Entry point (background execution)
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    if '--execute' in sys.argv:
        idx = sys.argv.index('--execute')
        sf = sys.argv[idx + 1] if idx + 1 < len(sys.argv) else STATE_FILE
        execute_pipeline(sf)
