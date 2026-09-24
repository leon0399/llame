"""Counterfactual token-cost arithmetic; requires Python 3.10+.

Compare source versus helper-answer insertion from the same first touch, then
charge both at the same cached rate on later model requests while both respective
payloads remain resident. This is not a cross-Run replay forecast: llame's
character-based replay caps can clear the source but retain a smaller answer.
Already-present source is a common cost, never credited as avoided.
Prices were read 2026-09-23.
Token totals are assumptions, not proposed caps or measured model behavior.
Additional helper calls, changed final answers, storage and hosting are omitted.
"""

import json
from decimal import Decimal

MILLION = Decimal(1_000_000)
WORKERS = {
    "deepseek_off_peak": ("0.15", "0.60"),
    "deepseek_peak": ("0.30", "1.20"),
    "gpt6_luna": ("0.10", "0.50"),
    "hypothetical_free": ("0", "0"),
}
PRIMARY = {
    "sol_ordinary": ("2", "0.2"),
    "sol_cache_write": ("2.5", "0.2"),
    "luna_ordinary": ("0.1", "0.01"),
}
# id, primary rate class, worker, model requests, added primary tokens, existing source
CASES = [
    ("C1", "sol_ordinary", "deepseek_off_peak", 1, 1500, False),
    ("C2", "sol_ordinary", "deepseek_off_peak", 1, 1500, True),
    ("C3", "luna_ordinary", "deepseek_off_peak", 1, 1500, False),
    ("C4", "luna_ordinary", "deepseek_off_peak", 10, 1500, False),
    ("C5", "luna_ordinary", "deepseek_off_peak", 51, 1500, False),
    ("C6", "sol_cache_write", "deepseek_off_peak", 1, 1500, False),
    ("C7", "sol_ordinary", "hypothetical_free", 1, 4000, False),
    ("C8", "sol_ordinary", "deepseek_peak", 1, 1500, False),
    ("C9", "sol_ordinary", "gpt6_luna", 1, 1500, False),
]
rows = []
for case, primary, worker, requests, added_tokens, existing_source in CASES:
    first, cached = map(Decimal, PRIMARY[primary])
    worker_input, worker_output = map(Decimal, WORKERS[worker])
    worker_cost = (4000 * worker_input + 500 * worker_output) / MILLION
    rate_over_requests = first + (requests - 1) * cached
    avoided_source = (
        Decimal(0) if existing_source else 3000 * rate_over_requests / MILLION
    )
    added_primary = added_tokens * rate_over_requests / MILLION
    delegated = worker_cost + added_primary
    rows.append(
        {
            "case": case,
            "primary": primary,
            "worker": worker,
            "primary_requests": requests,
            "source_already_present": existing_source,
            "source_tokens": 3000,
            "new_answer_and_verification_tokens": added_tokens,
            "worker_usd": str(worker_cost),
            "avoidable_direct_source_usd": str(avoided_source),
            "delegated_incremental_usd": str(delegated),
            "delegation_minus_direct_usd": str(delegated - avoided_source),
        }
    )

assert Decimal(rows[0]["delegation_minus_direct_usd"]) == Decimal("-0.0021")
assert Decimal(rows[1]["avoidable_direct_source_usd"]) == 0
assert Decimal(rows[4]["delegation_minus_direct_usd"]) == 0
assert Decimal(rows[6]["delegation_minus_direct_usd"]) == Decimal("0.002")
print(
    json.dumps(
        {
            "prices_observed": "2026-09-23",
            "sources": [
                "https://api-docs.deepseek.com/quick_start/pricing",
                "https://developers.openai.com/api/docs/models/gpt-6-luna",
                "https://developers.openai.com/api/docs/models/gpt-6-sol",
            ],
            "worker_rates_usd_per_million_input_output": WORKERS,
            "primary_rates_usd_per_million_first_cached": PRIMARY,
            "assumed_aggregate_worker_tokens": {"input": 4000, "output": 500},
            "assumptions": [
                "One helper invocation; no repeated calls or changed final output.",
                "Each model request retains its respective full source or answer after projection.",
                "Repeated-request cases do not forecast cross-Run replay; character caps can break residency.",
                "Same first-touch and later cached rate classes for both alternatives.",
                "Existing source is common to both alternatives and cannot be removed by delegation.",
                "Hypothetical free route is not a claim about a current offer.",
            ],
            "sign": "negative delta favors delegation; no quality/latency claim",
            "rows": rows,
        },
        indent=2,
    )
)
