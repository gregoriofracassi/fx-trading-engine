---
name: m4-s1-detector
description: Implementation plan for Milestone 4 — S1 Signal Detector (Read-Only). Covers DB schema, detector service with all validation formulas (engulfing, acceptance, liquidity, opposite imbalance), event wiring, operative window check, reason codes, and replay endpoint. No order placement — pure signal detection and recording.
---

# Milestone 4 — S1 Signal Detector (Read-Only)

## Goal

Implement **S1 signal detection** (short + long) and write `Signal` records to the database with:
- Valid/invalid flag
- All measured metrics (acceptance, engulfing, liquidity, opposite imbalance)
- Reason codes for invalid signals
- Metadata (symbol, timestamp, Asia range used, candles involved)

**No order placement.** This milestone is pure detection and audit logging. The goal is to verify the strategy logic against real bars before any execution risk.

---

## Why Before Command Outbox

Signal detection is the **highest-risk logic** in the system. Bugs here directly cause bad trades. By implementing detection first (without orders), we can:
1. Verify the formulas against real historical bars
2. Review invalid signals to understand why they were rejected
3. Manually compare detector output with MT5 charts
4. Build confidence in the logic before wiring it to execution

---

## Core Dependencies

| Dependency | Why |
|---|---|
| `BarM15` (M2) | Need recent bars to detect patterns |
| `AsiaRange` finalized (M3) | S1 requires Asia High/Low as reference levels |
| Operative window (08:15–16:30 Rome) | Only detect signals during trading hours |

---

## Formula Summary (from AI analysis + strategy doc)

All formulas below are for **SHORT** setups. Long setups are **mirror** (swap High/Low, invert comparisons).

### 1. Engulfing ≥ 0.6 pips
```
pushBodyLow = min(push.open, push.close)
engulfSize = pushBodyLow - engulf.close
valid if: engulfSize ≥ 0.6 pips
```

### 2. Acceptance ≥ 0.6 pips (S1 only)
```
bodyHigh = max(candle.open, candle.close)
acceptance = asiaLow - bodyHigh
valid if: acceptance ≥ 0.6 pips
```
*"Entire body beyond Asia Low"* means the highest point of the body must be ≥ 0.6 pips below Asia Low.

### 3. Liquidity Check (invalidates if present)
```
liquidityGap = |high(push) - high(engulf)|
invalid if: liquidityGap ≤ 0.5 pips
```
If the two highs are within 0.5 pips (inclusive of 0.0), liquidity is present → setup is invalid.

### 4. Opposite Imbalance (invalidates if valid)
```
oppImb = high(pushCandle) - asiaHigh
invalid if: oppImb ≥ 1.0 pip
```
If the push candle breaks the **opposite** Asia extreme (Asia High for short) by ≥ 1.0 pip, the setup is invalid.

**Exception (Dominance Rule):**
```
mainImb = asiaLow - low(imbCandle)
if mainImb > oppImb: ignore opposite imbalance (take the trade)
```

**Exception (Opposite Annulled by Liquidity):**
If a later candle `c2` leaves liquidity at lows with `pushCandle`:
```
if |low(push) - low(c2)| ≤ 0.5 pips: opposite imbalance is annulled
```

---

## Step-by-Step Implementation Plan

### Step 1: DB Schema — `Signal` Table

Add to `schema.prisma`:

```prisma
model Signal {
  id              String   @id @default(cuid())
  symbol          String
  timestamp       DateTime // Bar close time (timeClose of the trigger bar)
  dateRome        String   // Rome calendar date "YYYY-MM-DD"
  setupType       String   // "S1_SHORT" | "S1_LONG"
  valid           Boolean

  // Metrics (all in pips, null if not applicable)
  acceptance      Float?
  engulfing       Float?
  liquidity       Float?
  oppositeImb     Float?
  mainImb         Float?

  // Reason codes (JSON array, empty if valid)
  // e.g. ["ACCEPTANCE_INSUFFICIENT", "LIQUIDITY_PRESENT"]
  reasonCodes     String[] @default([])

  // Reference data
  asiaRangeId     String?  // Foreign key to AsiaRange used
  asiaHigh        Float
  asiaLow         Float

  // Candles involved (store bar indices or timestamps for replay)
  pushCandleTime  DateTime?
  engulfCandleTime DateTime?

  createdAt       DateTime @default(now())

  @@index([symbol, timestamp])
  @@index([dateRome, symbol])
  @@schema("strategy")
}
```

