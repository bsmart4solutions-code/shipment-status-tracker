-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "attn" TEXT,
ADD COLUMN     "billToCode" TEXT,
ADD COLUMN     "consignee" TEXT,
ADD COLUMN     "containerInfo" TEXT,
ADD COLUMN     "eta" TIMESTAMP(3),
ADD COLUMN     "etd" TIMESTAMP(3),
ADD COLUMN     "exRate" DECIMAL(14,4),
ADD COLUMN     "feederVessel" TEXT,
ADD COLUMN     "finalDestination" TEXT,
ADD COLUMN     "goods" TEXT,
ADD COLUMN     "hblNo" TEXT,
ADD COLUMN     "measurement" TEXT,
ADD COLUMN     "motherVessel" TEXT,
ADD COLUMN     "noOfPackages" TEXT,
ADD COLUMN     "oblNo" TEXT,
ADD COLUMN     "pod" TEXT,
ADD COLUMN     "pol" TEXT,
ADD COLUMN     "salesman" TEXT,
ADD COLUMN     "shipper" TEXT,
ADD COLUMN     "terms" TEXT;

-- CreateTable
CREATE TABLE "invoice_items" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
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

    CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "invoice_items_invoiceId_idx" ON "invoice_items"("invoiceId");

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
