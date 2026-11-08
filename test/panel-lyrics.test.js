const {test}=require('node:test'),assert=require('node:assert/strict');
const {createLyrics,matches}=require('../src/server/lyrics');
const response=value=>({ok:true,json:async()=>value,text:async()=>value});
test('without a video ID, only LRCLIB is queried and successful lyrics are cached', async () => {
  const calls = [];
  const service = createLyrics(async url => {
    calls.push(new URL(url).hostname);
    return response([
      {trackName: 'Other', artistName: 'Artist', plainLyrics: 'Wrong'},
      {trackName: 'Song', artistName: 'Artist', duration: 180, syncedLyrics: '[00:01.00]First\n[00:02.00]Second'}
    ]);
  });
  const result = await service.get('Song', 'Artist', 180);
  assert.equal(result.source, 'LRCLIB');
  assert.equal(result.text, 'First\nSecond');
  assert.deepEqual(await service.get('Song', 'Artist', 180), result);
  assert.deepEqual(calls, ['lrclib.net']);
});

test('stops after LRCLIB if both connected sources have no matching lyrics', async () => {
  assert.equal(matches('Song', 'Artist', 'Song remix', 'Artist'), false);
  const calls = [];
  const service = createLyrics(async url => {
    const hostname = new URL(url).hostname;
    calls.push(hostname);
    if (hostname === 'music.youtube.com') return response({contents: {}});
    return response([{trackName: 'Song', artistName: 'Other', plainLyrics: 'Wrong'}]);
  });
  assert.equal(await service.get('Song', 'Artist', 180, 'abcdefghijk'), null);
  assert.deepEqual(calls, ['music.youtube.com', 'lrclib.net']);
});

test('YouTube Music lyrics use the selected video ID and preserve provider credit',async()=>{const calls=[];const service=createLyrics(async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return response(url.includes('/next?')?{contents:{tabs:[{endpoint:{browseId:'MPLYfixture'}}]}}:{contents:{musicDescriptionShelfRenderer:{description:{runs:[{text:'First\nSecond'}]},footer:{runs:[{text:'Source: LyricFind'}]}}}});});const result=await service.get('Song','Artist',180,'abcdefghijk');assert.equal(result.source,'YouTube Music');assert.equal(result.provider,'Source: LyricFind');assert.equal(result.text,'First\nSecond');assert.equal(calls[0].body.videoId,'abcdefghijk');assert.equal(calls[1].body.browseId,'MPLYfixture');assert.equal(calls.length,2);});
test('YouTube Music without lyrics falls back to LRCLIB',async()=>{const service=createLyrics(async url=>response(url.includes('youtubei')?{contents:{}}:[{trackName:'Song',artistName:'Artist',duration:180,plainLyrics:'Fallback'}]));assert.equal((await service.get('Song','Artist',180,'abcdefghijk')).source,'LRCLIB');});

test('full-screen timing requires a close duration match and uses only supplied timestamps', async () => {
  const calls = [];
  const service = createLyrics(async url => {
    calls.push(new URL(url).hostname);
    return response([
      {trackName: 'Song', artistName: 'Artist', duration: 186, syncedLyrics: '[00:01.00]Wrong version'},
      {trackName: 'Song', artistName: 'Artist', duration: 180, syncedLyrics: '[00:06.25]Second\n[00:02.50]First\n[00:10.00] '}
    ]);
  });
  assert.equal(await service.getTimed('Song', 'Artist', 0), null);
  const result = await service.getTimed('Song', 'Artist', 180);
  assert.equal(result.source, 'LRCLIB');
  assert.deepEqual(result.lines, [
    {time: 2.5, text: 'First'},
    {time: 6.25, text: 'Second'},
    {time: 10, text: ''}
  ]);
  assert.deepEqual(await service.getTimed('Song', 'Artist', 180), result);
  assert.equal(await service.getTimed('Song', 'Artist', 220), null);
  assert.deepEqual(calls, ['lrclib.net']);
});
