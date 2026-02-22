---
name: m4.5-historical-backfill
description: Implementation plan for Milestone 4.5 — Historical Data Backfill (6 Months). Covers all steps from backend state management to EA chunked uploads, with testable definition of done for each step.
---

# Milestone 4.5 — Historical Data Backfill (6 Months)

## Overview

**Goal:** Automatically load 6 months (~17,520 bars) of historical M15 data from MT5 into the backend database to enable comprehensive S1 signal testing and strategy validation.

**Key Architectural Decisions:**

1. **Data Source:** MT5 EA fetches bars via `CopyRates()` — no external APIs or CSV exports needed
2. **Trigger Mechanism:** Piggyback on existing `GET /api/ea/last-bar` endpoint — zero extra HTTP polling
3. **Transport:** Chunked uploads (500 bars/chunk) to avoid timeouts and enable resilience
4. **Module:** Uses `backtest` module, keeping separation from live `ea-gateway` infrastructure
5. **Concurrency:** Multiple symbols can backfill simultaneously via async handlers

---

## Implementation Steps

### Step 1: Backend State Management

**Goal:** Create in-memory state to track which symbols need historical backfill.

**Files to create/modify:**

1. **Create backfill state service:**

```typescript
// apps/backend/src/modules/backtest/domain/services/backfill-state.service.ts

import { Injectable } from '@nestjs/common';

export interface BackfillRequest {
  symbol: string;
  barsRequested: number;
  barsIngested: number;
  chunksReceived: number;
  totalChunks: number;
  createdAt: Date;
}

@Injectable()
export class BackfillStateService {
  private readonly requests = new Map<string, BackfillRequest>();

  createRequest(symbol: string, barsCount: number): BackfillRequest {
    const totalChunks = Math.ceil(barsCount / 500);
    const request: BackfillRequest = {
      symbol,
      barsRequested: barsCount,
      barsIngested: 0,
      chunksReceived: 0,
      totalChunks,
      createdAt: new Date(),
    };
    this.requests.set(symbol, request);
    return request;
  }

  getRequest(symbol: string): BackfillRequest | undefined {
    return this.requests.get(symbol);
  }

  incrementProgress(symbol: string, barsCount: number): BackfillRequest | undefined {
    const request = this.requests.get(symbol);
    if (!request) return undefined;

    request.barsIngested += barsCount;
    request.chunksReceived += 1;
    return request;
  }

  completeRequest(symbol: string): void {
    this.requests.delete(symbol);
  }

  getAllRequests(): BackfillRequest[] {
    return Array.from(this.requests.values());
  }
}
```

2. **Register in BacktestModule:**

```typescript
// apps/backend/src/modules/backtest/backtest.module.ts

import { BackfillStateService } from './domain/services/backfill-state.service';

const Services = [
  BacktestService,
  HistoricalDataService,
  SimulatedFillService,
  SimulatedStateService,
  BackfillStateService, // NEW
];
```

**Testable Definition of Done:**

- [ ] `BackfillStateService` can create, get, update, and delete backfill requests
- [ ] Multiple symbols can have active requests simultaneously
- [ ] Progress tracking works (barsIngested increments correctly)

---

### Step 2: Admin Trigger Endpoint

**Goal:** Create endpoint to trigger historical backfill for one or more symbols.

**Files to create/modify:**

1. **Create DTO:**

```typescript
// apps/backend/src/modules/backtest/dto/requests/request-historical-backfill.dto.ts

import { IsString, IsNotEmpty, IsNumber, Min, Max } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RequestHistoricalBackfillDto {
  @ApiProperty({ example: 'EURUSD' })
  @IsString()
  @IsNotEmpty()
  symbol: string;

  @ApiProperty({ example: 17520, description: 'Number of M15 bars to backfill (max 50000)' })
  @IsNumber()
  @Min(1)
  @Max(50000)
  barsCount: number;
}
```

2. **Add controller endpoint:**

