-- Remove the legacy coupon quantity field from persisted automation results.
-- Quantity remains an internal reservation concern and is not part of the
-- execution result contract.
UPDATE automation.execution_ledger
SET result_json = result_json - 'sentQuantity',
    updated_at = now()
WHERE result_json ? 'sentQuantity';
