-- AlterTable
ALTER TABLE "quotations" ADD COLUMN     "cargoVolume" TEXT,
ADD COLUMN     "cargoWeight" TEXT,
ADD COLUMN     "carrier" TEXT,
ADD COLUMN     "exclusions" TEXT,
ADD COLUMN     "finalDestination" TEXT,
ADD COLUMN     "freeTime" TEXT,
ADD COLUMN     "modeOfTransport" TEXT,
ADD COLUMN     "transitTime" TEXT;
