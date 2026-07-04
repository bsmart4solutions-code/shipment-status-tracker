-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "quotations" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "services" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "vendors" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "quotation_revisions" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "sellingPrice" DECIMAL(14,2) NOT NULL,
    "grossProfit" DECIMAL(14,2) NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quotation_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "quotation_revisions_quotationId_idx" ON "quotation_revisions"("quotationId");

-- CreateIndex
CREATE UNIQUE INDEX "quotation_revisions_quotationId_revision_key" ON "quotation_revisions"("quotationId", "revision");

-- CreateIndex
CREATE INDEX "customers_deletedAt_idx" ON "customers"("deletedAt");

-- CreateIndex
CREATE INDEX "jobs_deletedAt_idx" ON "jobs"("deletedAt");

-- CreateIndex
CREATE INDEX "quotations_deletedAt_idx" ON "quotations"("deletedAt");

-- CreateIndex
CREATE INDEX "services_deletedAt_idx" ON "services"("deletedAt");

-- CreateIndex
CREATE INDEX "vendors_deletedAt_idx" ON "vendors"("deletedAt");

-- AddForeignKey
ALTER TABLE "quotation_revisions" ADD CONSTRAINT "quotation_revisions_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_revisions" ADD CONSTRAINT "quotation_revisions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
