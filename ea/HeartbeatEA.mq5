//+------------------------------------------------------------------+
//| HeartbeatEA.mq5                                                  |
//| Milestone 1 — EA connectivity proof                              |
//| Sends a HEARTBEAT event to the NestJS backend every N seconds.   |
//+------------------------------------------------------------------+
#property copyright ""
#property version   "1.00"
#property strict

//--- Input parameters
input string BackendBaseUrl  = "http://localhost:3000"; // Backend base URL (no trailing slash)
input string TerminalId      = "FTMO_01";               // Unique ID for this MT5 terminal
input int    HeartbeatSecs   = 10;                      // Heartbeat interval in seconds

//--- Internal state
int sequenceNumber = 0;

//+------------------------------------------------------------------+
//| OnInit                                                           |
//+------------------------------------------------------------------+
int OnInit()
{
   EventSetTimer(HeartbeatSecs);
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
//| OnTimer — fires every HeartbeatSecs seconds                      |
//+------------------------------------------------------------------+
void OnTimer()
{
   SendHeartbeat();
}

//+------------------------------------------------------------------+
//| OnTick — not used, required by MQL5                              |
//+------------------------------------------------------------------+
void OnTick() {}

//+------------------------------------------------------------------+
//| SendHeartbeat                                                     |
//+------------------------------------------------------------------+
void SendHeartbeat()
{
   sequenceNumber++;

   //--- Build URL
   string url = BackendBaseUrl + "/api/ea/events";

   //--- Build JSON body
   string body = StringFormat(
      "{\"type\":\"HEARTBEAT\",\"terminalId\":\"%s\",\"sentAt\":\"%s\",\"seq\":%d}",
      TerminalId,
      TimeToString(TimeGMT(), TIME_DATE | TIME_SECONDS),
      sequenceNumber
   );

   //--- Prepare buffers
   char   postData[];
   char   result[];
   string resultHeaders;
   string reqHeaders = "Content-Type: application/json\r\n";

   StringToCharArray(body, postData, 0, StringLen(body));

   //--- Send HTTP POST
   int httpStatus = WebRequest("POST", url, reqHeaders, 5000, postData, result, resultHeaders);

   if(httpStatus == -1)
   {
      int err = GetLastError();
      Print("HeartbeatEA: WebRequest FAILED | error=", err,
            " | HINT: Add ", BackendBaseUrl, " to Tools > Options > Expert Advisors > Allow WebRequest");
   }
   else
   {
      Print("HeartbeatEA: Heartbeat sent | seq=", sequenceNumber, " | HTTP=", httpStatus);
   }
}
//+------------------------------------------------------------------+
