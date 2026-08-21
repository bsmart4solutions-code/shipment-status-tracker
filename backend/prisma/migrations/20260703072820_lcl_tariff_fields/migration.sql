-- CreateEnum
CREATE TYPE "RateAvailability" AS ENUM ('AVAILABLE', 'ON_REQUEST', 'SUSPENDED');

-- AlterEnum
ALTER TYPE "RateType" ADD VALUE 'PER_WM';

-- AlterTable
ALTER TABLE "vendor_service_rates" ADD COLUMN     "availability" "RateAvailability" NOT NULL DEFAULT 'AVAILABLE',
ADD COLUMN     "freightCollect" BOOLEAN,
ADD COLUMN     "surcharges" JSONB,
ADD COLUMN     "transitDays" TEXT,
ADD COLUMN     "viaPort" TEXT,
ADD COLUMN     "weightRatio" INTEGER;
