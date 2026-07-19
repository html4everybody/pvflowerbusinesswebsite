-- Run once in Supabase SQL Editor.
-- Changes merchants.id from UUID to TEXT so human-readable IDs like
-- VIVAPETALS, MERCH-001, MERCH-002 can be used as the actual primary key.

-- 1. Drop FK constraints that reference merchants.id
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_merchant_id_fkey;
ALTER TABLE order_merchant_parts DROP CONSTRAINT IF EXISTS order_merchant_parts_merchant_id_fkey;

-- 2. Clear all data (fresh start — no products yet)
DELETE FROM order_merchant_parts;
DELETE FROM products;
DELETE FROM merchants;

-- 3. Change merchants.id to TEXT primary key
ALTER TABLE merchants DROP CONSTRAINT IF EXISTS merchants_pkey;
ALTER TABLE merchants ALTER COLUMN id DROP DEFAULT;
ALTER TABLE merchants ALTER COLUMN id TYPE TEXT USING id::TEXT;
ALTER TABLE merchants ADD CONSTRAINT merchants_pkey PRIMARY KEY (id);

-- 4. Change products.merchant_id to TEXT
ALTER TABLE products ALTER COLUMN merchant_id TYPE TEXT USING merchant_id::TEXT;

-- 5. Change order_merchant_parts.merchant_id to TEXT
ALTER TABLE order_merchant_parts ALTER COLUMN merchant_id TYPE TEXT USING merchant_id::TEXT;

-- 6. Re-add FK constraints
ALTER TABLE products ADD CONSTRAINT products_merchant_id_fkey
  FOREIGN KEY (merchant_id) REFERENCES merchants(id);
ALTER TABLE order_merchant_parts ADD CONSTRAINT order_merchant_parts_merchant_id_fkey
  FOREIGN KEY (merchant_id) REFERENCES merchants(id);

-- After running this, restart your backend on Render.
-- The backend will auto-create the VIVAPETALS house merchant with id='VIVAPETALS'.
