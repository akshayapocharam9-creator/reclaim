-- CreateTable
CREATE TABLE "RecoveryToken" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'PAYMENT_RECOVERY',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecoveryToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RecoveryToken_tokenHash_key" ON "RecoveryToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RecoveryToken_tenantId_idx" ON "RecoveryToken"("tenantId");

-- CreateIndex
CREATE INDEX "RecoveryToken_opportunityId_idx" ON "RecoveryToken"("opportunityId");

-- CreateIndex
CREATE INDEX "RecoveryToken_tokenHash_idx" ON "RecoveryToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RecoveryToken_expiresAt_idx" ON "RecoveryToken"("expiresAt");

-- AddForeignKey
ALTER TABLE "RecoveryToken" ADD CONSTRAINT "RecoveryToken_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecoveryToken" ADD CONSTRAINT "RecoveryToken_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "RecoveryOpportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
