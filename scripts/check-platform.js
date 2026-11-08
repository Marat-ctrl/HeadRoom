'use strict';
if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  console.error('HeadRoom supports macOS on Apple Silicon (ARM64) only.');
  process.exit(1);
}
