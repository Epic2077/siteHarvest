export type SiteConfig = {
  name: string;
  match: { hosts: string[] };
  selectors?: {
    product?: string;
    title?: string;
    description?: string;
    brand?: string;
    ingredients?: string;
    category?: string;
    price?: string;
    availability?: string;
    sku?: string;
    barcode?: string;
  };
  discovery?: {
    categoryLinks?: string[];
    productLinks?: string[];
    pagination?: string[];
  };
};
