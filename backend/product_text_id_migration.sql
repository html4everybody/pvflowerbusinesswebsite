-- Run once in Supabase SQL Editor.
-- Changes products.id from integer to TEXT so PRODUCT-001, PRODUCT-002
-- etc. become the actual primary key.

-- 1. Drop all FK constraints referencing products.id
ALTER TABLE order_items     DROP CONSTRAINT IF EXISTS order_items_product_id_fkey;
ALTER TABLE product_stock   DROP CONSTRAINT IF EXISTS product_stock_product_id_fkey;
ALTER TABLE cart_items      DROP CONSTRAINT IF EXISTS cart_items_product_id_fkey;

-- 2. Clear dependent tables (fresh start)
DELETE FROM cart_items;
DELETE FROM product_stock;
DELETE FROM order_items;
DELETE FROM products;

-- 3. Change products.id to TEXT primary key
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_pkey;
ALTER TABLE products ALTER COLUMN id DROP DEFAULT;
ALTER TABLE products ALTER COLUMN id TYPE TEXT USING id::TEXT;
ALTER TABLE products ADD CONSTRAINT products_pkey PRIMARY KEY (id);

-- 4. Change product_id columns in dependent tables to TEXT
ALTER TABLE order_items   ALTER COLUMN product_id TYPE TEXT USING product_id::TEXT;
ALTER TABLE product_stock ALTER COLUMN product_id TYPE TEXT USING product_id::TEXT;
ALTER TABLE cart_items    ALTER COLUMN product_id TYPE TEXT USING product_id::TEXT;

-- 5. Re-add FK constraints
ALTER TABLE order_items ADD CONSTRAINT order_items_product_id_fkey
  FOREIGN KEY (product_id) REFERENCES products(id);
ALTER TABLE product_stock ADD CONSTRAINT product_stock_product_id_fkey
  FOREIGN KEY (product_id) REFERENCES products(id);
ALTER TABLE cart_items ADD CONSTRAINT cart_items_product_id_fkey
  FOREIGN KEY (product_id) REFERENCES products(id);

-- 6. Also change reviews.product_id if it exists (no FK, just type)
ALTER TABLE reviews ALTER COLUMN product_id TYPE TEXT USING product_id::TEXT;

-- After running this, restart your backend on Render.
-- The backend will generate PRODUCT-001, PRODUCT-002 etc. as actual IDs.
