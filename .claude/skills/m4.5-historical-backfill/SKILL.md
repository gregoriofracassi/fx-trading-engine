---
name: m4.5-historical-backfill
description: Implementation plan for Milestone 4.5 — Historical Data Backfill (6 Months). Covers all steps from backend state management to EA chunked uploads, with testable definition of done for each step.
---

# Milestone 4.5 — Historical Data Backfill (6 Months)

## Overview

**Goal:** Automatically load 6 months (~17,520 bars) of historical M15 data from MT5 into the backend database to enable comprehensive S1 signal testing and strategy validation.

**Purpose:** Before testing the S1 signal detector with live data, we need historical data to validate the detector logic, test Asia range calculations, and ensure the strategy behaves correctly across different market conditions. This milestone provides the infrastructure to backfill months of data without manual CSV exports or external APIs.

---

## Architecture Philosophy

### Key Decisions

1. **Data Source: MT5 EA via CopyRates()**
   - No external APIs (FXCM, CSV exports, etc.)
   - EA has direct access to MT5 historical data (up to 100,000 bars)
   - Simplest, most reliable source of truth for the broker data we'll trade on

2. **Trigger Mechanism: Piggyback Pattern**
   - Reuse existing `GET /api/ea/last-bar` endpoint that EA calls on every bar close
   - Backend adds optional `historicalBackfill` section to response when backfill requested
   - Zero additional HTTP polling overhead

3. **Transport: Chunked Uploads**
   - 500 bars per chunk (~133 KB)
   - 36 chunks for 17,520 bars (6 months of M15 data)
   - Total upload time: ~2-3 minutes per symbol
   - Prevents timeouts, enables progress tracking

4. **Module Separation**
   - Uses `backtest` module (not `ea-gateway`)
   - Keeps backfill infrastructure separate from live trading
   - Clean separation of concerns: ea-gateway = live, backtest = historical

5. **State Management: In-Memory Map**
   - Simple `Map<symbol, BackfillRequest>` in BackfillStateService
   - Fast lookups (checked on every bar close)
   - Sufficient for M4.5 (backfill completes in 2-3 minutes, low risk of backend restart)
   - **Future consideration:** Migrate to Redis for persistence across restarts

6. **Concurrency: Async Handlers**
   - Multiple symbols can backfill simultaneously
   - Each EA instance (attached to different symbol charts) uploads independently
   - Backend handles concurrent chunk ingestion via async CQRS handlers
   - **Future consideration:** Use BullMQ for background job processing to avoid blocking live bar ingestion

---

## System Flow

### 1. Admin Triggers Backfill

**Actor:** Admin (via Postman, curl, or future admin UI)

**Action:** `POST /api/backtest/request-historical-backfill`

**Payload:**
```json
{
  "symbol": "EURUSD",
  "barsCount": 17520
}
```

**What Happens:**
- `BacktestController` receives request
- Dispatches `RequestHistoricalBackfillCommand` via CQRS CommandBus
- `RequestHistoricalBackfillHandler` calls `BackfillStateService.createRequest()`
- In-memory state created:
  ```typescript
  {
    symbol: "EURUSD",
    barsRequested: 17520,
    barsIngested: 0,
    chunksReceived: 0,
    totalChunks: 36, // Math.ceil(17520 / 500)
    createdAt: new Date()
  }
  ```
- Response confirms request accepted: `"EA will pick up this request on next bar close"`

**Why this approach:**
- On-demand triggering (admin decides when to backfill)
- Multiple symbols can be queued independently
- No automatic backfill on EA startup (cleaner, more controlled)

---

### 2. EA Detects Backfill Request

**Actor:** HeartbeatEA.mq5 running on MT5 chart (e.g., EURUSD M15)

**Trigger:** Normal bar close (happens every 15 minutes)

**Flow:**
1. Timer fires every 1 second (via `OnTimer()`)
2. `CheckBarClose()` detects new closed bar (dedup gate using `lastClosedBarTime`)
3. Calls `BackfillMissingBars()`
4. **Step 1: Sends normal bars first (priority)**
   - Queries backend: `GET /api/ea/last-bar?symbol=EURUSD`
   - Backend response includes `historicalBackfill` section if backfill requested:
     ```json
     {
       "symbol": "EURUSD",
       "timeOpen": "2026-02-23T14:45:00.000Z",
       "historicalBackfill": {
         "requested": true,
         "barsRequested": 17520,
         "totalChunks": 36
       }
     }
     ```
   - EA extracts `timeOpen`, builds array of missing normal bars, sends in single batch POST
   - **This happens FIRST, takes <1 second, never delayed by backfill**

