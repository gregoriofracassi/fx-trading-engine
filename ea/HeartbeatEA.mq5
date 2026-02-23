//+------------------------------------------------------------------+
//| HeartbeatEA.mq5                                                  |
//| Milestone 1+2+4.5 — EA connectivity + M15 bar ingestion +        |
//| historical backfill (6 months)                                   |
//| On every bar close: asks backend for its last known bar,         |
//| then sends all missing closed bars in a single batch POST.       |
//| Also checks for historical backfill requests and executes them.  |
//+------------------------------------------------------------------+
#property copyright ""
#property version   "1.10"
#property strict

//--- Input parameters
input string BackendBaseUrl = "https://unstationed-joselyn-pantropically.ngrok-free.dev"; // Backend base URL (no trailing slash)
input string TerminalId     = "FTMO_01"; // Unique ID for this MT5 terminal

//--- Internal state (dedup only — not source of truth)
int      sequenceNumber    = 0;
datetime lastClosedBarTime = 0;

//+------------------------------------------------------------------+
//| OnInit                                                           |
//+------------------------------------------------------------------+
int OnInit()
{
   EventSetTimer(1); // fire every 1 second
   Print("HeartbeatEA started | TerminalId=", TerminalId, " | Backend=", BackendBaseUrl);
   return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
//| OnDeinit                                                         |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   EventKillTimer();
   Print("HeartbeatEA stopped");
}

//+------------------------------------------------------------------+
//| OnTimer — fires every 1 second                                   |
//+------------------------------------------------------------------+
void OnTimer()
{
   CheckBarClose();
}

//+------------------------------------------------------------------+
//| OnTick — not used, required by MQL5                              |
//+------------------------------------------------------------------+
void OnTick() {}

//+------------------------------------------------------------------+
//| CheckBarClose                                                    |
//| Dedup gate: detects a new closed bar, then delegates entirely    |
//| to BackfillMissingBars which is the single send path.           |
//+------------------------------------------------------------------+
void CheckBarClose()
{
   MqlRates rates[];
   ArraySetAsSeries(rates, true);

   if(CopyRates(Symbol(), PERIOD_M15, 0, 2, rates) < 2)
      return;

   datetime closedBarTime = rates[1].time; // rates[1] = last closed bar

   if(closedBarTime <= lastClosedBarTime)
      return; // no new bar

   lastClosedBarTime = closedBarTime; // update dedup gate

   BackfillMissingBars();
}

//+------------------------------------------------------------------+
//| BackfillMissingBars                                              |
//| Single send path. Asks backend for its last known bar, builds    |
//| a JSON array of every missing closed bar, sends in one POST.    |
//| Handles: startup, reconnect, and normal bar close identically.  |
//| Also checks for historical backfill requests (M4.5).            |
//+------------------------------------------------------------------+
void BackfillMissingBars()
{
   //--- 1. Ask backend for last known bar timeOpen (ISO 8601 string or "null")
   string lastKnownResponse = QueryLastBar(Symbol());

   //--- 1a. Extract timeOpen from response (priority: normal bar ingestion first)
   string lastKnownIso = ExtractTimeOpen(lastKnownResponse);

   datetime fromTime = 0;

   if(lastKnownIso == "" || lastKnownIso == "null")
   {
      Print("Backfill: no data in backend, seeding last 500 bars for ", Symbol());
      fromTime = 0;
   }
   else
   {
      //--- Parse ISO 8601 to datetime: "2026-02-17T19:15:00.000Z" → "2026.02.17 19:15:00"
      string mt5fmt = lastKnownIso;
      StringReplace(mt5fmt, "-", ".");
      StringReplace(mt5fmt, "T", " ");
      int dotPos = StringFind(mt5fmt, ".");
      int msPos  = StringFind(mt5fmt, ".", dotPos + 9);
      if(msPos > 0)
         mt5fmt = StringSubstr(mt5fmt, 0, msPos);
      StringReplace(mt5fmt, "Z", "");

      fromTime = StringToTime(mt5fmt);
      Print("Backfill: last known bar in backend = ", mt5fmt, " (", (long)fromTime, ")");

      fromTime += 900; // already have that bar, start from next
   }

   //--- 2. Load available M15 history (chronological, oldest first)
   MqlRates rates[];
   ArraySetAsSeries(rates, false);

   int copied = CopyRates(Symbol(), PERIOD_M15, 0, 500, rates);
   if(copied <= 0)
   {
      Print("Backfill: CopyRates returned 0 — no history available yet");
      return;
   }

   //--- 3. Collect missing closed bars (skip currently open bar at rates[copied-1])
   string items = "";
   int sentCount = 0;

   for(int i = 0; i < copied - 1; i++)
   {
      if(fromTime > 0 && rates[i].time < fromTime)
         continue; // already in backend

      string timeOpen  = TimeToString(rates[i].time,       TIME_DATE | TIME_SECONDS);
      string timeClose = TimeToString(rates[i].time + 900, TIME_DATE | TIME_SECONDS);

      sequenceNumber++;

      string item = StringFormat(
         "{\"type\":\"BAR_M15_CLOSED\","
         "\"terminalId\":\"%s\","
         "\"symbol\":\"%s\","
         "\"timeOpen\":\"%s\","
         "\"timeClose\":\"%s\","
         "\"open\":%.5f,"
         "\"high\":%.5f,"
         "\"low\":%.5f,"
         "\"close\":%.5f,"
         "\"tickVolume\":%d,"
         "\"spreadPoints\":%d,"
         "\"sentAt\":\"%s\","
         "\"seq\":%d}",
         TerminalId,
         Symbol(),
         timeOpen,
         timeClose,
         rates[i].open,
         rates[i].high,
         rates[i].low,
         rates[i].close,
         (int)rates[i].tick_volume,
         (int)rates[i].spread,
         TimeToString(TimeGMT(), TIME_DATE | TIME_SECONDS),
         sequenceNumber
      );

      if(sentCount > 0)
         items += ",";
      items += item;
      sentCount++;
   }

   if(sentCount == 0)
   {
      Print("Backfill: nothing to send, backend is up to date");
      return;
   }

   //--- 4. Send single batch POST
   string body   = "[" + items + "]";
   int    status = SendPost(body);

   Print("Backfill | ", Symbol(), " | sent=", sentCount, " bars | HTTP=", status);

   //--- 5. Check for historical backfill request (M4.5) — runs AFTER normal bars sent
   CheckHistoricalBackfillRequest(lastKnownResponse);
}