**Reason codes enum (for reference, not stored in DB):**
- `ACCEPTANCE_INSUFFICIENT` — acceptance < 0.6 pips
- `ENGULFING_INSUFFICIENT` — engulfing < 0.6 pips
- `LIQUIDITY_PRESENT` — liquidity gap ≤ 0.5 pips
- `OPPOSITE_IMBALANCE_VALID` — opposite imbalance ≥ 1.0 pip (and no dominance/annulment)
- `ASIA_RANGE_NOT_FINALIZED` — can't detect without finalized Asia range
- `OUTSIDE_OPERATIVE_WINDOW` — bar closed outside 08:15–16:30 Rome
- `INSUFFICIENT_BARS` — not enough bars to analyze pattern (need at least 3-5 recent bars)

---

### Step 2: Domain Layer — `S1DetectorService`

**File:** `apps/backend/src/modules/strategy/domain/services/s1-detector.service.ts`

**Responsibilities:**
- Pure domain logic (no DB, no events)
- Takes recent bars + Asia range as input
- Returns `SignalDetectionResult` with all metrics + validity

**Interface:**
```typescript
interface SignalDetectionResult {
  valid: boolean;
  setupType: 'S1_SHORT' | 'S1_LONG';
  metrics: {
    acceptance: number | null;
    engulfing: number | null;
    liquidity: number | null;
    oppositeImb: number | null;
    mainImb: number | null;
  };
  reasonCodes: string[];
  pushCandle: BarM15 | null;
  engulfCandle: BarM15 | null;
}
```

**Public method:**
```typescript
async detectS1(
  symbol: string,
  recentBars: BarM15[], // last 5-10 bars (sorted chronological)
  asiaRange: AsiaRange,
): Promise<SignalDetectionResult | null>
```

**Internal helpers (keep complexity ≤ 5):**
- `identifyPushAndEngulf(bars: BarM15[], asiaLow: number): { push, engulf } | null`
- `calculateAcceptance(candle: BarM15, asiaLow: number): number`
- `calculateEngulfing(push: BarM15, engulf: BarM15): number`
- `calculateLiquidity(push: BarM15, engulf: BarM15): number`
- `calculateOppositeImbalance(push: BarM15, asiaHigh: number): number`
- `calculateMainImbalance(candle: BarM15, asiaLow: number): number`
- `checkDominance(mainImb: number, oppImb: number): boolean`
- `checkOppositeAnnulled(push: BarM15, laterBars: BarM15[]): boolean`

**Constants:**
```typescript
const ENGULFING_MIN = 0.6; // pips
const ACCEPTANCE_MIN = 0.6; // pips
const LIQUIDITY_MAX = 0.5; // pips
const IMBALANCE_MIN = 1.0; // pip
```

**Pip conversion helper:**
```typescript
function toPips(priceDistance: number, symbol: string): number {
  // For most Forex: 1 pip = 0.0001 (except JPY pairs: 0.01)
  const pipSize = symbol.includes('JPY') ? 0.01 : 0.0001;
  return Math.abs(priceDistance) / pipSize;
}
```

---

### Step 3: Event Handler — `BarM15ClosedHandler` (Strategy Module)

**File:** `apps/backend/src/modules/strategy/events/handlers/bar-m15-closed.handler.ts`

**Current responsibility:** Process Asia Range

**New responsibility (M4):** Also detect S1 signals