5. **Step 2: Executes historical backfill (after normal bars sent)**
   - `CheckHistoricalBackfillRequest()` parses `historicalBackfill` section
   - Extracts `barsRequested` value (17520)
   - Calls `ExecuteHistoricalBackfill(Symbol(), 17520)`

**Why this order:**
- Normal bar ingestion is time-sensitive (live trading data)
- Historical backfill is background task (can take 2-3 minutes)
- Ensures live data is never delayed

---

### 3. EA Uploads Historical Chunks

**Actor:** HeartbeatEA.mq5 `ExecuteHistoricalBackfill()` function

**Process:**

1. **Fetch all bars from MT5 history**
   ```mql5
   MqlRates rates[];
   ArraySetAsSeries(rates, false); // Chronological order (oldest first)
   int copied = CopyRates(Symbol(), PERIOD_M15, 0, 17520, rates);
   ```
   - MT5 CopyRates() can fetch up to 100,000 bars (more than enough for 6 months)
   - Returns actual count (may be less if MT5 doesn't have full history)

2. **Send in 500-bar chunks**
   - Loop through 36 chunks (0 to 35)
   - For each chunk:
     - Build JSON array of 500 bars (timeOpen, timeClose, OHLC, volume, spread)
     - POST to `/api/backtest/historical-bars/chunk`
     - Wait for 200/201 response
     - Sleep(100ms) between chunks (prevent server overload)
     - Log progress: "chunk 15/36 (500 bars)"

3. **Signal completion**
   - After all chunks sent, POST to `/api/backtest/historical-backfill/complete`
   - Removes backfill request from backend state
   - Future `GET /api/ea/last-bar` calls no longer include `historicalBackfill` section

**Blocking Behavior:**
- EA runs single-threaded (MQL5 limitation)
- During 2-3 minute upload, no other timer events fire
- Any bars that close during upload are caught on next timer tick after upload completes
- Normal backfill (missing bars from last known) handles any gaps automatically

**Why this approach:**
- Simplest implementation (no threading complexity)
- Backfill is one-time operation per symbol
- 2-3 minutes of blocking is acceptable for historical data load

---

### 4. Backend Ingests Chunks

**Actor:** Backend CQRS handlers

**Flow per chunk:**

1. **Request arrives:** `POST /api/backtest/historical-bars/chunk`
   ```json
   {
     "symbol": "EURUSD",
     "chunkNumber": 15,
     "totalChunks": 36,
     "bars": [ /* 500 bar objects */ ]
   }
   ```

2. **Controller validates and dispatches:**
   - DTO validation (class-validator)
   - Dispatches `IngestHistoricalChunkCommand` via CommandBus

3. **Handler processes chunk:**
   - `IngestHistoricalChunkHandler.execute()`
   - Validates chunk against active backfill request:
     - Checks `BackfillStateService.getRequest(symbol)` exists
     - Throws `BackfillNotFoundException` (404) if no active request
     - Validates `totalChunks` matches expected value
     - Throws `ChunkValidationException` (400) if mismatch
   - Delegates to `HistoricalBarIngestionService.ingestBars()`
   - Service calls `HistoricalBarRepository.upsert()` for each bar
   - Repository uses Prisma upsert with unique constraint `(symbol, timeOpen)`:
     ```prisma
     @@unique([symbol, timeOpen], name: "symbol_timeOpen")
     ```
   - Updates progress: `BackfillStateService.incrementProgress(symbol, barsCount)`
   - Returns progress info:
     ```json
     {
       "message": "Chunk 15/36 ingested successfully",
       "symbol": "EURUSD",
       "chunkNumber": 15,
       "totalChunks": 36,
       "barsIngested": 7500,
       "barsInChunk": 500
     }
     ```

**Idempotency:**
- Prisma upsert ensures duplicate bars (same symbol + timeOpen) don't cause errors
- If EA retries chunk, existing bars are updated (no duplicates)
- Enables resumption after interruption

**Why this design:**
- CQRS keeps business logic in handlers (not controllers)
- Repository pattern isolates Prisma (only place PrismaService injected)
- Custom exceptions map to correct HTTP status codes via ApplicationExceptionFilter
- Service layer reduces handler complexity (ESLint complexity check)

---

### 5. Admin Monitors Progress

**Actor:** Admin

**Tools:**

1. **Get all active backfills:** `GET /api/backtest/backfill-status`
   ```json
   [
     {
       "symbol": "EURUSD",
       "barsRequested": 17520,
       "barsIngested": 7500,
       "chunksReceived": 15,
       "totalChunks": 36,
       "createdAt": "2026-02-23T15:00:00.000Z"
     }
   ]
   ```

2. **Query database directly:**
   ```sql
   SELECT COUNT(*)
   FROM "BarM15"
   WHERE symbol = 'EURUSD' AND source = 'HISTORICAL';
   ```

**Source field differentiation:**
- `LIVE` - Real-time bars from normal EA operation
- `HISTORICAL` - Backfilled bars from M4.5
- Enables filtering, debugging, and data provenance tracking

---

## Implementation Steps (Completed)

### Step 1: Backend State Management
**Status:** ✅ Complete

**Created:**
- `BackfillStateService` - In-memory Map to track active backfill requests
- Methods: createRequest, getRequest, incrementProgress, completeRequest, getAllRequests

**Registered in:**
- `BacktestModule` providers
- Exported for use by `EaGatewayModule`

---

### Step 2: Admin Trigger Endpoint
**Status:** ✅ Complete

**Created:**
- `RequestHistoricalBackfillDto` - Validation for symbol and barsCount (max 50,000)
- `RequestHistoricalBackfillCommand` + Handler (CQRS pattern)
- `POST /api/backtest/request-historical-backfill` endpoint
- `GET /api/backtest/backfill-status` endpoint

**Response example:**
```json
{
  "message": "Historical backfill requested for EURUSD",
  "barsRequested": 17520,
  "totalChunks": 36,
  "note": "EA will pick up this request on next bar close"
}
```

---

### Step 3: Enhance Last-Bar Response
**Status:** ✅ Complete

**Modified:**
- `GetLastBarHandler` - Injects `BackfillStateService`, checks for active request
- `LastBarResult` interface - Added optional `historicalBackfill` section
- `EaGatewayModule` - Imports `BacktestModule` to access state service

**Response example (when backfill active):**
```json
{
  "symbol": "EURUSD",
  "timeOpen": "2026-02-23T14:45:00.000Z",
  "historicalBackfill": {
    "requested": true,
    "barsRequested": 17520,
    "totalChunks": 36
  }
}
```

---

### Step 4: Chunk Ingestion Endpoint
**Status:** ✅ Complete

**Created:**
- `UploadHistoricalBarsDto` + `HistoricalBarDto` (nested validation)
- `IngestHistoricalChunkCommand` + Handler
- `HistoricalBarIngestionService` - Delegates to repository
- `HistoricalBarRepository` - Only place Prisma injected for historical bars
- `POST /api/backtest/historical-bars/chunk` endpoint
- Custom exceptions: `BackfillNotFoundException`, `ChunkValidationException`
- Registered exceptions in `ApplicationExceptionFilter` (404, 400)

**Response example:**
```json
{
  "message": "Chunk 15/36 ingested successfully",
  "symbol": "EURUSD",
  "chunkNumber": 15,
  "totalChunks": 36,
  "barsIngested": 7500,
  "barsInChunk": 500
}
```

---

### Step 5: Completion Endpoint
**Status:** ✅ Complete

**Created:**
- `CompleteHistoricalBackfillDto`
- `CompleteHistoricalBackfillCommand` + Handler
- `POST /api/backtest/historical-backfill/complete` endpoint

**What it does:**
- Removes backfill request from in-memory state
- Future `GET /api/ea/last-bar` calls no longer include `historicalBackfill` section
- Signals backfill process is done

---

### Step 6: EA Implementation
**Status:** ✅ Complete

**Modified:**
- `HeartbeatEA.mq5` version 1.03 → 1.10

**Changes:**
1. **Reordered BackfillMissingBars():**
   - Now sends normal bars FIRST (priority, <1 second)
   - Then checks for historical backfill (runs after, 2-3 minutes)

2. **Modified QueryLastBar():**
   - Returns full JSON response instead of just `timeOpen`
   - Enables parsing of `historicalBackfill` section

3. **Added ExtractTimeOpen():**
   - Helper function to parse `timeOpen` field from JSON
   - Handles both null and ISO 8601 string values

4. **Added CheckHistoricalBackfillRequest():**
   - Parses `historicalBackfill` section from response
   - Extracts `barsRequested` value
   - Triggers `ExecuteHistoricalBackfill()` if detected

5. **Added ExecuteHistoricalBackfill():**
   - Fetches all requested bars via `CopyRates()`
   - Chunks into 500-bar batches
   - Sends each chunk via `SendHistoricalChunk()`
   - Logs progress: "chunk 15/36 (500 bars)"
   - Calls `CompleteHistoricalBackfill()` after all chunks sent

6. **Added SendHistoricalChunk():**
   - POST to `/api/backtest/historical-bars/chunk`
   - 30-second timeout (longer than normal endpoints)
   - Returns HTTP status code

7. **Added CompleteHistoricalBackfill():**
   - POST to `/api/backtest/historical-backfill/complete`
   - Signals backend to clear backfill request

---

## End-to-End Testing

### Test Case 1: Single Symbol Backfill

1. **Trigger:**
   ```bash
   curl -X POST http://localhost:4000/api/backtest/request-historical-backfill \
     -H "Content-Type: application/json" \
     -d '{"symbol": "EURUSD", "barsCount": 17520}'
   ```

2. **Verify request created:**
   ```bash
   curl http://localhost:4000/api/backtest/backfill-status
   # Should show active request with totalChunks: 36
   ```

3. **Wait for EA detection:**
   - EA checks on next bar close (max 15 minutes)
   - Look for log: "Historical backfill requested: 17520 bars for EURUSD"

4. **Monitor upload progress:**
   - EA logs: "Historical backfill progress: chunk 1/36", "chunk 2/36", etc.
   - Total time: ~2-3 minutes

5. **Verify completion:**
   ```bash
   curl http://localhost:4000/api/backtest/backfill-status
   # Should return empty array (request cleared)
   ```

6. **Query database:**
   ```sql
   SELECT COUNT(*) FROM "BarM15"
   WHERE symbol = 'EURUSD' AND source = 'HISTORICAL';
   -- Should return 17520 (or less if MT5 doesn't have full history)
   ```

7. **Test S1 detector with historical data:**
   ```bash
   curl -X POST http://localhost:4000/admin/replay-s1-signals \
     -H "Content-Type: application/json" \
     -d '{"symbol": "EURUSD"}'
   # Should process all 17520 bars successfully
   ```

---

### Test Case 2: Multiple Symbols Concurrently

1. **Trigger 3 backfills:**
   ```bash
   curl -X POST http://localhost:4000/api/backtest/request-historical-backfill \
     -d '{"symbol": "EURUSD", "barsCount": 17520}'

   curl -X POST http://localhost:4000/api/backtest/request-historical-backfill \
     -d '{"symbol": "GBPUSD", "barsCount": 17520}'

   curl -X POST http://localhost:4000/api/backtest/request-historical-backfill \
     -d '{"symbol": "USDJPY", "barsCount": 17520}'
   ```

2. **Verify 3 active requests:**
   ```bash
   curl http://localhost:4000/api/backtest/backfill-status
   # Should show 3 objects in array
   ```

3. **Run 3 EA instances:**
   - Open 3 MT5 charts: EURUSD M15, GBPUSD M15, USDJPY M15
   - Attach HeartbeatEA to each chart

4. **Monitor concurrent uploads:**
   - All 3 EAs upload simultaneously
   - Backend async handlers process chunks concurrently
   - Total time: ~3-4 minutes for all 3 symbols

5. **Verify database:**
   ```sql
   SELECT symbol, COUNT(*) as bars
   FROM "BarM15"
   WHERE source = 'HISTORICAL'
   GROUP BY symbol;
   -- Should show 17520 bars for each symbol
   ```

---

### Test Case 3: Resume After Interruption

1. **Trigger backfill:**
   ```bash
   curl -X POST http://localhost:4000/api/backtest/request-historical-backfill \
     -d '{"symbol": "EURUSD", "barsCount": 17520}'
   ```

2. **Let EA upload 10 chunks:**
   - Monitor logs: "chunk 1/36", "chunk 2/36", ..., "chunk 10/36"

3. **Stop EA:**
   - Close MT5 or disable EA mid-upload

4. **Verify partial data:**
   ```sql
   SELECT COUNT(*) FROM "BarM15"
   WHERE symbol = 'EURUSD' AND source = 'HISTORICAL';
   -- Should show ~5000 bars (10 chunks × 500)
   ```

5. **Restart EA:**
   - Recompile and attach to EURUSD M15 chart

6. **Observe resumption:**
   - EA continues uploading from chunk 11
   - Upsert handles duplicate bars (no errors)
   - Logs: "chunk 11/36", "chunk 12/36", ..., "chunk 36/36"

7. **Verify completion:**
   ```sql
   SELECT COUNT(*) FROM "BarM15"
   WHERE symbol = 'EURUSD' AND source = 'HISTORICAL';
   -- Should show full 17520 bars

   SELECT symbol, "timeOpen", COUNT(*) as duplicates
   FROM "BarM15"
   WHERE symbol = 'EURUSD' AND source = 'HISTORICAL'
   GROUP BY symbol, "timeOpen"
   HAVING COUNT(*) > 1;
   -- Should return 0 rows (no duplicates thanks to unique constraint)
   ```

---

## Future Improvements

### 1. Redis State Management

**Current:** In-memory Map in `BackfillStateService`

**Problem:** If backend restarts during 2-3 minute upload, state is lost. EA continues sending chunks, backend rejects with 404 (no active request).

**Solution:** Store backfill requests in Redis
```typescript
// Use ioredis or @nestjs/redis
await redis.hset(`backfill:${symbol}`, {
  barsRequested: 17520,
  barsIngested: 7500,
  chunksReceived: 15,
  totalChunks: 36,
  createdAt: new Date().toISOString()
});
```

**Benefits:**
- State persists across backend restarts
- Horizontal scaling (multiple backend instances share state)
- Better for production environments

**When to implement:** Before deploying to production with multiple backend instances

---

### 2. BullMQ Background Jobs

**Current:** Chunk ingestion runs synchronously in HTTP request handler

**Problem:** Long-running upserts (500 bars) block HTTP response. If multiple EAs upload concurrently, may impact live bar ingestion latency.

**Solution:** Offload chunk processing to BullMQ background jobs
```typescript
// In IngestHistoricalChunkHandler:
await this.chunkQueue.add('ingest-chunk', {
  symbol: command.symbol,
  chunkNumber: command.chunkNumber,
  bars: command.bars
});

// Return immediately (202 Accepted)
return {
  message: "Chunk queued for processing",
  queuePosition: await this.chunkQueue.count()
};

// Separate worker processes chunks asynchronously
```

**Benefits:**
- HTTP endpoints return instantly (202 Accepted)
- Live bar ingestion never blocked by historical uploads
- Better concurrency (workers scale independently)
- Built-in retry logic for failed chunks

**When to implement:** If we observe latency impact on live bar ingestion during concurrent backfills

---

### 3. Progress Tracking via WebSocket

**Current:** Admin polls `GET /api/backtest/backfill-status` for progress

**Future:** WebSocket events push progress updates to admin UI
```typescript
// Backend emits events:
this.eventGateway.emit('backfill:progress', {
  symbol: 'EURUSD',
  progress: 42, // percentage
  chunksReceived: 15,
  totalChunks: 36
});

// Admin UI subscribes and updates progress bar in real-time
```

**When to implement:** When building admin UI dashboard (future milestone)

---

## Definition of Done (Complete Milestone)

- ✅ Backend accepts backfill trigger via `POST /api/backtest/request-historical-backfill`
- ✅ `GET /api/ea/last-bar` includes historicalBackfill flag when requested
- ✅ EA detects flag and executes chunked upload automatically
- ✅ Chunks are processed and inserted into BarM15 with `source='HISTORICAL'`
- ✅ Progress is tracked and visible via `GET /api/backtest/backfill-status`
- ✅ Completion endpoint clears backfill request
- ✅ Normal bar ingestion happens FIRST (never delayed by historical backfill)
- ✅ Custom exceptions (BackfillNotFoundException, ChunkValidationException) map to correct HTTP status codes
- ✅ Repository pattern isolates Prisma (architecture compliance)
- ✅ CQRS pattern used for all POST endpoints (architecture compliance)

**Ready for testing:**
- 17,520 bars for EURUSD can load in ~2-3 minutes
- Multiple symbols can backfill concurrently
- Unique constraint prevents duplicates (idempotent uploads)
- Replay endpoints (Asia Range, S1 signals) work with full 6-month dataset

---

## Notes

**Why 500 bars per chunk?**
- Chunk size: ~133 KB (small, reliable network transmission)
- Processing time: ~1-2 seconds per chunk (500 upserts)
- Total time: 36 chunks × 2s = ~72 seconds + network overhead = ~2-3 minutes

**Why in-memory state?**
- Simple, fast for M4.5 (no Redis dependency yet)
- Backfill completes in 2-3 minutes (low risk of backend restart)
- Can migrate to Redis later if needed (see Future Improvements)

**Why piggyback on last-bar endpoint?**
- Zero extra HTTP polling (reuses existing bar-close check)
- EA naturally checks every bar close (perfect trigger point)
- No new timer/polling logic needed in EA

**Why chunk uploads instead of single POST?**
- 17,520 bars = ~4.54 MB payload (within 14 MiB limit but risky)
- Chunking enables progress tracking, resumption, and avoids timeouts
- Slightly slower but much more resilient

**Symbol scoping:**
- EA is attached to specific symbol in MT5 (e.g., EURUSD M15 chart)
- EA only operates on that symbol (Symbol() in MQL5)
- Backend checks backfill request for that exact symbol
- No ambiguity, no cross-symbol uploads
