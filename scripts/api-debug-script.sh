#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"

BASE="${BASE:-http://localhost:3100}"
OUT="${OUT:-$PROJECT_ROOT/tmp/erc8004-audit}"
mkdir -p "$OUT"

echo "Using API base: $BASE"
echo "Writing audit artifacts to: $OUT"

# 1) Core endpoints
curl -sS "$BASE/v1/health" > "$OUT/health.json"
curl -sS "$BASE/v1/analytics/overview" > "$OUT/analytics.json"
curl -sS "$BASE/v1/reputation?limit=10" > "$OUT/reputation.json"
curl -sS "$BASE/v1/agents?limit=10&page=1" > "$OUT/agents.json"

# 2) Pick one agent and fetch profile
AGENT_ID="$(jq -r '.items[0].agentId // .data[0].agentId // empty' "$OUT/agents.json")"
if [ -n "$AGENT_ID" ]; then
  curl -sS "$BASE/v1/agents/$AGENT_ID" > "$OUT/agent.json"
else
  echo '{}' > "$OUT/agent.json"
fi

# 3) Pick one tx from activity feed and fetch decode payload
TX_HASH="$(jq -r '.activityFeed[0].txHash // empty' "$OUT/analytics.json")"
if [ -n "$TX_HASH" ]; then
  curl -sS "$BASE/v1/transactions/$TX_HASH" > "$OUT/tx.json"
else
  echo '{}' > "$OUT/tx.json"
fi

# 4) Build compact summary
jq -n \
  --slurpfile health "$OUT/health.json" \
  --slurpfile analytics "$OUT/analytics.json" \
  --slurpfile reputation "$OUT/reputation.json" \
  --slurpfile agents "$OUT/agents.json" \
  --slurpfile agent "$OUT/agent.json" \
  --slurpfile tx "$OUT/tx.json" \
'def as_obj: if type == "object" then . else {} end;
 def as_arr: if type == "array" then . else [] end;
 ($health[0] // {} | as_obj) as $h
 | ($analytics[0] // {} | as_obj) as $a
 | ($reputation[0] // {} | as_obj) as $r
 | ($agents[0] // {} | as_obj) as $ags
 | ($agent[0] // {} | as_obj) as $ag
 | ($tx[0] // {} | as_obj) as $t
 | ($a.charts // {} | as_obj) as $charts
 | {
     health: $h,
     analytics: {
       dashboardMetrics: ($a.dashboardMetrics // {} | as_obj),
       heuristics: ($a.heuristics // {} | as_obj),
       chartLengths: (
         $charts
         | to_entries
         | map({
             key: .key,
             len: ((.value | as_arr) | length)
           })
       ),
       chartSamples: {
         registrations: (($charts.registrations | as_arr) | {first: .[0], last: .[-1]}),
         feedbackVolume: (($charts.feedbackVolume | as_arr) | {first: .[0], last: .[-1]}),
         responseVolume: (($charts.responseVolume | as_arr) | {first: .[0], last: .[-1]}),
         revocationVolume: (($charts.revocationVolume | as_arr) | {first: .[0], last: .[-1]}),
         transferVolume: (($charts.transferVolume | as_arr) | {first: .[0], last: .[-1]})
       },
       activityFeedCount: (($a.activityFeed | as_arr) | length),
       activityFeedSample: (($a.activityFeed | as_arr)[:8] | map({eventName, agentId, timestamp, txHash})),
       rawError: ($a.error // null)
     },
     reputation: {
       metrics: ($r.metrics // {} | as_obj),
       heuristics: ($r.heuristics // {} | as_obj),
       recentFeedbackCount: ((($r.recentFeedback.items // $r.recentFeedback.data) | as_arr) | length),
       recentResponsesCount: ((($r.recentResponses.items // $r.recentResponses.data) | as_arr) | length),
       rawError: ($r.error // null)
     },
     agents: {
       pagination: ($ags.pagination // {} | as_obj),
       count: ((($ags.items // $ags.data) | as_arr) | length),
       sample: ((($ags.items // $ags.data) | as_arr)[:5] | map({agentId, feedbackCount, responseCount, transferCount, lastActiveTimestamp})),
       rawError: ($ags.error // null)
     },
     agentProfile: {
       selectedAgentId: ($ag.agent.agentId // null),
       heuristics: ($ag.heuristics // null),
       trustMetrics: ($ag.trustMetrics // null),
       counts: {
         feedback: ((($ag.feedback.items // $ag.feedback.data) | as_arr) | length),
         responses: ((($ag.responses.items // $ag.responses.data) | as_arr) | length),
         ownershipHistory: (($ag.ownershipHistory | as_arr) | length),
         uriHistory: (($ag.uriHistory | as_arr) | length),
         metadataHistory: (($ag.metadataHistory | as_arr) | length),
         transactionHistory: (($ag.transactionHistory | as_arr) | length)
       },
       rawError: ($ag.error // null)
     },
     txProbe: {
       txHash: ($t.transactionFact.txHash // null),
       functionName: ($t.callFact.functionName // null),
       eventCount: (($t.eventFacts | as_arr) | length),
       eventNames: (($t.eventFacts | as_arr) | map(.eventName) | unique),
       eventSample: (($t.eventFacts | as_arr)[:5] | map({eventName, logIndex, timestamp, txHash, argKeys: ((.eventArgs | as_obj) | keys)})),
       rawError: ($t.error // null)
     }
   }' > "$OUT/summary.json"

echo "Summary written to: $OUT/summary.json"
