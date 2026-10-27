-- Optional per-account safety floor, in the account's own currency. NULL keeps the
-- previous behaviour: the global LOW_BALANCE rule (or the simulation suggestion).
ALTER TABLE "Account" ADD COLUMN "lowBalanceThreshold" DECIMAL(18,2);
