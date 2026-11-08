const test = require('node:test');
const assert = require('node:assert/strict');

test('simple player defaults override legacy appearance choices without touching the library', () => {
 const { apply } = require('../src/renderer/startup-policy');
 const data = new Map([['riff_show_local','false'],['riff_perf_mode','0'],['riff_no_hand_cursor','1'],['riff_bg_url','file:///old-background.mp4'],['devsize_playlists','saved playlists']]);
 const storage = { getItem:k=>data.get(k), setItem:(k,v)=>data.set(k,v), removeItem:k=>data.delete(k) };
 apply(storage);
 assert.equal(data.get('riff_show_local'),'false');
 assert.equal(data.get('riff_perf_mode'),'1');
 assert.equal(data.get('riff_no_hand_cursor'),'0');
 assert.equal(data.has('riff_bg_url'),false);
 assert.equal(data.get('devsize_playlists'),'saved playlists');
 assert.equal(data.get('riff_platform'),'ytmusic');
 apply(storage);
 assert.equal(data.get('riff_perf_mode'),'1');
});
