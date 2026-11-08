const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const vm=require('node:vm');
function loadContext(mismatch=false, direct=false, fast=null){
 const text=fs.readFileSync(path.join(__dirname,'../src/server/server.js'),'utf8');const start=text.indexOf('const directAudioCache =');const end=text.indexOf('\nconst geniusArtCache',start);const code=text.slice(start,end);
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'headroom-exact-test-'));let calls=0;
 const context=vm.createContext({fs,path,URL,URLSearchParams,CACHE_DIR:directory,ACTIVE_PORT:38472,serverActiveProxy:'',resolveDirectAudio:async()=>fast,streamInfoInflight:new Map(),logger:{log(){}},saveTrackMetadata(){},audioCache:{keep(){},prune(){}},
 findCachedFile:async (id,quality)=>{const file=path.join(directory,'exact',quality,id+'.m4a');return fs.existsSync(file)?file:null;},
 executeYtDlp:async args=>{calls++;assert.equal(args.at(-1),'https://music.youtube.com/watch?v=eltXcW54cx0');assert.equal(args.some(a=>a.startsWith('ytsearch')),false);if(args.includes('--skip-download'))return [250,251].map(itag=>JSON.stringify({id:mismatch?'myoj9EpNDf8':'eltXcW54cx0',url:'https://r1.googlevideo.com/videoplayback?itag='+itag,protocol:'https',vcodec:'none'})).join('\n');const target=args[args.indexOf('-o')+1];fs.writeFileSync(target.replace('%(ext)s','info.json'),JSON.stringify({id:mismatch?'myoj9EpNDf8':'eltXcW54cx0',title:'Milwaukee Bucks',ext:'m4a'}));fs.writeFileSync(target.replace('%(ext)s','m4a'),Buffer.alloc(65000));}});
 vm.runInContext(code+'\nthis.load=handleStreamInfo;',context);
 return {directory,calls:()=>calls,request:async (id,quality='standard',download=!direct,resolveOnly=false)=>{let data,status;await context.load({}, {writeHead:s=>status=s,end:body=>data=body?JSON.parse(body):null},id,'Milwaukee Bucks','Rio Da Yung Og',0,'',quality,download,resolveOnly);return {data,status};}};
}
test('exact playback uses Riff execution/cache helpers, coalesces requests and serves only the selected ID',async()=>{
 const api=loadContext();try{const [a,b]=await Promise.all([api.request('eltXcW54cx0'),api.request('eltXcW54cx0')]);assert.equal(a.data.resolvedId,'eltXcW54cx0');assert.equal(b.data.success,true);assert.equal(api.calls(),1);assert.match(a.data.streamUrl,/local-track\?id=eltXcW54cx0&quality=standard$/);await api.request('eltXcW54cx0');assert.equal(api.calls(),1);}finally{fs.rmSync(api.directory,{recursive:true,force:true});}
});
test('unresolved metadata IDs and different recordings are rejected without a title-based replacement',async()=>{
 const api=loadContext(true);try{assert.equal((await api.request('dz_123')).status,422);assert.equal(api.calls(),0);assert.equal((await api.request('eltXcW54cx0')).data.success,false);assert.equal(fs.existsSync(path.join(api.directory,'exact','standard','eltXcW54cx0.m4a')),false);}finally{fs.rmSync(api.directory,{recursive:true,force:true});}
});
test('the direct path avoids downloading first and keeps cache entries separate by mode', async () => {
 const api = loadContext(false, true);
 try {
  const id = 'eltXcW54cx0';
  const standard = await api.request(id);
  assert.equal(standard.data.isDirect, true);
  assert.equal(fs.existsSync(path.join(api.directory, 'exact')), false);
  await api.request(id);
  assert.equal(api.calls(), 1);
  const plus = await api.request(id, 'plus');
  assert.match(standard.data.streamUrl, /itag=250$/);
  assert.match(plus.data.streamUrl, /itag=251$/);
  assert.equal(api.calls(), 1);
  const fallback = await api.request(id, 'plus', true);
  assert.equal(fallback.data.isLocal, true);
  assert.match(fallback.data.streamUrl, /quality=plus$/);
  assert.equal(fs.existsSync(path.join(api.directory, 'exact', 'plus', id + '.m4a')), true);
 } finally {
  fs.rmSync(api.directory, { recursive: true, force: true });
 }
});
test('a verified fast resolution serves both modes without starting yt-dlp', async () => {
 const fast = { standard:'https://r1.googlevideo.com/audio?itag=250', plus:'https://r1.googlevideo.com/audio?itag=251', plusAlternate:'https://r1.googlevideo.com/audio?itag=140' };
 const api = loadContext(false, true, fast);
 try {
  const [standard, plus] = await Promise.all([api.request('eltXcW54cx0'), api.request('eltXcW54cx0','plus')]);
  assert.equal(standard.data.streamUrl, fast.standard);
  assert.equal(plus.data.streamUrl, fast.plus);
  assert.equal(plus.data.alternateUrl, fast.plusAlternate);
  assert.equal(api.calls(), 0);
 } finally {
  fs.rmSync(api.directory, { recursive: true, force: true });
 }
});
test('player response must match the recording and supply valid audio in both modes', async () => {
 const { resolveDirectAudio } = require('../src/server/direct-audio');
 const id = 'eltXcW54cx0';
 const sample = (itag, bitrate, options = {}) => ({ mimeType:'audio/webm; codecs="opus"', averageBitrate:bitrate, url:'https://r1.googlevideo.com/audio?itag='+itag, ...options });
 const player = {
  videoDetails:{videoId:id}, playabilityStatus:{status:'OK'},
  streamingData:{adaptiveFormats:[sample(250,61000),sample(251,128000),sample(140,126000,{mimeType:'audio/mp4'}),sample(141,180000,{audioTrack:{audioIsDefault:false}}),sample(999,200000,{url:'https://example.com/audio'})]}
 };
 const fetcher = async () => ({ok:true,json:async()=>player});
 assert.deepEqual(await resolveDirectAudio(id,fetcher), {
  standard:'https://r1.googlevideo.com/audio?itag=250', plus:'https://r1.googlevideo.com/audio?itag=251', plusAlternate:'https://r1.googlevideo.com/audio?itag=140'
 });
 assert.equal(await resolveDirectAudio('abcdefghijk',fetcher), null);
 player.playabilityStatus.status = 'LOGIN_REQUIRED';
 assert.equal(await resolveDirectAudio(id,fetcher), null);
});
test('the player can finish initializing its anonymous session within one retry', async () => {
 const { resolveDirectAudio } = require('../src/server/direct-audio');
 const id = 'eltXcW54cx0';
 let calls = 0;
 const formats = await resolveDirectAudio(id, async (url, request) => {
  calls++;
  const visitor = JSON.parse(request.body).context.client.visitorData;
  if (calls === 1) {
   assert.equal(visitor, undefined);
   return {ok:true,json:async()=>({responseContext:{visitorData:'guest-session'}})};
  }
  assert.equal(visitor,'guest-session');
  assert.equal(request.headers['x-goog-visitor-id'],'guest-session');
  return {ok:true,json:async()=>({
   videoDetails:{videoId:id},playabilityStatus:{status:'OK'},
   streamingData:{adaptiveFormats:[{mimeType:'audio/webm',bitrate:60000,url:'https://r1.googlevideo.com/audio'}]}
  })};
 });
 assert.equal(calls,2);
 assert.equal(formats.standard,'https://r1.googlevideo.com/audio');
});
test('warming a missing direct link does not start a file download', async () => {
 const api = loadContext(true, true);
 try {
  const result = await api.request('eltXcW54cx0', 'standard', false, true);
  assert.equal(result.status, 204);
  assert.equal(api.calls(), 1);
  assert.equal(fs.existsSync(path.join(api.directory, 'exact')), false);
 } finally {
  fs.rmSync(api.directory, { recursive: true, force: true });
 }
});
test('every relative require in the active code points to an existing module',()=>{
 function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())walk(file);else if(file.endsWith('.js'))for(const match of fs.readFileSync(file,'utf8').matchAll(/require\(['"](\.[^'"]+)['"]\)/g)){const target=path.resolve(path.dirname(file),match[1]);assert.ok([target,target+'.js',target+'.json'].some(p=>fs.existsSync(p)),`${file}: ${match[1]}`);}}}walk(path.join(__dirname,'../src'));
});
test('the search route uses YouTube Music even when an old SoundCloud preference is supplied',async()=>{
 const text=fs.readFileSync(path.join(__dirname,'../src/server/server.js'),'utf8');const start=text.indexOf('async function handleSearch(');const end=text.indexOf('\nasync function ',start+1);let called=0;
 const context=vm.createContext({AbortController,catalog:{search:async(query,type,sort)=>{called++;assert.equal(query,'Milwaukee Bucks');assert.equal(type,'songs');return [{id:'eltXcW54cx0',title:'Milwaukee Bucks',isExplicit:true}];}}});
 vm.runInContext(text.slice(start,end)+'\nthis.search=handleSearch;',context);let result;await context.search({}, {writeHead(){},end:body=>result=JSON.parse(body)},'Milwaukee Bucks','soundcloud');assert.equal(called,1);assert.equal(result.tracks[0].id,'eltXcW54cx0');
});
test('removed service and lyric endpoints are inactive in the minimal base',async()=>{
 const text=fs.readFileSync(path.join(__dirname,'../src/server/server.js'),'utf8');const start=text.indexOf('async function requestHandler(');const end=text.indexOf('\nfunction startServer(',start);
 const context=vm.createContext({url:require('node:url'),URL,Set});vm.runInContext(text.slice(start,end)+'\nthis.handle=requestHandler;',context);
 for(const url of ['/api/spotify-import','/api/lyrics','/api/albums/search','/api/vibe']){let status;await context.handle({url,method:'GET',headers:{host:'127.0.0.1'}},{setHeader(){},writeHead:s=>status=s,end(){}});assert.equal(status,404);}
});
test('removed sign-in APIs are not exposed to trigger startup requests',()=>{
 const preload=fs.readFileSync(path.join(__dirname,'../src/main/preload.js'),'utf8');
 for(const channel of ['youtube-playback-status','youtube-playback-login','youtube-playback-logout','google-auth-status','google-login','google-import-library'])assert.equal(preload.includes(`invoke('${channel}'`),false,channel);
});

