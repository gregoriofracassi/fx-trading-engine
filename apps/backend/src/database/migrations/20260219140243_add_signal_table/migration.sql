-- CreateTable
CREATE TABLE "strategy"."Signal" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "dateRome" TEXT NOT NULL,
    "setupType" TEXT NOT NULL,
    "valid" BOOLEAN NOT NULL,
    "acceptance" DOUBLE PRECISION,
    "engulfing" DOUBLE PRECISION,
    "liquidity" DOUBLE PRECISION,
    "oppositeImb" DOUBLE PRECISION,
    "mainImb" DOUBLE PRECISION,
    "reasonCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "asiaRangeId" TEXT,
    "asiaHigh" DOUBLE PRECISION NOT NULL,
    "asiaLow" DOUBLE PRECISION NOT NULL,
    "pushCandleTime" TIMESTAMP(3),
    "engulfCandleTime" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Signal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Signal_symbol_timestamp_idx" ON "strategy"."Signal"("symbol", "timestamp");

-- CreateIndex
CREATE INDEX "Signal_dateRome_symbol_idx" ON "strategy"."Signal"("dateRome", "symbol");
