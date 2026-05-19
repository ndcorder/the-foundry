import path from "node:path";

let _rootDir: string | undefined;

export function setRootDir(dir: string): void {
  _rootDir = dir;
}

export function getRootDir(): string {
  if (!_rootDir) {
    _rootDir = process.cwd();
  }
  return _rootDir;
}

export function resolve(...segments: string[]): string {
  return path.join(getRootDir(), ...segments);
}
