export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;                 // base price (pre-discount)
  discount_percent?: number;     // merchant-set discount %
  final_price?: number;          // effective price customers pay
  merchant_id?: string;
  catalog_id?: string;           // set when this listing is admin-assigned & shared across merchants
  image: string;
  category: string;
  inStock: boolean;
  rating: number;
}

/** Effective selling price of a product (applies merchant discount if any). */
export function sellPrice(p: Product): number {
  return p?.final_price ?? p?.price ?? 0;
}

export interface CartItem {
  product: Product;
  quantity: number;
}