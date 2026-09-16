---
id: proj-lyra-ai
name: Lyra
type: Project
aliases:
  - Lyra AI
  - Lyra Assistant
status: active
lead_id: person-akash-kedia
confidence: verified
tech_stack:
  - OpenClaw Agent Framework
  - Node.js / Vite / TypeScript / Preact
  - Python 3 (Tier 0 CRUD bypass)
  - Notion API (2025-09-03)
  - PostgreSQL / SQLite
  - Caddy Web Server
  - Hetzner Linux VPS
sources:
  - SRC-BLOG-BUILDING-LYRA
  - SRC-DOCS-ARCH
  - SRC-SPEC-PWA-V2
---

# Lyra (Personal AI Chief of Staff)

## Architecture & System Overview
Lyra is a private, multi-tier personal AI chief of staff designed and implemented by Akash Kedia. It operates autonomously to manage daily schedules, coordinate household logistics, capture voice ideas, monitor competitors, and curate news briefs.

## Key Design Principles
1. **Operator, Not Chatbot**: Lyra takes proactive action, posts digests on schedule, and updates databases autonomously rather than waiting for user prompts.
2. **Notion as System of Record**: All structured state survives inside Notion databases; Lyra serves as the conversational and automated execution layer.
3. **PWA as Primary Interface**: Transitioned from Telegram Mini App to an installable, mobile-first Progressive Web App (PWA v2) with real-time push notifications.
4. **Programmatic Model Routing**: Employs a 3-way real-time router:
   - **Tier 0**: Python-based CRUD regex bypass (zero LLM token cost).
   - **Tier 1**: Google Gemini Flash (fast, economical default for 85%+ of tasks).
   - **Tier 2**: Anthropic Claude Sonnet 4.6 (invoked for complex multi-source synthesis, strategic drafts, and weekly reviews).
