-- Data fix: Job.actualRevenue used to be copied from Quotation.sellingPrice,
-- which is the TAX-INCLUSIVE grand total. Collected SST is not revenue, and
-- the job-based P&L was overstating revenue/margin by the tax amount while
-- profit was computed net — making actualRevenue − actualCost ≠ profit.
--
-- Convert affected rows to net-of-tax. The equality guard only touches jobs
-- whose actualRevenue still exactly equals the source quotation's grand total
-- (i.e. rows carrying the old convention); manually adjusted actuals are
-- left untouched.
UPDATE "jobs" j
SET "actualRevenue" = j."actualRevenue" - q."taxAmt",
    "profit"        = (j."actualRevenue" - q."taxAmt") - j."actualCost"
FROM "quotations" q
WHERE q."id" = j."quotationId"
  AND j."actualRevenue" = q."sellingPrice"
  AND q."taxAmt" <> 0;
