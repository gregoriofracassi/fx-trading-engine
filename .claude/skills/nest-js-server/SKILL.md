---
name: nest-js-server
description: NestJS backend (brain) specification for the FX trading engine. Covers 8 subsystems — API Ingestion, Data Store, News Service, State Machines (Asia/Zone/Daily), Strategy Engine (S1/SSA/Mutazione), Risk Manager, Command Outbox, Audit & Reconciliation — plus end-to-end flows and module structure.
---

# NestJS Backend — Brain Specification

## Core Principle

- **NestJS decides** (strategy + news + risk + commands)
- **EA executes** (orders + safety + events)

The backend must be able to **reconstruct everything from DB alone** — bars, events, signals, commands, positions.

---

## 0. Mental Model — 8 Subsystems

1. API Ingestion (EA → Backend)
2. Data Store (bars/orders/positions/events) + Normalization
3. News Service (provider + gating)
4. State Machines (Asia + Zone Engine + Daily State)
5. Strategy Engine (S1/SSA/Mutazione: valid/invalid + metrics)
6. Risk Manager (policy + FTMO constraints + orchestration)
7. Command Outbox (reliable queue for EA)
8. Audit + Monitoring + Replay/Backtest

---

## 1. API Ingestion (EA → NestJS)

### 1.1 POST /ea/events

The entry point for all live data.

**Events received:**
- `BAR_M15_CLOSED`
- `ORDER_PLACED`
- `ORDER_FILLED`
- `POSITION_OPENED`
- `POSITION_CLOSED`
- `SL_HIT`
- `TP_HIT`
- `ACCOUNT_SNAPSHOT`
- `HEARTBEAT`

**Always on receipt:**
1. Authenticate (API key / HMAC)
2. Validate schema (Zod or class-validator)
3. Idempotency check: every event must have an `eventId` or `(terminalId + sequenceNumber)`. If already seen → return 200 (ignore).
4. Persist raw event to `AuditEvent` (append-only table)
5. Internal dispatch (pub/sub or service call):
   - `BAR_*` → MarketData pipeline
   - Trade events → Order/Position pipeline
   - `ACCOUNT_SNAPSHOT` → Reconciliation pipeline

> **Principle: never lose events. Persist first, then process.**

### 1.2 GET /ea/commands?terminalId=...

EA polls this endpoint.

- Returns list of `EaCommand` records where `terminalId` matches and `status = PENDING`
- Limit results (e.g. max 5 at a time)

**Recommended status flow:**
- `PENDING` → `DELIVERED` (when EA downloads) → `ACKED` (on success) or `FAILED`
- Simpler alternative: stay `PENDING` until ACK arrives

### 1.3 POST /ea/ack

EA confirms command execution.

Actions:
1. Validate payload
2. Update `EaCommand.status`:
   - SUCCESS → `ACKED`
   - FAIL → `FAILED` (with error details)
3. Write `COMMAND_ACK` to AuditEvent
4. Optional: if transient failure (requote, off quotes) → retry policy server-side

---

## 2. Data Store + Normalization (Postgres / Prisma)

This layer makes everything replayable.

### Minimum Tables (Live)

| Table | Purpose |
|---|---|
| `BarM15` | OHLC candles from EA |
| `EconomicEvent` | News calendar events |
| `AsiaRange` | Daily high/low per symbol for Asia session |
| `Zone`, `ZoneState` | Zone engine state |
| `Signal` | All signals (valid and invalid) with metrics |
| `TradePlan` | Approved trade proposals |
| `EaCommand` | Command outbox |
| `Order`, `Position` | Live order/position state |
| `DailyState` | Per-day counters and halt flags |
| `AuditEvent` | Append-only event log (everything) |

### Bar Normalization

On each `BAR_M15_CLOSED` event:
- Normalize: symbol, `timeOpen`, `timeClose`, prices as double, `spreadPoints`
- Upsert into `BarM15` with unique constraint on `(symbol, timeOpen)`

> `timeOpen` is the natural key in MT5. Pick one and never change it.

---

## 3. News Service

