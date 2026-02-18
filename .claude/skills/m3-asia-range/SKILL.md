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
- `finalized = true` once the 08:15 Rome bar closes (no more updates after that)
- Values match what you see on the MT5 chart for the Asia session
- Replay works: feeding past `BarM15` rows produces correct `AsiaRange` rows for past days
- Idempotent: processing the same bar twice produces no duplicates and no errors

---

## Key Design Decisions

### New `strategy` module (not inside `ea-gateway`)

`AsiaRange` is a strategy concept. It does not belong in `ea-gateway` (which is pure data ingestion). A dedicated `strategy` module keeps the boundary clean and is where all future signal detection will also live.

### How bar events reach the strategy module

Use NestJS `EventBus`. When `ProcessBarM15Handler` finishes persisting a bar, it publishes a `BarM15ClosedEvent`. The strategy module subscribes and reacts. This decouples ingestion from strategy with no direct module dependency.

### Timezone

The Asia Session window is **01:00–08:15 Europe/Rome**. All bars arrive as UTC from MT5. The backend must convert to Rome time to determine if a bar falls inside the window. Use the `luxon` library (already commonly used in NestJS stacks) or Node's built-in `Intl`. No moment.js.

### "Date" key for AsiaRange

The date key for `AsiaRange` is the **Rome calendar date** of the bar, not UTC. A bar at `2026-02-18 00:30 UTC` is `2026-02-18 01:30 Rome` → belongs to Rome date `2026-02-18`. This matters for overnight sessions.

### Ignored bars

Per strategy spec: **bars between 23:00 and 00:00 Rome are ignored** entirely (not counted in high/low, not used for finalization).

### Finalization

The range is **finalized** when the bar at `08:00 Rome` closes (i.e. `timeOpen = 08:00 Rome`). After that no more updates happen. The `finalized` flag prevents stale re-processing if bars are replayed.

### Upsert pattern

Upsert on `(date, symbol)` with running high/low max/min. Idempotent — replaying a bar only raises high or lowers low if the new value is more extreme (which it won't be for an already-processed bar, so it's a no-op effectively).

---

## Current Codebase State (at time of writing)

| What exists                                      | File                                                                      |
| ------------------------------------------------ | ------------------------------------------------------------------------- |
| `BarM15` model + repository                      | `src/database/schema.prisma`, `domain/repositories/bar-m15.repository.ts` |
| `ProcessBarM15Handler` (saves bar, writes audit) | `commands/handlers/process-bar-m15.handler.ts`                            |
| No EventBus publishing yet                       | —                                                                         |
| No `strategy` module                             | —                                                                         |
| No `AsiaRange` model                             | —                                                                         |

---

## Step 1 — DB: Add `AsiaRange` model + migration

Add to `schema.prisma` under the `// ─── Strategy ───` section:

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

  @@unique([date, symbol])
  @@schema("strategy")
}
```

Also ensure the datasource declares both schemas:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
  schemas  = ["ea_gateway", "strategy"]
}
```

Notes:

- `date` is a plain string `"YYYY-MM-DD"` — not a `DateTime`. Avoids all timezone ambiguity at the DB level. The Rome date string is computed in application code before storing.
- `@@unique([date, symbol])` enables upsert and prevents duplicates. No separate `@@index` needed — `@@unique` already creates one.
- `@@schema("strategy")` — all strategy models live in the `strategy` Postgres schema, not `ea_gateway`.

Run migration:

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/fx_trading" \
  pnpm --filter @fx-trading/backend exec prisma migrate dev --name add_asia_range --schema=src/database/schema.prisma