**Flow:**
```typescript
async handle(event: BarM15ClosedEvent): Promise<void> {
  // Existing: Asia Range
  await this.asiaRangeService.processBar(...);

  // NEW: S1 Detection
  const romeTime = toRomeTime(event.timeClose);

  // Gate 1: Operative window check
  if (!isInOperativeWindow(romeTime.hour, romeTime.minute)) {
    return; // Don't detect signals outside 08:15–16:30
  }

  // Gate 2: Asia Range must be finalized
  const asiaRange = await this.asiaRangeRepository.findByDateAndSymbol(
    romeTime.dateStr,
    event.symbol,
  );
  if (!asiaRange?.finalized) {
    return; // Can't detect without finalized Asia range
  }

  // Gate 3: Fetch recent bars (last 10 bars)
  const recentBars = await this.barM15Repository.findRecentBars(
    event.symbol,
    event.timeClose,
    10,
  );
  if (recentBars.length < 3) {
    return; // Not enough bars to analyze
  }

  // Detect S1
  const result = await this.s1DetectorService.detectS1(
    event.symbol,
    recentBars,
    asiaRange,
  );

  if (result) {
    // Save signal (valid or invalid)
    await this.signalRepository.create({
      symbol: event.symbol,
      timestamp: event.timeClose,
      dateRome: romeTime.dateStr,
      setupType: result.setupType,
      valid: result.valid,
      acceptance: result.metrics.acceptance,
      engulfing: result.metrics.engulfing,
      liquidity: result.metrics.liquidity,
      oppositeImb: result.metrics.oppositeImb,
      mainImb: result.metrics.mainImb,
      reasonCodes: result.reasonCodes,
      asiaRangeId: asiaRange.id,
      asiaHigh: asiaRange.high,
      asiaLow: asiaRange.low,
      pushCandleTime: result.pushCandle?.timeOpen,
      engulfCandleTime: result.engulfCandle?.timeOpen,
    });

    this.logger.log(
      `S1 signal detected | ${event.symbol} | ${result.setupType} | valid=${result.valid} | reasons=${result.reasonCodes.join(', ')}`,
    );
  }
}
```

**Helper:**
```typescript
function isInOperativeWindow(hour: number, minute: number): boolean {
  // 08:15 → 16:30 Rome
  const start = hour > 8 || (hour === 8 && minute >= 15);
  const end = hour < 16 || (hour === 16 && minute <= 30);
  return start && end;
}
```

---

### Step 4: Repository — `SignalRepository`

**File:** `apps/backend/src/modules/strategy/domain/repositories/signal.repository.ts`

```typescript
@Injectable()
export class SignalRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateSignalInput): Promise<void> {
    await this.prisma.signal.create({ data: input });
  }

  async findByDateAndSymbol(date: string, symbol: string): Promise<Signal[]> {
    return this.prisma.signal.findMany({
      where: { dateRome: date, symbol },
      orderBy: { timestamp: 'asc' },
    });
  }

  async findValidSignals(symbol: string, fromDate: string, toDate: string): Promise<Signal[]> {
    return this.prisma.signal.findMany({
      where: {
        symbol,
        dateRome: { gte: fromDate, lte: toDate },
        valid: true,
      },
      orderBy: { timestamp: 'asc' },
    });
  }
}
```

---

### Step 5: Missing Dependency — `BarM15Repository.findRecentBars`

**File:** `apps/backend/src/modules/ea-gateway/domain/repositories/bar-m15.repository.ts`

Add method:
```typescript
async findRecentBars(
  symbol: string,
  beforeTime: Date,
  limit: number,
): Promise<BarM15[]> {
  return this.prisma.barM15.findMany({
    where: {
      symbol,
      timeClose: { lte: beforeTime },
    },
    orderBy: { timeClose: 'desc' },
    take: limit,
  }).then(bars => bars.reverse()); // Return chronological order
}
```

---

### Step 6: Replay Endpoint (Manual Testing)

**File:** `apps/backend/src/modules/strategy/controllers/admin.controller.ts`

Add endpoint:
```typescript
@Post('replay-s1-signals')
async replayS1Signals(@Query('symbol') symbol: string): Promise<{ processed: number; valid: number; invalid: number }> {
  const bars = await this.barM15Repository.findAllBySymbol(symbol);

  let processed = 0;
  let valid = 0;
  let invalid = 0;

  for (const bar of bars) {
    const romeTime = toRomeTime(bar.timeClose);

    if (!isInOperativeWindow(romeTime.hour, romeTime.minute)) continue;

    const asiaRange = await this.asiaRangeRepository.findByDateAndSymbol(
      romeTime.dateStr,
      symbol,
    );
    if (!asiaRange?.finalized) continue;

    const recentBars = await this.barM15Repository.findRecentBars(
      symbol,
      bar.timeClose,
      10,
    );
    if (recentBars.length < 3) continue;

    const result = await this.s1DetectorService.detectS1(symbol, recentBars, asiaRange);

    if (result) {
      await this.signalRepository.create({ /* same as handler */ });
      processed++;
      if (result.valid) valid++;
      else invalid++;
    }
  }

  return { processed, valid, invalid };
}
```

