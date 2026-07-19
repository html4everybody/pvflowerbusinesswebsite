export type UnitType = 'stem' | 'weight' | 'bunch' | 'pair';

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
export function formatQty(qty: number, product: Product): string {
  const type = product.unit_type || 'stem';
  if (type === 'weight') {
    const grams = qty * (product.min_quantity || 100);
    return grams >= 1000 ? `${grams / 1000}kg` : `${grams}g`;
  }
  if (type === 'pair')  return `${qty} pair${qty !== 1 ? 's' : ''}`;
  if (type === 'bunch') return `${qty} bunch${qty !== 1 ? 'es' : ''}`;
  return `${qty} stem${qty !== 1 ? 's' : ''}`;
}

/** Short price-per-unit suffix shown next to the price (e.g. "/ 100g", "/ stem"). */
export function unitPriceLabel(product: Product): string {
  const type = product.unit_type || 'stem';
  if (type === 'weight') {
    const g = product.min_quantity || 100;
    return `/ ${g >= 1000 ? `${g / 1000}kg` : `${g}g`}`;
  }
  if (type === 'pair')  return '/ pair';
  if (type === 'bunch') return '/ bunch';
  return '/ stem';
}

export interface CartItem {
  product: Product;
  quantity: number;
}
