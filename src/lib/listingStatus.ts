export type ListingStatusKind = 'showcase' | 'listed_no_source' | 'draft' | 'for_sale';

export interface ListingStatusInput {
  isDemo?: boolean;
  hasCanonicalRepo?: boolean;
  productStatus?: string | null;
  isAuthoritativeLive: boolean;
}

export interface ListingStatusPresentation {
  kind: ListingStatusKind;
  label: 'SHOWCASE' | 'LISTED — NO SOURCE' | 'DRAFT' | 'FOR SALE';
  sentence: string;
  className: string;
}

export function deriveListingStatus(input: ListingStatusInput): ListingStatusPresentation {
  if (input.isDemo || !input.isAuthoritativeLive) {
    return {
      kind: 'showcase',
      label: 'SHOWCASE',
      sentence: 'Preview-only showcase; it cannot be bought or forked.',
      className: 'bg-amber-100 text-amber-900 border-amber-400'
    };
  }
  if (!input.hasCanonicalRepo) {
    return {
      kind: 'listed_no_source',
      label: 'LISTED — NO SOURCE',
      sentence: 'Listed, but source is not on GITSMITH, so buying and forking are unavailable.',
      className: 'bg-gray-100 text-gray-700 border-gray-400'
    };
  }
  if (input.productStatus !== 'active') {
    return {
      kind: 'draft',
      label: 'DRAFT',
      sentence: 'Source is on GITSMITH; purchasing stays unavailable until the listing is active.',
      className: 'bg-blue-100 text-blue-900 border-blue-400'
    };
  }
  return {
    kind: 'for_sale',
    label: 'FOR SALE',
    sentence: 'Source and listing are ready to buy and fork.',
    className: 'bg-emerald-100 text-emerald-900 border-emerald-400'
  };
}
