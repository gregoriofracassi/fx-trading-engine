//+------------------------------------------------------------------+
//| HeartbeatEA.mq5                                                  |
//| Milestone 1+2 — EA connectivity + M15 bar close ingestion        |
//| Sends HEARTBEAT every N seconds and BAR_M15_CLOSED on bar close. |
//| On startup: fetches last known bar from backend and backfills     |
//| any missing bars since that point.                               |
//+------------------------------------------------------------------+
#property copyright ""
#property version   "1.01"
#property strict

//--- Input parameters
input string BackendBaseUrl  = "https://unstationed-joselyn-pantropically.ngrok-free.dev"; // Backend base URL (no trailing slash)
input string TerminalId      = "FTMO_01";               // Unique ID for this MT5 terminal
input int    HeartbeatSecs   = 30;                      // Heartbeat interval in seconds

//--- Internal state
int      sequenceNumber    = 0;
datetime lastClosedBarTime = 0;
datetime lastHeartbeatTime = 0;

//+------------------------------------------------------------------+
//| OnInit                                                           |
//+------------------------------------------------------------------+
int OnInit()
{
   EventSetTimer(1); // fire every 1 second
   Print("HeartbeatEA started | TerminalId=", TerminalId, " | Backend=", BackendBaseUrl);

   //--- Backfill missing bars on startup
   BackfillMissingBars();

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
   //--- Heartbeat (every HeartbeatSecs)
   if(TimeCurrent() - lastHeartbeatTime >= HeartbeatSecs)
   {
      SendHeartbeat();
      lastHeartbeatTime = TimeCurrent();
   }

   //--- M15 bar close detector
   CheckBarClose();
}

//+------------------------------------------------------------------+
//| OnTick — not used, required by MQL5                              |
//+------------------------------------------------------------------+
void OnTick() {}

