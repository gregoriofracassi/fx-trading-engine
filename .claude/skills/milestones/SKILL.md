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

## Milestone 0 — Repo + Executable Baseline

**Goal:** Have a running NestJS and a DB with Prisma.

**Tasks:**
- Create repo structure:
  - `/backend` (NestJS)
  - `/ea` (MQL5)
  - `/docs`
- Set up Postgres with Docker Compose
- Prisma init, run "hello world" migration

**Definition of Done:**
- `npm test` (even empty) passes
- `GET /health` responds 200
- DB is up and migration is applied

---

## Milestone 1 — EA Heartbeat (Connectivity Only)

**Goal:** Prove that MT5 → NestJS communication works via HTTP.

**EA (minimum):**
- `OnInit` sets a timer every 10s
- Sends `POST /ea/events` with:
  - `type = HEARTBEAT`
  - `terminalId`
  - `sentAt`
  - `seq`

**NestJS:**
- `POST /ea/events` accepts heartbeat and saves it to `AuditEvent`

**Definition of Done:**
- Open MT5, load EA on a chart
- DB shows one new row every ~10s
- If internet is cut or backend is stopped, EA logs "backend down" (even just `Print()`)

> This step proves the entire system is actually talking. Don't skip it.

---

## Milestone 2 — M15 Bar Close Ingestion

**Goal:** Save real candles from the terminal to DB (live source-of-truth).

**EA:**
- Every 1s: check `CopyRates(PERIOD_M15, 0, 2)`
- If `rates[1].time` is new → send `BAR_M15_CLOSED` event with OHLC + timeOpen/timeClose

**NestJS:**
- Validate event
- Upsert into `BarM15` (unique constraint on `(symbol, timeOpen)`)

**Definition of Done:**
- DB shows 1 new candle every 15 min
- No duplicates (unique constraint works)
- If EA/MT5 restarts, already-saved bars are not re-inserted

> This is the most important foundation: replay + audit.

---

## Milestone 3 — Command Outbox "Dummy" (Backend → EA)

**Goal:** Prove the reverse channel and command idempotency.

**NestJS:**
- Table `EaCommand` exists
- `GET /ea/commands?terminalId=` returns PENDING commands
- Manually insert (via SQL or admin endpoint) a dummy command:
  - `type = PING`
  - `payload = { "msg": "hello" }`

**EA:**
- Polls `GET /ea/commands` every 2s
- On receiving PING:
  - `Print("PING: hello")`
  - `POST /ea/ack` with status SUCCESS
  - Saves `commandId` to executed set

**Definition of Done:**
- Insert 1 command → EA sees it and acks it
- If backend returns the same command twice, EA does NOT re-execute it (idempotency confirmed)

> This unlocks all future execution without yet touching trading.

---

## Milestone 4 — Non-Trading Execution: Cancel Pending / Close All (Demo)

**Goal:** Test that the EA can call trading functions without risking capital.

**Use a demo account or FTMO demo (with extreme caution):**
- Manually create 1 very small pending order
- Backend creates `CANCEL_ALL_PENDING` command
- EA cancels and sends `ORDER_CANCELLED` event

**Definition of Done:**
- The order disappears from MT5
- DB records the event and state is coherent

> Always test the "cleanup" path before placing orders.

---

## Milestone 5 — Position State Mirror: Order/Position Events in DB

**Goal:** Backend always knows what is open or pending.

**EA:**
- Implement `OnTradeTransaction` → sends events:
  - `ORDER_PLACED`
  - `ORDER_FILLED`
  - `POSITION_OPENED`
  - `POSITION_CLOSED`
  - `SL_HIT`, `TP_HIT`

**NestJS:**
- Saves `Order` and `Position` via event-driven state machine
- Updates `DailyState.slCount` on SL events

**Definition of Done:**
- Place 1 trade manually at micro-lot size
- Backend correctly updates state
- Operational truth is now in DB

---

## Milestone 6 — First Strategy Piece: Asia Range (Calculation Only, No Trading)

**Goal:** Calculate and save the Asia Range — no trading decisions yet.

**NestJS:**
- On each `BAR_M15_CLOSED`:
  - If `timeOpen` is within [01:00–08:15) → update high/low running values
  - After 08:15 → finalize `AsiaRange(date, symbol)`

**Definition of Done:**
- For a given day, `AsiaRange` is correctly recorded in DB by mid-morning
- Values can be verified against the MT5 chart

---

## Milestone 7 — S1 Detector "Read-Only" (No Order Execution)

**Goal:** Implement S1 and produce Signal records (valid/invalid) with reason codes.

**NestJS:**
- Calculate S1 metrics on the last 2–3 relevant bars
- Always save a `Signal` record (valid or invalid)

**Definition of Done:**
- DB shows invalid signals with sensible reason codes
- At least 1 valid signal appears on days with typical setups
- Logic can be verified before any order risk

> This is where you find out if the strategy logic is correctly implemented.

---

## Milestone 8 — Paper Trading: Commands But No Real Orders

**Goal:** Test the full decision → command → ack pipeline without touching real trading.

**EA:**
- `DRY_RUN = true` mode:
  - On receiving `PLACE_PENDING` → does NOT place in MT5
  - Responds with ack `"SIMULATED"`
  - Sends `SIM_ORDER_PLACED` event

**Definition of Done:**
- Commands are generated by the backend
- Full ack + audit trail is visible
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