```typescript
// apps/backend/src/modules/backtest/controllers/backtest.controller.ts

import { RequestHistoricalBackfillDto } from '../dto/requests/request-historical-backfill.dto';
import { BackfillStateService } from '../domain/services/backfill-state.service';

@Post('request-historical-backfill')
@ApiOperation({ summary: 'Trigger historical data backfill from EA for a symbol' })
async requestHistoricalBackfill(@Body() dto: RequestHistoricalBackfillDto) {
  const request = this.backfillStateService.createRequest(dto.symbol, dto.barsCount);
  return {
    message: `Historical backfill requested for ${dto.symbol}`,
    barsRequested: request.barsRequested,
    totalChunks: request.totalChunks,
    note: 'EA will pick up this request on next bar close',
  };
}

@Get('backfill-status')
@ApiOperation({ summary: 'Get status of all active backfill requests' })
async getBackfillStatus() {
  return this.backfillStateService.getAllRequests();
}
```

**Testable Definition of Done:**

- [ ] `POST /api/backtest/request-historical-backfill` creates backfill request
- [ ] Response shows barsRequested and totalChunks
- [ ] `GET /api/backtest/backfill-status` lists all active requests
- [ ] Multiple symbols can be triggered (e.g., EURUSD, GBPUSD, USDJPY)

---

### Step 3: Enhance Last-Bar Response

**Goal:** Modify `GET /api/ea/last-bar` to include historical backfill flag when requested.

**Files to modify:**

1. **Update GetLastBarHandler:**

```typescript
// apps/backend/src/modules/ea-gateway/queries/handlers/get-last-bar.handler.ts

import { BackfillStateService } from '../../../backtest/domain/services/backfill-state.service';

@QueryHandler(GetLastBarQuery)
export class GetLastBarHandler implements IQueryHandler<GetLastBarQuery> {
  constructor(
    private readonly barM15Repository: BarM15Repository,
    private readonly backfillStateService: BackfillStateService, // NEW
  ) {}

  async execute(query: GetLastBarQuery): Promise<{
    timeOpen: string | null;
    historicalBackfill?: {
      requested: boolean;
      barsCount: number;
    };
  }> {
    const lastBar = await this.barM15Repository.findLatest(query.symbol);

    // Check if historical backfill requested
    const backfillRequest = this.backfillStateService.getRequest(query.symbol);

    const response: any = {
      timeOpen: lastBar?.timeOpen.toISOString() ?? null,
    };

    if (backfillRequest) {
      response.historicalBackfill = {
        requested: true,
        barsCount: backfillRequest.barsRequested,
      };
    }

    return response;
  }
}
```

2. **Update EaGatewayModule imports:**

```typescript
// apps/backend/src/modules/ea-gateway/ea-gateway.module.ts

import { BacktestModule } from '../backtest/backtest.module';

@Module({
  imports: [DatabaseModule, BacktestModule], // Import BacktestModule
  // ...
})
```

**Testable Definition of Done:**

- [ ] `GET /api/ea/last-bar?symbol=EURUSD` returns normal response when no backfill requested
- [ ] After triggering backfill, response includes `historicalBackfill: { requested: true, barsCount: 17520 }`
- [ ] Response reverts to normal after backfill completes

---

### Step 4: Chunk Ingestion Endpoint

**Goal:** Create endpoint for EA to submit chunks of historical bars.

**Files to create:**

1. **Create DTO:**

```typescript
// apps/backend/src/modules/backtest/dto/requests/submit-historical-chunk.dto.ts

import { IsString, IsNotEmpty, IsArray, ValidateNested, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class HistoricalBarDto {
  @ApiProperty()
  @IsString()
  timeOpen: string;

  @ApiProperty()
  @IsString()
  timeClose: string;

  @ApiProperty()
  @IsNumber()
  open: number;

  @ApiProperty()
  @IsNumber()
  high: number;

  @ApiProperty()
  @IsNumber()
  low: number;

  @ApiProperty()
  @IsNumber()
  close: number;

  @ApiProperty()
  @IsNumber()
  tickVolume: number;

  @ApiProperty()
  @IsNumber()
  spreadPoints: number;
}

export class SubmitHistoricalChunkDto {
  @ApiProperty({ example: 'EURUSD' })
  @IsString()
  @IsNotEmpty()
  symbol: string;

  @ApiProperty({ example: 0 })
  @IsNumber()
  chunkIndex: number;

  @ApiProperty({ type: [HistoricalBarDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => HistoricalBarDto)
  bars: HistoricalBarDto[];
}
```

