const DEFAULT_ALLOWED_TENANTS = new Set<string>([
  'tenant-acme',
  'tenant-globex',
  'tenant-demo',
]);

export function normalizeTenantId(tenantId?: string): string | undefined {
  const value = tenantId?.trim();
  return value ? value : undefined;
}

export function getAllowedTenantIds(): string[] {
  const configured = process.env.ALLOWED_TENANTS?.split(',').map((tenant) => tenant.trim()).filter(Boolean) ?? [];
  return configured.length > 0 ? configured : [...DEFAULT_ALLOWED_TENANTS];
}

export function assertTenantAccess(tenantId: string): void {
  const normalizedTenantId = normalizeTenantId(tenantId);
  if (!normalizedTenantId) {
    throw new Error('Tenant ID is required.');
  }

  // Grant access for all registered businesses (biz_*), tenant-* IDs, or wildcards
  if (normalizedTenantId.startsWith('biz_') || normalizedTenantId.startsWith('tenant-')) {
    return;
  }

  const allowedTenantIds = getAllowedTenantIds();
  if (allowedTenantIds.length > 0 && !allowedTenantIds.includes('*') && !allowedTenantIds.includes(normalizedTenantId)) {
    throw new Error(`Tenant '${normalizedTenantId}' is not authorized for this environment.`);
  }
}
