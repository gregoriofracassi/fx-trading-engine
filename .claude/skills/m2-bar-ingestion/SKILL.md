---
name: m2-bar-ingestion
description: Implementation plan for Milestone 2 — M15 Bar Close Ingestion. Covers all 6 steps from DB schema to EA changes and end-to-end test, with testable definition of done for each step.
---

# Milestone 2 — M15 Bar Close Ingestion

## Goal

Save real M15 candles from the MT5 terminal to the database. This is the live source-of-truth feed that everything else (Asia Range, S1, zones) builds on top of.

**Definition of Done:**

- DB gets 1 new `BarM15` row every 15 minutes from the live MT5 terminal
- No duplicates if EA or MT5 restarts (idempotency via upsert)
- Values match what you see on the MT5 chart

---

## Key Design Decisions

### Date parsing

No library needed. MT5 sends dates as `"2026.02.17 15:09:30"` (dots as separators). Parse with a simple native regex in the repository:

```typescript
function parseMT5Date(raw: string): Date {
  const iso = raw.replace(/(\d{4})\.(\d{2})\.(\d{2})/, '$1-$2-$3').replace(' ', 'T');
  return new Date(iso + 'Z'); // treat as UTC
}
```

### Event routing

Split into **separate command + handler per event type** — do not add a switch inside the existing `ProcessEaEventHandler`. The controller dispatches the right command based on `dto.type`. Clean NestJS CQRS pattern, each handler is independently testable.

### DTO

Keep the single generic `EaEventDto` envelope but add optional bar-specific fields (`symbol`, `o`, `h`, `l`, `c`, `tickVolume`, `spreadPoints`, `timeOpen`, `timeClose`). All optional — heartbeat continues to work unchanged.

### Idempotency

Prisma `upsert` with a unique constraint on `(symbol, timeOpen)`. If the EA restarts and resends the same bar, it overwrites with identical data. No duplicates, no errors.

### Audit

Every event (including `BAR_M15_CLOSED`) still gets written to `AuditEvent`. The bar also gets written to `BarM15`. Both happen in the handler.

---

## Current Codebase State (at time of writing)

| What exists                            | File                                                                   |
| -------------------------------------- | ---------------------------------------------------------------------- |
| `AuditEvent` model only                | `src/database/schema.prisma`                                           |
| Generic event handler (no routing)     | `src/modules/ea-gateway/commands/handlers/process-ea-event.handler.ts` |
| Generic DTO (type + seq + sentAt only) | `src/modules/ea-gateway/dto/requests/ea-event.dto.ts`                  |
| Controller dispatches single command   | `src/modules/ea-gateway/controllers/ea-gateway.controller.ts`          |
| No BarM15 repository                   | —                                                                      |
| EA sends HEARTBEAT only                | `ea/HeartbeatEA.mq5`                                                   |

---

## Step 1 — DB: Add `BarM15` to schema + migrate

**What to do:**
Add to `schema.prisma`:

```prisma
model BarM15 {
  id           String   @id @default(cuid())
  symbol       String
  timeOpen     DateTime
  timeClose    DateTime
  open         Float
  high         Float
  low          Float
  close        Float
  tickVolume   Int
  spreadPoints Int
  source       String   @default("FTMO_LIVE") // FTMO_LIVE | HISTORICAL
  createdAt    DateTime @default(now())

  @@unique([symbol, timeOpen])
  @@index([symbol, timeOpen])
  @@schema("ea_gateway")
}
```

Then run migration locally:

```bash
docker compose exec backend npx prisma migrate dev --name add_bar_m15 --schema=schema.prisma
```

Or if running backend locally:

```bash
pnpm --filter @fx-trading/backend exec prisma migrate dev --name add_bar_m15 --schema=src/database/schema.prisma
```

Then rebuild Docker:

```bash
docker compose up -d --build backend
```

**Testable:** Beekeeper → `ea_gateway.BarM15` table exists with correct columns and unique constraint on `(symbol, timeOpen)`.

---

## Step 2 — Backend: Extend `EaEventDto` for bar fields

Add optional OHLC fields to the existing DTO. All optional — validation only fires when present.