//+------------------------------------------------------------------+
//| QueryLastBar                                                     |
//| GET /api/ea/last-bar?symbol=EURUSD                               |
//| Returns the full JSON response or "" on error.                   |
//+------------------------------------------------------------------+
string QueryLastBar(string symbol)
{
   string url = BackendBaseUrl + "/api/ea/last-bar?symbol=" + symbol;
   string reqHeaders = "";
   char   postData[];
   char   result[];
   string resultHeaders;

   int status = WebRequest("GET", url, reqHeaders, 5000, postData, result, resultHeaders);

   if(status == -1)
   {
      Print("QueryLastBar: WebRequest FAILED | error=", GetLastError());
      return "";
   }

   if(status != 200)
   {
      Print("QueryLastBar: unexpected HTTP=", status);
      return "";
   }

   string responseStr = CharArrayToString(result);
   Print("QueryLastBar raw response: ", responseStr);

   return responseStr;
}

//+------------------------------------------------------------------+
//| ExtractTimeOpen                                                  |
//| Extracts timeOpen value from last-bar JSON response             |
//+------------------------------------------------------------------+
string ExtractTimeOpen(string response)
{
   if(response == "")
      return "";

   string key = "\"timeOpen\":";
   int keyPos = StringFind(response, key);
   if(keyPos < 0)
   {
      Print("ExtractTimeOpen: 'timeOpen' not found in response");
      return "";
   }

   int    valueStart = keyPos + StringLen(key);
   string rest       = StringSubstr(response, valueStart);

   if(StringSubstr(rest, 0, 4) == "null")
      return "null";

   if(StringSubstr(rest, 0, 1) == "\"")
   {
      int closeQuote = StringFind(rest, "\"", 1);
      if(closeQuote > 0)
         return StringSubstr(rest, 1, closeQuote - 1);
   }

   return "";
}

//+------------------------------------------------------------------+
//| CheckHistoricalBackfillRequest (M4.5)                           |
//| Parses last-bar response for historicalBackfill flag            |
//| If detected, triggers historical data upload                     |
//+------------------------------------------------------------------+
void CheckHistoricalBackfillRequest(string response)
{
   if(response == "")
      return;

   //--- Check for historicalBackfill section
   int backfillPos = StringFind(response, "\"historicalBackfill\"");
   if(backfillPos < 0)
      return; // No backfill requested

   //--- Extract barsRequested
   int barsPos = StringFind(response, "\"barsRequested\":", backfillPos);
   if(barsPos < 0)
      return;

   int valueStart = barsPos + StringLen("\"barsRequested\":");
   string substr = StringSubstr(response, valueStart);

   //--- Find end of number (comma or closing brace)
   int endPos = 0;
   for(int i = 0; i < StringLen(substr); i++)
   {
      string ch = StringSubstr(substr, i, 1);
      if(ch == "," || ch == "}")
      {
         endPos = i;
         break;
      }
   }

   if(endPos == 0)
      return;

   string barsStr = StringSubstr(substr, 0, endPos);
   StringTrimLeft(barsStr);
   StringTrimRight(barsStr);

   int barsCount = (int)StringToInteger(barsStr);

   if(barsCount <= 0)
      return;

   Print("Historical backfill requested: ", barsCount, " bars for ", Symbol());

   ExecuteHistoricalBackfill(Symbol(), barsCount);
}