test('verified age restrictions end exact playback resolution without an extractor retry', async () => {
 const api = loadContext(false, true, {restricted: 'age'});
 try {
  const result = await api.request('eltXcW54cx0');
  assert.equal(result.status, 403);
  assert.equal(result.data.code, 'AGE_RESTRICTED');
  assert.match(result.data.error, /age verification/);
  assert.equal((await api.request('eltXcW54cx0', 'plus', false, true)).status, 204);
  assert.equal(api.calls(), 0);
 } finally {
  fs.rmSync(api.directory, { recursive: true, force: true });
 }
});

test('the direct player classifies only age restrictions for the exact video', async () => {
 const { resolveDirectAudio } = require('../src/server/direct-audio');
 const id = 'tRAmPLYjbGg';
 const response = reason => async () => ({ok: true, json: async () => ({
  videoDetails: {videoId: id}, playabilityStatus: {status: 'LOGIN_REQUIRED', reason}
 })});
 assert.deepEqual(await resolveDirectAudio(id, response('Sign in to confirm your age')), {restricted: 'age'});
 assert.equal(await resolveDirectAudio('abcdefghijk', response('Sign in to confirm your age')), null);
 assert.equal(await resolveDirectAudio(id, response('Sign in to confirm you’re not a bot')), null);
});