```typescript
// New optional fields on EaEventDto
@IsOptional() @IsString()   symbol?: string;
@IsOptional() @IsString()   timeOpen?: string;   // MT5 format: "2026.02.17 15:00:00"
@IsOptional() @IsString()   timeClose?: string;
@IsOptional() @IsNumber()   o?: number;          // open
@IsOptional() @IsNumber()   h?: number;          // high
@IsOptional() @IsNumber()   l?: number;          // low
@IsOptional() @IsNumber()   c?: number;          // close
@IsOptional() @IsInt()      tickVolume?: number;
@IsOptional() @IsInt()      spreadPoints?: number;
```

**Testable:** POST to `/api/ea/events` with bar payload via curl → HTTP 200.

```bash
curl -X POST http://localhost:80/api/ea/events \
  -H "Content-Type: application/json" \
  -d '{"type":"BAR_M15_CLOSED","terminalId":"FTMO_01","symbol":"EURUSD","timeOpen":"2026.02.17 15:00:00","timeClose":"2026.02.17 15:15:00","o":1.08300,"h":1.08400,"l":1.08200,"c":1.08350,"tickVolume":1234,"spreadPoints":12}'
```

---

## Step 3 — Backend: `BarM15Repository`

New file: `src/modules/ea-gateway/domain/repositories/bar-m15.repository.ts`

```typescript
@Injectable()
export class BarM15Repository {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(input: UpsertBarM15Input): Promise<void> {
    await this.prisma.barM15.upsert({
      where: { symbol_timeOpen: { symbol: input.symbol, timeOpen: input.timeOpen } },
      create: { ...input },
      update: {
        open: input.open,
        high: input.high,
        low: input.low,
        close: input.close,
        tickVolume: input.tickVolume,
        spreadPoints: input.spreadPoints,
        timeClose: input.timeClose,
      },
    });
  }
}

interface UpsertBarM15Input {
  symbol: string;
  timeOpen: Date;
  timeClose: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  tickVolume: number;
  spreadPoints: number;
  source: string;
}
```

Register in `ea-gateway.module.ts`:

```typescript
providers: [...CommandHandlers, ...Services, AuditEventRepository, BarM15Repository];
```

**Testable:** call upsert twice with same `(symbol, timeOpen)` → 1 row in DB, no error.

---

## Step 4 — Backend: `ProcessBarM15Command` + handler + controller routing

**New command:** `src/modules/ea-gateway/commands/impl/process-bar-m15.command.ts`

```typescript
export class ProcessBarM15Command {
  constructor(
    public readonly terminalId: string,
    public readonly symbol: string,
    public readonly timeOpen: Date,
    public readonly timeClose: Date,
    public readonly open: number,
    public readonly high: number,
    public readonly low: number,
    public readonly close: number,
    public readonly tickVolume: number,
    public readonly spreadPoints: number,
    public readonly sentAt: Date | undefined,
    public readonly seq: number | undefined,
  ) {}
}
```

**New handler:** `src/modules/ea-gateway/commands/handlers/process-bar-m15.handler.ts`

- Injects `BarM15Repository` and `AuditEventRepository`
- Calls `barM15Repository.upsert(...)` with MT5 date parsed to `Date`
- Calls `auditEventRepository.create(...)` to keep full audit trail
- Logs `[terminalId] BAR_M15_CLOSED symbol=EURUSD timeOpen=...`

**Controller routing** in `ea-gateway.controller.ts`:

```typescript
if (dto.type === 'BAR_M15_CLOSED') {
  await this.commandBus.execute(new ProcessBarM15Command(...));
} else {
  await this.commandBus.execute(new ProcessEaEventCommand(...));
}
```

**Add handler to module providers.**

**Testable:** POST `BAR_M15_CLOSED` → row appears in `BarM15` AND row in `AuditEvent`.

---

## Step 5 — EA: Add M15 bar close detector

Update `ea/HeartbeatEA.mq5` (or create `MainEA.mq5` for the full EA):

**New state variables:**

```mql5
datetime lastClosedBarTime = 0;
```

**In `OnInit`:**

```mql5
EventSetTimer(1); // fire every 1 second
```

**In `OnTimer`:**

```mql5
void OnTimer() {
  // Heartbeat (every HeartbeatSecs)
  if (TimeCurrent() - lastHeartbeatTime >= HeartbeatSecs) {
    SendHeartbeat();
    lastHeartbeatTime = TimeCurrent();
  }

  // M15 bar close detector
  CheckBarClose();
}
```

**`CheckBarClose` function:**

