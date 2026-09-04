-- CreateEnum
CREATE TYPE "CadenceStatus" AS ENUM ('SCHEDULED', 'PROCESSING', 'COMPLETED', 'CANCELLED', 'FAILED');

-- CreateTable
CREATE TABLE "DunningCadence" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "recoveryTokenId" TEXT,
    "currentStep" INTEGER NOT NULL DEFAULT 1,
    "status" "CadenceStatus" NOT NULL DEFAULT 'SCHEDULED',
    "channel" TEXT NOT NULL DEFAULT 'EMAIL',
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "attemptedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "idempotencyKey" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DunningCadence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DunningCadence_opportunityId_key" ON "DunningCadence"("opportunityId");

-- CreateIndex
CREATE UNIQUE INDEX "DunningCadence_idempotencyKey_key" ON "DunningCadence"("idempotencyKey");

-- CreateIndex
CREATE INDEX "DunningCadence_tenantId_idx" ON "DunningCadence"("tenantId");

-- CreateIndex
CREATE INDEX "DunningCadence_status_idx" ON "DunningCadence"("status");

-- CreateIndex
CREATE INDEX "DunningCadence_scheduledAt_idx" ON "DunningCadence"("scheduledAt");

-- CreateIndex
CREATE INDEX "DunningCadence_currentStep_idx" ON "DunningCadence"("currentStep");

-- AddForeignKey
ALTER TABLE "DunningCadence" ADD CONSTRAINT "DunningCadence_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DunningCadence" ADD CONSTRAINT "DunningCadence_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "RecoveryOpportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DunningCadence" ADD CONSTRAINT "DunningCadence_recoveryTokenId_fkey" FOREIGN KEY ("recoveryTokenId") REFERENCES "RecoveryToken"("id") ON DELETE SET NULL ON UPDATE CASCADE;
