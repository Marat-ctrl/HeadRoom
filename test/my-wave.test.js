'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../src/renderer/app.js'), 'utf8');
const track = (id, title = id) => ({id, title, artist: 'Artist', platform: 'youtube'});
const liked = track('likedtrack0');
const fromAlbum = track('albumtrack0');
const fromArtist = track('artsttrack0');
const recent = track('recenttrack', 'Recently played');
const alternate = track('alternatere', 'Recently played');
const newTrack = track('unheardtrck');

function setup({favorites = [liked], history = [], albums = [{id: 'MPREsaved'}], artists = [{id: 'UCsaved'}], replies = {}} = {}) {
  const requests = [];
  const context = vm.createContext({
    AbortSignal,
    URLSearchParams,
    state: {favorites, history, currentTrack: history[0], serverPort: 38472},
    catalogLibrary: {list: kind => ({albums, artists})[kind]},
    isPlayableQueueTrack: item => /^[\w-]{11}$/.test(item?.id || ''),
    getTrackCanonicalId: item => item.id,
    getTrackNormalizedKey: (artist, title) => (artist + '::' + title).toLowerCase(),
    fetch: async input => {
      const {pathname, searchParams} = new URL(input);
      const key = pathname + ':' + searchParams.get('id');
      requests.push(key);
      return {ok: true, json: async () => ({tracks: replies[key] || []})};
    }
  });
  const start = source.indexOf('  function headRoomWaveLibrary()');
  const end = source.indexOf('  async function startWaveIfIdle()', start);
  vm.runInContext(source.slice(start, end) + '\nthis.load = loadHeadRoomWave;', context);
  return {requests, load: exclude => context.load(exclude)};
}

test('My Wave draws recommendations from liked songs, saved albums and saved artists', async () => {
  const wave = setup({replies: {
    '/api/catalog:MPREsaved': [fromAlbum],
    '/api/catalog:UCsaved': [fromArtist],
    '/api/wave:likedtrack0': [newTrack],
    '/api/wave:albumtrack0': [track('newfromalbm')],
    '/api/wave:artsttrack0': [track('newfromarts')]
  }});
  const result = Array.from(await wave.load(), song => song.id);
  assert.deepEqual(wave.requests.slice().sort(), [
    '/api/catalog:MPREsaved', '/api/catalog:UCsaved',
    '/api/wave:albumtrack0', '/api/wave:artsttrack0', '/api/wave:likedtrack0'
  ]);
  assert.ok(result.includes(liked.id) && result.includes(fromAlbum.id) && result.includes(fromArtist.id));
  assert.equal(result[0], newTrack.id);
  assert.ok(result.includes('newfromalbm') && result.includes('newfromarts'));
});

test('My Wave excludes recently played tracks, alternate IDs and tracks already queued', async () => {
  const wave = setup({
    favorites: [recent], history: [recent], albums: [], artists: [],
    replies: {'/api/wave:recenttrack': [recent, alternate, newTrack, track('queuedtrack')]}
  });
  assert.deepEqual(Array.from(await wave.load([track('queuedtrack')]), song => song.id), [newTrack.id]);
});

test('My Wave never falls back to a recently played track when fresh results are unavailable', async () => {
  const wave = setup({favorites: [recent], history: [recent], albums: [], artists: []});
  assert.equal((await wave.load()).length, 0);
});
