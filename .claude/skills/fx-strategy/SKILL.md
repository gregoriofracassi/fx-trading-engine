---
name: fx-strategy
description: Complete Forex M15 trading strategy specification. Covers markets, timeframes, FTMO context, calendar/hours, risk management, news rules, Asia Session range, tolerances, Zone Engine (Attuale/Periferica/A+P), and the three trade setups S1/SSA/Mutazione (short + long). Includes all special cases, TODO ambiguities, and the full operational flow.
---

# FX Trading Strategy — Full Specification (Forex M15)

> This document is the single source of truth for the trading strategy. Every rule, tolerance, setup, and special case is included. It must not be summarized or stripped.

---

## 0. Purpose

This specification provides all information needed to understand and implement the strategy at full deterministic detail — including all known ambiguities marked as `TODO_AMBIGUITY` or `TODO_UNSPECIFIED` so they are never silently ignored.

---

## 1. Environment, Markets, Timeframes, Sources

### 1.1 Markets and Scope

- Strategy is **FOREX ONLY** (core scope).
- Reference instrument and examples: **USDCHF M15 on FXCM**.
- US30 / indices / oil: mentioned in materials with parameters, but **excluded from the bot for now**.
  - "US30 non guardarlo… non da includere nel bot almeno per ora"
  - "OIL molto interessante ma non ancora ampiamente testato… non da includere nel bot almeno per ora"
- **Bot scope: Forex only.**

### 1.2 Timeframe

- Operative timeframe: **M15 (15 minutes)**.

### 1.3 Price Source

- **FXCM** is the reference for Forex data ("si usa FXCM come riferimento").

### 1.4 Ignored Candles

- Candles between **23:00 and 00:00** are ignored.
- They are excluded from pattern detection, zone counting, and all calculations.

---

## 2. FTMO Execution Environment

These are not "setup rules" — they define the real operating environment:

- Platform: **FTMO Challenge**
- Leverage: **x30**
- Reference account: **200k** (USD)
- All trades are treated as being in EUR (either EUR account base or EUR calculation convention).
  - `TODO_AMBIGUITY`: Does "trades in EUR" mean the account base currency is EUR, or is it just a P&L calculation convention? Impacts only sizing/calculations.

---

## 3. Calendar and Trading Hours

### 3.1 Days

- Trading: **Monday through Friday**.

### 3.2 Operative Window

- **08:15 → 16:30 (Europe/Rome timezone)**

### 3.3 First Friday of the Month

- **No trading on the first Friday of the month** (fixed rule, coincides with NFP day).

### 3.4 Overnight and Friday Close

- Leaving positions overnight is **permitted** in general.
- **Exception:** On Friday at **22:00** → force-close all open positions.

### 3.5 End of Session — Pending Orders

- At **16:30**: if there are unfilled pending orders → **cancel all pending orders**.

---

## 4. Risk Management and Position Concurrency

### 4.1 Daily Stop Loss Cap

- After **3 stop losses in a day** → halt all trading for the rest of that day, on all assets.
- Rule is global (all assets combined).

### 4.2 Concurrency Per Asset

- **Max 1 open position per asset at any time.**

### 4.3 "Alternative Asset Next Day" Rule

- If a position was open on an asset (today or overnight), the next trading day the operative must be on a **different asset**.

**AI-interpreted rule (pending Dave confirmation):**
- "Activity" on an asset = **filled position** (opened and executed)
  - Pending order **not filled** does NOT count as activity (gets cancelled at 16:30 anyway)
  - Trade filled and closed same day = still counts as activity
- **Next day restriction:**
  - Cannot open **new positions** on that same asset
  - Can still manage existing positions (close, modify SL/TP)
- **Overnight positions:**
  - If position is still open from previous day, that's allowed (can manage/close it)
  - But still cannot open a **new** position on that asset
  - Can open on different assets (rotation encouraged)

