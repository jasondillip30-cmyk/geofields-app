BEGIN;

-- The historical batch migration references this enum before it creates its tables.
DO $$
BEGIN
    IF to_regtype('"InventoryUsageContextType"') IS NULL THEN
        CREATE TYPE "InventoryUsageContextType" AS ENUM ('DRILLING_REPORT', 'MAINTENANCE', 'BREAKDOWN', 'OTHER');
    END IF;
END
$$;

COMMIT;