```mql5
void CheckBarClose() {
  MqlRates rates[];
  if (CopyRates(Symbol(), PERIOD_M15, 0, 2, rates) < 2) return;

  datetime closedBarTime = rates[1].time; // rates[1] = last closed bar
  if (closedBarTime <= lastClosedBarTime) return; // already sent

  lastClosedBarTime = closedBarTime;

  string timeOpen  = TimeToString(rates[1].time, TIME_DATE | TIME_SECONDS);
  string timeClose = TimeToString(rates[1].time + 900, TIME_DATE | TIME_SECONDS); // +15 min

  string body = StringFormat(
    "{\"type\":\"BAR_M15_CLOSED\",\"terminalId\":\"%s\",\"symbol\":\"%s\","
    "\"timeOpen\":\"%s\",\"timeClose\":\"%s\","
    "\"o\":%.5f,\"h\":%.5f,\"l\":%.5f,\"c\":%.5f,"
    "\"tickVolume\":%d,\"spreadPoints\":%d,\"sentAt\":\"%s\",\"seq\":%d}",
    TerminalId, Symbol(),
    timeOpen, timeClose,
    rates[1].open, rates[1].high, rates[1].low, rates[1].close,
    (int)rates[1].tick_volume, (int)rates[1].spread,
    TimeToString(TimeGMT(), TIME_DATE | TIME_SECONDS),
    ++sequenceNumber
  );

  // ... same WebRequest call as heartbeat ...
  int status = SendPost(BackendBaseUrl + "/api/ea/events", body);
  Print("BarSent | ", Symbol(), " | timeOpen=", timeOpen, " | HTTP=", status);
}
```

**Testable:** Journal shows `BarSent | EURUSD | timeOpen=... | HTTP=200` when an M15 bar closes.

---

## Step 6 — End-to-End Test

1. Rebuild and deploy backend (`docker compose up -d --build backend`)
2. Update EA on VPS with new code, recompile, reload on chart
3. Wait for the next M15 bar to close (at :00, :15, :30, :45)
4. Check Journal → `BarSent | EURUSD | HTTP=200`
5. Check Beekeeper → `ea_gateway.BarM15` → 1 new row, OHLC matches chart
6. Restart EA → wait for same bar to potentially resend → confirm still 1 row (upsert works)
7. Let it run for 1 hour → confirm 4 rows, no duplicates, no gaps

---

## MT5 Date Format Note

MT5 `TimeToString()` outputs `"2026.02.17 15:00:00"` (dots, space). This is NOT valid ISO 8601.
Parse on the backend with:

```typescript
const iso = raw.replace(/(\d{4})\.(\d{2})\.(\d{2})/, '$1-$2-$3').replace(' ', 'T') + 'Z';
return new Date(iso);
```

Place this helper in `BarM15Repository` or a shared `src/common/utils/date.ts`.

---

## File Checklist

| File                                                                  | Action                            |
| --------------------------------------------------------------------- | --------------------------------- |
| `src/database/schema.prisma`                                          | Add `BarM15` model                |
| `src/database/migrations/`                                            | New migration (auto-generated)    |
| `src/modules/ea-gateway/dto/requests/ea-event.dto.ts`                 | Add optional bar fields           |
| `src/modules/ea-gateway/domain/repositories/bar-m15.repository.ts`    | New file                          |
| `src/modules/ea-gateway/commands/impl/process-bar-m15.command.ts`     | New file                          |
| `src/modules/ea-gateway/commands/handlers/process-bar-m15.handler.ts` | New file                          |
| `src/modules/ea-gateway/controllers/ea-gateway.controller.ts`         | Add routing by event type         |
| `src/modules/ea-gateway/ea-gateway.module.ts`                         | Register new handler + repository |
| `ea/HeartbeatEA.mq5`                                                  | Add bar close detector            |

---

## Post-Implementation Notes

### EA send strategy (v1.03)

On every bar close the EA makes **2 HTTP calls**:

1. `GET /api/ea/last-bar` — asks backend for its last known bar (source of truth)
2. `POST /api/ea/events` — sends a JSON array of all missing closed bars since that point

This removes all local state dependency (no flags, no in-memory tracking). The backend is the single source of truth. Normal case sends 1 bar per close; backfill after an outage sends N bars in one batch.

**Latency note:** the extra GET adds ~50–100ms per bar close. At M15 frequency this is negligible for strategy detection on closed bars. If future implementations require lower latency (e.g. tick-level execution or very short timeframes), consider switching back to a single POST per close with a server-side dedup mechanism instead.
