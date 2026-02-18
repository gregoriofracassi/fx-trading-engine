---
name: m3-asia-range
description: Implementation plan for Milestone 3 — Asia Range Calculation. Covers all steps from DB schema to strategy module wiring and replay test, with testable definition of done for each step.
---

# Milestone 3 — Asia Range Calculation

## Goal

Calculate and persist the Asia Session high/low (`AsiaRange`) for each trading day and symbol, by processing `BarM15` rows as they arrive from the EA.

This is the **foundational input for every setup** (S1, SSA, Mutazione — all reference the Asia High or Asia Low). No trading logic yet — pure read and calculation.

**Definition of Done:**
- `AsiaRange` row in DB per `(date, symbol)` with correct `high` and `low`
- `finalized = true` once the 08:00 Rome bar closes (no more updates after that)
- Values match what you see on the MT5 chart for the Asia session
- Replay endpoint populates past days from existing `BarM15` rows
- Idempotent: processing the same bar twice produces no duplicates and no errors

---

## Key Design Decisions

### `strategy` module — separate from `ea-gateway`

`AsiaRange` is a strategy concept. `ea-gateway` is pure data ingestion. All future signal detection (S1, SSA, Mutazione) also lives in `strategy`. Clean boundary, no cross-module imports.

### How bars reach the strategy module

`ProcessBarM15Handler` publishes a `BarM15ClosedEvent` via NestJS `EventBus` after saving each bar. The `strategy` module subscribes via `@EventsHandler`. `ea-gateway` knows nothing about `strategy`.

### Timezone

Asia Session window: **01:00–08:15 Europe/Rome**. All bars arrive as UTC from MT5. Conversion uses Node's built-in `Intl.DateTimeFormat` — no external library needed.

### Date key

`AsiaRange.date` is the **Rome calendar date** (`"YYYY-MM-DD"` string), not UTC. A bar at `00:30 UTC` in winter is `01:30 Rome` → belongs to Rome date of that day. Plain string avoids all DB timezone ambiguity.

### 23:xx candle rule

Bars between 23:00 and 00:00 Rome are ignored per strategy spec. Controlled by `IGNORE_23H_CANDLES` constant at the top of `AsiaRangeService` — set to `false` to disable the rule without touching logic.

### Finalization

The 08:00 Rome bar (closes at 08:15) is the last Asia bar. After it is processed, `finalized = true` is set. No further updates happen for that day/symbol — even if bars are replayed.

### Separation of concerns

| Layer | Responsibility |
|---|---|
| `BarM15ClosedHandler` | Receives event, calls service — 4 lines, no logic |
| `AsiaRangeService` | All domain decisions: window check, high/low calc, finalization |
| `AsiaRangeRepository` | Pure DB access: find, create, update, finalize — no conditions |

### Function complexity

ESLint `complexity: max 5` is enforced on commit. Each function has one clear job. Helper functions in `AsiaRangeService` are pure (no DB, no side effects):
- `toRomeTime` — UTC → Rome local time
- `isIgnoredCandle` — 23h rule
- `isAfterAsiaStart` / `isBeforeAsiaEnd` / `isInAsiaSession` — window checks
- `isFinalizingBar` — 08:00 Rome detection
- `computeUpdatedRange` — max/min calculation

---

## Replay vs Backtest — Design Decision

### Replay endpoint (built in M3)

`POST /api/admin/replay-asia-range?symbol=EURUSD`

Feeds existing `BarM15` rows from the DB through the same `AsiaRangeService.processBar()` call used live. Purpose: populate `AsiaRange` for past days we already have bar data for. Also used to verify correctness against the MT5 chart.

This works correctly for small datasets (days or weeks of bars). It processes bars one at a time with one DB read+write per bar — fine for manual verification, not designed for bulk throughput.

### Backtest (future milestone)

When backtest downloads 6 months of historical data (~17,000 bars), running `processBar` one-by-one would mean ~34,000 DB calls — too slow.

The backtest Asia Range calculator will:
1. Load all bars for the symbol+date range into memory in one query
2. Run the same pure helper functions (`isInAsiaSession`, `computeUpdatedRange`, etc.) in-process — no DB calls per bar
3. Bulk upsert all resulting `AsiaRange` rows in one operation at the end

**The calculation logic is the same. Only the runner differs.** The pure helpers in `AsiaRangeService` are already designed to be reused directly by the backtest runner without going through `processBar`.

