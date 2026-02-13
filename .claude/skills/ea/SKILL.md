---
name: ea
description: MT5 Expert Advisor (EA) specification. Covers the thin but serious execution layer: Bootstrap, Market Data Capture, HTTP Client, Execution Engine, Safety Layer, State & Persistence, Trade Events, Reconciliation, and implementation checklist.
---

# MT5 Expert Advisor (EA) — Execution Layer Specification

## Core Principle

**EA = Execution + Safety + Telemetry.** All strategic logic lives in the NestJS backend. The EA is a disciplined executor, not a decision-maker.

---

## 0. Mental Model — 6 Subsystems

1. Bootstrap & Config
2. Market Data Capture (M15 bar close + snapshot)
3. HTTP Client (Events out + Commands in)
4. Execution Engine (place/modify/cancel/close)
5. Safety Layer (local fail-safes, kill-switch, limits)
6. State & Persistence (idempotency, last bar, daily counters, reconciliation)

---

## 1. Bootstrap & Config

### OnInit()

On EA start, read config from hardcoded values or input parameters:

- `terminalId` (e.g. `FTMO_01`)
- `backendBaseUrl` (e.g. `https://your-api.com`)
- `apiKey` (or token)
- `symbols[]` (if EA runs on multiple charts or one chart per symbol)
- `pollIntervalMs` (e.g. 1000–2000ms)
- `heartbeatIntervalMs` (e.g. 30s)
- `timezoneHandling` (use MT5 server time as truth)

Setup timer: `EventSetTimer(1)` (tick every 1s, or more frequent if needed).

Initialize in-memory state:
- `lastClosedM15Time`
- `lastCommandPollTime`
- `dailyState` (slCount, halted flag, tradingDay date)

Load persisted state:
- Last processed bar time
- List of `executedCommandIds`
- Counters (slCount)
- Last daily reset timestamp

**Goal:** if MT5/VPS restarts, the EA resumes without causing damage.

### OnDeinit()

On EA shutdown:
- Flush state to file (command IDs, last bar, counters)
- Send `EA_STOPPED` event (if connection is available)

---

## 2. Market Data Capture (M15 Candles)

This is the live source-of-truth feed.

### "When is an M15 candle closed?"

Classic mistake: calculating on a still-open candle.

**Robust method** (run every cycle via `OnTimer` / `OnTick`):

```mql5
CopyRates(symbol, PERIOD_M15, 0, 2, rates)
// rates[0] = current (open) candle
// rates[1] = just-closed candle
```

In MQL5, `MqlRates.time` is the **open time** of the bar. So the payload includes:
- `timeOpen = rates[1].time`
- `timeClose = rates[1].time + 15 minutes`

### Dedupe — Send Each Bar Only Once

- If `rates[1].time == lastClosedM15Time` → skip
- If greater → new closed candle → process and update `lastClosedM15Time`

### Payload per Closed Candle

```json
{
  "type": "BAR_M15_CLOSED",
  "terminalId": "FTMO_01",
  "symbol": "EURUSD",
  "timeOpen": "2026-02-13T10:00:00Z",
  "timeClose": "2026-02-13T10:15:00Z",
  "o": 1.08345,
  "h": 1.08390,
  "l": 1.08310,
  "c": 1.08320,
  "spreadPoints": 12,
  "tickVolume": 1234
}
```

### Candles 23:00–00:00

These are filtered by the strategy, but the EA should **always send them** and let the backend filter. This preserves full audit/replay capability. The EA is a dumb collector.

---

## 3. HTTP Client — Events Out + Commands In

### 3.1 Events OUT (push)

**Endpoint:** `POST /ea/events`

Payload: single event or batch JSON.

Always include:
- `terminalId`
- `sequenceNumber` (local incrementing counter, helps ordering)
- `sentAt`

**Retry policy:**
- On failure → queue locally (in-memory, optionally persisted to file)
- Retry with backoff: 1s → 2s → 5s → 10s → max 60s
- Never block trade execution; signal "backend down" to Safety Layer

### 3.2 Commands IN (pull / polling)

**Endpoint:** `GET /ea/commands?terminalId=FTMO_01`

Returns list of pending commands.

**Example command:**
```json
{
  "commandId": "cmd_2026-02-13_00123",
  "type": "PLACE_PENDING",
  "symbol": "EURUSD",
  "payload": {
    "side": "SELL",
    "entry": 1.08320,
    "sl": 1.08410,
    "tp": 1.08050,
    "volume": 0.30,
    "expiry": "2026-02-13T16:30:00Z",
    "clientOrderKey": "sig_S1_2026-02-13T10:15_EURUSD"
  }
}
```

**Idempotency:**
- Before executing: check if `commandId` is already in `executedCommandIds`
- If yes → skip, respond ack with "already executed"

### 3.3 ACK (confirm)

**Endpoint:** `POST /ea/ack`

