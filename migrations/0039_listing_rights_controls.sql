ALTER TABLE commerce_products
    ADD COLUMN resale_enabled INTEGER NOT NULL DEFAULT 1 CHECK (resale_enabled IN (0, 1));

ALTER TABLE commerce_products
    ADD COLUMN forking_enabled INTEGER NOT NULL DEFAULT 1 CHECK (forking_enabled IN (0, 1));
