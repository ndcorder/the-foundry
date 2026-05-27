import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

function normalizeBase(base) {
  if (!base) return undefined;
  const trimmed = base.trim();
  if (!trimmed || trimmed === '/') return undefined;
  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeadingSlash.replace(/\/$/, '');
}

export function getGithubPagesAstroOptions(env = process.env) {
  const repositoryOwner = env.GITHUB_REPOSITORY_OWNER?.trim();
  const repositoryName = env.GITHUB_REPOSITORY?.split('/')[1]?.trim();
  const explicitSite = env.SITE_URL?.trim();
  const explicitBase = normalizeBase(env.SITE_BASE);
  const site = explicitSite || (repositoryOwner ? `https://${repositoryOwner}.github.io` : undefined);

  if (explicitBase) {
    return { site, base: explicitBase };
  }

  const ownerPagesRepo = repositoryOwner
    ? `${repositoryOwner.toLowerCase()}.github.io`
    : '';
  const needsProjectBase = env.GITHUB_ACTIONS === 'true' &&
    repositoryName &&
    repositoryName.toLowerCase() !== ownerPagesRepo;

  return {
    site,
    base: needsProjectBase ? `/${repositoryName}` : undefined,
  };
}

const githubPagesOptions = getGithubPagesAstroOptions();

export default defineConfig({
  ...githubPagesOptions,
  output: 'static',
  build: { assets: '_assets' },
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: { '@lib': '/src/lib', '@components': '/src/components' }
    }
  }
});
