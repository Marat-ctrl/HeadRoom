'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createAudioCache } = require('../src/server/audio-cache');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'headroom-audio-cache-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  function write(relative, age, size = 4) {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.alloc(size));
    fs.utimesSync(file, age, age);
    return file;
  }
  return { root, write };
}

test('audio cache evicts oldest completed files across legacy and quality directories', async t => {
  const { root, write } = fixture(t);
  const old = write('legacy-track.mp3', 100);
  const middle = write('exact/standard/aaaaaaaaaaa.m4a', 200);
  const recent = write('exact/plus/bbbbbbbbbbb.webm', 300);
  const inProgress = write('exact/plus/.loading-temp/audio.m4a', 50, 32);
  const sidecar = write('other.json', 50, 32);
  const outside = write('library/private.m4a', 50, 32);
  const cache = createAudioCache({ root, getLimit: () => 8 });

  await cache.prune();
  assert.equal(fs.existsSync(old), false);
  for (const file of [middle, recent, inProgress, sidecar, outside]) assert.equal(fs.existsSync(file), true);
});

test('cache preserves served files and the current track until they can be evicted', async t => {
  const { root, write } = fixture(t);
  const current = write('exact/standard/aaaaaaaaaaa.m4a', 100);
  const served = write('exact/plus/bbbbbbbbbbb.m4a', 200);
  const cache = createAudioCache({
    root, getLimit: () => 4, isCurrentTrack: id => id === 'aaaaaaaaaaa', graceMs: 0
  });
  const release = cache.open(served);

  await Promise.all([cache.prune(), cache.prune()]);
  assert.equal(fs.existsSync(current), true);
  assert.equal(fs.existsSync(served), true);
  release();
  await cache.prune();
  assert.equal(fs.existsSync(served), false);
  assert.equal(fs.existsSync(current), true);
});

test('audio cache does not follow symlinks to user files', async t => {
  const { root, write } = fixture(t);
  const saved = write('library/aaaaaaaaaaa.m4a', 50);
  fs.symlinkSync(path.dirname(saved), path.join(root, 'exact'));
  const cache = createAudioCache({ root, getLimit: () => 0 });

  await cache.prune();
  assert.equal(fs.existsSync(saved), true);
});

test('audio cache reports completed recordings and returns the remaining usage after pruning', async t => {
  const { root, write } = fixture(t);
  const old = write('legacy-track.mp3', 100, 10);
  write('exact/standard/aaaaaaaaaaa.m4a', 200, 20);
  const protectedFile = write('exact/plus/bbbbbbbbbbb.webm', 300, 30);
  write('exact/plus/.loading-temp/audio.m4a', 50, 100);
  write('metadata.json', 50, 100);
  const cache = createAudioCache({ root, getLimit: () => 25, graceMs: 0 });
  const release = cache.open(protectedFile);

  assert.equal(await cache.usage(), 60);
  assert.equal(fs.existsSync(old), true);
  assert.equal(await cache.prune(), 30);
  assert.equal(await cache.usage(), 30);
  release();
  assert.equal(await cache.prune(), 0);
  assert.equal(await cache.usage(), 0);
});
