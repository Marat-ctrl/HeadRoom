'use strict';

const fs = require('node:fs');
const path = require('node:path');

const completedAudio = /^[\w-]+\.(?:m4a|webm|opus|mp3)$/i;

function createAudioCache({ root, getLimit, isCurrentTrack = () => false, graceMs = 15000, onError = console.warn }) {
  const leases = new Map();
  let pending = Promise.resolve();
  let retryTimer;
  let overLimit = false;

  function collectExpiredLeases(now) {
    for (const [file, lease] of leases) {
      if (!lease.readers && lease.until <= now) leases.delete(file);
    }
  }

  function keep(file) {
    const now = Date.now();
    collectExpiredLeases(now);
    const lease = leases.get(file) || { readers: 0 };
    lease.until = now + graceMs;
    leases.set(file, lease);
    return lease;
  }

  function open(file) {
    const lease = keep(file);
    lease.readers++;
    return () => {
      lease.readers--;
      lease.until = Date.now() + graceMs;
      if (overLimit) prune();
    };
  }

  async function directoryEntries(directory) {
    try {
      if ((await fs.promises.lstat(directory)).isDirectory()) {
        return await fs.promises.readdir(directory, { withFileTypes: true });
      }
    } catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
    }
    return [];
  }

  async function list(directory, entries, exactLayout = false) {
    const files = [];
    for (const entry of entries) {
      if (entry.isFile() && completedAudio.test(entry.name)) {
        const file = path.join(directory, entry.name);
        try {
          const stat = await fs.promises.lstat(file);
          if (stat.isFile()) files.push({ file, size: stat.size, age: stat.mtimeMs });
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      } else if (entry.isDirectory() && (exactLayout ? ['standard', 'plus'].includes(entry.name) : entry.name === 'exact')) {
        const nested = path.join(directory, entry.name);
        const childEntries = await directoryEntries(nested);
        if (exactLayout) {
          files.push(...await list(nested, childEntries.filter(child => child.isFile())));
        } else {
          files.push(...await list(nested, childEntries, true));
        }
      }
    }
    return files;
  }

  async function cachedFiles() {
    return list(root, await directoryEntries(root));
  }

  async function sweep() {
    clearTimeout(retryTimer);
    const files = await cachedFiles();
    const limit = getLimit();
    let remaining = files.reduce((bytes, entry) => bytes + entry.size, 0);
    let nextExpiry = Infinity;
    collectExpiredLeases(Date.now());

    files.sort((a, b) => a.age - b.age || a.file.localeCompare(b.file));
    for (const entry of files) {
      if (remaining <= limit) break;
      const id = path.basename(entry.file, path.extname(entry.file));
      if (isCurrentTrack(id)) continue;
      const lease = leases.get(entry.file);
      if (lease?.readers) continue;
      if (lease?.until > Date.now()) {
        nextExpiry = Math.min(nextExpiry, lease.until);
        continue;
      }
      // The protection check and unlink run together, before a reader can acquire a lease.
      try {
        fs.unlinkSync(entry.file);
        remaining -= entry.size;
      } catch (error) {
        if (error.code === 'ENOENT') remaining -= entry.size;
        else onError(error);
      }
    }
    overLimit = remaining > limit;
    if (overLimit && Number.isFinite(nextExpiry)) {
      retryTimer = setTimeout(prune, Math.max(1, nextExpiry - Date.now()));
      retryTimer.unref();
    }
    return remaining;
  }

  function enqueue(operation) {
    pending = pending.then(operation).catch(error => {
      onError(error);
      return null;
    });
    return pending;
  }

  function prune() {
    return enqueue(sweep);
  }

  function usage() {
    return enqueue(async () => (await cachedFiles()).reduce((bytes, entry) => bytes + entry.size, 0));
  }

  function currentTrackChanged() {
    if (overLimit) prune();
  }

  return { keep, open, prune, usage, currentTrackChanged };
}

module.exports = { createAudioCache };