2. **Create command and handler:**

```typescript
// apps/backend/src/modules/backtest/commands/impl/process-historical-chunk.command.ts

import { HistoricalBarDto } from '../../dto/requests/submit-historical-chunk.dto';

export class ProcessHistoricalChunkCommand {
  constructor(
    public readonly symbol: string,
    public readonly chunkIndex: number,
    public readonly bars: HistoricalBarDto[],
  ) {}
}
```

```typescript
// apps/backend/src/modules/backtest/commands/handlers/process-historical-chunk.handler.ts

import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { Logger } from '@nestjs/common';
import { ProcessHistoricalChunkCommand } from '../impl/process-historical-chunk.command';
import { BarM15Repository } from '../../../ea-gateway/domain/repositories/bar-m15.repository';
import { BackfillStateService } from '../../domain/services/backfill-state.service';

export interface ProcessHistoricalChunkResult {
  symbol: string;
  chunkIndex: number;
  barsIngested: number;
  totalIngested: number;
  chunksReceived: number;
  totalChunks: number;
  progress: number; // percentage
}

@CommandHandler(ProcessHistoricalChunkCommand)
export class ProcessHistoricalChunkHandler implements ICommandHandler<ProcessHistoricalChunkCommand> {
  private readonly logger = new Logger(ProcessHistoricalChunkHandler.name);

  constructor(
    private readonly barM15Repository: BarM15Repository,
    private readonly backfillStateService: BackfillStateService,
  ) {}

  async execute(command: ProcessHistoricalChunkCommand): Promise<ProcessHistoricalChunkResult> {
    const { symbol, chunkIndex, bars } = command;

    this.logger.log(`Processing historical chunk ${chunkIndex} for ${symbol}: ${bars.length} bars`);

    // Insert bars into BarM15
    for (const bar of bars) {
      await this.barM15Repository.upsert({
        symbol,
        timeOpen: new Date(bar.timeOpen),
        timeClose: new Date(bar.timeClose),
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        tickVolume: bar.tickVolume,
        spreadPoints: bar.spreadPoints,
        source: 'HISTORICAL',
      });
    }

    // Update progress
    const request = this.backfillStateService.incrementProgress(symbol, bars.length);

    if (!request) {
      this.logger.warn(`No backfill request found for ${symbol} - chunk processed but not tracked`);
      return {
        symbol,
        chunkIndex,
        barsIngested: bars.length,
        totalIngested: bars.length,
        chunksReceived: 1,
        totalChunks: 1,
        progress: 100,
      };
    }

    const progress = Math.round((request.barsIngested / request.barsRequested) * 100);

    this.logger.log(
      `Historical backfill progress for ${symbol}: ${request.chunksReceived}/${request.totalChunks} chunks (${progress}%)`,
    );

    return {
      symbol,
      chunkIndex,
      barsIngested: bars.length,
      totalIngested: request.barsIngested,
      chunksReceived: request.chunksReceived,
      totalChunks: request.totalChunks,
      progress,
    };
  }
}
```

3. **Add controller endpoint:**

```typescript
// apps/backend/src/modules/backtest/controllers/backtest.controller.ts

import { SubmitHistoricalChunkDto } from '../dto/requests/submit-historical-chunk.dto';
import { ProcessHistoricalChunkCommand } from '../commands/impl/process-historical-chunk.command';
import { CommandBus } from '@nestjs/cqrs';

@Post('historical-bars/chunk')
@ApiOperation({ summary: 'Submit a chunk of historical bars from EA' })
async submitHistoricalChunk(@Body() dto: SubmitHistoricalChunkDto) {
  return this.commandBus.execute(
    new ProcessHistoricalChunkCommand(dto.symbol, dto.chunkIndex, dto.bars),
  );
}
```

4. **Register handler in BacktestModule:**

```typescript
// apps/backend/src/modules/backtest/backtest.module.ts

import { CqrsModule } from '@nestjs/cqrs';
import { ProcessHistoricalChunkHandler } from './commands/handlers/process-historical-chunk.handler';

@Module({
  imports: [DatabaseModule, CqrsModule],
  controllers: [BacktestController],
  providers: [
    ...Services,
    BacktestRunRepository,
    ProcessHistoricalChunkHandler,
  ],
  exports: [BackfillStateService],
})
```