> `TODO_DAVE_CONFIRM`: Verify "activity" = filled trade, and blocks new opens (not management) next day

---

## 5. News Rules (Entry Filter + Exit Rules)

### 5.1 General Red News Rule (3-Star)

- **No entry** in the window: **[−15 min, +15 min]** around any red (3-star) news event.

### 5.2 If Already in a Trade

- **Exit 15 minutes before** any upcoming relevant red news event.
- `TODO_UNSPECIFIED`: "Relevant" = currency-specific matching (news affects the cross being traded), or any 3-star event globally? Materials imply currency-specific, but needs formal definition for implementation.

### 5.3 Full-Day Global Blackout

- **USD CPI** → no trading all day, all assets.
- **FOMC** → no trading all day, all assets.

### 5.4 NFP / First Friday

Already covered by section 3.3: no trading on the first Friday of the month.

### 5.5 Currency-Specific Event List (from Dave)

**USD** (no trading on USD or indices):
- Unemployment rate / claims
- Retail sales
- PMI
- Bank holiday (no trade on USD or indices only)
- FOMC = all-day global blackout (see 5.3)
- `TODO_UNSPECIFIED`: Are these events "all-day" or just ±15 min? Dave lists them without specifying. Default: apply ±15 min rule for 3-star events; apply "no trade on currency" if that policy is confirmed.

**EUR:**
- Monetary policy statement

**GBP** (no trade on GBP only):
- Monetary policy report/statement
- CPI
- Retail sales

**CAD** (applies time-based rule):
- CPI
- Unemployment rate/change

**CHF** (applies time-based ±15 min rule):
- CPI

---

## 6. Asia Session (Range Base)

### 6.1 Definition

- Asia Session: **01:00 → 08:15** (Europe/Rome timezone)
- **Asia High** = maximum price in that window
- **Asia Low** = minimum price in that window

### 6.2 Usage in Setups

- Setups (S1, SSA, Mutazione) trigger on **imbalances** relative to the Asia range.
- Most documented examples are **short** (break downward from Asia Low).
- `TODO_UNSPECIFIED`: Complete and symmetric rules for **LONG** setups are not present in the materials.

---

## 7. Forex Tolerances (Valid for All Forex Assets on FXCM)

These are the official thresholds from Dave:

| Concept | Threshold |
|---|---|
| Engulfing minimum | ≥ 0.6 pips |
| Imbalance minimum | ≥ 1.0 pip |
| Liquidity | ≤ 0.5 pips (between highs of 2 candles) |
| Acceptance | ≥ 0.6 pips (body beyond zone) |
| Opposite imbalance | ≥ 1.0 pip to be considered "valid" |

### 7.1 Post-Entry "Leave Liquidity" Rule

- **While in a trade**, if a candle leaves liquidity (distance in [0.0, 0.5] inclusive), and the price **then returns to entry** → **close manually immediately**.
- Applies to: S1, SSA, Mutazione.
- `TODO_UNSPECIFIED`: Algorithmic definition of "the candle leaves liquidity" post-entry — which two candles are compared, and what exact measurement point is used?

---

## 8. Operational Pipeline (Mental Flow)

1. Identify Asia Low (for short) or Asia High (for long)
2. Measure imbalance from Asia Low/High to the "imbalancing candle"
3. Wait for trigger
4. Validate liquidity and engulfing
5. This confirms the sequence: identify Asia reference → measure imbalance (≥1 pip for SSA) → wait for trigger/engulfing candle → filter with liquidity and other constraints

---

## 9. Core Concept Definitions

### 9.1 Engulfing (≥ 0.6 pips)

- Validation condition for S1, SSA, and Mutazione.
- Threshold: **≥ 0.6 pips**.

**AI-interpreted formula (pending Dave confirmation):**
- Candles: **push candle** (brings price in opposite direction) vs **engulfing candle** (closes in trade direction)
- For short:
  ```
  pushBodyLow = min(push.open, push.close)
  engulfSize = pushBodyLow - engulf.close
  valid if: engulfSize ≥ 0.6 pips
  ```
