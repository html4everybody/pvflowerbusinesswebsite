export interface BouquetFlower {
  productId: number;
  name: string;
  image: string;
  price: number;
  count: number;
}

export type ArrangementStyle = 'round' | 'cascading' | 'posy' | 'hand-tied';
export type BouquetSize = 'small' | 'medium' | 'large';

export interface BouquetDesign {
  flowers: BouquetFlower[];
  style: ArrangementStyle;
  wrappingColor: string;
  wrappingName: string;
  size: BouquetSize;
}