//+------------------------------------------------------------------+
//| BackfillMissingBars                                              |
//| Called once on OnInit. Asks backend for its last known bar,      |
//| then sends every bar from that point up to (but not including)   |
//| the currently open bar.                                          |
//+------------------------------------------------------------------+
void BackfillMissingBars()
{
   //--- 1. Ask backend for last known bar timeOpen (ISO 8601 string or "null")
   string lastKnownIso = QueryLastBar(Symbol());

   datetime fromTime;

   if(lastKnownIso == "" || lastKnownIso == "null")
   {
      //--- No data in backend yet — send last 200 closed bars as initial seed
      Print("Backfill: no data in backend, seeding last 200 bars for ", Symbol());
      fromTime = 0; // will be clamped by available history below
   }
   else
   {
      //--- Parse ISO 8601 to datetime: "2026-02-17T19:15:00.000Z" → "2026.02.17 19:15:00"
      string mt5fmt = lastKnownIso;
      StringReplace(mt5fmt, "-", ".");
      StringReplace(mt5fmt, "T", " ");
      int dotPos = StringFind(mt5fmt, ".");
      // strip milliseconds and Z if present: "2026.02.17 19:15:00.000Z" → "2026.02.17 19:15:00"
      int msPos = StringFind(mt5fmt, ".", dotPos + 9); // look for ms dot after time part
      if(msPos > 0)
         mt5fmt = StringSubstr(mt5fmt, 0, msPos);
      StringReplace(mt5fmt, "Z", "");

      fromTime = StringToTime(mt5fmt);
      Print("Backfill: last known bar in backend = ", mt5fmt, " (", (long)fromTime, ")");

      //--- The bar at fromTime is already in the backend, so start from the next one
      fromTime += 900; // +15 minutes
   }

   //--- 2. Load available M15 history
   MqlRates rates[];
   ArraySetAsSeries(rates, false); // chronological order (oldest first)

   //--- We want up to 500 bars to cover any downtime gap
   int copied = CopyRates(Symbol(), PERIOD_M15, 0, 500, rates);
   if(copied <= 0)
   {
      Print("Backfill: CopyRates returned 0 — no history available yet");
      return;
   }

   //--- rates[copied-1] is the currently OPEN bar — skip it
   //--- rates[copied-2] is the last CLOSED bar
   int sentCount = 0;

   for(int i = 0; i < copied - 1; i++)
   {
      if(fromTime > 0 && rates[i].time < fromTime)
         continue; // already in backend

      //--- Send this closed bar
      string timeOpen  = TimeToString(rates[i].time,       TIME_DATE | TIME_SECONDS);
      string timeClose = TimeToString(rates[i].time + 900, TIME_DATE | TIME_SECONDS);

      sequenceNumber++;

      string body = StringFormat(
         "{\"type\":\"BAR_M15_CLOSED\","
         "\"terminalId\":\"%s\","
         "\"symbol\":\"%s\","
         "\"timeOpen\":\"%s\","
         "\"timeClose\":\"%s\","
         "\"o\":%.5f,"
         "\"h\":%.5f,"
         "\"l\":%.5f,"
         "\"c\":%.5f,"
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

      int status = SendPost(body);
      Print("Backfill | ", Symbol(), " | timeOpen=", timeOpen, " | HTTP=", status);
      sentCount++;

      //--- Small delay to avoid flooding backend (5 ms)
      Sleep(5);
   }

   //--- Update lastClosedBarTime so CheckBarClose doesn't re-send bars we just backfilled
   if(copied >= 2)
      lastClosedBarTime = rates[copied - 2].time;

   Print("Backfill complete | sent=", sentCount, " bars | symbol=", Symbol());
}

//+------------------------------------------------------------------+
//| QueryLastBar                                                     |
//| GET /api/ea/last-bar?symbol=EURUSD                               |
//| Returns the timeOpen ISO string or "null" if no data             |
//+------------------------------------------------------------------+
string QueryLastBar(string symbol)
{
   string url = BackendBaseUrl + "/api/ea/last-bar?symbol=" + symbol;
   string reqHeaders = "";
   char   postData[];  // empty body for GET
   char   result[];
   string resultHeaders;

   int status = WebRequest("GET", url, reqHeaders, 5000, postData, result, resultHeaders);

   if(status == -1)
   {
      int err = GetLastError();
      Print("QueryLastBar: WebRequest FAILED | error=", err);
      return "";
   }

   if(status != 200)
   {
      Print("QueryLastBar: unexpected HTTP=", status);
      return "";
   }

   //--- Parse {"symbol":"EURUSD","timeOpen":"2026-02-17T19:15:00.000Z"}
   //--- or    {"symbol":"EURUSD","timeOpen":null}
   string responseStr = CharArrayToString(result);
   Print("QueryLastBar raw response: ", responseStr);

   //--- Extract value after "timeOpen":
   string key = "\"timeOpen\":";
   int keyPos = StringFind(responseStr, key);
   if(keyPos < 0)
   {
      Print("QueryLastBar: 'timeOpen' not found in response");
      return "";
   }

   int valueStart = keyPos + StringLen(key);
   string rest = StringSubstr(responseStr, valueStart);

   //--- Check for null
   if(StringSubstr(rest, 0, 4) == "null")
      return "null";

   //--- Extract quoted string: "2026-02-17T19:15:00.000Z"
   if(StringSubstr(rest, 0, 1) == "\"")
   {
      int closeQuote = StringFind(rest, "\"", 1);
      if(closeQuote > 0)
         return StringSubstr(rest, 1, closeQuote - 1);
   }

   return "";
}

//+------------------------------------------------------------------+
//| CheckBarClose — detects new closed M15 bar and sends it         |
//+------------------------------------------------------------------+
void CheckBarClose()
{
   MqlRates rates[];
   ArraySetAsSeries(rates, true);

   if(CopyRates(Symbol(), PERIOD_M15, 0, 2, rates) < 2)
      return;

   datetime closedBarTime = rates[1].time; // rates[1] = last closed bar

   if(closedBarTime <= lastClosedBarTime)
      return; // already sent this bar

   lastClosedBarTime = closedBarTime;

   //--- Build time strings (MT5 format: "2026.02.17 15:00:00")
   string timeOpen  = TimeToString(rates[1].time,       TIME_DATE | TIME_SECONDS);
   string timeClose = TimeToString(rates[1].time + 900, TIME_DATE | TIME_SECONDS); // +15 min

   sequenceNumber++;

   string body = StringFormat(
      "{\"type\":\"BAR_M15_CLOSED\","
      "\"terminalId\":\"%s\","
      "\"symbol\":\"%s\","
      "\"timeOpen\":\"%s\","
      "\"timeClose\":\"%s\","
      "\"o\":%.5f,"
      "\"h\":%.5f,"
      "\"l\":%.5f,"
      "\"c\":%.5f,"
      "\"tickVolume\":%d,"
      "\"spreadPoints\":%d,"
      "\"sentAt\":\"%s\","
      "\"seq\":%d}",
      TerminalId,
      Symbol(),
      timeOpen,
      timeClose,
      rates[1].open,
      rates[1].high,
      rates[1].low,
      rates[1].close,
      (int)rates[1].tick_volume,
      (int)rates[1].spread,
      TimeToString(TimeGMT(), TIME_DATE | TIME_SECONDS),
      sequenceNumber
   );

   int status = SendPost(body);
   Print("BarSent | ", Symbol(), " | timeOpen=", timeOpen, " | HTTP=", status);
}

//+------------------------------------------------------------------+
//| SendHeartbeat                                                     |
//+------------------------------------------------------------------+
void SendHeartbeat()
{
   sequenceNumber++;

   string body = StringFormat(
      "{\"type\":\"HEARTBEAT\",\"terminalId\":\"%s\",\"sentAt\":\"%s\",\"seq\":%d}",
      TerminalId,
      TimeToString(TimeGMT(), TIME_DATE | TIME_SECONDS),
      sequenceNumber
   );

   int status = SendPost(body);
   if(status == -1)
   {
      int err = GetLastError();
      Print("HeartbeatEA: WebRequest FAILED | error=", err,
            " | HINT: Add ", BackendBaseUrl, " to Tools > Options > Expert Advisors > Allow WebRequest");
   }
   else
   {
      Print("HeartbeatEA: Heartbeat sent | seq=", sequenceNumber, " | HTTP=", status);
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
