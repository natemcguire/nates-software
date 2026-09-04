export const repositorySourcePolicyColumns = `
  r.app_id AS sourceRepositoryAppId,
  (SELECT a.id FROM app_listings a WHERE a.repository_id = r.id ORDER BY a.id LIMIT 1) AS sourceListingAppId,
  (SELECT COUNT(*) FROM app_listings a WHERE a.repository_id = r.id) AS sourceListingLinkCount,
  (SELECT p.app_id FROM commerce_products p WHERE p.repository_id = r.id ORDER BY p.app_id LIMIT 1) AS sourceRepositoryProductAppId,
  (SELECT COUNT(*) FROM commerce_products p WHERE p.repository_id = r.id) AS sourceRepositoryProductLinkCount,
  (SELECT COUNT(*) FROM commerce_orders o WHERE o.app_id = COALESCE(
    r.app_id,
    (SELECT a.id FROM app_listings a WHERE a.repository_id = r.id ORDER BY a.id LIMIT 1),
    (SELECT p.app_id FROM commerce_products p WHERE p.repository_id = r.id ORDER BY p.app_id LIMIT 1)
  )) AS sourceCommerceEvidenceCount,
  cp.app_id AS sourceProductAppId,
  cp.repository_id AS sourceProductRepositoryId,
  cp.forking_enabled AS forkingEnabled
`;

export const repositorySourcePolicyJoin = `
  LEFT JOIN commerce_products cp ON cp.app_id = COALESCE(
    r.app_id,
    (SELECT a.id FROM app_listings a WHERE a.repository_id = r.id ORDER BY a.id LIMIT 1),
    (SELECT p.app_id FROM commerce_products p WHERE p.repository_id = r.id ORDER BY p.app_id LIMIT 1)
  )
`;

export function repositorySourceIsPrivate(row: any): boolean {
  const linkedIds = new Set(
    [row?.sourceRepositoryAppId, row?.sourceListingAppId, row?.sourceRepositoryProductAppId]
      .filter(value => typeof value === 'string' && value.length > 0)
  );
  if (linkedIds.size === 0) return false;
  if (linkedIds.size !== 1) return true;
  if (Number(row?.sourceListingLinkCount || 0) > 1 || Number(row?.sourceRepositoryProductLinkCount || 0) > 1) return true;
  const linkedAppId = Array.from(linkedIds)[0];
  if (!row?.sourceProductAppId) return Number(row?.sourceCommerceEvidenceCount || 0) > 0;
  if (row.sourceProductAppId !== linkedAppId) return true;
  if (row?.sourceProductRepositoryId && row.sourceProductRepositoryId !== (row.id || row.repositoryId)) return true;
  return Number(row?.forkingEnabled) !== 1;
}

export function listingSourceIsPrivate(row: any): boolean {
  if (!row?.sourceProductAppId) return Number(row?.sourceCommerceEvidenceCount || 0) > 0;
  if (row?.sourceProductRepositoryId && row.sourceProductRepositoryId !== row.repositoryId) return true;
  return Number(row?.forkingEnabled) !== 1;
}