On success:
```json
{
  "terminalId": "FTMO_01",
  "commandId": "cmd_...",
  "status": "SUCCESS",
  "result": {
    "ticket": 123456,
    "price": 1.08321
  }
}
```

On failure:
```json
{
  "status": "FAILED",
  "error": {
    "code": "TRADE_RETCODE_REQUOTE",
    "message": "Requote"
  }
}
```

---

## 4. Execution Engine

Translates backend commands into MT5 actions.

### 4.1 Place Pending

Use `CTrade`:
- `SellLimit` / `SellStop` / `BuyLimit` / `BuyStop` based on side and entry vs. current price
- Set SL/TP
- Set comment with `clientOrderKey` or `commandId`

Save mappings:
- `commandId ↔ ticket`
- `clientOrderKey ↔ ticket`

> Comments are gold for reconciliation.

### 4.2 Place Market

- `trade.Buy()` / `trade.Sell()`
- Record ticket

### 4.3 Modify Order / Position

- Move SL to entry (Break Even)
- Update TP
- Update SL

### 4.4 Cancel Pending

- Cancel by ticket
- Cancel all pending for a symbol
- Cancel all global pending (for 16:30 rule)

### 4.5 Close Position

- Close by ticket
- Close all positions in portfolio (for Friday 22:00 rule)

---

## 5. Safety Layer — Local Fail-Safes

This layer prevents backend bugs from causing account damage. It runs **independently** of backend decisions.

### 5.1 Hard Rules (Always Enforced by EA)

1. **Max 1 position per symbol**
   - Before executing any `PLACE_*`: if an open position exists on the symbol → reject command with ack `FAILED "POSITION_ALREADY_OPEN"`

2. **Cancel pending at 16:30**
   - EA checks server/local time (pick one and stick to it)
   - If time >= 16:30 → cancel pending, reject new pending commands

3. **Friday forced close at 22:00**
   - If Friday and time >= 22:00 → close all, cancel all, reject new commands

4. **Daily 3 SL cap**
   - EA counts SL hits from `OnTradeTransaction`
   - If `slCount >= 3` → stop placing new trades (reject commands), cancel pending, emit `DAILY_HALT_TRIGGERED`

5. **Backend unreachable**
   - EA continues managing safety (16:30 cancel, 22:00 close)
   - Does NOT make new trading decisions
   - No new orders

### 5.2 Backend Sanity Checks (Anti-Absurd Commands)

Even for "valid" commands from backend, EA verifies:
- SL and TP are coherent with side (sell: SL > entry, TP < entry)
- Volume within allowed limits
- Symbol is supported
- Minimum stop distance (broker-imposed)

---

## 6. State & Persistence

### What to Persist

- `lastClosedM15Time` per symbol
- `executedCommandIds` (last N = 500–2000)
- `dailyState`:
  - date
  - slCount
  - halted (boolean)
- Ticket mappings:
  - Order tickets by `commandId`
  - Position ticket by `clientOrderKey` (optional)

### Where to Persist in MQL5

Recommended: **simple JSON or CSV file** on disk (`Files\...`). GlobalVariables are more limited.

### Daily Reset

Every loop, check if date has changed:
- `slCount = 0`
- `halted = false`
- Clear some caches
- Send `DAILY_RESET` event

---

## 7. Trade Events — OnTradeTransaction

MT5 notifies everything (fills, modifies, SL/TP hits) via `OnTradeTransaction`.

EA must:
- Identify deal type:
  - Entry fill
  - Close by SL
  - Close by TP
  - Manual close
  - Cancel pending
- Update `slCount` on SL hit
- Send event to backend with full details

This is how the backend knows:
- "This order was actually filled"
- "This stop was hit"
- "This position is closed"

---

## 8. Reconciliation (Recommended)

Every X minutes (e.g. every 5 min):

EA sends a state snapshot:

```json
{
  "type": "ACCOUNT_SNAPSHOT",
  "terminalId": "FTMO_01",
  "time": "...",
  "positions": [...],
  "orders": [...],
  "equity": 12345.6,
  "balance": 12000.0
}
```

Backend compares with DB and corrects mismatches (e.g. lost events).

---

## 9. What a "Thin but Serious" EA Looks Like

Thin means: no S1/SSA/zone calculation, no entry/SL/TP decisions.

But it fully handles:
- Timer loop
- Bar detector
- HTTP client
- Command executor
- Trade event handler
- Safety checks
- Persistence

---

## 10. Implementation Checklist (Recommended Order)

1. Base: config + timer + heartbeat
2. M15 bar close detector + POST event
3. Poll commands + ack
4. Place pending + cancel
5. `OnTradeTransaction` → emit fill/SL/TP events
6. Safety: max 1 position per symbol
7. Safety: 16:30 cancel pending
8. Safety: Friday 22:00 close all
9. Safety: daily 3 SL halt
10. Persistence: last bar, command IDs, daily state
11. Reconciliation snapshot