test('Standard falls back to a comparable alternate codec for the same recording', async () => {
 const { resolveDirectAudio } = require('../src/server/direct-audio');
 const id = 'eltXcW54cx0';
 const formats = await resolveDirectAudio(id, async () => ({ok:true, json: async () => ({
  videoDetails: {videoId: id}, playabilityStatus: {status: 'OK'}, streamingData: {adaptiveFormats: [
   {mimeType:'audio/webm', bitrate:61000, url:'https://r1.googlevideo.com/audio?itag=250'},
   {mimeType:'audio/mp4', bitrate:49000, url:'https://r1.googlevideo.com/audio?itag=139'},
   {mimeType:'audio/mp4', bitrate:129000, url:'https://r1.googlevideo.com/audio?itag=140'}
  ]}
 })}));
 assert.match(formats.standard, /itag=250$/);
 assert.match(formats.standardAlternate, /itag=139$/);
 const api = loadContext(false, true, formats);
 try {
  assert.match((await api.request(id)).data.alternateUrl, /itag=139$/);
  assert.equal(api.calls(), 0);
 } finally {
  fs.rmSync(api.directory, {recursive:true, force:true});
 }
});

test('cold direct resolution reuses the already warmed anonymous visitor', async () => {
 const module = {exports: {}};
 const source = fs.readFileSync(path.join(__dirname, '../src/server/direct-audio.js'), 'utf8');
 vm.runInNewContext(source, {module, URL, AbortSignal});
 const { primeDirectAudio, resolveDirectAudio } = module.exports;
 const id = 'eltXcW54cx0';
 primeDirectAudio('startup-visitor');
 let calls = 0;
 await resolveDirectAudio(id, async (_url, request) => {
  calls++;
  assert.equal(request.headers['x-goog-visitor-id'], 'startup-visitor');
  return {ok:true,json:async()=>({
   videoDetails: {videoId: id}, playabilityStatus: {status: 'OK'},
   streamingData: {adaptiveFormats: [{mimeType:'audio/webm', bitrate:60000, url:'https://r1.googlevideo.com/audio'}]}
  })};
 });
 assert.equal(calls, 1);
});
