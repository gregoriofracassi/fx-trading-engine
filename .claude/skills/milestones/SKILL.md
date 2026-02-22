---
name: milestones
description: Development milestones plan for the FX trading engine. Covers 10 micro-milestones from repo setup to first real automated trade, with testable "Definition of Done" for each step. Follows an onion strategy — build the reliable EA↔Backend↔DB channel first, then layer the strategy on top.
---

# FX Trading Engine — Development Milestones

## Core Philosophy

**Onion strategy**: build the reliable EA ↔ Backend ↔ DB communication channel first, then layer the strategy on top. Every milestone must be testable in isolation and must leave something observable (logs, DB records, UI).

**Three practical rules to feel you're doing things right:**

1. Never implement 2 new things in the same step. E.g. do not build "S1 + order placement" together. Do S1 read-only first.
2. Every step must leave a permanent trace in DB — even just an `AuditEvent` + counters.
3. Before creating orders, create and test cancel/close commands. When things go wrong, that's what saves you.

---

## Milestone 0 — Repo + Executable Baseline ✅

**Goal:** Have a running NestJS and a DB with Prisma.

**Definition of Done:**

- `npm test` (even empty) passes
- `GET /health` responds 200
- DB is up and migration is applied

---

## Milestone 1 — EA Heartbeat (Connectivity Only) ✅

**Goal:** Prove that MT5 → NestJS communication works via HTTP.

**Definition of Done:**

- Open MT5, load EA on a chart
- DB shows new rows from heartbeat events
- If internet is cut or backend is stopped, EA logs the error

> This step proves the entire system is actually talking. Don't skip it.

---

## Milestone 2 — M15 Bar Close Ingestion ✅

**Goal:** Save real candles from the terminal to DB (live source-of-truth).

**EA:**

- Every 1s: check `CopyRates(PERIOD_M15, 0, 2)`
- If `rates[1].time` is new → send `BAR_M15_CLOSED` event with OHLC + timeOpen/timeClose
- On startup: backfill missing bars since last known bar in DB

**NestJS:**

- Validate event
- Upsert into `BarM15` (unique constraint on `(symbol, timeOpen)`)
- `GET /ea/last-bar?symbol=` endpoint for EA backfill query

**Definition of Done:**

- DB shows 1 new candle every 15 min
- No duplicates (unique constraint works)
- If EA/MT5 restarts, missing bars are backfilled automatically

> This is the most important foundation: replay + audit.

---

## Milestone 3 — Asia Range (Calculation Only, No Trading) ✅

**Goal:** Calculate and persist the Asia Session high/low for each trading day. This is the foundational input for every setup (S1, SSA, Mutazione).

**Why before the Command Outbox:** The Asia Range is the prerequisite for _all_ signal detection. Implementing it now, read-only, lets you verify strategy logic against real bars you already have before wiring up any execution path. Bugs in range calculation caught here cost nothing. Bugs caught after order placement cost money.

**NestJS (new `strategy` module):**

- On each `BAR_M15_CLOSED` event (via EventBus or direct call):
  - Convert `timeOpen` to Europe/Rome timezone
  - If bar falls in [01:00, 08:15) Rome → upsert running `AsiaRange { date, symbol, high, low }`
  - When the 08:00 Rome bar closes (i.e. 08:15 is the first bar outside the window) → mark `AsiaRange` as finalized
  - Bars between 23:00–00:00 Rome are ignored per strategy spec

**Definition of Done:**

- `AsiaRange` row in DB for each trading day with correct high/low
- Values match what you see on the MT5 chart for the Asia session
- Replay works: backfilled bars from `BarM15` can populate past `AsiaRange` rows
- No duplicates (upsert on `(date, symbol)`)

> See `.claude/skills/m3-asia-range/SKILL.md` for full implementation plan.

---

## Milestone 4 — S1 Detector "Read-Only" (Signal Records, No Orders) ✅

**Goal:** Implement S1 signal detection and write `Signal` records to DB — no order placement.

**Why before the Command Outbox:** Signal detection is the highest-risk piece of logic. Bugs here directly cause bad trades. By writing records (valid + invalid with reason codes) first, you can verify the logic against real historical bars with zero financial risk.

**NestJS:**

- After each bar in the operative window [08:15–16:30 Rome]:
  - Check S1 conditions: acceptance ≥ 0.6 pips, engulfing ≥ 0.6 pips, no liquidity at highs, no valid opposite imbalance
  - Always write a `Signal` record with: type=S1, valid=true/false, reason code if invalid
- Requires `AsiaRange` for the current day to be finalized

**Definition of Done:**

- DB shows `Signal` records (valid and invalid) with sensible reason codes
- At least 1 valid signal appears on days with typical setups
- Logic verified against chart before any order risk

---

## Milestone 4.5 — Historical Data Backfill (6 Months) ← CURRENT

**Goal:** Load 6 months of historical M15 bar data automatically via EA to enable comprehensive S1 testing and strategy validation.

**Why here:** Before building the command infrastructure (M5+), you need sufficient data to verify S1 detection works correctly across various market conditions. S1 signals are relatively rare, so a few days of data isn't enough. 6 months provides statistical confidence.

**Architecture:**

- **Data source:** MT5 EA fetches bars via `CopyRates()` (up to 100k bars available)
- **Trigger mechanism:** Piggyback on existing `GET /api/ea/last-bar` endpoint (zero extra polling)
- **Transport:** Chunked uploads (500 bars/chunk, ~133 KB each) to avoid timeouts
- **Module:** Uses `backtest` module infrastructure, not `ea-gateway`
- **Concurrency:** Multiple symbols can backfill simultaneously (async handlers)

