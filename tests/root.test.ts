import { describe, it, expect, beforeEach, vi } from 'vitest';
import path from 'node:path';

describe('root', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('defaults to cwd when getRootDir called without setRootDir', async () => {
    const { getRootDir } = await import('../src/root.js');
    expect(getRootDir()).toBe(process.cwd());
  });

  it('setRootDir changes the root', async () => {
    const { setRootDir, getRootDir } = await import('../src/root.js');
    setRootDir('/tmp/test');
    expect(getRootDir()).toBe('/tmp/test');
  });

  it('resolve joins segments to root', async () => {
    const { setRootDir, resolve } = await import('../src/root.js');
    setRootDir('/tmp/foundry');
    expect(resolve('portfolio', 'index.md')).toBe(path.join('/tmp/foundry', 'portfolio', 'index.md'));
  });

  it('setRootDir resolves relative paths', async () => {
    const { setRootDir, getRootDir } = await import('../src/root.js');
    setRootDir('relative/path');
    expect(getRootDir()).toBe(path.resolve('relative/path'));
  });

  it('getRootDir returns same value on repeated calls', async () => {
    const { getRootDir } = await import('../src/root.js');
    const first = getRootDir();
    const second = getRootDir();
    expect(first).toBe(second);
  });

  it('resolve with no segments returns root', async () => {
    const { setRootDir, resolve } = await import('../src/root.js');
    setRootDir('/tmp/foundry');
    expect(resolve()).toBe('/tmp/foundry');
  });
});
