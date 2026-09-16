# SOURCE ID: SRC-BLOG-BUILDING-LYRA
Title: Field Report: Building Lyra — Personal AI Chief of Staff
Authority Tier: Tier 2 (Authored)
Origin: blog/building-lyra-v2.md
Author: Akash Kedia
Entities: person-akash-kedia, person-abhigna, proj-lyra-ai

---

# Building Lyra: Field Report on Personal AI Chief of Staff

By Akash Kedia (Product Leader)

## Core Insight: An Operator, Not a Chatbot
For two years, I pasted the same giant context file into ChatGPT at the start of every conversation. Every session from scratch. Every thread forgotten.

I lead product organizations. I manage a hundred people. I have a household, a content strategy, and a head that's full. And I kept thinking: isn't this exactly what AI is supposed to fix? Not the "write me a poem" kind of AI. The "remember that I told you last Tuesday that the electrician is coming Thursday, and tell my wife" kind.

I wanted an operator. Not a chatbot.

## Architectural Pillars
1. **The Desk**: A €6/month Hetzner Linux VPS. Always on, independent of my laptop.
2. **The Job Description**: `SOUL.md` loaded on every turn defining boundaries, communication style, and escalation gates.
3. **The System of Record**: Notion. Lyra is the interface; Notion is the database. If the AI agent breaks, the data survives.
4. **Economic & Robust Routing**: Model routing keeping total monthly API spend under €20/month. Routine queries execute via MiniMax/Gemini Flash or Tier 0 Python regex; complex synthesis escalates to Claude Sonnet.
5. **Structural Access Control**: Household boundaries must be architectural. Abhigna has access to household databases only; she physically cannot query professional career databases.
