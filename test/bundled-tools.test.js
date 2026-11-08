'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const fixture = '#!/bin/sh\necho "test-tool 1.0"\n';
const digest = 'sha256:' + crypto.createHash('sha256').update(fixture).digest('hex');
const release = { tag_name: '1.0', assets: [{ name: 'tool', browser_download_url: 'https://github.com/example/tools/releases/download/1.0/tool', digest }] };

// A failed or tampered download must never replace the working tool selection.
test('verified release activates only after all tools have been staged successfully', { skip: process.platform === 'win32' }, async () => {
  const { installRelease, managedBinary } = require('../src/shared/bundled-tools');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'headroom-tool-test-'));
  try {
    const pairRelease = { ...release, assets: [...release.assets, { ...release.assets[0], name: 'probe', browser_download_url: 'https://github.com/example/tools/releases/download/1.0/probe' }] };
    const options = { root: dir, group: 'ffmpeg', release: pairRelease, assets: { ffmpeg: 'tool', ffprobe: 'probe' }, download: async (_url, dest) => fs.writeFileSync(dest, fixture) };
    await installRelease(options);
    const working = managedBinary(dir, 'ffmpeg');
    assert.ok(fs.existsSync(working));
    assert.ok(fs.existsSync(managedBinary(dir, 'ffprobe')));
    await assert.rejects(installRelease({ ...options, release: { ...pairRelease, tag_name: '2.0' }, download: async (url, dest) => fs.writeFileSync(dest, url.endsWith('/probe') ? 'broken' : fixture) }), /checksum/i);
    assert.equal(managedBinary(dir, 'ffmpeg'), working);
    assert.equal(fs.readFileSync(working, 'utf8'), fixture);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('release with a valid checksum but an unlaunchable binary is not activated', { skip: process.platform === 'win32' }, async () => {
  const { installRelease, managedBinary } = require('../src/shared/bundled-tools');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'headroom-tool-test-'));
  const broken = '#!/bin/sh\nexit 1\n';
  const badRelease = { tag_name: 'bad', assets: [{ ...release.assets[0], digest: 'sha256:' + crypto.createHash('sha256').update(broken).digest('hex') }] };
  try {
    await assert.rejects(installRelease({ root: dir, group: 'ytdlp', release: badRelease, assets: { 'yt-dlp': 'tool' }, download: async (_url, dest) => fs.writeFileSync(dest, broken) }));
    assert.equal(managedBinary(dir, 'yt-dlp'), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('managed binary paths cannot escape the tools directory', () => {
  const { managedBinary } = require('../src/shared/bundled-tools');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'headroom-tool-test-'));
  try {
    fs.writeFileSync(path.join(dir, 'active-tools.json'), JSON.stringify({ files: { 'yt-dlp': '../outside' } }));
    assert.equal(managedBinary(dir, 'yt-dlp'), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('extracts the verified FFmpeg archive as one complete release', { skip: process.platform === 'win32' }, async () => {
  const { installRelease, managedBinary } = require('../src/shared/bundled-tools');
  const { execFileSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'headroom-archive-test-'));
  try {
    const source = path.join(dir, 'source'); fs.mkdirSync(source);
    for (const name of ['ffmpeg', 'ffprobe']) fs.writeFileSync(path.join(source, name), fixture, { mode: 0o755 });
    const archive = path.join(dir, 'bundle.tar.gz');
    execFileSync('tar', ['-czf', archive, '-C', source, 'ffmpeg', 'ffprobe']);
    const archiveRelease = { tag_name: '8.1', assets: [{ name: 'portable-mac.tar.gz', browser_download_url: release.assets[0].browser_download_url, digest: 'sha256:' + crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex') }] };
    const root = path.join(dir, 'installed');
    await installRelease({ root, group: 'ffmpeg', release: archiveRelease, assets: { ffmpeg: { pattern: '^portable-mac', member: 'ffmpeg' }, ffprobe: { pattern: '^portable-mac', member: 'ffprobe' } }, download: async (_url, dest) => fs.copyFileSync(archive, dest) });
    assert.equal(fs.readFileSync(managedBinary(root, 'ffprobe'), 'utf8'), fixture);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('offline update checks preserve bundled files and are throttled for one day', async () => {
  const { updateBundledTools } = require('../src/shared/bundled-tools');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'headroom-offline-tools-'));
  const root = path.join(dir, 'updates');
  const bundledDir = path.join(dir, 'bundled');
  const previousData = process.env.RIFF_DATA_DIR;
  process.env.RIFF_DATA_DIR = path.join(dir, 'data');
  let attempts = 0;
  try {
    fs.mkdirSync(bundledDir);
    fs.writeFileSync(path.join(bundledDir, 'versions.json'), '{"ytdlp":"1","ffmpeg":"1"}');
    fs.writeFileSync(path.join(bundledDir, 'yt-dlp'), 'working bundled tool');
    const options = { root, bundledDir, releaseProvider: async () => { attempts++; throw new Error('offline'); } };
    assert.equal(await updateBundledTools(options), false);
    assert.equal(await updateBundledTools(options), false);
    assert.equal(attempts, 2, 'one attempt per provider, no immediate repeated checks');
    assert.equal(fs.readFileSync(path.join(bundledDir, 'yt-dlp'), 'utf8'), 'working bundled tool');
    assert.equal(fs.existsSync(path.join(root, 'active-tools.json')), false);
  } finally {
    if (previousData === undefined) delete process.env.RIFF_DATA_DIR; else process.env.RIFF_DATA_DIR = previousData;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('tool downloads reject Windows, Linux and Intel Mac targets', () => {
  const { toolSources } = require('../src/shared/bundled-tools');
  for (const [platform, arch] of [['win32','x64'],['linux','arm64'],['darwin','x64']]) {
    assert.throws(() => toolSources(platform, arch), /Unsupported/);
  }
  assert.equal(toolSources('darwin','arm64')[0].assets['yt-dlp'], 'yt-dlp_macos');
});
