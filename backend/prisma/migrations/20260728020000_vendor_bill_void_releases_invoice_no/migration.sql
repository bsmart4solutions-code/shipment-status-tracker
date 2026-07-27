-- Sprint 03A / H-1 — a VOID vendor bill must release its vendor invoice number.
--
-- The Sprint 03 constraint was unconditional, so voiding a mis-keyed bill
-- permanently burned that number and the documented correction workflow
-- (create -> approve -> void -> re-enter the same number) could not be
-- executed. Replace it with a PARTIAL unique index that ignores VOID rows:
-- duplicate protection for live bills is unchanged, cancelled numbers are
-- reusable.
--
-- Prisma cannot express partial indexes, so this index is managed here and is
-- deliberately absent from schema.prisma (see the comment on VendorBill).

DROP INDEX IF EXISTS "vendor_bills_vendorId_vendorInvoiceNo_key";

CREATE UNIQUE INDEX "vendor_bills_vendor_invoice_active_key"
  ON "vendor_bills" ("vendorId", "vendorInvoiceNo")
  WHERE "status" <> 'VOID';
