import { VM, MemoryProvider, type ExecResult, type ExecProcess } from "@earendil-works/gondolin";

export interface SandboxConfig {
  timeoutMs: number;
  memoryLimitMb?: number;
}

export interface SandboxResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

export interface SandboxSession {
  writeFile(path: string, content: string): Promise<void>;
  exec(command: string, timeoutMs?: number): Promise<SandboxResult>;
  execDirect(cmd: string, args: string[], timeoutMs?: number): Promise<SandboxResult>;
  installPackages(packages: string[]): Promise<SandboxResult>;
  installDeps(command: string): Promise<SandboxResult>;
  close(): Promise<void>;
}

const DEFAULT_CONFIG: SandboxConfig = {
  timeoutMs: 60_000,
};

function mergeConfig(partial?: Partial<SandboxConfig>): SandboxConfig {
  return { ...DEFAULT_CONFIG, ...partial };
}

function toResult(execResult: ExecResult, durationMs: number): SandboxResult {
  return {
    exitCode: execResult.exitCode,
    stdout: execResult.stdout,
    stderr: execResult.stderr,
    timedOut: false,
    durationMs,
  };
}

function timedOutResult(timeoutMs: number): SandboxResult {
  return {
    exitCode: 124,
    stdout: "",
    stderr: `Execution timed out after ${timeoutMs}ms`,
    timedOut: true,
    durationMs: timeoutMs,
  };
}

// Race an ExecProcess (PromiseLike) against a timeout.
// ExecProcess implements PromiseLike<ExecResult>, not Promise,
// so we wrap via Promise.resolve to get a proper Promise for racing.
function timedExec(
  process: ExecProcess,
  timeoutMs: number,
): Promise<SandboxResult> {
  const start = Date.now();

  const execPromise = Promise.resolve(process).then(
    (result) => toResult(result, Date.now() - start),
  );

  const timeoutPromise = new Promise<SandboxResult>((resolve) => {
    const timer = setTimeout(() => resolve(timedOutResult(timeoutMs)), timeoutMs);
    // Don't hold the Node.js event loop open
    if (typeof timer === "object" && "unref" in timer) {
      timer.unref();
    }
  });

  return Promise.race([execPromise, timeoutPromise]);
}

export async function createSandbox(
  config?: Partial<SandboxConfig>,
): Promise<SandboxSession> {
  const cfg = mergeConfig(config);

  let vm: VM;
  try {
    vm = await VM.create({
      vfs: {
        mounts: { "/workspace": new MemoryProvider() },
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to create sandbox VM. Is QEMU installed? (brew install qemu)\n${message}`,
    );
  }

  let closed = false;

  function assertOpen(): void {
    if (closed) {
      throw new Error("Sandbox session is already closed");
    }
  }

  const session: SandboxSession = {
    async writeFile(filePath: string, content: string): Promise<void> {
      assertOpen();
      const fullPath = filePath.startsWith("/")
        ? filePath
        : `/workspace/${filePath}`;

      const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
      if (dir) {
        await vm.fs.mkdir(dir, { recursive: true });
      }

      await vm.fs.writeFile(fullPath, content);
    },

    async exec(command: string, timeoutMs?: number): Promise<SandboxResult> {
      assertOpen();
      return timedExec(
        vm.exec(`cd /workspace && ${command}`),
        timeoutMs ?? cfg.timeoutMs,
      );
    },

    async execDirect(
      cmd: string,
      args: string[],
      timeoutMs?: number,
    ): Promise<SandboxResult> {
      assertOpen();
      return timedExec(
        vm.exec([cmd, ...args]),
        timeoutMs ?? cfg.timeoutMs,
      );
    },

    async installPackages(packages: string[]): Promise<SandboxResult> {
      assertOpen();
      if (packages.length === 0) {
        return { exitCode: 0, stdout: "", stderr: "", timedOut: false, durationMs: 0 };
      }
      return timedExec(
        vm.exec(`apk update && apk add --no-cache ${packages.join(" ")}`),
        cfg.timeoutMs,
      );
    },

    async installDeps(command: string): Promise<SandboxResult> {
      assertOpen();
      return timedExec(
        vm.exec(`cd /workspace && ${command}`),
        cfg.timeoutMs,
      );
    },

    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await vm.close();
    },
  };

  return session;
}
