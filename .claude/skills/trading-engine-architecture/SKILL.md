---
name: trading-engine-architecture
description: Overall system architecture for the FX trading engine. Covers the three components — MT5 EA (execution layer), NestJS backend (brain), and FXCM (backtest only) — plus the database structure, live execution flow, and why each responsibility is placed where it is.
---

# FX Trading Engine — System Architecture

## Core Principles

| Component | Role |
|---|---|
| **MT5 FTMO** | Source of truth for execution and live data |
| **FXCM** | Data source for historical backtest only |
| **NestJS** | Decisional brain |
| **EA (MQL5)** | Execution + safety layer |

> FXCM is **NOT** an execution venue. FTMO (MT5) is the only live execution environment.

---

## High-Level Architecture

```
┌─────────────────────────┐
│      FXCM API / CSV      │
│      (BACKTEST ONLY)     │
└────────────┬────────────┘
             │
             ▼
      Backtest Engine
             │
             ▼
    PostgreSQL (historical)


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
          PostgreSQL (live)
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

## Component 3 — FXCM (Backtest Only)

Not used for live trading. Used for:
- Downloading M15 historical data
- Calibrating tolerances
- Validating assets (6-month backtest, 30-trade minimum)
- Statistical studies

**Flow:** FXCM data → Backtest Engine (NestJS) → Postgres (historical dataset)

**Does NOT generate live signals.**

---

## Database Structure

### Core Tables

| Table | Description |
|---|---|
| `BarM15` | All OHLC candles |
| `AsiaRange` | Daily Asia session high/low |
| `Zone` | Zone definitions |
| `ZoneState` | Current zone engine state per symbol |
| `Signal` | All signals with metrics and reason codes |
| `TradePlan` | Approved trade proposals |
| `EaCommand` | Command outbox |
| `Position` | Live position state |
| `DailyState` | Daily counters and halt flags |
| `EconomicEvent` | News calendar |
| `AuditEvent` | Append-only full audit log |

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

## Architecture Rationale

| What | Where | Why |
|---|---|---|
| Order execution | EA | Reduces execution risk |
| Hard safety rules | EA | Works even if backend crashes |
| Complex strategy logic | NestJS | Testable, versionable |
| News integration | NestJS | Requires external APIs |
| Zone engine | NestJS | Complex stateful logic |
| SL → BE at 1:2 | Backend decides, EA executes | Control + safety separation |
| Full audit log | NestJS | Monitoring and debugging |
