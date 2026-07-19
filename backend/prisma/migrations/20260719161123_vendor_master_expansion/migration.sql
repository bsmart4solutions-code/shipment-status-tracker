-- CreateEnum
CREATE TYPE "VendorType" AS ENUM ('SHIPPING_LINE', 'HAULIER', 'FORWARDING_AGENT', 'CUSTOMS_BROKER', 'WAREHOUSE', 'COURIER', 'AIRLINE', 'SUPPLIER', 'OTHER');

-- AlterTable
ALTER TABLE "vendors" ADD COLUMN     "apAccount" TEXT,
ADD COLUMN     "assignedBuyerId" TEXT,
ADD COLUMN     "blacklist" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "category" TEXT,
ADD COLUMN     "contactTitle" TEXT,
ADD COLUMN     "contractEnd" TIMESTAMP(3),
ADD COLUMN     "contractStart" TIMESTAMP(3),
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "creditLimit" DECIMAL(14,2),
ADD COLUMN     "currency" TEXT DEFAULT 'MYR',
ADD COLUMN     "deliveryTerms" TEXT,
ADD COLUMN     "extension" TEXT,
ADD COLUMN     "financeRemarks" TEXT,
ADD COLUMN     "insuranceExpiry" TIMESTAMP(3),
ADD COLUMN     "leadTimeDays" INTEGER,
ADD COLUMN     "licenseNo" TEXT,
ADD COLUMN     "minOrderValue" DECIMAL(14,2),
ADD COLUMN     "mobile" TEXT,
ADD COLUMN     "nextReviewDate" TIMESTAMP(3),
ADD COLUMN     "officePhone" TEXT,
ADD COLUMN     "onboardedDate" TIMESTAMP(3),
ADD COLUMN     "openingBalance" DECIMAL(14,2),
ADD COLUMN     "openingBalanceDate" TIMESTAMP(3),
ADD COLUMN     "preferredComm" TEXT,
ADD COLUMN     "preferredMode" TEXT,
ADD COLUMN     "registrationNo" TEXT,
ADD COLUMN     "servicesProvided" TEXT,
ADD COLUMN     "taxCategory" TEXT,
ADD COLUMN     "taxExempt" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "taxId" TEXT,
ADD COLUMN     "taxType" TEXT,
ADD COLUMN     "updatedById" TEXT,
ADD COLUMN     "vendorAccountCode" TEXT,
ADD COLUMN     "vendorType" "VendorType" NOT NULL DEFAULT 'SUPPLIER',
ADD COLUMN     "warnings" TEXT,
ADD COLUMN     "website" TEXT,
ADD COLUMN     "whatsapp" TEXT;

-- CreateTable
CREATE TABLE "vendor_contacts" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" TEXT,
    "department" TEXT,
    "mobile" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "remarks" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "vendor_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_addresses" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "type" "AddressType" NOT NULL DEFAULT 'BILLING',
    "line1" TEXT,
    "line2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "country" TEXT DEFAULT 'Malaysia',
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "vendor_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_documents" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "link" TEXT,
    "notes" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_bank_accounts" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "bankName" TEXT,
    "accountName" TEXT,
    "accountNumber" TEXT,
    "swift" TEXT,
    "bankAddress" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "vendor_bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vendor_contacts_vendorId_idx" ON "vendor_contacts"("vendorId");

-- CreateIndex
CREATE INDEX "vendor_addresses_vendorId_idx" ON "vendor_addresses"("vendorId");

-- CreateIndex
CREATE INDEX "vendor_documents_vendorId_idx" ON "vendor_documents"("vendorId");

-- CreateIndex
CREATE INDEX "vendor_bank_accounts_vendorId_idx" ON "vendor_bank_accounts"("vendorId");

-- CreateIndex
CREATE INDEX "vendors_assignedBuyerId_idx" ON "vendors"("assignedBuyerId");

-- AddForeignKey
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_assignedBuyerId_fkey" FOREIGN KEY ("assignedBuyerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_contacts" ADD CONSTRAINT "vendor_contacts_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_addresses" ADD CONSTRAINT "vendor_addresses_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_documents" ADD CONSTRAINT "vendor_documents_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_bank_accounts" ADD CONSTRAINT "vendor_bank_accounts_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
