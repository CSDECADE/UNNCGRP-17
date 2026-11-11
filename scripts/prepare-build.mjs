import { accessSync, chmodSync, constants, statSync } from 'node:fs';
import { createRequire } from 'node:module';

// NAS sync can strip POSIX executable permissions from the installed build binary.
// Repair only the trusted esbuild package's owner execute bit, never whole directories.
if (process.platform !== 'win32') {
  const require = createRequire(import.meta.url);
  const binary = require.resolve(`@esbuild/${process.platform}-${process.arch}/bin/esbuild`);
  try { accessSync(binary, constants.X_OK); }
  catch {
    chmodSync(binary, statSync(binary).mode | 0o100);
    console.log('已恢复 NAS 同步目录中 esbuild 的执行权限。');
  }
}
