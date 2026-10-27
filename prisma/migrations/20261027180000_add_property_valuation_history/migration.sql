CREATE TABLE "PropertyValuation" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "valuedOn" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "sourceNote" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PropertyValuation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PropertyValuation_propertyId_valuedOn_idx"
    ON "PropertyValuation"("propertyId", "valuedOn");

ALTER TABLE "PropertyValuation"
    ADD CONSTRAINT "PropertyValuation_propertyId_fkey"
    FOREIGN KEY ("propertyId") REFERENCES "Property"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