- For long: mirror (engulf.close - pushBodyHigh ≥ 0.6 pips)

> `TODO_DAVE_CONFIRM`: Verify this body-to-close measurement is correct

### 9.2 Liquidity (≤ 0.5 pips)

- Definition: **distance between the highs of 2 relevant candles** (for short).
- If distance ∈ [0.0, 0.5] pips inclusive → **liquidity is present** (invalidating condition, or trigger for special rules).
- For short: `Liquidity = |high(candle A) − high(candle B)|`

**AI-interpreted formula (pending Dave confirmation):**
- **S1/SSA:** Compare **push candle** (brings price up) vs **engulfing candle**
  ```
  liquidityGap = |high(push) - high(engulf)|
  liquidity present if: liquidityGap ≤ 0.5 pips → setup INVALID
  ```
- **Mutazione:** Compare push candle vs **previous candle** (the one immediately before push)
  ```
  liquidityGap = |high(push) - high(previous)|
  liquidity present if: liquidityGap ≤ 0.5 pips → setup INVALID
  ```
- For long: use `low` instead of `high`

> `TODO_DAVE_CONFIRM`: Verify which two candles for each setup

### 9.3 Imbalance Minimum (≥ 1.0 pip)

- For SSA: explicit — the wick must imbalance by ≥ 1 pip.
- General Forex rule: imbalance minimum = 1 pip.

**AI-interpreted formula (pending Dave confirmation):**
- For **SSA short** (wick-only imbalance):
  ```
  imbalance = asiaLow - low(imbCandle)  // uses wick tip
  valid if: imbalance ≥ 1.0 pip
  ```
