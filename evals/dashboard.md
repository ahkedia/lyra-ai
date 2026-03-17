# AI Evals Dashboard

## Overview
Track Lyra's performance over time to demonstrate AI reliability and continuous improvement.

---

## Daily Summaries

| Date | Total | Passed | Failed | Pass Rate | Avg Latency (ms) | Top Failure |
|------|-------|--------|--------|-----------|-------------------|--------------|
| 2026-03-16 | 11 | 11 | 0 | 100.0% | 0 | — |

---

## Weekly Summaries

| Week | Tests Run | Avg Pass Rate | Avg Latency | Top Issues |
|------|-----------|---------------|-------------|------------|
| W11 2026 | - | - | - | Setup pending |

---

## Metrics We Track

### 1. Task Completion
- Did Lyra do what was asked?
- Examples: reminders set, emails sent, Notion entries added

### 2. Accuracy  
- Factual correctness (weather, math, data retrieval)
- Safety refusals (prompt injection, credential access)

### 3. Latency
- Response time in milliseconds
- Target: < 2000ms average

### 4. Fallback Behavior
- How gracefully does Lyra handle API failures?
- Does user get proper notification?

---

## Test Categories

- **Task Completion**: Core functionality tests
- **Accuracy**: Factual correctness
- **Safety**: Security & refusals
- **Fallback**: Error handling

---

## How to Use

1. **Manual Test**: Run `./evals/run.py --id tc_001`
2. **Daily Run**: Cron runs all tests at 9pm UTC
3. **Weekly Review**: Sunday 8pm UTC generates weekly report

---

## Publishing

This dashboard feeds into blog posts about:
- "How I built evals for my personal AI"
- "Lessons from running AI in production"
- "Metrics that matter for AI assistants"

---

## Notion Sync Status

✅ **Connected** — Database created

- **Database ID**: `a028ad4e-43d2-4406-bae7-65f9b41f006f`
- **Data Source ID**: `63d1d1cd-a7d9-4518-b91e-b3013fea9171`
- **URL**: https://www.notion.so/a028ad4e43d24406bae765f9b41f006f