A separate module responsible for economic calendar gating.

### Responsibilities

Provide deterministic gating functions:
1. `isAllDayBlackout(date)` → USD CPI / FOMC
2. `isFirstFriday(date)` → NFP day
3. `isRedNewsWindow(now, currencies, ±15min)` → 3-star news proximity
4. `mustExitBeforeNews(position, now, 15min)` → force-exit logic

### News Ingestion (Scheduled Job)

- Once per day: fetch next 7 days of events
- Refresh every X minutes for "today"
- Recommended source: **TradingEconomics API**

**Persist per event:**
- `timeUtc`
- `currency`
- `impact` (red / 3-star)
- `title`
- `allDayFlag` (true for CPI USD, FOMC)
- `provider`

The `NewsService` output is consumed by `RiskModule` and `ManagePositions`.

---

## 4. State Machines: Asia + Zone + DailyState

This is the "context" the strategy requires.

### 4.1 DailyStateMachine

Maintains global daily state:
- `date`
- `slCountGlobal`
- `haltedForDay` (boolean)
- Future: max daily loss (FTMO), max drawdown, etc.

**Updates:**
- On `SL_HIT` event → increment `slCount`
- If `slCount >= 3` → set `haltedForDay = true`, optionally generate cancel commands

> The EA also has its own local fail-safe. The backend enforces this on the decision side too.

### 4.2 AsiaSessionState

On each closed bar:
- If `barTime` is within [01:00, 08:15) → update running `max(high)` / `min(low)`
- When time passes 08:15 → **finalize** `AsiaRange(symbol, date, high, low)`

### 4.3 Zone Engine State (per symbol)

Maintains:
- Current zone
- Peripheral zone
- A+P zone
- Last two breakouts
- 70%/75% mitigation tracking
- Concordant/discordant gating flags

**When updated:** On each M15 bar close (at minimum whenever breakouts/rottures are detected).

**Output:** `ZoneContext` for the Strategy Engine:
- Relationship type (concordant / discordant / none)
- `rrTarget` (3 or 4)
- Gating flags (e.g. "wait for 75% peripheral")

---

## 5. Strategy Engine (S1 / SSA / Mutazione)

### Input:
- Last N bars
- `AsiaRange` for the day
- `ZoneContext`

### Output:
- `SignalValid` or `SignalInvalid` with metrics and reason codes

### Philosophy

The strategy logic must be **explainable, not opaque**. For every check, save:
- Calculated metrics
- Thresholds used
- Invalidation reasons

### Signal Output Format

Always write a `Signal` record, even for invalid signals:

```json
{
  "kind": "S1",
  "valid": false,
  "reasons": ["S1_FAIL_LIQUIDITY_PRESENT", "S1_FAIL_ACCEPTANCE_LT_MIN"],
  "metrics": {
    "acceptance": 0.5,
    "liquidity": 0.3,
    "engulfing": 0.8,
    "oppositeImbalance": 0.0
  }
}
```

This lets you answer: **"Why didn't it trade today?"**

### Processing Sequence on Bar Close

1. Determine direction candidate (based on Asia high/low break)
2. Calculate pattern windows (relevant candles)
3. Calculate metrics
4. Validate:
   - Engulfing ≥ 0.6
   - Liquidity NOT in [0, 0.5]
   - Acceptance ≥ 0.6 (S1 only)
   - Wick-only break (SSA only)
   - Opposite imbalance absent (S1/SSA); ignored for Mutazione
5. Produce raw trade plan (entry/SL/TP) as a proposal

---

## 6. Risk Manager (Policy Orchestrator)

The final gate before issuing commands.

### Input:
- Valid signal
- Proposed trade plan
- `DailyState`
- Current positions/orders (from DB, updated by EA events)
- `NewsService` gating results
- Trading hours (08:15–16:30, first Friday, etc.)
- Zone gating (75% rules)

### Processing

**Step A — Hard rules (non-negotiable rejections):**
- `haltedForDay` = true → reject
- Outside trading hours → reject
- First Friday → reject
- All-day news blackout (CPI/FOMC) → reject
- Red news ±15 min → reject
- Open position already exists on symbol → reject

