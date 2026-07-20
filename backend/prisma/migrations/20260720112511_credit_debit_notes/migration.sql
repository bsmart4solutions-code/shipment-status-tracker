-- CreateEnum
CREATE TYPE "CreditDebitType" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "AdjustmentStatus" AS ENUM ('DRAFT', 'ISSUED', 'CANCELLED');

-- CreateTable
CREATE TABLE "credit_debit_notes" (
    "id" TEXT NOT NULL,
    "noteNumber" TEXT NOT NULL,
    "type" "CreditDebitType" NOT NULL,
    "invoiceId" TEXT,
    "customerId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'MYR',
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxPct" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "taxAmt" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "AdjustmentStatus" NOT NULL DEFAULT 'DRAFT',
    "reason" TEXT,
    "issueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_debit_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_debit_note_items" (
    "id" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "unitPrice" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "unit" TEXT,
    "quantity" DECIMAL(14,4) NOT NULL DEFAULT 1,
    "lineCurrency" TEXT NOT NULL DEFAULT 'MYR',
    "fxRate" DECIMAL(14,6) NOT NULL DEFAULT 1,
    "amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxExempt" BOOLEAN NOT NULL DEFAULT false,
    "accNo" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "credit_debit_note_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "credit_debit_notes_noteNumber_key" ON "credit_debit_notes"("noteNumber");

-- CreateIndex
CREATE INDEX "credit_debit_notes_invoiceId_idx" ON "credit_debit_notes"("invoiceId");

-- CreateIndex
CREATE INDEX "credit_debit_notes_customerId_idx" ON "credit_debit_notes"("customerId");

-- CreateIndex
CREATE INDEX "credit_debit_notes_type_idx" ON "credit_debit_notes"("type");

-- CreateIndex
CREATE INDEX "credit_debit_notes_status_idx" ON "credit_debit_notes"("status");

-- CreateIndex
CREATE INDEX "credit_debit_note_items_noteId_idx" ON "credit_debit_note_items"("noteId");

-- AddForeignKey
ALTER TABLE "credit_debit_notes" ADD CONSTRAINT "credit_debit_notes_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_debit_notes" ADD CONSTRAINT "credit_debit_notes_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_debit_notes" ADD CONSTRAINT "credit_debit_notes_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_debit_notes" ADD CONSTRAINT "credit_debit_notes_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_debit_note_items" ADD CONSTRAINT "credit_debit_note_items_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "credit_debit_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
