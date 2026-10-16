-- CreateTable
CREATE TABLE "PropertyLoan" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'EUR',
    "initialPrincipal" DECIMAL(18,2) NOT NULL,
    "outstandingBalance" DECIMAL(18,2),
    "balanceAsOf" DATE,
    "interestRate" DECIMAL(18,2),
    "termMonths" INTEGER,
    "paymentAmount" DECIMAL(18,2),
    "insuranceAmount" DECIMAL(18,2),
    "startDate" DATE,
    "endDate" DATE,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PropertyLoan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PropertyLoan_propertyId_idx" ON "PropertyLoan"("propertyId");

-- AddForeignKey
ALTER TABLE "PropertyLoan" ADD CONSTRAINT "PropertyLoan_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;
