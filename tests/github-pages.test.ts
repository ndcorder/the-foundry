import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';

describe('GitHub workflow scaffolding', () => {
  it('deploys portfolio pages automatically from main or master pushes', () => {
    const workflowPath = path.resolve('.github', 'workflows', 'site.yml');
    const workflow = yaml.parse(readFileSync(workflowPath, 'utf-8')) as {
      on: {
        push: {
          branches: string[];
          paths: string[];
        };
        workflow_dispatch: unknown;
      };
    };

    expect(workflow.on.push.branches).toEqual(expect.arrayContaining(['main', 'master']));
    expect(workflow.on.push.paths).toEqual(expect.arrayContaining([
      'portfolio/**',
      'identity/**',
      'logs/**',
      'site/**',
      '.github/workflows/site.yml',
    ]));
    expect(workflow.on.workflow_dispatch).toBeDefined();
  });

  it('runs CI for generated portfolio workdirs that only contain the site project', () => {
    const workflowPath = path.resolve('.github', 'workflows', 'ci.yml');
    const workflowContent = readFileSync(workflowPath, 'utf-8');

    expect(workflowContent).toContain('site/package.json');
    expect(workflowContent).toContain('working-directory: site');
    expect(workflowContent).toContain('npm run build');
  });

  it('publishes interactive artifact files through static Astro routes', () => {
    const portfolioPage = readFileSync(path.resolve('site', 'src', 'pages', 'portfolio', '[id].astro'), 'utf-8');

    expect(portfolioPage).not.toContain('copyFileSync');
    expect(existsSync(path.resolve('site', 'src', 'pages', 'artifacts', '[...path].ts'))).toBe(true);
  });
});

describe('Astro GitHub Pages configuration', () => {
  const previousEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...previousEnv };
  });

  it('uses the repository name as the base path for GitHub project pages', async () => {
    process.env.GITHUB_ACTIONS = 'true';
    process.env.GITHUB_REPOSITORY = 'octocat/foundry-workdir';
    process.env.GITHUB_REPOSITORY_OWNER = 'octocat';
    delete process.env.SITE_BASE;
    delete process.env.SITE_URL;

    const configModule = await import('../site/astro.config.mjs');

    expect(configModule.getGithubPagesAstroOptions()).toEqual({
      site: 'https://octocat.github.io',
      base: '/foundry-workdir',
    });
  });
});
