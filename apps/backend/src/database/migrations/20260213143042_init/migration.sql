-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "ea_gateway";

-- CreateTable
CREATE TABLE "ea_gateway"."AuditEvent" (
    "id" TEXT NOT NULL,
    "terminalId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "sequenceNum" INTEGER,
    "sentAt" TIMESTAMP(3),
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);
