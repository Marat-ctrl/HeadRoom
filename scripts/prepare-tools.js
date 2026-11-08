'use strict';
const path = require('path');
const fs = require('fs');
const { prepareBundle } = require('../src/shared/bundled-tools');

async function prepare(platform, arch, refresh = false) {
  console.log(`Preparing bundled tools for ${platform}/${arch}`);
  const root = path.join(__dirname, '..', '.tool-bundles', `${platform}-${arch}`);
  const bin = await prepareBundle(platform, arch, root, { refresh });
  fs.copyFileSync(path.join(__dirname, '..', 'THIRD_PARTY_TOOLS.md'), path.join(bin, 'THIRD_PARTY_TOOLS.md'));
  const notices = path.join(__dirname, '..', 'assets', 'tool-licenses');
  for (const name of fs.readdirSync(notices)) fs.copyFileSync(path.join(notices, name), path.join(bin, name));
  console.log(`Verified tools ready: ${bin}`);
}
exports.default = async context => {
  const arch = require('builder-util').Arch[context.arch];
  await prepare(context.electronPlatformName, arch);
};
if (require.main === module) {
  const args = process.argv.slice(2).filter(a => a !== '--refresh');
  prepare(args[0] || process.platform, args[1] || process.arch, process.argv.includes('--refresh')).catch(error => { console.error(error); process.exitCode = 1; });
}