//+------------------------------------------------------------------+
//| ExecuteHistoricalBackfill (M4.5)                                |
//| Fetches historical bars and sends in chunks of 500              |
//+------------------------------------------------------------------+
void ExecuteHistoricalBackfill(string symbol, int totalBars)
{
   const int CHUNK_SIZE = 500;
   int totalChunks = (int)MathCeil(totalBars / (double)CHUNK_SIZE);

   Print("Starting historical backfill: ", totalBars, " bars in ", totalChunks, " chunks");

   //--- Fetch all bars at once (chronological order, oldest first)
   MqlRates rates[];
   ArraySetAsSeries(rates, false);

   int copied = CopyRates(symbol, PERIOD_M15, 0, totalBars, rates);

   if(copied <= 0)
   {
      Print("Historical backfill FAILED: CopyRates returned 0");
      return;
   }

   Print("Fetched ", copied, " bars from MT5 history");

   //--- Send in chunks
   for(int chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++)
   {
      int startIdx = chunkIndex * CHUNK_SIZE;
      int endIdx = (int)MathMin(startIdx + CHUNK_SIZE, copied);
      int chunkSize = endIdx - startIdx;

      //--- Build JSON for this chunk
      string items = "";

      for(int i = startIdx; i < endIdx; i++)
      {
         string timeOpen  = TimeToString(rates[i].time,       TIME_DATE | TIME_SECONDS);
         string timeClose = TimeToString(rates[i].time + 900, TIME_DATE | TIME_SECONDS);

         string item = StringFormat(
            "{\"timeOpen\":\"%s\",\"timeClose\":\"%s\",\"open\":%.5f,\"high\":%.5f,\"low\":%.5f,\"close\":%.5f,\"tickVolume\":%d,\"spreadPoints\":%d}",
            timeOpen, timeClose,
            rates[i].open, rates[i].high, rates[i].low, rates[i].close,
            (int)rates[i].tick_volume, (int)rates[i].spread
         );

         if(i > startIdx)
            items += ",";
         items += item;
      }

      string body = StringFormat(
         "{\"symbol\":\"%s\",\"chunkNumber\":%d,\"totalChunks\":%d,\"bars\":[%s]}",
         symbol, chunkIndex + 1, totalChunks, items
      );

      int status = SendHistoricalChunk(body);

      if(status != 200 && status != 201)
      {
         Print("Historical backfill FAILED: HTTP ", status, " at chunk ", chunkIndex + 1);
         return;
      }

      Print("Historical backfill progress: chunk ", chunkIndex + 1, "/", totalChunks, " (", chunkSize, " bars)");

      Sleep(100); // Small delay between chunks
   }

   //--- Signal completion
   CompleteHistoricalBackfill(symbol);

   Print("Historical backfill COMPLETED: ", copied, " bars for ", symbol);
}

//+------------------------------------------------------------------+
//| SendHistoricalChunk (M4.5)                                       |
//| POST /api/backtest/historical-bars/chunk                        |
//+------------------------------------------------------------------+
int SendHistoricalChunk(string body)
{
   string url        = BackendBaseUrl + "/api/backtest/historical-bars/chunk";
   string reqHeaders = "Content-Type: application/json\r\n";
   char   postData[];
   char   result[];
   string resultHeaders;

   StringToCharArray(body, postData, 0, StringLen(body));

   return WebRequest("POST", url, reqHeaders, 30000, postData, result, resultHeaders);
}

//+------------------------------------------------------------------+
//| CompleteHistoricalBackfill (M4.5)                               |
//| POST /api/backtest/historical-backfill/complete                 |
//+------------------------------------------------------------------+
void CompleteHistoricalBackfill(string symbol)
{
   string body = StringFormat("{\"symbol\":\"%s\"}", symbol);

   string url        = BackendBaseUrl + "/api/backtest/historical-backfill/complete";
   string reqHeaders = "Content-Type: application/json\r\n";
   char   postData[];
   char   result[];
   string resultHeaders;

   StringToCharArray(body, postData, 0, StringLen(body));

   int status = WebRequest("POST", url, reqHeaders, 5000, postData, result, resultHeaders);

   if(status != 200 && status != 201)
   {
      Print("CompleteHistoricalBackfill: HTTP ", status);
   }
}

//+------------------------------------------------------------------+
//| SendPost — shared HTTP POST helper                               |
//+------------------------------------------------------------------+
int SendPost(string body)
{
   string url        = BackendBaseUrl + "/api/ea/events";
   string reqHeaders = "Content-Type: application/json\r\n";
   char   postData[];
   char   result[];
   string resultHeaders;

   StringToCharArray(body, postData, 0, StringLen(body));

   return WebRequest("POST", url, reqHeaders, 5000, postData, result, resultHeaders);
}
//+------------------------------------------------------------------+
