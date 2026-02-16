---
name: nest-js-server
description: NestJS backend (brain) specification for the FX trading engine. Covers 9 subsystems — API Ingestion, Data Store, News Service, State Machines (Asia/Zone/Daily), Strategy Engine (S1/SSA/Mutazione), Risk Manager, Command Outbox, Audit & Reconciliation, and Backtest Engine — plus end-to-end flows and module structure.
---

# NestJS Backend — Brain Specification

## Core Principle

- **NestJS decides** (strategy + news + risk + commands)
- **EA executes** (orders + safety + events)

The backend must be able to **reconstruct everything from DB alone** — bars, events, signals, commands, positions.

---

## 0. Mental Model — 9 Subsystems

1. API Ingestion (EA → Backend)
2. Data Store (bars/orders/positions/events) + Normalization
3. News Service (provider + gating)
4. State Machines (Asia + Zone Engine + Daily State)
5. Strategy Engine (S1/SSA/Mutazione: valid/invalid + metrics)
6. Risk Manager (policy + FTMO constraints + orchestration)
7. Command Outbox (reliable queue for EA)
8. Audit + Monitoring + Reconciliation
9. Backtest Engine (on-demand asset validation + strategy replay)

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

| Table               | Purpose                                                                                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BarM15`            | OHLC candles. Shared by live and backtest. `source` column: `FTMO_LIVE` (from EA) or `HISTORICAL` (fetched for backtest). Unique key: `(symbol, timeOpen)`. |
| `EconomicEvent`     | News calendar events                                                                                                                                        |
| `AsiaRange`         | Daily high/low per symbol for Asia session                                                                                                                  |
| `Zone`, `ZoneState` | Zone engine state                                                                                                                                           |
| `Signal`            | All signals (valid and invalid) with metrics                                                                                                                |
| `TradePlan`         | Approved trade proposals                                                                                                                                    |
| `EaCommand`         | Command outbox                                                                                                                                              |
| `Order`, `Position` | Live order/position state                                                                                                                                   |
| `DailyState`        | Per-day counters and halt flags                                                                                                                             |
| `AuditEvent`        | Append-only event log (everything)                                                                                                                          |
| `BacktestRun`       | One record per backtest run: symbol, date range, params, status, summary stats                                                                              |
| `BacktestSignal`    | One record per signal produced during a backtest run: setup kind, valid/invalid, metrics, simulated outcome                                                 |

### Bar Normalization

On each `BAR_M15_CLOSED` event:

- Normalize: symbol, `timeOpen`, `timeClose`, prices as double, `spreadPoints`
- Upsert into `BarM15` with `source = 'FTMO_LIVE'`, unique constraint on `(symbol, timeOpen)`

> `timeOpen` is the natural key in MT5. Pick one and never change it.
>
> Historical candles fetched for backtesting use the same table and same upsert logic with `source = 'HISTORICAL'`. The unique constraint prevents duplication regardless of source.

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

| State       | Description                 |
| ----------- | --------------------------- |
| `PENDING`   | Created, not yet seen by EA |
| `DELIVERED` | EA downloaded it (optional) |
| `ACKED`     | EA executed and confirmed   |
| `FAILED`    | EA reported failure         |

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

## 9. Backtest Engine

### Purpose

On-demand asset validation and strategy replay. Triggered manually. Never runs automatically. Never issues real commands to the EA.

Three use cases:

- **Asset validation** — before enabling a symbol for live trading, confirm ≥30 valid signals over 6 months of historical M15 data.
- **Strategy verification** — after going live, confirm live signal frequency and quality is consistent with backtest expectations.
- **Parameter calibration** — test threshold changes before applying them to live.

### API

```
POST /backtest/run
  Body: { symbol, fromDate, toDate, params? }
  Returns: { runId, status: 'queued' }

GET /backtest/runs/:runId
  Returns: { status, tradeCount, winRate, avgRR, signals[] }

GET /backtest/runs
  Returns: list of all past runs with summary stats
```

### How it works

Backtests run as BullMQ background jobs so they never block the NestJS event loop. A 6-month M15 backtest processes ~11,000 candles and may take 5–30 seconds.

```
POST /backtest/run
        │
        ▼
BacktestController → enqueues BullMQ job → returns { runId }
        │
        ▼ (background worker)
BacktestProcessor:
  1. Query BarM15 for symbol + date range
  2. If candle gaps exist → fetch from historical data API → upsert into BarM15 (source = HISTORICAL)
  3. Replay candles one by one, chronologically:
     a. AsiaSessionService.onBar(candle)        ← same service as live
     b. ZoneEngineService.onBar(candle)         ← same service as live
     c. StrategyService.evaluate(...)           ← same service as live
     d. SimulatedRiskService.gate(signal, ...)  ← backtest-only: no real positions/commands
     e. Record BacktestSignal (valid/invalid, entry/SL/TP, simulated outcome)
  4. Save BacktestRun summary to DB
```

### The single-codebase principle

`AsiaSessionService`, `ZoneEngineService`, and `StrategyService` are **the same injectable classes** used during live trading. The `BacktestProcessor` injects them directly. There is no separate strategy implementation for backtest.

What changes in backtest mode:

- Data input: DB cursor over `BarM15` rows, not live EA HTTP events
- Time: driven by bar timestamps, never `Date.now()`
- Order execution: `SimulatedFillService` fills at next bar's open — no real MT5 commands
- State: isolated `SimulatedStateService` tracks simulated positions per run — never touches live `Position`/`Order` tables

### No-lookahead rule

The replay cursor must expose exactly one new closed bar per step. Strategy services must never query `BarM15` for rows with `timeOpen > currentBarTime` during a replay. The processor enforces this by passing only the current bar (and pre-fetched prior context) into the service calls.

### Historical data fetching

When the requested date range is not fully covered in `BarM15`, the `HistoricalDataService` fetches the missing candles from the configured external provider (FXCM API, dukascopy-node, or other — provider is injected and swappable). Fetched candles are stored in `BarM15` with `source = 'HISTORICAL'` and reused in future backtest runs for the same symbol/range.

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
  └── (services are reused by BacktestModule)

RiskModule
  └── Decisioning + policies

ExecutionModule
  └── Command outbox + dedupe + ack handler

AuditModule
  └── Append-only event log

ReconciliationModule
  └── Snapshot compare + state healing

BacktestModule
  └── BacktestController        (POST /backtest/run, GET /backtest/runs)
  └── BacktestQueue             (BullMQ job queue — uses existing Redis)
  └── BacktestProcessor         (background worker, drives the replay loop)
  └── HistoricalDataService     (fetches missing candles from external API, upserts BarM15)
  └── SimulatedFillService      (simulates order fills at next bar open)
  └── SimulatedStateService     (isolated position/order state per backtest run)
  └── BacktestRunRepository     (persists BacktestRun + BacktestSignal records)
```

---

## 11. Two Golden Rules to Avoid Major Bugs

1. **The backend must NOT assume an order is placed until it receives the event from the EA** (`ORDER_PLACED` / `ACK`).
2. **The backend must be able to reconstruct the entire state from DB alone:** bars, events, signals, commands, positions.
