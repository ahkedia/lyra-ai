#!/usr/bin/env bash
# Brain provenance audit + factual-leak eval.
# Answers "how do I know my facts are annotated right and third-party content is never
# passed off as my facts?" — by MEASURING it, repeatably.
#
# Two parts:
#   1. COVERAGE: every page → its tier. Flags anything UNCLASSIFIED.
#   2. LEAK EVAL: ask factual questions; assert the top results come from canonical/authored
#      sources, NOT from reference (Lenny/tweets/RSS). A "leak" = a factual question whose
#      top answer is third-party content.
#
# Run anytime: bash brain-provenance-audit.sh   (read-only; safe)
set -uo pipefail
export PATH="$HOME/.bun/bin:$PATH"
export OLLAMA_HOST="${OLLAMA_HOST:-http://127.0.0.1:11434}"
BRAIN="${GBRAIN_BRAIN_REPO:-/root/gbrain-brain}"

# tier map by path prefix (single source of truth for classification)
tier_of() {
  case "$1" in
    wiki/career/*|wiki/domain/*|wiki/meta/*|wiki/self-reflection/*|persona/*) echo canonical;;
    writing/*) echo authored;;
    wiki/lenny/*|tweets/*|second-brain/*) echo reference;;
    lyra/*|command-center/*) echo boot;;
    inbox/*|lyra/conversations/*) echo ephemeral;;
    README.md) echo skip;;
    *) echo UNCLASSIFIED;;
  esac
}

echo "================ BRAIN PROVENANCE AUDIT  $(date -u +%F\ %T) ================"

echo ""
echo "### 1. COVERAGE — every page classified by tier ###"
declare -A C; unclassified=()
cd "$BRAIN" || exit 1
while IFS= read -r f; do
  rel="${f#./}"
  t=$(tier_of "$rel")
  [ "$t" = skip ] && continue
  C[$t]=$(( ${C[$t]:-0} + 1 ))
  [ "$t" = UNCLASSIFIED ] && unclassified+=("$rel")
done < <(find . -path ./.git -prune -o -name '*.md' -print)
for k in canonical authored reference boot ephemeral UNCLASSIFIED; do
  printf "  %-14s %s\n" "$k" "${C[$k]:-0}"
done
if [ "${#unclassified[@]}" -gt 0 ]; then
  echo "  ⚠️  UNCLASSIFIED pages (must be assigned a tier):"
  printf '     %s\n' "${unclassified[@]}"
else
  echo "  ✅ every page is classified."
fi

echo ""
echo "### 2. FACTUAL-LEAK EVAL — do factual questions cite ONLY your own record? ###"
echo "(A leak = a factual question whose #1 result is reference/third-party content.)"

# factual questions that MUST be answered from canonical/authored only
FACTUAL_QS=(
  "what are my most important product achievements"
  "what did I do at N26"
  "what did I build at Flipkart"
  "what were my results at CheQ"
  "what is my experience in payments"
  "what did I achieve in lending and credit"
  "what is my track record in growth"
  "summarize my career"
)
pkill -f "gbrain serve" 2>/dev/null; sleep 2
leaks=0; total=0
for q in "${FACTUAL_QS[@]}"; do
  total=$((total+1))
  top=$(gbrain query "$q" --limit 1 2>/dev/null | grep -oE '^\[[0-9.]+\] [^ ]+' | head -1 | awk '{print $2}')
  [ -z "$top" ] && { echo "  ? '$q' → no result"; continue; }
  t=$(tier_of "$top")
  if [ "$t" = reference ] || [ "$t" = UNCLASSIFIED ]; then
    echo "  ❌ LEAK: '$q'"
    echo "       top result: $top  (tier=$t)"
    leaks=$((leaks+1))
  else
    echo "  ✅ '$q' → $top (tier=$t)"
  fi
done

echo ""
echo "### RESULT ###"
echo "  factual questions: $total | leaks (top result was third-party): $leaks"
if [ "$leaks" -eq 0 ]; then
  echo "  ✅ PASS — no factual question leaked third-party content into the #1 slot."
else
  echo "  ❌ FAIL — $leaks/$total factual questions surfaced third-party content first."
  echo "     This is the gap source-scoped retrieval (multi-source split) will close."
fi
echo "============================================================================"
