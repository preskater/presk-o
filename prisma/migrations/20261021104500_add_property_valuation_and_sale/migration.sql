-- Add property valuation and sale figures.
--
-- Every price is optional: "not recorded" is unknown, never zero. The reference
-- currency defaults to EUR, like every other amount of the repository.
ALTER TABLE "Property"
    ADD COLUMN "currency" CHAR(3) NOT NULL DEFAULT 'EUR',
    ADD COLUMN "purchasePrice" DECIMAL(18,2),
    ADD COLUMN "estimatedValue" DECIMAL(18,2),
    ADD COLUMN "estimatedValueAsOf" DATE,
    ADD COLUMN "targetGainRate" DECIMAL(5,2) NOT NULL DEFAULT 10,
    ADD COLUMN "salePrice" DECIMAL(18,2),
    ADD COLUMN "saleCosts" DECIMAL(18,2);
