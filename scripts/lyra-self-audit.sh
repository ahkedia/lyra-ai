#!/bin/bash
set -eu
source /root/.openclaw/.env 2>/dev/null || true
BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
CHAT_ID="7057922182"
AUDIT_DIR="/var/log/lyra/audit"
STATE_DIR="/var/lib/lyra/audit"
HISTORY_FILE="$STATE_DIR/history.jsonl"
NOW_UTC="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
TODAY="$(date -u '+%Y-%m-%d')"
REPORT_JSON="$AUDIT_DIR/${TODAY}-self-audit.json"
REPORT_TXT="$AUDIT_DIR/${TODAY}-self-audit.txt"
mkdir -p "$AUDIT_DIR" "$STATE_DIR"

send_telegram(){ local msg="$1"; [ -z "$BOT_TOKEN" ] && return 0; curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" -d chat_id="$CHAT_ID" --data-urlencode "text=$msg" >/dev/null 2>&1 || true; }
safe_stat_size(){ [ -f "$1" ] && stat -c %s "$1" 2>/dev/null || echo 0; }
safe_count_errors(){ if [ ! -f "$1" ]; then echo 0; return; fi; grep -Ei "error|fail|timeout|timed out" "$1" 2>/dev/null | wc -l | tr -d ' '; }

CRON_JSON="$(openclaw cron list --json 2>/dev/null || echo '{}')"
export CRON_JSON
METRICS_JSON="$(python3 -c 'import os,json
raw=os.environ.get("CRON_JSON","{}")
try:data=json.loads(raw)
except:data={}
jobs=data.get("jobs",[])
slow=[];errs=[];dur=[];je=0;cecount=0
for j in jobs:
 st=j.get("state") or {}
 n=j.get("name","unknown")
 d=int(st.get("lastDurationMs") or 0); dur.append(d)
 if d>0: slow.append((d,n))
 ls=(st.get("lastRunStatus") or st.get("lastStatus") or "").lower()
 ce=int(st.get("consecutiveErrors") or 0)
 if ls=="error": je+=1
 if ce>0: cecount+=1; errs.append((ce,n,ls,st.get("lastError","")))
out={"jobs_total":len(jobs),"jobs_error":je,"jobs_with_consecutive_errors":cecount,"avg_last_duration_ms":int(sum(dur)/len(dur)) if dur else 0,"max_last_duration_ms":max(dur) if dur else 0,"top_slow_jobs":[{"name":n,"last_duration_ms":d} for d,n in sorted(slow, reverse=True)[:5]],"top_error_jobs":[{"name":n,"consecutive_errors":ce,"status":ls,"last_error":le} for ce,n,ls,le in sorted(errs, reverse=True)[:5]]}
print(json.dumps(out))' )"

EVAL_ERRORS=$(safe_count_errors /var/log/lyra-evals.log)
TW_ERRORS=$(safe_count_errors /var/log/lyra-twitter-cron.log)
HEALTH_ERRORS=$(safe_count_errors /var/log/lyra/health.log)
UPDATES_ERRORS=$(safe_count_errors /var/log/lyra/openclaw-updates.log)
EVAL_SIZE=$(safe_stat_size /var/log/lyra-evals.log)
TW_SIZE=$(safe_stat_size /var/log/lyra-twitter-cron.log)
HEALTH_SIZE=$(safe_stat_size /var/log/lyra/health.log)
DISK_USED=$(df -h / | awk 'NR==2{print $5}')
MEM_AVAIL=$(free -m | awk '/Mem:/{print $7}')
GW_OK="no"; curl -sf --max-time 6 http://localhost:18789/health >/dev/null 2>&1 && GW_OK="yes"

export METRICS_JSON EVAL_ERRORS TW_ERRORS HEALTH_ERRORS UPDATES_ERRORS EVAL_SIZE TW_SIZE HEALTH_SIZE DISK_USED MEM_AVAIL GW_OK NOW_UTC REPORT_JSON REPORT_TXT
RECO_JSON="$(python3 -c 'import json,os
m=json.loads(os.environ["METRICS_JSON"]); rec=[]
if m.get("jobs_error",0)>0: rec.append("Investigate jobs with lastRunStatus=error before changing schedules.")
if m.get("jobs_with_consecutive_errors",0)>0: rec.append("For recurring failures, increase timeout by +20% max and recheck for 2 days.")
if m.get("max_last_duration_ms",0)>180000: rec.append("Split longest cron into two phases (data fetch then synthesis) to reduce timeout risk.")
if int(os.environ.get("EVAL_ERRORS","0"))>20: rec.append("Eval lane elevated errors; run targeted canary before heavy jobs.")
if int(os.environ.get("TW_ERRORS","0"))>10: rec.append("Twitter pipeline noisy; inspect API/Notion limits and keep retry cap <=2.")
cannot=["Do not auto-restart gateway based on one slow run.","Do not auto-edit cron prompts/models without approval.","Do not run heavy audits during 03:30-08:00 UTC."]
print(json.dumps({"recommended_actions":rec,"not_recommended":cannot}))')"
export RECO_JSON

python3 -c 'import json,os
print(json.dumps({"timestamp_utc":os.environ["NOW_UTC"],"mode":"report-only","gateway_healthy":os.environ["GW_OK"]=="yes","system":{"disk_used":os.environ["DISK_USED"],"memory_available_mb":int(os.environ["MEM_AVAIL"])} ,"cron_summary":json.loads(os.environ["METRICS_JSON"]),"logs":{"eval_errors":int(os.environ["EVAL_ERRORS"]),"twitter_errors":int(os.environ["TW_ERRORS"]),"health_errors":int(os.environ["HEALTH_ERRORS"]),"updates_errors":int(os.environ["UPDATES_ERRORS"]),"eval_log_size_bytes":int(os.environ["EVAL_SIZE"]),"twitter_log_size_bytes":int(os.environ["TW_SIZE"]),"health_log_size_bytes":int(os.environ["HEALTH_SIZE"])},"assessment":json.loads(os.environ["RECO_JSON"])} ,indent=2))' > "$REPORT_JSON"

python3 -c 'import json,os
m=json.loads(os.environ["METRICS_JSON"])
print(json.dumps({"timestamp_utc":os.environ["NOW_UTC"],"jobs_total":m.get("jobs_total",0),"jobs_error":m.get("jobs_error",0),"jobs_with_consecutive_errors":m.get("jobs_with_consecutive_errors",0),"avg_last_duration_ms":m.get("avg_last_duration_ms",0),"max_last_duration_ms":m.get("max_last_duration_ms",0),"gateway_healthy":os.environ["GW_OK"]=="yes","eval_errors":int(os.environ["EVAL_ERRORS"]),"twitter_errors":int(os.environ["TW_ERRORS"])}))' >> "$HISTORY_FILE"

find "$AUDIT_DIR" -type f -name '*-self-audit.json' -mtime +21 -delete 2>/dev/null || true
find "$AUDIT_DIR" -type f -name '*-self-audit.txt' -mtime +21 -delete 2>/dev/null || true
[ -f "$HISTORY_FILE" ] && tail -n 180 "$HISTORY_FILE" > "$HISTORY_FILE.tmp" && mv "$HISTORY_FILE.tmp" "$HISTORY_FILE"

python3 -c 'import json,os
r=json.load(open(os.environ["REPORT_JSON"])); c=r["cron_summary"]; a=r["assessment"]
lines=[f"Lyra Self-Audit ({r['"'"'timestamp_utc'"'"']})", f"Gateway: {'"'"'OK'"'"' if r['"'"'gateway_healthy'"'"'] else '"'"'DOWN'"'"'} | Disk: {r['"'"'system'"'"']['"'"'disk_used'"'"']} | MemAvail: {r['"'"'system'"'"']['"'"'memory_available_mb'"'"']}MB", f"Crons: total={c['"'"'jobs_total'"'"']} error={c['"'"'jobs_error'"'"']} consecutiveErrorJobs={c['"'"'jobs_with_consecutive_errors'"'"']}", f"Latency: avg={c['"'"'avg_last_duration_ms'"'"']}ms max={c['"'"'max_last_duration_ms'"'"']}ms"]
if c.get("top_error_jobs"): lines.append("Top failing jobs: " + ", ".join([f"{j['"'"'name'"'"']}({j['"'"'consecutive_errors'"'"']})" for j in c["top_error_jobs"]]))
if c.get("top_slow_jobs"): lines.append("Top slow jobs: " + ", ".join([f"{j['"'"'name'"'"']}({j['"'"'last_duration_ms'"'"']}ms)" for j in c["top_slow_jobs"]]))
if a.get("recommended_actions"): lines += ["Recommended:"] + [f"- {x}" for x in a["recommended_actions"][:4]]
lines += ["Do not auto-do:"] + [f"- {x}" for x in a["not_recommended"][:3]]
open(os.environ["REPORT_TXT"],"w").write("\n".join(lines))'

send_telegram "$(cat "$REPORT_TXT")"
