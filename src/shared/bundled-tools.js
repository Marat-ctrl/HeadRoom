'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { execFile } = require('child_process');
const { promisify } = require('util');
const exec = promisify(execFile);
const DAY = 24 * 60 * 60 * 1000;

function readManifest(root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'active-tools.json'), 'utf8')); }
  catch (_) { return { files: {}, versions: {} }; }
}

function managedBinary(root, name) {
  const relative = readManifest(root).files?.[name];
  if (typeof relative !== 'string') return null;
  const absolute = path.resolve(root, relative);
  if (!absolute.startsWith(path.resolve(root) + path.sep)) return null;
  try { fs.accessSync(absolute, process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK); return absolute; }
  catch (_) { return null; }
}

const curl = process.platform === 'win32' ? 'curl.exe' : '/usr/bin/curl';

async function request(url) {
  // OS curl honors system proxy settings and has a total deadline, including DNS/TLS.
  const { stdout } = await exec(curl, ['-fsSL', '--connect-timeout', '15', '--max-time', '35', '-A', 'HeadRoom', url], { timeout: 40000, encoding: 'buffer', maxBuffer: 8 * 1024 * 1024 });
  return stdout;
}

async function download(url, dest) {
  await exec(curl, ['-fL', '--connect-timeout', '20', '--max-time', '180', '--retry', '2', '-A', 'HeadRoom', '-o', dest, url], { timeout: 240000 });
}

async function latestRelease(repo) {
  return JSON.parse((await request(`https://api.github.com/repos/${repo}/releases/latest`)).toString('utf8'));
}

function toolSources(platform, arch) {
  if (platform !== 'darwin' || arch !== 'arm64') {
    throw new Error(`Unsupported HeadRoom tools target: ${platform}/${arch}`);
  }
  const exe = platform === 'win32' ? '.exe' : '';
  const pattern = platform === 'darwin' ? '_portable_macarm64-gpl\\.tar\\.xz$' : '_portable_win64-clang-gpl\\.zip$';
  return [
    { group: 'ytdlp', repo: 'yt-dlp/yt-dlp', assets: { ['yt-dlp' + exe]: platform === 'darwin' ? 'yt-dlp_macos' : 'yt-dlp.exe' } },
    { group: 'ffmpeg', repo: 'jellyfin/jellyfin-ffmpeg', assets: {
      ['ffmpeg' + exe]: { pattern, member: 'ffmpeg' + exe },
      ['ffprobe' + exe]: { pattern, member: 'ffprobe' + exe }
    } }
  ];
}

