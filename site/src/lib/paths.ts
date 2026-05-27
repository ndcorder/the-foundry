function normalizedBase(): string {
  const base = import.meta.env.BASE_URL ?? '/';
  if (!base || base === '/') return '';
  return base.endsWith('/') ? base.slice(0, -1) : base;
}

export function sitePath(targetPath: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(targetPath) || targetPath.startsWith('#')) {
    return targetPath;
  }

  const base = normalizedBase();
  const path = targetPath.startsWith('/') ? targetPath : `/${targetPath}`;
  if (!base) return path;
  if (path === '/') return `${base}/`;
  return `${base}${path}`;
}

export function stripSiteBase(pathname: string): string {
  const base = normalizedBase();
  if (!base) return pathname || '/';
  if (pathname === base || pathname === `${base}/`) return '/';
  if (pathname.startsWith(`${base}/`)) return pathname.slice(base.length) || '/';
  return pathname || '/';
}
