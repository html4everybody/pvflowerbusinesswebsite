-- A merchant can attach a photo when marking their part of an order
-- delivered; shown to the customer on order-detail/track-order as delivery
-- confirmation proof.
ALTER TABLE order_merchant_parts ADD COLUMN IF NOT EXISTS delivery_photo_url TEXT;