async function installRelease({ root, group, release, assets, download: fetchFile = download, verify = true }) {
  fs.mkdirSync(path.join(root, 'releases'), { recursive: true });
  const stage = fs.mkdtempSync(path.join(root, 'releases', group + '-'));
  let activated = false;
  const files = {};
  const archives = new Map();
  try {
    for (const [name, descriptor] of Object.entries(assets)) {
      const asset = release.assets.find(a => typeof descriptor === 'string' ? a.name === descriptor : new RegExp(descriptor.pattern).test(a.name));
      if (!asset || !/^sha256:[a-f0-9]{64}$/i.test(asset.digest || '')) throw new Error(`Missing verified asset: ${name}`);
      if (!asset.browser_download_url.startsWith('https://github.com/')) throw new Error('Untrusted tool download URL');
      let temporary = archives.get(asset.name);
      if (!temporary) {
        temporary = path.join(stage, `asset-${archives.size}.download`);
        await fetchFile(asset.browser_download_url, temporary);
        const digest = 'sha256:' + crypto.createHash('sha256').update(await fs.promises.readFile(temporary)).digest('hex');
        if (digest !== asset.digest.toLowerCase()) throw new Error(`Tool checksum mismatch: ${asset.name}`);
        archives.set(asset.name, temporary);
      }
      const target = path.join(stage, name);
      if (typeof descriptor === 'object') {
        // Extract only explicitly selected root files, never the entire archive.
        if (path.basename(descriptor.member) !== descriptor.member) throw new Error('Unsafe archive member');
        await exec(process.platform === 'win32' ? 'tar.exe' : '/usr/bin/tar', ['-xf', temporary, '-C', stage, descriptor.member], { timeout: 60000 });
        if (descriptor.member !== name) fs.renameSync(path.join(stage, descriptor.member), target);
      } else {
        const bytes = await fs.promises.readFile(temporary);
        await fs.promises.writeFile(target, asset.name.endsWith('.gz') ? await promisify(zlib.gunzip)(bytes) : bytes);
      }
      if (/^(yt-dlp|ffmpeg|ffprobe)(\.exe)?$/.test(name)) {
        fs.chmodSync(target, 0o755);
        if (verify) {
          const { stdout } = await exec(target, [name.startsWith('yt-dlp') ? '--version' : '-version'], { timeout: 30000 });
          if (/--enable-nonfree/.test(stdout)) throw new Error('FFmpeg build is not redistributable');
        }
      }
      files[name] = path.relative(root, target);
    }
    for (const file of archives.values()) fs.rmSync(file, { force: true });
    // No running/bundled binary is overwritten. One atomic pointer activates the complete release.
    const previous = readManifest(root);
    const manifest = { files: { ...previous.files, ...files }, versions: { ...previous.versions, [group]: release.tag_name } };
    const pointer = path.join(root, `active-tools.${crypto.randomUUID()}.tmp`);
    fs.writeFileSync(pointer, JSON.stringify(manifest, null, 2) + '\n');
    try { fs.renameSync(pointer, path.join(root, 'active-tools.json')); }
    finally { fs.rmSync(pointer, { force: true }); }
    activated = true;
    return manifest;
  } finally {
    if (!activated) fs.rmSync(stage, { recursive: true, force: true });
  }
}

async function prepareBundle(platform, arch, root, { refresh = false, releaseProvider = latestRelease } = {}) {
  for (const source of toolSources(platform, arch)) {
    const cached = readManifest(root);
    const complete = cached.versions?.[source.group] && Object.keys(source.assets).every(name => { const relative = cached.files?.[name]; return relative && fs.existsSync(path.join(root, relative)); });
    if (!refresh && complete) continue;
    const release = await releaseProvider(source.repo);
    if (complete && cached.versions[source.group] === release.tag_name) continue;
    await installRelease({ root, ...source, release, verify: platform === process.platform && arch === process.arch });
  }
  const manifest = readManifest(root);
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  for (const [name, relative] of Object.entries(manifest.files)) fs.copyFileSync(path.join(root, relative), path.join(bin, name));
  fs.writeFileSync(path.join(bin, 'versions.json'), JSON.stringify(manifest.versions, null, 2) + '\n');
  return bin;
}

let updating = false;
async function updateBundledTools({ root, bundledDir, releaseProvider = latestRelease }) {
  // Do not manage tools belonging to a package manager or an unbundled dev installation.
  let bundled;
  try { bundled = JSON.parse(fs.readFileSync(path.join(bundledDir, 'versions.json'), 'utf8')); }
  catch (_) { return false; }
  if (updating) return false;
  const stamp = path.join(root, '.tools-update-check');
  try { if (Date.now() - Number(fs.readFileSync(stamp, 'utf8')) < DAY) return false; } catch (_) {}
  updating = true;
  let changed = false;
  try {
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(stamp, String(Date.now()));
    for (const source of toolSources(process.platform, process.arch)) {
      try {
        const release = await releaseProvider(source.repo);
        const current = readManifest(root).versions?.[source.group] || bundled[source.group];
        if (release.tag_name === current) continue;
        await installRelease({ root, ...source, release });
        changed = true;
      } catch (error) {
        // A failed update must never prevent playback with existing bundled tools.
        require('./logger').log('warn', `Tool update skipped (${source.group}): ${error.message}`);
      }
    }
  } finally { updating = false; }
  return changed;
}

module.exports = { managedBinary, installRelease, toolSources, prepareBundle, updateBundledTools };