**Testable Definition of Done:**

- [ ] `POST /api/backtest/historical-bars/chunk` accepts 500 bars and inserts them
- [ ] Response shows progress: chunksReceived, totalChunks, progress percentage
- [ ] Bars are inserted with `source='HISTORICAL'`
- [ ] Duplicate bars (same symbol + timeOpen) are handled by upsert (no errors)
- [ ] Progress tracking updates correctly after each chunk

---

### Step 5: Completion Endpoint

**Goal:** Allow EA to signal completion and clear backfill request.

**Files to create:**

1. **Create DTO:**

```typescript
// apps/backend/src/modules/backtest/dto/requests/complete-historical-backfill.dto.ts

import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CompleteHistoricalBackfillDto {
  @ApiProperty({ example: 'EURUSD' })
  @IsString()
  @IsNotEmpty()
  symbol: string;
}
```

2. **Add controller endpoint:**

```typescript
// apps/backend/src/modules/backtest/controllers/backtest.controller.ts

import { CompleteHistoricalBackfillDto } from '../dto/requests/complete-historical-backfill.dto';

@Post('historical-backfill/complete')
@ApiOperation({ summary: 'EA signals completion of historical backfill' })
async completeHistoricalBackfill(@Body() dto: CompleteHistoricalBackfillDto) {
  this.backfillStateService.completeRequest(dto.symbol);
  return {
    message: `Historical backfill completed for ${dto.symbol}`,
  };
}
```

**Testable Definition of Done:**

- [ ] `POST /api/backtest/historical-backfill/complete { symbol: "EURUSD" }` clears request
- [ ] After completion, `GET /api/ea/last-bar?symbol=EURUSD` no longer includes historicalBackfill flag
- [ ] `GET /api/backtest/backfill-status` no longer shows completed symbol

---

### Step 6: EA Implementation

**Goal:** Modify EA to detect backfill requests and send chunks.

**Files to modify:**

1. **Update HeartbeatEA.mq5:**

