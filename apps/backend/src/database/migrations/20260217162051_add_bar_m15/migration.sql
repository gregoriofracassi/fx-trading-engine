-- CreateTable
CREATE TABLE "ea_gateway"."BarM15" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "timeOpen" TIMESTAMP(3) NOT NULL,
    "timeClose" TIMESTAMP(3) NOT NULL,
    "open" DOUBLE PRECISION NOT NULL,
    "high" DOUBLE PRECISION NOT NULL,
    "low" DOUBLE PRECISION NOT NULL,
    "close" DOUBLE PRECISION NOT NULL,
    "tickVolume" INTEGER NOT NULL,
    "spreadPoints" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'FTMO_LIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BarM15_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BarM15_symbol_timeOpen_idx" ON "ea_gateway"."BarM15"("symbol", "timeOpen");

-- CreateIndex
CREATE UNIQUE INDEX "BarM15_symbol_timeOpen_key" ON "ea_gateway"."BarM15"("symbol", "timeOpen");