**Step B — Strategy context rules:**
- Cancel-if-reached-1:2-without-fill (pending order management)
- RR target 1:3 or 1:4 (from zone context)
- 16:30: no new pending (or generate cancel command)
- Friday 22:00: close all (generate close commands)

**Step C — If approved:**
Create command(s) in outbox:
- `PLACE_PENDING` or `PLACE_MARKET`
- `CANCEL_ORDER`
- `MODIFY_SL_TO_BE`
- `CLOSE_POSITION`

Save `TradePlan` with link to `SignalId`.

---

## 7. Command Outbox (EaCommand) — Reliability and Control

### Why an Outbox?

To prevent:
- Deciding, then crashing before sending
- Duplicate commands
- Loss of traceability ("who requested what")

### How It Works

- Each command is a DB record
- Has a unique `commandId` + `dedupeKey`

**Example dedupeKey:** `terminalId + symbol + signalId + actionType`

This prevents two `PLACE_ORDER` commands from the same signal.

### Command States

| State | Description |
|---|---|
| `PENDING` | Created, not yet seen by EA |
| `DELIVERED` | EA downloaded it (optional) |
| `ACKED` | EA executed and confirmed |
| `FAILED` | EA reported failure |

---

## 8. Audit + Monitoring + Reconciliation

### 8.1 AuditEvent (Append-Only)

Write a record for **every meaningful event**:
- Received event (bar, trade event)
- Signal generated (valid or invalid)
- Risk approval or rejection
- Command created
- ACK received

This enables: replay, debugging, reporting.

### 8.2 Reconciliation

Every X minutes:
- Receive (push) or request (pull) an `ACCOUNT_SNAPSHOT` from EA
- Compare DB state vs. reality:
  - "Thought it was pending but it's already filled"
  - "Thought position was open but it's already closed"
- On mismatch:
  - Update state
  - Log warning
  - Optionally emit a corrective command (e.g. cancel residuals)

---

## 9. End-to-End Flows

### Flow 1: Bar Close → Decision → Order

```
1. EA sends BAR_M15_CLOSED
2. Backend saves bar + audit
3. AsiaSessionModule updates range
4. ZoneEngine updates zone state
5. StrategyEngine produces signals (valid/invalid)
6. RiskManager decides:
   → reject (audit)
   → approve → creates EaCommand PLACE_PENDING
7. EA downloads command, executes, sends ACK + ORDER_PLACED
8. Backend updates Order + audit
```

### Flow 2: Fill → Move SL to Break Even at RR 1:2

```
9.  EA sends ORDER_FILLED / POSITION_OPENED
10. Backend updates Position
11. On subsequent bars:
    → Backend calculates RR progress
    → If RR 1:2 reached → create MODIFY_SL_TO_BE command
12. EA executes modify, sends ACK
13. Backend saves + audit
```

### Flow 3: SL Hit → Halt Trading

```
14. EA sends SL_HIT
15. Backend increments DailyState.slCount
16. If slCount >= 3:
    → set haltedForDay = true
    → optionally create CANCEL_ALL_PENDING commands
17. EA still has local fail-safe as backup
```

---

## 10. NestJS Module Structure

```
EaGatewayModule
  └── controllers: /ea/events  /ea/commands  /ea/ack

MarketDataModule
  └── Bar service + repository

NewsModule
  └── Provider + rules engine

AsiaModule
  └── Asia range calculator

ZonesModule
  └── Zone state machine

StrategyModule
  └── S1 / SSA / Mutazione detectors

RiskModule
  └── Decisioning + policies

ExecutionModule
  └── Command outbox + dedupe + ack handler

AuditModule
  └── Append-only event log

ReconciliationModule
  └── Snapshot compare + state healing
```

---

## 11. Two Golden Rules to Avoid Major Bugs

1. **The backend must NOT assume an order is placed until it receives the event from the EA** (`ORDER_PLACED` / `ACK`).
2. **The backend must be able to reconstruct the entire state from DB alone:** bars, events, signals, commands, positions.