```

Then rebuild Docker:

```bash
docker compose up -d --build backend
```

**Testable:** Beekeeper → `strategy.AsiaRange` table exists with all columns, unique constraint on `(date, symbol)`.

---

## Step 2 — Backend: Publish `BarM15ClosedEvent` from the existing handler

The existing `ProcessBarM15Handler` saves the bar but doesn't notify the rest of the system. Add a NestJS domain event publish after the upsert.

**New file:** `src/modules/ea-gateway/events/bar-m15-closed.event.ts`

```typescript
export class BarM15ClosedEvent {
  constructor(
    public readonly symbol: string,
    public readonly timeOpen: Date, // UTC
    public readonly timeClose: Date, // UTC
    public readonly high: number,
    public readonly low: number,
    public readonly open: number,
    public readonly close: number,
  ) {}
}
```

**Edit `ProcessBarM15Handler`** — inject `EventBus` and publish after upsert:

```typescript
// After barM15Repository.upsert(...)
this.eventBus.publish(
  new BarM15ClosedEvent(
    command.symbol,
    command.timeOpen,
    command.timeClose,
    command.high,
    command.low,
    command.open,
    command.close,
  ),
);
```

Import `EventBus` from `@nestjs/cqrs`. No other changes to the handler.

**Testable:** No visible change yet — the event is published but nothing listens. Confirm no TypeScript errors (`pnpm --filter @fx-trading/backend exec tsc --noEmit`).

---

## Step 3 — Backend: Create `strategy` module scaffold

**New files:**

```
src/modules/strategy/
├── strategy.module.ts
├── domain/
│   └── repositories/
│       └── asia-range.repository.ts
└── events/
    └── handlers/
        └── bar-m15-closed.handler.ts
```

**`strategy.module.ts`:**

```typescript
import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { AsiaRangeRepository } from './domain/repositories/asia-range.repository';
import { BarM15ClosedHandler } from './events/handlers/bar-m15-closed.handler';

const EventHandlers = [BarM15ClosedHandler];
const Repositories = [AsiaRangeRepository];

@Module({
  imports: [CqrsModule],
  providers: [...EventHandlers, ...Repositories],
})
export class StrategyModule {}
```

Register `StrategyModule` in `app.module.ts`:

```typescript
imports: [DatabaseModule, EaGatewayModule, BacktestModule, StrategyModule],
```

**Testable:** Backend starts without errors. No logic yet, just the module wiring.

---

## Step 4 — Backend: `AsiaRangeRepository`

**File:** `src/modules/strategy/domain/repositories/asia-range.repository.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';

export interface UpsertAsiaRangeInput {
  date: string; // "YYYY-MM-DD" Rome calendar date
  symbol: string;
  high: number;
  low: number;
}

@Injectable()
export class AsiaRangeRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsertRunning(input: UpsertAsiaRangeInput): Promise<void> {
    const existing = await this.prisma.asiaRange.findUnique({
      where: { date_symbol: { date: input.date, symbol: input.symbol } },
    });

    if (existing?.finalized) return; // never overwrite a finalized range

    await this.prisma.asiaRange.upsert({
      where: { date_symbol: { date: input.date, symbol: input.symbol } },
      create: {
        date: input.date,
        symbol: input.symbol,
        high: input.high,
        low: input.low,
        finalized: false,
      },
      update: {
        // Only expand the range — never shrink it
        high: Math.max(existing?.high ?? input.high, input.high),
        low: Math.min(existing?.low ?? input.low, input.low),
      },
    });
  }

  async finalize(date: string, symbol: string): Promise<void> {
    await this.prisma.asiaRange.updateMany({
      where: { date, symbol, finalized: false },
      data: { finalized: true },
    });
  }

  async findByDateAndSymbol(date: string, symbol: string) {
    return this.prisma.asiaRange.findUnique({
      where: { date_symbol: { date, symbol } },
    });
  }
}
```

**Testable:** Call `upsertRunning` twice with the same bar → 1 row. Call with a lower high → high unchanged. Call `finalize` → `finalized = true`, subsequent `upsertRunning` is a no-op.

---

## Step 5 — Backend: `BarM15ClosedHandler` in strategy module

This is the core logic. It receives the published event and decides whether to update the Asia Range.

**File:** `src/modules/strategy/events/handlers/bar-m15-closed.handler.ts`

```typescript
import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { Injectable, Logger } from '@nestjs/common';
import { BarM15ClosedEvent } from '../../../ea-gateway/events/bar-m15-closed.event';
import { AsiaRangeRepository } from '../../domain/repositories/asia-range.repository';

