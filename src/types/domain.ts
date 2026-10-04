export type Technology = {
  name: string;
  category: 'framework' | 'cms' | 'ecommerce' | 'frontend' | 'analytics' | 'server' | 'other';
  confidence: number;
  evidence: string[];
};

export type CategoryRecord = {
  name: string;
  slug?: string;
  parentName?: string;
  sourceUrl: string;
  breadcrumbs: string[];
};

export type IngredientRecord = {
  name: string;
  amount?: number;
  unit?: string;
  form?: string;
};

export type ProductRecord = {
  canonicalUrl: string;
  name: string;
  brand?: string;
  description?: string;
  categoryNames: string[];
  breadcrumbs: string[];
  imageUrls: string[];
  sku?: string;
  barcode?: string;
  price?: number;
  currency?: string;
  availability?: string;
  manufacturer?: string;
  form?: string;
  packageSize?: string;
  ingredients: IngredientRecord[];
  attributes: Record<string, string | number | boolean | null>;
  source: {
    url: string;
    extractedAt: string;
  };
};

export type ExtractedPage = {
  url: string;
  title?: string;
  description?: string;
  canonicalUrl?: string;
  breadcrumbs: string[];
  technologies: Technology[];
  category?: CategoryRecord;
  product?: ProductRecord;
  links: string[];
  rawHtml: string;
};
