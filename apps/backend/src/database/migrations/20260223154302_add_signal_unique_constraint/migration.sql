-- CreateIndex
CREATE UNIQUE INDEX "Signal_symbol_timestamp_key" ON "strategy"."Signal"("symbol", "timestamp");