No queues needed for backtest — it's a batch job with a defined start/end that runs in seconds entirely in memory.

---

## DB Schema

```prisma
model AsiaRange {
  id        String   @id @default(cuid())
  date      String   // Rome calendar date "YYYY-MM-DD" — plain string avoids timezone ambiguity
  symbol    String
  high      Float
  low       Float
  finalized Boolean  @default(false)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([date, symbol])  // also serves as the index — no separate @@index needed
  @@schema("strategy")
}
```

Migration already applied. Table lives in `strategy` Postgres schema (not `ea_gateway`).

---

## Module Structure

```
src/modules/strategy/
├── strategy.module.ts
├── domain/
│   ├── repositories/
│   │   └── asia-range.repository.ts
│   └── services/
│       └── asia-range.service.ts
└── events/
    └── handlers/
        └── bar-m15-closed.handler.ts
```

`StrategyModule` registered in `AppModule`. Imports `CqrsModule` and `DatabaseModule`.

---

## Replay Endpoint

**`POST /api/admin/replay-asia-range?symbol=EURUSD`**

1. `BarM15Repository.findAllBySymbol(symbol)` — all bars ordered by `timeOpen ASC`
2. Loop: call `asiaRangeService.processBar()` for each bar
3. Return `{ processed: N }`

Also requires `findAllBySymbol` on `BarM15Repository`:
```typescript
async findAllBySymbol(symbol: string) {
  return this.prisma.barM15.findMany({
    where: { symbol },
    orderBy: { timeOpen: 'asc' },
    select: { symbol: true, timeOpen: true, timeClose: true, high: true, low: true, open: true, close: true },
  });
}
```

Endpoint lives in a dedicated `AdminController` (not `EaGatewayController`) under `src/modules/strategy/`.

---

## File Checklist

| File | Status |
|---|---|
| `src/database/schema.prisma` — `AsiaRange` model | ✅ done |
| `src/database/migrations/` — migration applied | ✅ done |
| `src/modules/ea-gateway/events/bar-m15-closed.event.ts` | ✅ done |
| `src/modules/ea-gateway/commands/handlers/process-bar-m15.handler.ts` — publishes event | ✅ done |
| `src/modules/strategy/strategy.module.ts` | ✅ done |
| `src/modules/strategy/domain/services/asia-range.service.ts` | ✅ done |
| `src/modules/strategy/domain/repositories/asia-range.repository.ts` | ✅ done |
| `src/modules/strategy/events/handlers/bar-m15-closed.handler.ts` | ✅ done |
| `src/app.module.ts` — `StrategyModule` registered | ✅ done |
| `src/modules/ea-gateway/domain/repositories/bar-m15.repository.ts` — `findAllBySymbol` | ✅ done |
| `src/modules/strategy/controllers/admin.controller.ts` — replay endpoint | ✅ done |
| Rebuild Docker + end-to-end test | ✅ done |

---

## End-to-End Test

### Replay test (historical):
```bash
curl -X POST "http://localhost:80/api/admin/replay-asia-range?symbol=EURUSD"
# → { "processed": 47 }
```
Then Beekeeper: `strategy.AsiaRange` → rows for each past trading day.

Cross-check one day: look at that day's bars in `BarM15` between 01:00–08:15 Rome, manually compute max high and min low — must match the `AsiaRange` row exactly.

Run twice → same rows, no errors, no duplicates (idempotency).

### Live test (forward-looking):
Wait for a bar in the 01:00–08:15 Rome window → backend logs show `AsiaRange updated`. Wait for 08:00 Rome bar → log shows `AsiaRange FINALIZED` → `finalized = true` in DB.

### Verification against MT5 chart:
Draw a horizontal line at the `high` from DB for a specific day. Compare to the 01:00–08:15 session on the chart. Must match exactly.

---

## Timezone Reference

| Scenario | UTC timeOpen | Rome time | In window? |
|---|---|---|---|
| Rome winter (UTC+1) session start | 00:00 UTC | 01:00 Rome | Yes |
| Rome summer (UTC+2) session start | 23:00 UTC prev day | 01:00 Rome | Yes |
| Ignored candle | 22:00 UTC (winter) | 23:00 Rome | No — ignored |
| Last Asia bar (winter) | 07:00 UTC | 08:00 Rome | Yes — finalizes |
| First operative bar (winter) | 07:15 UTC | 08:15 Rome | No — operative session |
