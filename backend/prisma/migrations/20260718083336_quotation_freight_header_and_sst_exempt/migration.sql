-- AlterTable
ALTER TABLE "quotation_items" ADD COLUMN     "taxExempt" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "quotations" ADD COLUMN     "attn" TEXT,
ADD COLUMN     "goods" TEXT,
ADD COLUMN     "paymentTerm" TEXT,
ADD COLUMN     "pod" TEXT,
ADD COLUMN     "pol" TEXT,
ADD COLUMN     "shipmentType" TEXT,
ADD COLUMN     "shippingTerm" TEXT,
ADD COLUMN     "subject" TEXT,
ADD COLUMN     "yourRef" TEXT;