```mql5
// Add after BackfillMissingBars() function

//+------------------------------------------------------------------+
//| CheckHistoricalBackfillRequest                                    |
//| Called from BackfillMissingBars after parsing last-bar response  |
//| If historicalBackfill flag detected, executes chunked upload      |
//+------------------------------------------------------------------+
void CheckHistoricalBackfillRequest(string lastBarResponse)
{
   // Parse historicalBackfill section
   int backfillPos = StringFind(lastBarResponse, "\"historicalBackfill\"");
   if(backfillPos < 0)
      return; // No backfill requested

   // Extract barsCount
   int barsCountPos = StringFind(lastBarResponse, "\"barsCount\":", backfillPos);
   if(barsCountPos < 0)
      return;

   string substr = StringSubstr(lastBarResponse, barsCountPos + 13);
   int commaPos = StringFind(substr, ",");
   int bracePos = StringFind(substr, "}");
   int endPos = (commaPos > 0 && commaPos < bracePos) ? commaPos : bracePos;

   string barsCountStr = StringSubstr(substr, 0, endPos);
   StringTrimLeft(barsCountStr);
   StringTrimRight(barsCountStr);

   int barsCount = (int)StringToInteger(barsCountStr);

   if(barsCount <= 0)
      return;

   Print("Historical backfill requested: ", barsCount, " bars for ", Symbol());

   ExecuteHistoricalBackfill(Symbol(), barsCount);
}

//+------------------------------------------------------------------+
//| ExecuteHistoricalBackfill                                         |
//| Fetches historical bars and sends in chunks of 500               |
//+------------------------------------------------------------------+
void ExecuteHistoricalBackfill(string symbol, int totalBars)
{
   const int CHUNK_SIZE = 500;
   int totalChunks = (int)MathCeil(totalBars / (double)CHUNK_SIZE);

   Print("Starting historical backfill: ", totalBars, " bars in ", totalChunks, " chunks");

   // Fetch all bars at once
   MqlRates rates[];
   ArraySetAsSeries(rates, false); // Chronological order (oldest first)

   int copied = CopyRates(symbol, PERIOD_M15, 0, totalBars, rates);

   if(copied <= 0)
   {
      Print("Historical backfill FAILED: CopyRates returned 0");
      return;
   }

   Print("Fetched ", copied, " bars from MT5 history");

   // Send in chunks
   for(int chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++)
   {
      int startIdx = chunkIndex * CHUNK_SIZE;
      int endIdx = MathMin(startIdx + CHUNK_SIZE, copied);
      int chunkSize = endIdx - startIdx;

      // Build JSON for this chunk
      string items = "";

      for(int i = startIdx; i < endIdx; i++)
      {
         string timeOpen  = TimeToString(rates[i].time,       TIME_DATE | TIME_SECONDS);
         string timeClose = TimeToString(rates[i].time + 900, TIME_DATE | TIME_SECONDS);

         string item = StringFormat(
            "{\\\"timeOpen\\\":\\\"%s\\\",\\\"timeClose\\\":\\\"%s\\\",\\\"open\\\":%.5f,\\\"high\\\":%.5f,\\\"low\\\":%.5f,\\\"close\\\":%.5f,\\\"tickVolume\\\":%d,\\\"spreadPoints\\\":%d}",
            timeOpen, timeClose,
            rates[i].open, rates[i].high, rates[i].low, rates[i].close,
            (int)rates[i].tick_volume, (int)rates[i].spread
         );

         if(i > startIdx)
            items += ",";
         items += item;
      }

      string body = StringFormat(
         "{\\\"symbol\\\":\\\"%s\\\",\\\"chunkIndex\\\":%d,\\\"bars\\\":[%s]}",
         symbol, chunkIndex, items
      );

      int status = SendHistoricalChunk(body);

      if(status != 200)
      {
         Print("Historical backfill FAILED: HTTP ", status, " at chunk ", chunkIndex);
         return;
      }

      Print("Historical backfill progress: chunk ", chunkIndex + 1, "/", totalChunks, " (", chunkSize, " bars)");

      Sleep(100); // Small delay between chunks
   }

   // Signal completion
   CompleteHistoricalBackfill(symbol);

   Print("Historical backfill COMPLETED: ", copied, " bars for ", symbol);
}

//+------------------------------------------------------------------+
//| SendHistoricalChunk                                               |
//+------------------------------------------------------------------+
int SendHistoricalChunk(string body)
{
   string url        = BackendBaseUrl + "/api/backtest/historical-bars/chunk";
   string reqHeaders = "Content-Type: application/json\r\n";
   char   postData[];
   char   result[];
   string resultHeaders;

   StringToCharArray(body, postData, 0, StringLen(body));

   return WebRequest("POST", url, reqHeaders, 10000, postData, result, resultHeaders);
}

//+------------------------------------------------------------------+
//| CompleteHistoricalBackfill                                        |
//+------------------------------------------------------------------+
void CompleteHistoricalBackfill(string symbol)
{
   string body = StringFormat("{\\\"symbol\\\":\\\"%s\\\"}", symbol);

   string url        = BackendBaseUrl + "/api/backtest/historical-backfill/complete";
   string reqHeaders = "Content-Type: application/json\r\n";
   char   postData[];
   char   result[];
   string resultHeaders;

   StringToCharArray(body, postData, 0, StringLen(body));

   WebRequest("POST", url, reqHeaders, 5000, postData, result, resultHeaders);
}
```

2. **Modify BackfillMissingBars to check for historical backfill:**

```mql5
void BackfillMissingBars()
{
   // ... existing code ...

   string lastKnownIso = QueryLastBar(Symbol());

   // NEW: Check for historical backfill request
   CheckHistoricalBackfillRequest(lastKnownIso);

   // ... rest of existing backfill logic ...
}
```

**Testable Definition of Done:**