**Backend Implementation:**

1. **Backfill state tracking:**
   - In-memory map: `symbol → barsRequested` (or Redis for persistence)
   - Admin trigger: `POST /api/backtest/request-historical-backfill { symbol, barsCount }`
   - Sets flag that EA will pick up on next `GET /api/ea/last-bar` call

2. **Enhanced last-bar response:**
   - `GET /api/ea/last-bar?symbol=EURUSD` returns:
   ```json
   {
     "timeOpen": "2024-08-01T10:15:00.000Z",
     "historicalBackfill": {
       "requested": true,
       "barsCount": 17520
     }
   }
   ```

3. **Chunk ingestion endpoint:**
   - `POST /api/backtest/historical-bars/chunk`
   - Receives 500 bars per call, upserts to `BarM15` with `source='HISTORICAL'`
   - Returns progress: `{ chunksReceived: 15, totalChunks: 36, barsIngested: 7500 }`

4. **Completion acknowledgment:**
   - `POST /api/backtest/historical-backfill/complete { symbol }`
   - Clears the in-memory flag so EA stops sending

**EA Implementation:**

1. **Check for backfill request** (every bar close, piggybacked):
   - Parse `historicalBackfill` section from `GET /api/ea/last-bar` response
   - If `requested=true`, trigger `ExecuteHistoricalBackfill()`

2. **Chunked upload:**
   - Fetch bars via `CopyRates(Symbol(), PERIOD_M15, 0, barsCount, rates)`
   - Split into chunks of 500 bars
   - Send each chunk to `POST /api/backtest/historical-bars/chunk`
   - Sleep 100ms between chunks to avoid overwhelming backend

3. **Completion:**
   - After all chunks sent, call `POST /api/backtest/historical-backfill/complete`
   - Log summary: "Historical backfill complete: 17,520 bars for EURUSD"

**Definition of Done:**

- Admin triggers backfill: `POST /api/backtest/request-historical-backfill { symbol: "EURUSD", barsCount: 17520 }`
- EA automatically fetches and sends 17,520 bars in 36 chunks within ~2-3 minutes
- `BarM15` table shows 17,520 rows with `source='HISTORICAL'` for EURUSD
- No duplicates (unique constraint on `symbol, timeOpen` enforced)
- Works for multiple symbols concurrently (trigger EURUSD, GBPUSD, USDJPY simultaneously)
- Replay endpoints (Asia Range, S1 signals) can process full 6-month dataset

> This gives you a solid foundation to validate S1 detector performance before any execution risk. See `.claude/skills/m4.5-historical-backfill/SKILL.md` for full implementation plan.

---

## Milestone 5 — Command Outbox "Dummy" (Backend → EA)

**Goal:** Prove the reverse channel and command idempotency.

**Why here (after signal detection):** By now you have real signals to send through the wire. Testing the outbox with dummy PING commands first proves the channel, then you wire up `PLACE_PENDING` knowing the logic feeding it is correct.

**NestJS:**

- Table `EaCommand` exists
- `GET /ea/commands?terminalId=` returns PENDING commands
- Manually insert a dummy command: `type = PING`, `payload = { "msg": "hello" }`

**EA:**

- Polls `GET /ea/commands` every 2s
- On receiving PING: `Print("PING: hello")`, POST ack, save commandId to executed set

**Definition of Done:**

- Insert 1 command → EA sees it and acks it
- Same command returned twice → EA does NOT re-execute (idempotency confirmed)

> This unlocks all future execution without yet touching trading.

---

## Milestone 6 — Non-Trading Execution: Cancel Pending / Close All (Demo)

**Goal:** Test that the EA can call trading functions without risking capital.

**Use a demo account:**

- Manually create 1 small pending order
- Backend creates `CANCEL_ALL_PENDING` command
- EA cancels and sends `ORDER_CANCELLED` event

**Definition of Done:**

- Order disappears from MT5
- DB records the event and state is coherent

> Always test the "cleanup" path before placing orders.

---

## Milestone 7 — Position State Mirror: Order/Position Events in DB

**Goal:** Backend always knows what is open or pending.

**EA:**

- Implement `OnTradeTransaction` → sends events:
  - `ORDER_PLACED`, `ORDER_FILLED`, `POSITION_OPENED`, `POSITION_CLOSED`, `SL_HIT`, `TP_HIT`

**NestJS:**

- Saves `Order` and `Position` via event-driven state machine
- Updates `DailyState.slCount` on SL events

**Definition of Done:**

- Place 1 trade manually at micro-lot size
- Backend correctly updates state
- Operational truth is now in DB

---

## Milestone 8 — Paper Trading: Commands But No Real Orders

**Goal:** Test the full decision → command → ack pipeline without touching real trading.

**EA:**

- `DRY_RUN = true` mode:
  - On receiving `PLACE_PENDING` → does NOT place in MT5
  - Responds with ack `"SIMULATED"`
  - Sends `SIM_ORDER_PLACED` event

**Definition of Done:**

- Commands are generated by the backend from real signals
- Full ack + audit trail visible
- No real orders appear in MT5

> This step gives maximum confidence before going live.

---

## Milestone 9 — First Real Automated Trade (Micro-Lot)

**Prerequisites — only proceed when all of these are true:**

- Event/command pipeline is stable
- S1 detector is reliable
- Dry-run is confirmed working

**Constraints for this milestone:**

- Enable only **1 symbol** (EURUSD)
- Enable only **1 setup** (S1)
- Use **minimum volume**
- **Kill switch is ready**

**Definition of Done:**

- 1 trade is placed correctly
- `order → fill → BE → close` event sequence is coherent
- No duplicate orders
