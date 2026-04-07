# Mode: compare — Offer Comparison & Decision Framework

When the user pastes 2-3 job offers for comparison:

## Step 0 — Extract All Offers

For each offer, create a structured data block:

```
Offer [A/B/C]: [Company] — [Role]
- Base: $X
- Equity: [shares/RSUs/options], [X]-year vesting, [cliff], [$Y current value at last valuation]
- Bonus: [X% target], [guaranteed?]
- Signing: $X
- Benefits: [health quality: 1-5], [401k match: X%], [PTO: X days], [other]
- Stage: [public/Series A-E/bootstrapped]
- Location: [remote/hybrid/onsite] — [city]
- Role level: [IC4/L6/Staff/etc.]
```

If any field is unknown, flag it — missing equity details are a red flag.

## Step 1 — Total Compensation Normalization

Normalize all offers to comparable annual cash-equivalent values.

### Year 1 vs 4-Year View

| Component | Offer A | Offer B | Offer C |
|-----------|---------|---------|---------|
| Base | | | |
| Annual bonus (target) | | | |
| Equity (4-yr annual) | | | |
| Signing (Year 1 only) | | | |
| Benefits value | | | |
| **Year 1 total** | | | |
| **4-Year total** | | | |

### Benefits Value Methodology
- Health (employer-covered premium): $200-600/mo = $2.4K-7.2K/year
- 401k match: match% × typical contribution
- Equity: use current valuation for private; use stock price for public

## Step 2 — Location Adjustment

Adjust for cost of living if locations differ:

| City | COL Index | Adjusted Value |
|------|-----------|---------------|
| NYC  | 1.3 | Divide by 1.3 to normalize |
| SF/Bay Area | 1.35 | |
| Seattle | 1.15 | |
| Austin | 1.0 | baseline |
| Remote | ~1.0-1.1 | depends on candidate location |

Show: **purchasing power equivalent** for each offer in a neutral baseline location.

## Step 3 — Equity Risk Adjustment

Apply a discount to private equity based on stage:

| Stage | Discount | Reasoning |
|-------|----------|-----------|
| Public (liquid) | 0% | Face value |
| Late stage / pre-IPO (Series D+) | 20-30% | High probability of liquidity, still illiquid |
| Series C | 40-50% | ~50% of outcomes reach liquidity meaningfully |
| Series B | 60-70% | Most equity never becomes liquid |
| Series A / Seed | 75-90% | High risk, treat as lottery ticket |
| Bootstrapped / unknown | 80-95% | Limited exit path |

Show: **risk-adjusted equity value** for each offer.

## Step 4 — 4-Year Scenario Analysis

For each offer, model 3 scenarios:

| Scenario | Offer A | Offer B | Offer C |
|----------|---------|---------|---------|
| **Conservative** (50th percentile) | | | |
| **Base** (75th percentile) | | | |
| **Optimistic** (company 3x/5x) | | | |

Assumptions to state clearly:
- Annual base increases (conservative: 3-5%, base: 5-7%, optimistic: 8-12%)
- Bonus payouts
- Equity outcomes

## Step 5 — Non-Comp Factors Scorecard

Score each offer 1-5 on:

| Factor | Offer A | Offer B | Offer C | Weight |
|--------|---------|---------|---------|--------|
| Technical learning / growth | | | | 25% |
| Team quality / caliber | | | | 20% |
| Mission / product alignment | | | | 15% |
| Stability / runway | | | | 15% |
| Work-life balance signals | | | | 10% |
| Career brand / prestige | | | | 10% |
| Management quality signals | | | | 5% |
| **Weighted Score** | | | | |

Use the user's profile from `_profile.md` to weight these factors. If the user values learning over comp, say so explicitly.

## Step 6 — Ranked Recommendation

**Recommended: [Offer X]**

Rationale (3 sentences maximum):
1. Financial: [why it wins or loses on comp]
2. Career: [why it's best for next 3-5 years]
3. Risk profile: [how it fits the user's current situation]

**If it's close:** Say so explicitly. Give the one tiebreaker factor.

**Deal-breakers to flag:**
- Any offer with major red flags (no equity details, unrealistic expectations, known culture issues)
- Stage mismatch (overqualified/underqualified)
- Location mismatch with user's stated preferences in `_profile.md`

## Step 7 — Negotiation Leverage

If one offer is clearly better, suggest using it as leverage:
> "Offer [X] gives you leverage. When negotiating with [Company Y], you can honestly say you have a competing offer in the $[range]. This alone often moves the number 5-10%."

## Rules

- **Never compare apples to oranges without normalizing.** Always show the adjustments.
- **Be decisive.** The user needs a recommendation, not a framework to decide themselves.
- **Flag the unknowns.** Missing equity details = estimate conservatively or ask.
- **Read `_profile.md` first.** The user's priorities should drive the weighting.
- **Consider the whole picture.** Highest total comp is not always the right answer.
