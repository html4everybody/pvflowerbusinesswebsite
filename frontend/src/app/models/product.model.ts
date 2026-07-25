export type UnitType = 'stem' | 'weight' | 'pair';

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
  deliverable?: boolean;         // false when the fulfilling merchant has temporarily closed their shop
  rating: number;
  unit_type?: UnitType;          // how the product is sold
  min_quantity?: number;         // for weight: grams per unit; for others: minimum pieces
}

/** Effective selling price of a product (applies merchant discount if any). */
export function sellPrice(p: Product): number {
  return p?.final_price ?? p?.price ?? 0;
}

/**
 * Human-readable quantity label for a product.
 * For weight: qty × min_quantity grams (e.g. qty=5, minQ=100 → "500g")
 * For others: qty stems / bunches / pairs
 */
/** qty for weight products is in kg (0.1 = 100g, 1.5 = 1.5kg). */
export function formatQty(qty: number, product: Product): string {
  const type = product.unit_type || 'stem';
  if (type === 'weight') {
    const grams = Math.round(qty * 1000);
    return grams < 1000 ? `${grams}g` : `${qty}kg`;
  }
  if (type === 'pair') return `${qty} pair${qty !== 1 ? 's' : ''}`;
  return `${qty} stem${qty !== 1 ? 's' : ''}`;
}

/** Short price-per-unit suffix shown next to the price. */
export function unitPriceLabel(product: Product): string {
  const type = product.unit_type || 'stem';
  if (type === 'weight') return '/ kg';
  if (type === 'pair') return '/ pair';
  return '/ stem';
}

export interface CartItem {
  product: Product;
  quantity: number;
}