- [ ] EA detects `historicalBackfill` flag in last-bar response
- [ ] EA fetches requested number of bars via `CopyRates()`
- [ ] EA sends bars in chunks of 500
- [ ] EA logs progress: "chunk 15/36 (500 bars)"
- [ ] EA calls completion endpoint after all chunks sent
- [ ] EA handles HTTP errors gracefully (logs and stops, doesn't crash)

---

## End-to-End Testing

### Test Case 1: Single Symbol Backfill

1. **Trigger:** `POST /api/backtest/request-historical-backfill { symbol: "EURUSD", barsCount: 17520 }`
2. **Verify:** `GET /api/backtest/backfill-status` shows active request
3. **Wait:** EA detects request on next bar close (~15 seconds max)
4. **Monitor:** EA logs show "chunk 1/36", "chunk 2/36", etc.
5. **Verify progress:** Call `GET /api/backtest/backfill-status` during upload, see progress increase
6. **Wait:** ~2-3 minutes for all 36 chunks
7. **Verify completion:** `GET /api/backtest/backfill-status` shows no active requests
8. **Query DB:** `SELECT COUNT(*) FROM "BarM15" WHERE symbol='EURUSD' AND source='HISTORICAL'` returns 17520
9. **Run replay:** `POST /admin/replay-s1-signals { symbol: "EURUSD" }` processes all bars successfully

### Test Case 2: Multiple Symbols Concurrently

1. **Trigger 3 symbols:**
   - `POST /api/backtest/request-historical-backfill { symbol: "EURUSD", barsCount: 17520 }`
   - `POST /api/backtest/request-historical-backfill { symbol: "GBPUSD", barsCount: 17520 }`
   - `POST /api/backtest/request-historical-backfill { symbol: "USDJPY", barsCount: 17520 }`
2. **Verify:** `GET /api/backtest/backfill-status` shows 3 active requests
3. **Run 3 EA instances:** One chart for each symbol (EURUSD, GBPUSD, USDJPY)
4. **Monitor:** All 3 EAs upload concurrently (logs interleaved)
5. **Verify:** All 3 complete within ~3-4 minutes
6. **Query DB:** All 3 symbols have 17520 bars with `source='HISTORICAL'`

### Test Case 3: Resume After Interruption

1. **Trigger:** `POST /api/backtest/request-historical-backfill { symbol: "EURUSD", barsCount: 17520 }`
2. **Wait:** Let EA upload 10 chunks (monitor logs)
3. **Stop EA:** Close MT5 or disable EA
4. **Verify DB:** ~5000 bars inserted (10 chunks × 500)
5. **Restart EA:** Recompile and attach to chart
6. **Monitor:** EA continues from where it left off (upsert handles duplicates)
7. **Verify completion:** All 17520 bars eventually in DB
8. **Check duplicates:** No duplicate rows (unique constraint on symbol + timeOpen)

---

## Definition of Done (Complete Milestone)

- [ ] Backend accepts backfill trigger via `POST /api/backtest/request-historical-backfill`
- [ ] `GET /api/ea/last-bar` includes historicalBackfill flag when requested
- [ ] EA detects flag and executes chunked upload automatically
- [ ] Chunks are processed and inserted into BarM15 with `source='HISTORICAL'`
- [ ] Progress is tracked and visible via `GET /api/backtest/backfill-status`
- [ ] Completion endpoint clears backfill request
- [ ] 17,520 bars for EURUSD load successfully in ~2-3 minutes
- [ ] Multiple symbols can backfill concurrently (tested with 3 symbols)
- [ ] Unique constraint prevents duplicates (idempotent uploads)
- [ ] Replay endpoints (Asia Range, S1 signals) work with full 6-month dataset
- [ ] EA handles errors gracefully (logs, doesn't crash)

---

## Notes

**Why 500 bars per chunk?**
- Chunk size: ~133 KB (small enough for reliable network transmission)
- Processing time: ~1-2 seconds per chunk (backend inserts 500 bars)
- Total time: 36 chunks × 2s = ~72 seconds + network overhead = ~2-3 minutes

**Why in-memory state?**
- Simple for M4.5 (no DB schema changes needed)
- Fast lookups on every `GET /api/ea/last-bar` call
- Optional: Migrate to DB or Redis later for persistence across backend restarts

**Why piggyback on last-bar?**
- Zero extra HTTP polling (reuses existing 1/second check that only triggers on bar close)
- EA naturally checks every bar close, perfect for triggering backfill
- No new timer/polling logic in EA needed

**Source field differentiation:**
- `FTMO_LIVE` - Real-time bars from live EA
- `HISTORICAL` - Backfilled bars from this M4.5 implementation
- Allows filtering/debugging if needed