- Plus structural check: body must NOT accept beyond Asia Low (otherwise it's S1, not SSA)
- For long: `high(imbCandle) - asiaHigh ≥ 1.0 pip`

> `TODO_DAVE_CONFIRM`: Verify wick tip measurement for SSA

### 9.4 Acceptance (≥ 0.6 pips)

- "Acceptance: 0.6 — rottura della zona"
- In S1: "accept with the entire body beyond the Asia session by at least 0.6 pips"

**AI-interpreted formula (pending Dave confirmation):**
- "Entire body beyond" means both open and close must be beyond the zone
- For **S1 short**:
  ```
  bodyHigh = max(candle.open, candle.close)  // highest point of body
  acceptance = asiaLow - bodyHigh
  valid if: acceptance ≥ 0.6 pips
  ```
- This ensures the entire body (both open and close) stays ≥ 0.6 pips below Asia Low
- For long: `bodyLow - asiaHigh ≥ 0.6 pips` where `bodyLow = min(open, close)`

> `TODO_DAVE_CONFIRM`: Verify "entire body" means both open and close beyond zone

### 9.5 Opposite Imbalance (≥ 1.0 pip)

- In S1 and SSA: if a valid opposite imbalance exists (≥ 1.0 pip) → **setup is invalid**.
- In Mutazione: **opposite imbalance is NOT checked** ("con la mutazione NON si guarda lo sbilanciamento opposto").

**AI-interpreted formula (pending Dave confirmation):**
- Opposite imbalance = breaking the **opposite Asia extreme** by ≥ 1.0 pip
- For **short setup**:
  ```
  oppImb = high(pushCandle) - asiaHigh
  setup invalid if: oppImb ≥ 1.0 pip
  ```
- The "push candle" (that brings price up against the short direction) is checked
- For long: `asiaLow - low(pushCandle) ≥ 1.0 pip` → invalid

> `TODO_DAVE_CONFIRM`: Verify opposite imbalance uses push candle vs opposite Asia extreme

### 9.6 Dominance Rule

- "Lo sbilanciamento dominance reale è più forte dello sbilanciamento opposto quindi si prende sempre"
- Operational interpretation: if there is a conflict between dominance imbalance and opposite imbalance → **always take dominance**.

**AI-interpreted formula (pending Dave confirmation):**
- Dominance is not a different calculation — it's a **priority rule** based on magnitude comparison
- For **short setup**:
  ```
  mainImb = asiaLow - low(imbCandle)      // imbalance in trade direction
  oppImb = high(pushCandle) - asiaHigh    // opposite imbalance

  if mainImb > oppImb:
    → dominance applies → take the trade (ignore opposite imbalance)
  ```
- Both must meet minimum thresholds (mainImb ≥ 1.0, oppImb ≥ 1.0 to "exist")
- If main imbalance is larger, it "dominates" and the setup remains valid

> `TODO_DAVE_CONFIRM`: Verify dominance = simple magnitude comparison (mainImb > oppImb)

### 9.7 Opposite Imbalance Cancelled by Liquidity

- "The opposite imbalance is cancelled if it leaves liquidity at the lows (for short) with another candle."
- Effect: opposite imbalance is "annulled" (setup can proceed).

**AI-interpreted formula (pending Dave confirmation):**
- If opposite imbalance exists (would normally invalidate), check if a **later candle** leaves liquidity with the push candle
- For **short setup**:
  ```
  oppImb = high(pushCandle) - asiaHigh  // ≥ 1.0 pip (exists)

  for each candle c2 after pushCandle:
    if |low(pushCandle) - low(c2)| ≤ 0.5 pips:
      → liquidity at lows detected
      → opposite imbalance annulled
      → setup remains valid
  ```
- "Annulled" means the opposite imbalance no longer invalidates the setup
- For long: check liquidity at highs (`|high(push) - high(c2)| ≤ 0.5`)

> `TODO_DAVE_CONFIRM`: Verify liquidity annulment logic (later candle vs push candle at lows)

---

## 10. The Three Setups: S1 / SSA / Mutazione

> The images document the **short** side. The **long** side is presumably mirror-image but is not formally specified in the materials.

---

### 10A. Setup S1 (SHORT)

#### Validation — ALL conditions must be true:

1. **Acceptance**: entire candle body accepted beyond the Asia Low by **≥ 0.6 pips** (inclusive).
2. **Engulfing**: the candle that closes below the level engulfs by **≥ 0.6 pips**.
3. **No liquidity at highs**: distance between the highs of the "candle that pushed price highest" and the reference candle must be **> 0.5 pips** (i.e. NOT in [0.0, 0.5]).
4. **No valid opposite imbalance**: opposite imbalance must be **< 1.0 pip** (if ≥ 1.0 → invalid).

#### Invalidation Examples (from images — any one is sufficient to reject):

- Acceptance = 0.5 pips → invalid (must be ≥ 0.6)
- Opposite imbalance = 1.0 pips → invalid
- Liquidity at highs in [0.0, 0.5] → invalid

#### Trade Placement — Fibonacci (SHORT):

Draw Fibonacci:
- From: **high of the candle that pushed price highest**
- To: **low of the engulfing candle**

Place:
- **Entry**: at Fibonacci 50% **minus 5 pips** (i.e. `fib50% − 5 pips`)
  - `TODO_AMBIGUITY`: Most coherent interpretation is `entry = fib50% − 5 pips`
- **Stop Loss**: 10 pips **above** the Fibonacci 100% level

#### Order & Trade Management:

- If price reaches **RR 1:2** and order is **NOT filled** → cancel order
- If order is filled and price reaches **RR 1:2** → move SL to **Break Even (entry)**

#### Target:

- Concordant zones → **TP at RR 1:4**
- Discordant zones → **TP at RR 1:3**

---

### 10B. Setup SSA (SHORT)

#### Definition

"When the candle imbalances the Asia session with the wick only, not with the body."
- Wick breaks the level; body does not.

#### Validation — ALL conditions must be true:

1. **Wick imbalances Asia Low by ≥ 1.0 pip** (inclusive).
2. **Engulfing ≥ 0.6 pips** (inclusive).
3. **No liquidity at highs** (distance NOT in [0.0, 0.5]).
4. **No valid opposite imbalance** (< 1.0 pip).

#### Invalidation Examples (from "SSA NON VALIDA" table — any one is sufficient):

- Body accepts beyond Asia (not wick-only) → invalid
- Wick breaks but imbalance < 1.0 pip → invalid
- Engulfing < 0.6 → invalid
- Liquidity at highs in [0.0, 0.5] → invalid
- Opposite imbalance ≥ 1.0 → invalid

#### Trade Placement — Fibonacci (SHORT):

Draw Fibonacci:
- From: **highest point of the imbalancing candle (wick high)**
- To: **lowest point of the engulfing candle**

Place:
- **Entry**: at Fibonacci 50% **minus 5 pips** (short)
- **Stop Loss**: 10 pips **above** the Fibonacci 100% level

#### Order & Trade Management:

- If price reaches RR 1:2 and order is NOT filled → cancel order
- If order is filled and price reaches RR 1:2 → move SL to Break Even

#### Target:

- Concordant zones → **TP at RR 1:4**
- Discordant zones → **TP at RR 1:3**

---

### 10C. Setup Mutazione (SHORT)

#### Definition

"The schematic that forms after an SSA or S1 is called Mutazione."
- **Mutazione only occurs after a confirmed SSA or S1.**

#### Validation — ALL conditions must be true:

1. There is a "candle that pushed price higher" (in the short case).
2. **Engulfing ≥ 0.6 pips**.
3. **No liquidity at highs** between:
   - The "push up" candle
   - **The previous candle** (if liquidity [0.0, 0.5] inclusive → invalid)

**Key note:** "Con la mutazione NON si guarda lo sbilanciamento opposto" — opposite imbalance is **not checked** for Mutazione.

#### Trade Placement — NOT Fibonacci (SHORT):

- **Entry**: at the **low of the candle that pushed price highest** (the "push up" candle)
- **Entry buffer**: 5 pips below entry (short)
- **Stop Loss**: 10 pips **above** the high of the push-up candle

**AI-confirmed (from slide analysis):**
- The original text "SL 5 pips below entry" was an error/typo
- Correct formula for **Mutazione short**:
  ```
  entry = low(pushCandle) - 5 pips
  SL = high(pushCandle) + 10 pips
  ```
- For long: mirror (entry = high(pushCandle) + 5 pips, SL = low(pushCandle) - 10 pips)

> `TODO_DAVE_CONFIRM`: Verify Mutazione entry/SL offsets (5 pips entry buffer, 10 pips SL)

#### Order & Trade Management:

- If price reaches RR 1:2 and order is NOT filled → cancel order
- If order is filled and price reaches RR 1:2 → move SL to Break Even

#### Target:

- Concordant zones → **TP at RR 1:4**
- Discordant zones → **TP at RR 1:3**

---

### 10D. Post-Entry Rule: Leave Liquidity → Close on Return to Entry

Applies to **S1, SSA, and Mutazione**:

- While in a trade, if a candle **leaves liquidity** ([0.0, 0.5] pips inclusive)…
- …and the price **returns to the entry level** → **close the position manually immediately**.

---

## 11. Special Cases (from "Casi Particolari" Board)

These are explicit operational rules:

1. **Mutazione only occurs after SSA or S1** — never in isolation.
2. **Post-fill liquidity rule**: if after fill the price leaves liquidity [0.0, 0.5] (short), and price returns to entry → close manually.
3. **Red news (3-star)**: no entry 15 min before and 15 min after.
4. **If in trade and news approaches**: exit 15 min before.
5. **Opposite imbalance cancelled by liquidity**: if opposite imbalance leaves liquidity at the lows (short) with another candle → opposite imbalance is annulled. `TODO_UNSPECIFIED`: define "annulled" operationally.
6. **Mutazione does NOT check opposite imbalance.**
7. **First Friday of month**: no trading.
8. **"Alternative asset next day" rule**: after activity/position on an asset, next day operate on a different asset. `TODO_AMBIGUITY`: exact conditions (overnight only? any trade?).
9. **Max 1 position per asset at any time.**
10. **At 16:30**: cancel all unfilled pending orders.
11. **Overnight allowed, but Friday 22:00**: force-close everything.
12. **3 stop losses in a day**: halt trading for the rest of that day on all assets.

---

## 12. Zone Engine (Attuale / Periferica / A+P)

This section governs market context, operational validity, RR target (1:4 vs 1:3), and the 75% waiting conditions.

### 12.1 Rule: Never Trade a Zone Formed Today

- Zones created during the current trading session are not tradeable.
- `TODO_UNSPECIFIED`: Precise boundary — "today" = current calendar day? The 08:15–16:30 window? Needs formal definition.

### 12.2 Only the Last 2 Breakouts

- "Only the last 2 breakouts are considered."
- Zone state is limited to the last two breakout events.

### 12.3 Zone Search Rules

**In continuation:**
- Look for **3 valid candles** opposite to the move, at the point where the previous high is broken.

**In reversal:**
- **1 valid candle** is sufficient where the break occurs.

**If a zone is mitigated at 70%:**
- 1 valid candle is sufficient (even in continuation).
- It becomes an **A+P zone**.

- `TODO_UNSPECIFIED`: Complete formal definition of a "valid candle" (long and short directions).

### 12.4 Zone Definitions

| Zone | Description |
|---|---|
| **Attuale (Current)** | The most recent active zone |
| **Periferica (Peripheral)** | The previous zone (when two zones exist) |
| **A+P (Attuale + Periferica)** | Special zone — formed when the current zone is mitigated at 70% |

### 12.5 Concordant vs Discordant Behavior

**If two zones are concordant (same direction):**
- If the current zone is broken → **wait for 75% mitigation of the peripheral zone before entering**.

**If two zones are discordant (opposite directions):**
- Price must reach **75% of the opposite peripheral zone** before operating in that direction.

**If two zones are discordant and price is already at 75% of the peripheral zone:**
- **Only take trades in the direction of the peripheral zone**.

- `TODO_UNSPECIFIED`: Mathematical formula for 70%/75% mitigation and definition of "75% opposite".

### 12.6 Zone Updates on Breakouts

**With discordant zones:**
- Breaking the current zone without peripheral mitigation → **only changes the current zone** (peripheral unchanged).

**With concordant zones:**
- Break in continuation → new current zone; old current becomes peripheral.

**Special case: concordant + continuation + 70% mitigation:**
- If break in continuation AND current zone is mitigated at 70%:
  - Generate a **new A+P zone** and **eliminate all previous zones**.
  - For A+P: 1 valid candle is sufficient (even in continuation).

---

## 13. RR and Zone Relationship

- Concordant zones → **RR 1:4**
- Discordant zones → **RR 1:3**

- `TODO_UNSPECIFIED`: Formal definition for deciding whether zones are concordant vs discordant.

---

## 14. Backtest / Asset Validation Policy

- After 1 year of backtesting, filters can be developed for individual assets.
- To validate an asset: 6 months of backtest required.
- **≥ 30 trades in 6 months** → asset is considered valid.
- Target: **90–130 trades/year across 6–7 assets**.
- From Dave: "approximately 3 trades/month to validate an asset" (consistent with ~30/6 months).

---

## 15. Non-Forex Tolerances (Excluded from Bot — For Reference Only)

These are **not** for the bot, but are in the materials:

| Asset | Liquidity | Engulfing | Imbalance |
|---|---|---|---|
| US30 (not in bot) | 35 | 35 | 50 |
| USOIL (TVC) | 4 | 4 | 3 |
| UK100 (Capital.com) | 5 | 4 | 3 |
| US500 (Capital.com) | 7 | 15 | 15 |
| US100 (Capital.com) | 35 | 30 | 30 |
| GER40 (Forex.com) | 25 | 20 | 25 |

Additional US30 notes (not for bot):
- Stop on trade: 25 tick spread
- Entry on trade: 50 ticks
- Avoid window: 15:15–15:45

---

## 16. Open TODOs / Remaining Ambiguities

**Status Update:** Items 1-5, 11-13 have been **AI-interpreted** based on slide analysis. Formulas are now documented in sections 9.1-9.7 above, marked with `TODO_DAVE_CONFIRM` for verification.

**Remaining unresolved (Zone Engine — deferred to later milestone):**

7. `TODO_UNSPECIFIED`: Complete definition of **"valid candle"** for zone construction (long and short).
8. `TODO_UNSPECIFIED`: Mathematical formula for **70% and 75% mitigation** on zones.
9. `TODO_UNSPECIFIED`: Formal definition of **concordant vs discordant zones**.
10. `TODO_UNSPECIFIED`: Formal definition of **"continuation breakout" vs reversal** in the zone engine.

**Resolved by AI analysis (pending Dave confirmation):**

1. ✅ **Engulfing formula** — See section 9.1 (body-to-close measurement)
2. ✅ **Acceptance formula** — See section 9.4 (entire body = both open and close beyond zone)
3. ✅ **Imbalance for SSA** — See section 9.3 (wick tip to Asia Low)
4. ✅ **Opposite imbalance** — See section 9.5 (push candle vs opposite Asia extreme)
5. ✅ **Dominance imbalance** — See section 9.6 (magnitude comparison: mainImb > oppImb)
6. ✅ **Opposite annulled by liquidity** — See section 9.7 (later candle leaves liquidity at lows with push)
11. ✅ **Long mirror rules** — Confirmed as simple inversion (High/Low swap, etc.)
12. ✅ **Mutazione SL** — Fixed (see section 10C: SL = high + 10 pips for short)
13. ✅ **Alternative asset rule** — See section 4.3 (filled position blocks new opens next day)

**Still ambiguous (not blocking M4):**

14. `TODO_AMBIGUITY`: **EUR trades in FTMO** — account base currency EUR or just P&L convention? Impacts only sizing/lot calculation.

---

## 17. Full Operational Flow

```
1. Calendar check:
   - First Friday / USD CPI / FOMC → global halt
   - Red news ±15 min → no entry

2. Time check: 08:15–16:30 (Europe/Rome)

3. Build Asia Range: 01:00–08:15 (high/low)

4. Identify zone context:
   - Attuale / Periferica / A+P
   - Last 2 breakouts
   - Concordant / discordant
   - 75% gating where applicable

5. Detect setup (short):
   - S1: body acceptance ≥ 0.6 + engulf ≥ 0.6 + no liquidity + no opposite imbalance
   - SSA: wick-only break ≥ 1.0 + engulf ≥ 0.6 + no liquidity + no opposite imbalance
   - Mutazione: only after S1/SSA + engulf ≥ 0.6 + no liquidity vs previous candle; ignore opposite imbalance

6. Place order:
   - S1/SSA: Fibonacci 50% − 5 pips, SL 10 pips above fib 100%
   - Mutazione: entry at low of push-up candle − 5 pips, SL 10 pips above its high

7. Order management:
   - If price reaches 1:2 without fill → cancel order

8. Trade management:
   - If price reaches 1:2 → move SL to Break Even
   - If candle leaves liquidity [0.0, 0.5] and price returns to entry → close manually
   - If red news approaches → exit 15 min before

9. End of session (16:30):
   - Cancel all unfilled pending orders

10. Friday 22:00:
    - Close all open positions
```
