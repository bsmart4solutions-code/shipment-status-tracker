-- CreateEnum
CREATE TYPE "VendorBillStatus" AS ENUM ('DRAFT', 'APPROVED', 'PARTIALLY_PAID', 'PAID', 'VOID');

-- CreateTable
CREATE TABLE "vendor_bills" (
    "id" TEXT NOT NULL,
    "billNumber" TEXT NOT NULL,
    "vendorInvoiceNo" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "jobId" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'MYR',
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxPct" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "taxAmt" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "amountPaid" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "VendorBillStatus" NOT NULL DEFAULT 'DRAFT',
    "billDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3),
    "terms" TEXT,
    "notes" TEXT,
    "voidReason" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_bill_items" (
    "id" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "unitPrice" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "unit" TEXT,
    "quantity" DECIMAL(14,4) NOT NULL DEFAULT 1,
    "lineCurrency" TEXT NOT NULL DEFAULT 'MYR',
    "fxRate" DECIMAL(14,6) NOT NULL DEFAULT 1,
    "amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxExempt" BOOLEAN NOT NULL DEFAULT false,
    "accNo" TEXT,
    "jobId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "vendor_bill_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_payments" (
    "id" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "method" TEXT,
    "reference" TEXT,
    "recordedById" TEXT,
    "reversedAt" TIMESTAMP(3),
    "reversedById" TEXT,
    "reversalReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vendor_bills_billNumber_key" ON "vendor_bills"("billNumber");

-- CreateIndex
CREATE INDEX "vendor_bills_vendorId_idx" ON "vendor_bills"("vendorId");

-- CreateIndex
CREATE INDEX "vendor_bills_status_idx" ON "vendor_bills"("status");

-- CreateIndex
CREATE INDEX "vendor_bills_dueDate_idx" ON "vendor_bills"("dueDate");

-- CreateIndex
CREATE INDEX "vendor_bills_jobId_idx" ON "vendor_bills"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_bills_vendorId_vendorInvoiceNo_key" ON "vendor_bills"("vendorId", "vendorInvoiceNo");

-- CreateIndex
CREATE INDEX "vendor_bill_items_billId_idx" ON "vendor_bill_items"("billId");

-- CreateIndex
CREATE INDEX "vendor_bill_items_jobId_idx" ON "vendor_bill_items"("jobId");

-- CreateIndex
CREATE INDEX "vendor_payments_billId_idx" ON "vendor_payments"("billId");

-- AddForeignKey
ALTER TABLE "vendor_bills" ADD CONSTRAINT "vendor_bills_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_bills" ADD CONSTRAINT "vendor_bills_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_bills" ADD CONSTRAINT "vendor_bills_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_bills" ADD CONSTRAINT "vendor_bills_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_bill_items" ADD CONSTRAINT "vendor_bill_items_billId_fkey" FOREIGN KEY ("billId") REFERENCES "vendor_bills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_bill_items" ADD CONSTRAINT "vendor_bill_items_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_payments" ADD CONSTRAINT "vendor_payments_billId_fkey" FOREIGN KEY ("billId") REFERENCES "vendor_bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_payments" ADD CONSTRAINT "vendor_payments_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_payments" ADD CONSTRAINT "vendor_payments_reversedById_fkey" FOREIGN KEY ("reversedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
