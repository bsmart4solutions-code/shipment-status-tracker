-- AlterTable
ALTER TABLE "job_documents" ADD COLUMN     "extracted" JSONB,
ADD COLUMN     "mimeType" TEXT,
ADD COLUMN     "originalName" TEXT,
ADD COLUMN     "sizeBytes" INTEGER,
ADD COLUMN     "storedPath" TEXT;

-- CreateIndex
CREATE INDEX "job_documents_jobId_idx" ON "job_documents"("jobId");
