-- CreateTable
CREATE TABLE "ea_gateway"."AsiaRange" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "high" DOUBLE PRECISION NOT NULL,
    "low" DOUBLE PRECISION NOT NULL,
    "finalized" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AsiaRange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AsiaRange_date_symbol_idx" ON "ea_gateway"."AsiaRange"("date", "symbol");

-- CreateIndex
CREATE UNIQUE INDEX "AsiaRange_date_symbol_key" ON "ea_gateway"."AsiaRange"("date", "symbol");