// Rome timezone identifier
const ROME_TZ = 'Europe/Rome';

function toRomeTime(utcDate: Date): { hour: number; minute: number; dateStr: string } {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: ROME_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(utcDate);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return {
    dateStr: `${get('year')}-${get('month')}-${get('day')}`,
    hour: parseInt(get('hour'), 10),
    minute: parseInt(get('minute'), 10),
  };
}

@Injectable()
@EventsHandler(BarM15ClosedEvent)
export class BarM15ClosedHandler implements IEventHandler<BarM15ClosedEvent> {
  private readonly logger = new Logger(BarM15ClosedHandler.name);

  constructor(private readonly asiaRangeRepository: AsiaRangeRepository) {}

  async handle(event: BarM15ClosedEvent): Promise<void> {
    const rome = toRomeTime(event.timeOpen);
    const { hour, minute, dateStr } = rome;

    // Ignore candles between 23:00 and 00:00 Rome (strategy spec)
    if (hour === 23) return;

    // Asia session window: [01:00, 08:15) Rome
    // A bar at timeOpen=08:00 closes at 08:15, which is the LAST bar of the session
    const inAsiaSession =
      (hour > 1 || (hour === 1 && minute >= 0)) && (hour < 8 || (hour === 8 && minute === 0));

    if (!inAsiaSession) return;

    // Update the running high/low for this date + symbol
    await this.asiaRangeRepository.upsertRunning({
      date: dateStr,
      symbol: event.symbol,
      high: event.high,
      low: event.low,
    });

    this.logger.log(
      `AsiaRange updated | ${event.symbol} | date=${dateStr} | ` +
        `bar=${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')} Rome | ` +
        `barHigh=${event.high} barLow=${event.low}`,
    );

    // Finalize when the 08:00 Rome bar closes (it's the last bar before 08:15)
    if (hour === 8 && minute === 0) {
      await this.asiaRangeRepository.finalize(dateStr, event.symbol);
      this.logger.log(`AsiaRange FINALIZED | ${event.symbol} | date=${dateStr}`);
    }
  }
}
```

**Testable:** Send a bar with `timeOpen` in the Asia window via curl → `AsiaRange` row appears or updates. Send the 08:00 Rome bar → row is finalized. Send a later bar → row unchanged.

---

## Step 6 — Replay: Populate `AsiaRange` from existing `BarM15` rows

You already have historical bars in `BarM15` from M2. Add an admin endpoint that replays them through the handler to populate `AsiaRange` for all past days.

**New endpoint** in `ea-gateway.controller.ts` (or a separate admin controller):

```
POST /admin/replay-asia-range?symbol=EURUSD
```

Handler logic:

1. Query all `BarM15` rows for the symbol, ordered by `timeOpen` ASC
2. For each row, publish a `BarM15ClosedEvent` (same as the live path)
3. Return count of bars processed

```typescript
@Post('/admin/replay-asia-range')
async replayAsiaRange(@Query('symbol') symbol: string) {
  const bars = await this.barM15Repository.findAllBySymbol(symbol);
  for (const bar of bars) {
    this.eventBus.publish(
      new BarM15ClosedEvent(bar.symbol, bar.timeOpen, bar.timeClose, bar.high, bar.low, bar.open, bar.close),
    );
  }
  return { processed: bars.length };
}
```

Also add `findAllBySymbol(symbol: string)` to `BarM15Repository`:

```typescript
async findAllBySymbol(symbol: string) {
  return this.prisma.barM15.findMany({
    where: { symbol },
    orderBy: { timeOpen: 'asc' },
    select: { symbol: true, timeOpen: true, timeClose: true, high: true, low: true, open: true, close: true },
  });
}
```

**Testable:**

```bash
curl -X POST "http://localhost:80/api/admin/replay-asia-range?symbol=EURUSD"
# → { "processed": 47 }
```

Then check Beekeeper: `AsiaRange` rows for each trading day where bars existed.

---

## Step 7 — End-to-End Test

### Live test (forward-looking):

1. Rebuild: `docker compose up -d --build backend`
2. Wait for any M15 bar in the 01:00–08:15 Rome window
3. `docker compose logs -f backend` → look for `AsiaRange updated | EURUSD | ...`
4. Beekeeper: `strategy.AsiaRange` → row for today's date, `finalized = false`
5. When the 08:00 Rome bar fires → log shows `AsiaRange FINALIZED` → `finalized = true` in DB

### Replay test (historical):

1. `curl -X POST "http://localhost:80/api/admin/replay-asia-range?symbol=EURUSD"`
2. Beekeeper: rows for every past date where bars existed
3. Cross-check one day: take the date, look at that day's bars in `BarM15` for that symbol between 01:00–08:15 Rome, manually compute max high and min low, confirm they match the `AsiaRange` row

### Idempotency test:

1. Run replay twice → same rows, no errors, no new rows created

### Verification against MT5 chart:

1. In MT5: draw a horizontal line at the `high` value from DB for a specific day
2. Compare to the 01:00–08:15 session on the chart
3. They must match exactly

---

## Timezone Correctness Notes

The most error-prone part of this milestone. Some checks:

| Scenario            | UTC timeOpen          | Rome time  | In window?               |
| ------------------- | --------------------- | ---------- | ------------------------ |
| Rome winter (UTC+1) | 00:00 UTC             | 01:00 Rome | Yes (window start)       |
| Rome summer (UTC+2) | 23:00 UTC (prev day)  | 01:00 Rome | Yes (window start)       |
| Ignored candle      | 22:00 UTC Rome winter | 23:00 Rome | No (ignored)             |
| Last Asia bar       | 07:00 UTC Rome winter | 08:00 Rome | Yes (finalize)           |
| First operative bar | 07:15 UTC Rome winter | 08:15 Rome | No (operative, not Asia) |

Summer (CEST, UTC+2): the 01:00 Rome bar opens at 23:00 UTC the previous day. The `dateStr` must still be the Rome calendar date (the "next" date), not the UTC date. The `toRomeTime()` helper above handles this correctly because it uses `Intl.DateTimeFormat` with `timeZone: 'Europe/Rome'`.

---

## File Checklist

| File                                                                  | Action                                        |
| --------------------------------------------------------------------- | --------------------------------------------- |
| `src/database/schema.prisma`                                          | Add `AsiaRange` model                         |
| `src/database/migrations/`                                            | New migration (auto-generated)                |
| `src/modules/ea-gateway/events/bar-m15-closed.event.ts`               | New file                                      |
| `src/modules/ea-gateway/commands/handlers/process-bar-m15.handler.ts` | Inject `EventBus`, publish event after upsert |
| `src/modules/ea-gateway/domain/repositories/bar-m15.repository.ts`    | Add `findAllBySymbol()`                       |
| `src/modules/ea-gateway/controllers/ea-gateway.controller.ts`         | Add `POST /admin/replay-asia-range` endpoint  |
| `src/modules/strategy/strategy.module.ts`                             | New file                                      |
| `src/modules/strategy/domain/repositories/asia-range.repository.ts`   | New file                                      |
| `src/modules/strategy/events/handlers/bar-m15-closed.handler.ts`      | New file                                      |
| `src/app.module.ts`                                                   | Import `StrategyModule`                       |

---

## What Comes Next (M4)

Once `AsiaRange` is verified correct:

- Implement S1 detector in the `strategy` module
- On each bar in the operative window [08:15–16:30 Rome], check S1 conditions against the finalized `AsiaRange` for that day
- Write a `Signal` record (valid or invalid with reason codes) — still no orders
