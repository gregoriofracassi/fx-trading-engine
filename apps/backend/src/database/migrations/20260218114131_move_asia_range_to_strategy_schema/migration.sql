/*
  Warnings:

  - You are about to drop the `AsiaRange` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "strategy";

-- DropTable
DROP TABLE "ea_gateway"."AsiaRange";

-- CreateTable
CREATE TABLE "strategy"."AsiaRange" (
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
CREATE UNIQUE INDEX "AsiaRange_date_symbol_key" ON "strategy"."AsiaRange"("date", "symbol");
