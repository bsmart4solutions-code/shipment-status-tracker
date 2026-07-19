-- CreateEnum
CREATE TYPE "CustomerType" AS ENUM ('COMPANY', 'INDIVIDUAL');

-- CreateEnum
CREATE TYPE "AddressType" AS ENUM ('REGISTERED', 'BILLING', 'SHIPPING', 'WAREHOUSE');

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "arAccount" TEXT,
ADD COLUMN     "assignedSalespersonId" TEXT,
ADD COLUMN     "birthday" TIMESTAMP(3),
ADD COLUMN     "blacklist" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "collectionNotes" TEXT,
ADD COLUMN     "commissionGroup" TEXT,
ADD COLUMN     "companyAnniversary" TIMESTAMP(3),
ADD COLUMN     "contactTitle" TEXT,
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "creditHold" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "creditNotesInternal" TEXT,
ADD COLUMN     "currency" TEXT DEFAULT 'MYR',
ADD COLUMN     "customerAccountCode" TEXT,
ADD COLUMN     "customerCategory" TEXT,
ADD COLUMN     "customerSince" TIMESTAMP(3),
ADD COLUMN     "customerType" "CustomerType" NOT NULL DEFAULT 'COMPANY',
ADD COLUMN     "customerWarnings" TEXT,
ADD COLUMN     "defaultDiscountPct" DECIMAL(7,4),
ADD COLUMN     "defaultWarehouse" TEXT,
ADD COLUMN     "deliveryInstructions" TEXT,
ADD COLUMN     "discountGroup" TEXT,
ADD COLUMN     "extension" TEXT,
ADD COLUMN     "financeRemarks" TEXT,
ADD COLUMN     "firstContactDate" TIMESTAMP(3),
ADD COLUMN     "lastContactDate" TIMESTAMP(3),
ADD COLUMN     "lastSalesDate" TIMESTAMP(3),
ADD COLUMN     "leadSource" TEXT,
ADD COLUMN     "leadStatus" TEXT,
ADD COLUMN     "loadingBayNotes" TEXT,
ADD COLUMN     "mobile" TEXT,
ADD COLUMN     "nextFollowUp" TIMESTAMP(3),
ADD COLUMN     "officePhone" TEXT,
ADD COLUMN     "openingBalance" DECIMAL(14,2),
ADD COLUMN     "openingBalanceDate" TIMESTAMP(3),
ADD COLUMN     "outstandingLimit" DECIMAL(14,2),
ADD COLUMN     "preferredComm" TEXT,
ADD COLUMN     "preferredCourier" TEXT,
ADD COLUMN     "preferredDeliveryMethod" TEXT,
ADD COLUMN     "preferredLanguage" TEXT,
ADD COLUMN     "preferredShippingCompany" TEXT,
ADD COLUMN     "priceLevel" TEXT,
ADD COLUMN     "receiveInvoiceByEmail" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "receivePromotions" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "receiveStatementsByEmail" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "receivingHours" TEXT,
ADD COLUMN     "registrationNo" TEXT,
ADD COLUMN     "salesTeam" TEXT,
ADD COLUMN     "salesTerritory" TEXT,
ADD COLUMN     "shippingNotes" TEXT,
ADD COLUMN     "taxCategory" TEXT,
ADD COLUMN     "taxExempt" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "taxId" TEXT,
ADD COLUMN     "taxType" TEXT,
ADD COLUMN     "timeZone" TEXT,
ADD COLUMN     "updatedById" TEXT,
ADD COLUMN     "vip" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "website" TEXT,
ADD COLUMN     "whatsapp" TEXT;

-- CreateTable
CREATE TABLE "customer_contacts" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" TEXT,
    "department" TEXT,
    "mobile" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "remarks" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "customer_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_addresses" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" "AddressType" NOT NULL DEFAULT 'BILLING',
    "line1" TEXT,
    "line2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "country" TEXT DEFAULT 'Malaysia',
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "customer_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_documents" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "link" TEXT,
    "notes" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_bank_accounts" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "bankName" TEXT,
    "accountName" TEXT,
    "accountNumber" TEXT,
    "swift" TEXT,
    "bankAddress" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "customer_bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_contacts_customerId_idx" ON "customer_contacts"("customerId");

-- CreateIndex
CREATE INDEX "customer_addresses_customerId_idx" ON "customer_addresses"("customerId");

-- CreateIndex
CREATE INDEX "customer_documents_customerId_idx" ON "customer_documents"("customerId");

-- CreateIndex
CREATE INDEX "customer_bank_accounts_customerId_idx" ON "customer_bank_accounts"("customerId");

-- CreateIndex
CREATE INDEX "customers_assignedSalespersonId_idx" ON "customers"("assignedSalespersonId");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_assignedSalespersonId_fkey" FOREIGN KEY ("assignedSalespersonId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_contacts" ADD CONSTRAINT "customer_contacts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_documents" ADD CONSTRAINT "customer_documents_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_bank_accounts" ADD CONSTRAINT "customer_bank_accounts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
