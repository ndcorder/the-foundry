import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock the gondolin module
const mockVmClose = vi.fn().mockResolvedValue(undefined);
const mockVmExec = vi.fn();
const mockFsMkdir = vi.fn().mockResolvedValue(undefined);
const mockFsWriteFile = vi.fn().mockResolvedValue(undefined);

const mockVm = {
  exec: mockVmExec,
  fs: {
    mkdir: mockFsMkdir,
    writeFile: mockFsWriteFile,
  },
  close: mockVmClose,
};

const mockVmCreate = vi.fn().mockResolvedValue(mockVm);

vi.mock('@earendil-works/gondolin', () => ({
  VM: { create: mockVmCreate },
  MemoryProvider: vi.fn(),
}));

describe('sandbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVmCreate.mockResolvedValue(mockVm);
  });

  describe('createSandbox', () => {
    it('creates a sandbox session with default config', async () => {
      const { createSandbox } = await import('../src/sandbox/sandbox.js');
      const session = await createSandbox();
      expect(session).toBeDefined();
      expect(typeof session.writeFile).toBe('function');
      expect(typeof session.exec).toBe('function');
      expect(typeof session.execDirect).toBe('function');
      expect(typeof session.installPackages).toBe('function');
      expect(typeof session.installDeps).toBe('function');
      expect(typeof session.close).toBe('function');
      expect(mockVmCreate).toHaveBeenCalledOnce();
    });

    it('throws when VM creation fails', async () => {
      mockVmCreate.mockRejectedValueOnce(new Error('QEMU not installed'));
      const { createSandbox } = await import('../src/sandbox/sandbox.js');
      await expect(createSandbox()).rejects.toThrow('Failed to create sandbox VM');
    });
  });

  describe('SandboxSession', () => {
    it('writeFile writes to workspace path', async () => {
      const { createSandbox } = await import('../src/sandbox/sandbox.js');
      const session = await createSandbox();
      await session.writeFile('test.js', 'console.log(1)');
      expect(mockFsWriteFile).toHaveBeenCalledWith('/workspace/test.js', 'console.log(1)');
    });

    it('writeFile handles absolute paths', async () => {
      const { createSandbox } = await import('../src/sandbox/sandbox.js');
      const session = await createSandbox();
      await session.writeFile('/custom/path.js', 'code');
      expect(mockFsWriteFile).toHaveBeenCalledWith('/custom/path.js', 'code');
    });

    it('writeFile creates parent directories', async () => {
      const { createSandbox } = await import('../src/sandbox/sandbox.js');
      const session = await createSandbox();
      await session.writeFile('src/lib/test.js', 'code');
      expect(mockFsMkdir).toHaveBeenCalledWith('/workspace/src/lib', { recursive: true });
    });

    it('exec runs command in /workspace', async () => {
      // Create a PromiseLike that resolves immediately
      const execResult = { exitCode: 0, stdout: 'output', stderr: '' };
      const promiseLike = {
        then: (resolve: any) => Promise.resolve(execResult).then(resolve),
      };
      mockVmExec.mockReturnValueOnce(promiseLike);

      const { createSandbox } = await import('../src/sandbox/sandbox.js');
      const session = await createSandbox();
      const result = await session.exec('node test.js');

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('output');
      expect(result.timedOut).toBe(false);
      expect(mockVmExec).toHaveBeenCalledWith('cd /workspace && node test.js');
    });

    it('exec handles timeout', async () => {
      // Create a PromiseLike that never resolves
      const promiseLike = {
        then: () => new Promise(() => {}),
      };
      mockVmExec.mockReturnValueOnce(promiseLike);

      const { createSandbox } = await import('../src/sandbox/sandbox.js');
      const session = await createSandbox({ timeoutMs: 100 });
      const result = await session.exec('sleep 999', 100);

      expect(result.timedOut).toBe(true);
      expect(result.exitCode).toBe(124);
    });

    it('execDirect runs command with args', async () => {
      const execResult = { exitCode: 0, stdout: 'direct output', stderr: '' };
      const promiseLike = {
        then: (resolve: any) => Promise.resolve(execResult).then(resolve),
      };
      mockVmExec.mockReturnValueOnce(promiseLike);

      const { createSandbox } = await import('../src/sandbox/sandbox.js');
      const session = await createSandbox();
      const result = await session.execDirect('node', ['test.js']);

      expect(result.exitCode).toBe(0);
      expect(mockVmExec).toHaveBeenCalledWith(['node', 'test.js']);
    });

    it('installPackages runs apk command', async () => {
      const execResult = { exitCode: 0, stdout: 'installed', stderr: '' };
      const promiseLike = {
        then: (resolve: any) => Promise.resolve(execResult).then(resolve),
      };
      mockVmExec.mockReturnValueOnce(promiseLike);

      const { createSandbox } = await import('../src/sandbox/sandbox.js');
      const session = await createSandbox();
      const result = await session.installPackages(['git', 'curl']);

      expect(mockVmExec).toHaveBeenCalledWith('apk update && apk add --no-cache git curl');
      expect(result.exitCode).toBe(0);
    });

    it('installPackages returns immediately for empty list', async () => {
      const { createSandbox } = await import('../src/sandbox/sandbox.js');
      const session = await createSandbox();
      const result = await session.installPackages([]);

      expect(result.exitCode).toBe(0);
      expect(result.durationMs).toBe(0);
      expect(mockVmExec).not.toHaveBeenCalled();
    });

    it('installDeps runs command in /workspace', async () => {
      const execResult = { exitCode: 0, stdout: 'deps installed', stderr: '' };
      const promiseLike = {
        then: (resolve: any) => Promise.resolve(execResult).then(resolve),
      };
      mockVmExec.mockReturnValueOnce(promiseLike);

      const { createSandbox } = await import('../src/sandbox/sandbox.js');
      const session = await createSandbox();
      const result = await session.installDeps('npm install');

      expect(mockVmExec).toHaveBeenCalledWith('cd /workspace && npm install');
      expect(result.exitCode).toBe(0);
    });

    it('close closes the VM', async () => {
      const { createSandbox } = await import('../src/sandbox/sandbox.js');
      const session = await createSandbox();
      await session.close();
      expect(mockVmClose).toHaveBeenCalledOnce();
    });

    it('close is idempotent', async () => {
      const { createSandbox } = await import('../src/sandbox/sandbox.js');
      const session = await createSandbox();
      await session.close();
      await session.close();
      expect(mockVmClose).toHaveBeenCalledOnce();
    });

    it('throws on operations after close', async () => {
      const { createSandbox } = await import('../src/sandbox/sandbox.js');
      const session = await createSandbox();
      await session.close();
      await expect(session.writeFile('test.js', 'code')).rejects.toThrow('already closed');
      await expect(session.exec('ls')).rejects.toThrow('already closed');
    });
  });
});
