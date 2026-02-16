---
name: trading-engine-architecture
description: Overall system architecture for the FX trading engine. Covers the three components — MT5 EA (execution layer), NestJS backend (brain), and historical data (backtest only) — plus the database structure, live execution flow, backtest architecture, and why each responsibility is placed where it is.
---

# FX Trading Engine — System Architecture

## Core Principles

| Component               | Role                                                                     |
| ----------------------- | ------------------------------------------------------------------------ |
| **MT5 FTMO**            | Source of truth for execution and live data                              |
| **Historical data API** | Data source for backtesting only (provider TBD — FXCM API or equivalent) |
| **NestJS**              | Decisional brain                                                         |
| **EA (MQL5)**           | Execution + safety layer                                                 |

> The historical data API is **NOT** an execution venue. FTMO (MT5) is the only live execution environment.
>
> **Important**: The EA sends FTMO candles (from FTMO's own liquidity providers). The historical data provider for backtesting will be a separate API. These are different price feeds. The strategy was originally calibrated on FXCM data, but long-term the live-accumulated `BarM15` data from FTMO is the most consistent source for backtesting. The backtest data provider decision is deferred — the architecture accommodates any candle source.

---

## High-Level Architecture

```
┌──────────────────────────────┐
│   Historical Data API        │
│   (BACKTEST ONLY — TBD)      │
│   e.g. FXCM API / dukascopy  │
└─────────────┬────────────────┘
              │ on-demand fetch
              ▼
    NestJS BacktestModule
    (stores in BarM15 with source tag,
     replays through same strategy services)
              │
              ▼
       PostgreSQL (shared DB)
         BarM15 table
         BacktestRun table
         BacktestSignal table


─────────────────────────────────────────────────────

         FTMO MT5 SERVER  (LIVE EXECUTION)
                    │
                    ▼
           MT5 Terminal (VPS)
                    │
                    ▼
            EA (Execution Layer)
                    │  HTTP
                    ▼
         NestJS Backend (Brain)
                    │
                    ▼
          PostgreSQL (shared DB)
            BarM15 table (source = FTMO_LIVE)
            + all live tables
```

---

## Component 1 — MT5 EA (Execution Layer)

### Responsibility 1: Market Data Capture (Live)

On each M15 bar close, the EA extracts and sends to the backend:

- `open`, `high`, `low`, `close`
- `spread`
- `timestamp` (timeOpen and timeClose)

**This is the official live feed for signals.**

### Responsibility 2: Order Execution

- Place pending order
- Place market order
- Modify SL/TP
- Cancel order
- Close position

Uses: `CTrade` class, `OrderSend`, `OnTradeTransaction`.

### Responsibility 3: Local Fail-Safes (CRITICAL)

These run **independently of the backend**. They protect the account even if the backend is down:

- Max 1 open position per symbol
- 3 SL hits per day → block new entries
- 16:30 → cancel all pending orders
- Friday 22:00 → close all positions
- Backend unreachable → no new actions (no new orders)

### Responsibility 4: Event Emission

The EA sends events to the backend for every meaningful trade action:

```json
{
  "type": "POSITION_OPENED",
  "symbol": "EURUSD",
  "ticket": 123456,
  "entry": 1.0832,
  "sl": 1.0842,
  "tp": 1.0792
}
```

**Event types:**

- `BAR_CLOSED`
- `ORDER_PLACED`
- `ORDER_FILLED`
- `ORDER_CANCELLED`
- `SL_HIT`
- `TP_HIT`
- `POSITION_CLOSED`
- `HEARTBEAT`

### Responsibility 5: Command Polling

Every 1–2 seconds:

```
GET /ea/commands?terminalId=FTMO_01
```

Backend responds with pending commands. EA executes and sends ACK.

---

## Component 2 — NestJS Backend (Brain)

### MarketDataModule

- Receives `BAR_CLOSED` events
- Saves to `BarM15` table: `symbol`, `timeClose` (unique), `o/h/l/c`, `spread`, `source = "FTMO"`
- Emits internal `BarClosedEvent`

### AsiaSessionModule

- Calculates Asia range: **01:00–08:15**
- Saves `AsiaRange(symbol, date, high, low)`

### ZoneEngineModule

Manages zone state per symbol:

- Current zone (Attuale)
- Peripheral zone (Periferica)
- A+P zone
- Last 2 breakouts
- 70% mitigation tracking
- 75% gating rules
- Concordant/discordant classification

Saves to `ZoneState`:

- `symbol`
- `currentZoneId`
- `peripheralZoneId`
- `aPlusPZoneId`
- `lastTwoBreakouts`

### StrategyModule

**Input:** Last N candles + Asia range + Zone context

**Calculates:**

- Engulfing ≥ 0.6
- Liquidity (high-to-high distance [0.0, 0.5])
- Imbalance ≥ 1.0
- Acceptance ≥ 0.6
- Opposite imbalance
- Dominance

**Evaluates setups:** S1, SSA, Mutazione

**Produces:**

```json
{
  "type": "S1",
  "valid": true,
  "reasonCodes": [],
  "metrics": { "acceptance": 0.7, "engulfing": 0.8, "liquidity": 0.6 }
}
```

### RiskModule

**Validates against:**

- 3 SL/day global cap
- 1 open position per asset
- First Friday rule
- News blackout (all-day and ±15 min)
- Trading hours (08:15–16:30)
- 75% zone gating constraints
- "Alternative asset next day" rule

**If approved:** creates `TradePlan`

### ExecutionCommandModule

If Risk approves, creates:

```
EaCommand {
  commandId
  type
  payload
  status = PENDING
}
```

EA downloads and executes.

### NewsModule

**Recommended source:** TradingEconomics API

Saves to `EconomicEvent`:

- `time`
- `currency`
- `impact`
- `title`
- `allDayFlag`

**Exposes:**

- `isBlackoutNow(symbol)`
- `mustExitBeforeNews(position)`

### AuditModule

Records **everything** as append-only events:

- All bars
- All signals (valid and invalid)
- All risk decisions (approved and rejected)
- All orders and fills
- SL count per day

**This is vital for debugging, replay, and reporting.**

---

## Component 3 — Historical Data Provider (Backtest Only)

Not used for live trading. Used exclusively to seed historical M15 candles for backtesting.

**Provider:** TBD. Candidates:

- **FXCM REST API** — closest to the strategy's original calibration data source. Requires a free demo account. M15 history limited to ~212 days via live API. Socket.io transport, no maintained Node.js SDK.
- **dukascopy-node** — free npm package, no account required, M15 supported, data back to early 2000s, actively maintained. Different price feed from FXCM/FTMO.
- **Own accumulated live data** — once enough `BarM15` rows exist from the EA (6+ months), this is the most consistent source since it matches the execution venue exactly. Preferred long-term.

**Does NOT generate live signals. Never used for execution decisions.**

**Flow:** Historical API → `BacktestModule` fetches on demand → stores in `BarM15` with `source` tag → `BacktestModule` replays through strategy services.

---

## Component 4 — BacktestModule (NestJS)

This is a NestJS module inside the backend, not a separate process.

### Purpose

- **Asset validation**: before going live on a symbol, run the strategy over 6 months of historical M15 data and verify ≥30 valid signals are produced. This is the minimum bar for an asset to be considered tradeable.
- **Strategy verification**: after going live, periodically re-run the backtest to confirm live results are consistent with historical expectations.
- **Parameter calibration**: experiment with threshold changes (e.g. acceptance 0.6 → 0.7) and see the effect on signal count and simulated outcomes before applying to live.

### When it runs

**On-demand only.** Triggered manually via `POST /backtest/run`. Not a continuous or scheduled process. A backtest is something you do deliberately before enabling a new asset or after changing strategy parameters.

### How it works

```
POST /backtest/run
  { symbol, fromDate, toDate, params? }
        │
        ▼
  BacktestController → enqueues BullMQ job → returns { runId }
        │
        ▼  (background worker, non-blocking)
  BacktestProcessor:
    1. Check if BarM15 rows already exist for symbol + range
    2. If gaps exist → fetch from historical data API → store in BarM15 (source = historical)
    3. Walk candles one by one in time order (cursor replay)
    4. Feed each candle through the same services used in live:
       AsiaSessionService → ZoneEngineService → StrategyService
    5. Risk rules applied with simulated state (no real positions/orders)
    6. For each signal: record valid/invalid, entry/SL/TP, simulated outcome
    7. Save BacktestRun + BacktestSignal[] to DB
        │
        ▼
  GET /backtest/runs/:runId → returns result, signal log, trade count, win rate
```

### The single-codebase principle

The strategy services (Asia range calculation, zone engine, S1/SSA/Mutazione detectors) are **the same injectable services** used in live trading. The backtest processor injects them directly. There is no separate "backtest strategy implementation." This means:

- A bug fixed in the live strategy is automatically fixed in backtest
- A strategy change tested in backtest is exactly what will run live
- Results are trustworthy because there is no code divergence

The only difference in backtest mode:

- Data comes from the DB cursor (historical candles), not from EA HTTP events
- Order "execution" is simulated: filled at next bar's open price
- Time is driven by bar timestamps, never by wall clock
- There are no real positions, no real commands issued to the EA

### Key rule: no lookahead

The backtest cursor must never give the strategy access to a candle that hasn't "happened yet" in the replay. Each step of the cursor exposes exactly one new closed bar — identical to how the live system receives one bar at a time from the EA.

---

## Database Structure

### Core Tables

| Table            | Description                                                                                                                                                           |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BarM15`         | All OHLC candles — live and historical. `source` column distinguishes `FTMO_LIVE` (from EA) vs `HISTORICAL` (fetched for backtest). Unique key: `(symbol, timeOpen)`. |
| `AsiaRange`      | Daily Asia session high/low                                                                                                                                           |
| `Zone`           | Zone definitions                                                                                                                                                      |
| `ZoneState`      | Current zone engine state per symbol                                                                                                                                  |
| `Signal`         | All signals with metrics and reason codes                                                                                                                             |
| `TradePlan`      | Approved trade proposals                                                                                                                                              |
| `EaCommand`      | Command outbox                                                                                                                                                        |
| `Position`       | Live position state                                                                                                                                                   |
| `DailyState`     | Daily counters and halt flags                                                                                                                                         |
| `EconomicEvent`  | News calendar                                                                                                                                                         |
| `AuditEvent`     | Append-only full audit log                                                                                                                                            |
| `BacktestRun`    | One record per backtest run: symbol, date range, params, status, summary stats                                                                                        |
| `BacktestSignal` | One record per signal produced in a backtest run: setup kind, valid/invalid, metrics, simulated outcome                                                               |

---

## Live Execution Flow (Complete)

```
1.  M15 candle closes
2.  EA → backend: BAR_CLOSED
3.  Backend:
    ├── Updates Asia range
    ├── Updates zone state
    ├── Calculates signals (S1/SSA/Mutazione)
    ├── Applies news gating
    └── Applies risk gating
4.  If approved → create EaCommand
5.  EA:
    ├── Downloads command
    ├── Places order
    └── Sends ORDER_PLACED event
6.  On fill:
    └── EA sends POSITION_OPENED
7.  Backend updates Position state
8.  On RR 1:2 reached:
    └── Backend creates MODIFY_SL_BE command
9.  EA executes SL modification
10. On SL or TP hit:
    ├── EA sends SL_HIT / TP_HIT
    └── Backend updates slCountGlobal
```

---

## Backtest Flow

```
1.  POST /backtest/run { symbol: 'EURUSD', from: '2025-01-01', to: '2025-07-01' }
2.  BacktestController enqueues BullMQ job → returns { runId, status: 'queued' }
3.  BacktestProcessor picks up job:
    ├── Query BarM15 for symbol + date range
    ├── If gaps → fetch missing candles from historical API → upsert into BarM15
    └── Replay loop (candle by candle, chronological):
        ├── AsiaSessionService.onBar(candle)
        ├── ZoneEngineService.onBar(candle)
        ├── StrategyService.evaluate(candle, asiaRange, zoneContext)
        ├── SimulatedRiskService.gate(signal, simulatedState)
        └── If valid → simulate fill, track simulated position, record BacktestSignal
4.  Save BacktestRun (summary: tradeCount, winRate, avgRR, etc.)
5.  GET /backtest/runs/:runId → full result + signal log
```

---

## Architecture Rationale

| What                   | Where                              | Why                                                                        |
| ---------------------- | ---------------------------------- | -------------------------------------------------------------------------- |
| Order execution        | EA                                 | Reduces execution risk                                                     |
| Hard safety rules      | EA                                 | Works even if backend crashes                                              |
| Complex strategy logic | NestJS                             | Testable, versionable                                                      |
| News integration       | NestJS                             | Requires external APIs                                                     |
| Zone engine            | NestJS                             | Complex stateful logic                                                     |
| SL → BE at 1:2         | Backend decides, EA executes       | Control + safety separation                                                |
| Full audit log         | NestJS                             | Monitoring and debugging                                                   |
| Backtest engine        | NestJS BacktestModule              | Reuses live strategy services — single codebase, no divergence             |
| Historical candles     | Same `BarM15` table, `source` flag | Live and historical candles are the same data shape; no schema duplication |
| Backtest trigger       | On-demand HTTP only                | Asset validation is a deliberate manual action, not a continuous process   |