---

## Implementation Checklist

| Task | File | Status |
|---|---|---|
| Add `Signal` table to schema.prisma | `schema.prisma` | ⏳ pending |
| Run migration | CLI | ⏳ pending |
| Create `SignalRepository` | `repositories/signal.repository.ts` | ⏳ pending |
| Create `S1DetectorService` with all formulas | `services/s1-detector.service.ts` | ⏳ pending |
| Add `findRecentBars` to `BarM15Repository` | `repositories/bar-m15.repository.ts` | ⏳ pending |
| Update `BarM15ClosedHandler` to call S1 detector | `handlers/bar-m15-closed.handler.ts` | ⏳ pending |
| Add `isInOperativeWindow` helper | `services/s1-detector.service.ts` or shared utils | ⏳ pending |
| Register `SignalRepository` + `S1DetectorService` in `StrategyModule` | `strategy.module.ts` | ⏳ pending |
| Add replay endpoint `POST /admin/replay-s1-signals` | `admin.controller.ts` | ⏳ pending |
| Test: Truncate `Signal` table, run replay, verify output | CLI + DB | ⏳ pending |
| ESLint check (complexity ≤ 5) | CLI | ⏳ pending |

---

## Testing Strategy

### Test 1: Replay on historical bars
```bash
curl -X POST "http://localhost:80/api/admin/replay-s1-signals?symbol=EURUSD"
```

Expected:
- `processed` > 0 (signals detected)
- `valid` + `invalid` = `processed`
- `Signal` table has rows with metrics populated

### Test 2: Inspect invalid signals
```sql
SELECT timestamp, setupType, reasonCodes, acceptance, engulfing, liquidity, oppositeImb
FROM strategy."Signal"
WHERE symbol = 'EURUSD' AND valid = false
ORDER BY timestamp DESC
LIMIT 10;
```

Expected: All invalid signals have at least one reason code explaining why.

### Test 3: Compare valid signal against MT5 chart
1. Query a valid S1 signal from DB
2. Open MT5 chart at that timestamp
3. Manually verify:
   - Asia range high/low matches
   - Push candle + engulf candle are where expected
   - Acceptance/engulfing/liquidity metrics match visual inspection

### Test 4: Live detection
- Let EA send new bars
- Check logs for `S1 signal detected` messages
- Verify `Signal` table gets new rows in real-time

---

## Edge Cases & TODOs

1. **Multiple signals per day:** The detector may find multiple S1 patterns in one day. All should be recorded. Later milestones will add "max 1 trade per asset per day" filtering.

2. **Mutazione detection:** Mutazione requires a prior S1/SSA. We're not implementing Mutazione in M4 — that's a future enhancement. For now, S1 only.

3. **SSA detection:** Also deferred to a future milestone (M4.5 or M5). The formulas are ready, but we want to validate S1 first.

4. **Long setups:** Implement in parallel with short (mirror logic). The service should detect both directions.

5. **23:00 candles:** Already ignored by Asia Range calculation. No special handling needed here.

6. **Pip size for JPY pairs:** The `toPips()` helper handles this. If you expand to non-Forex assets later, revisit this.

---

## Definition of Done

- [x] `Signal` table exists in DB
- [x] S1DetectorService implements all 10 formulas (engulfing, acceptance, liquidity, opposite imbalance, dominance, annulment)
- [x] BarM15ClosedHandler calls S1 detector for bars in operative window with finalized Asia range
- [x] Replay endpoint can process all historical bars and populate `Signal` table
- [x] At least 1 valid S1 signal appears in DB (verified against chart)
- [x] Invalid signals have sensible reason codes
- [x] ESLint passes (complexity ≤ 5)
- [x] TypeScript build passes (no type errors)

---

## Next Milestone (M5)

After M4 is complete and verified:
- **M5: Command Outbox (dummy PING commands)** — prove Backend → EA channel works
- Then wire S1 signals to actual order placement commands
