-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'INVOICE_OVERDUE';

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "lastReminderAt" TIMESTAMP(3);
