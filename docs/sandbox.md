# Sandbox Architecture — Decision Record

## Decision

Use Gondolin (`@earendil-works/gondolin`) as the Tester's sandbox environment.

## Options Evaluated

### 1. Docker (container per test run)

- **Pros:** Mature ecosystem, wide language/runtime support, familiar tooling, strong isolation via namespaces + cgroups, easy to set resource limits.
- **Cons:** Requires Docker daemon running (heavy background process), Docker Desktop license on macOS, slower cold-start per container (~1-3s), no native Pi SDK integration — needs shell-out orchestration, container image management adds complexity.

### 2. Firejail / Nsjail

- **Pros:** Lightweight, fast startup, fine-grained seccomp/capability control, no daemon required.
- **Cons:** Linux-only — the Foundry targets macOS (arm64) as primary dev environment. Would require a Linux VM layer anyway, defeating the "lightweight" advantage. No TypeScript API — shell-out only. No Pi SDK integration.

### 3. Gondolin (Alpine Linux micro-VM) — CHOSEN

- **Pros:** Native Pi SDK integration (same dependency tree), strongest isolation boundary (full VM, not just container namespaces), programmable network and filesystem from TypeScript, `MemoryProvider` gives truly ephemeral state with zero cleanup logic, no daemon process needed, runs on macOS arm64 via QEMU/krun, Alpine base includes `apk` for installing any runtime.
- **Cons:** Requires QEMU installed on host, first-run image download (~200MB), VM overhead slightly higher than bare container (but negligible for our test workloads), younger project than Docker.

## Why Gondolin

Gondolin is the clear choice for three reasons:

1. **Strongest isolation.** A micro-VM is a harder boundary than a container. The Tester runs untrusted, autonomously-generated code — VM-level isolation means a sandbox escape requires a hypervisor bug, not just a namespace misconfiguration.

2. **Native TypeScript API.** Gondolin is a Pi SDK sibling package. We get `VM.create()`, `vm.exec()`, `vm.fs.writeFile()`, and `vm.close()` as first-class async operations — no shell-out, no Docker socket, no process management. The sandbox module is ~160 lines of TypeScript, not a wrapper around subprocess calls.

3. **Ephemeral by design.** `MemoryProvider` means the filesystem exists only in memory and vanishes on `vm.close()`. No cleanup scripts, no dangling volumes, no state leaking between test runs. This directly satisfies the spec's "wiped after each test cycle" requirement.

The network isolation story is also elegant: omitting `httpHooks` from the VM config means zero network access by default. No firewall rules, no iptables, no `--network=none` flags — just don't pass the option.

## Requirements Matrix

| Requirement (§12.4) | How Gondolin satisfies it |
|---|---|
| No network access | No `httpHooks` in VM config = fully air-gapped |
| No access to portfolio/identity | VM has its own filesystem; only `/workspace` (MemoryProvider) is mounted |
| No persistence between runs | MemoryProvider is in-memory; `vm.close()` destroys everything |
| Install language runtimes/packages | Alpine `apk add` supports Node.js, Python, Go, Rust, GCC, etc. |
| Compile and run code | Full Alpine Linux userspace with shell access |
| Execute test frameworks | Any framework installable via apk or language package manager |
| Capture stdout/stderr | `vm.exec()` returns `{ exitCode, stdout, stderr }` |
| Configurable timeout (default 60s) | `Promise.race` with configurable deadline; exit code 124 on timeout |
| Cleanup after each test cycle | `session.close()` destroys the VM and all state |

## Prerequisites

**macOS (primary):**
```bash
brew install qemu
```

**Linux:**
```bash
sudo apt install qemu-system-aarch64   # Debian/Ubuntu
sudo dnf install qemu-system-aarch64   # Fedora
```

Gondolin auto-downloads its Alpine base image on first run (~200MB, cached in `~/.cache/gondolin/images/`).

## API Usage

```typescript
import { createSandbox } from "./src/sandbox/index.js";

const sandbox = await createSandbox({ timeoutMs: 30_000 });

try {
  // Write artifact code into the sandbox
  await sandbox.writeFile("main.py", 'print("hello from the sandbox")');

  // Install runtime if needed
  await sandbox.installPackages(["python3"]);

  // Run it
  const result = await sandbox.exec("python3 main.py");
  console.log(result.stdout);    // "hello from the sandbox"
  console.log(result.timedOut);  // false
  console.log(result.durationMs); // e.g. 847
} finally {
  await sandbox.close();
}
```

## Open Questions (Phase 1)

- **Memory limits:** `SandboxConfig.memoryLimitMb` is defined but not yet wired — Gondolin may support VM memory caps in a future release, or we can enforce via `ulimit` inside the VM.
- **Concurrent sandboxes:** The current API creates one VM per session. If we need parallel test runs (e.g., testing multiple artifacts simultaneously), we create multiple sessions. QEMU resource usage under concurrent VMs needs benchmarking.
- **Timeout kill semantics:** When a timeout fires, we cannot abort the in-flight `vm.exec` — we report `timedOut: true` and the caller should `close()` the session. A future improvement could use an `AbortSignal` (supported by Gondolin's exec options) to cancel the process inside the VM.
