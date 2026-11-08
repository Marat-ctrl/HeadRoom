const test=require('node:test');const assert=require('node:assert/strict');const {count,parseItems,sortPopular,createCatalog}=require('../src/server/catalog');
function row(id,title,sub,badge=false){return{musicResponsiveListItemRenderer:{navigationEndpoint:{browseEndpoint:{browseId:id}},playlistItemData:id.length===11?{videoId:id}:undefined,flexColumns:[{musicResponsiveListItemFlexColumnRenderer:{text:{runs:[{text:title}]}}},{musicResponsiveListItemFlexColumnRenderer:{text:{runs:[{text:sub}]}}}],badges:badge?[{musicInlineBadgeRenderer:{icon:{iconType:'MUSIC_EXPLICIT_BADGE'}}}]:[]}};}
test('parses real counters without inventing missing values',()=>{assert.equal(count('2.9M monthly audience'),2900000);assert.equal(count('552K plays'),552000);assert.equal(count('12,345 views'),12345);assert.equal(count('Popularity unavailable'),null);});
test('artist and album search preserve browse IDs separately from playable song IDs',()=>{const a=parseItems([row('UCartist','Rio','Artist • 2.9M monthly audience')],'artists');assert.equal(a[0].id,'UCartist');assert.equal(a[0].popularity,2900000);const b=parseItems([row('MPREbalbum','Album','Album • Rio • 2026')],'albums');assert.equal(b[0].artist,'Rio');assert.equal(b[0].year,'2026');assert.equal(parseItems([row('MPREbalbum','Album','Album')],'songs').length,0);});
test('popularity uses descending known counters; missing counters are stable at the end',()=>{const list=[{id:'unknown',popularity:null},{id:'a',popularity:10},{id:'b',popularity:90},{id:'unknown2',popularity:null}];assert.deepEqual(sortPopular(list).map(t=>t.id),['b','a','unknown','unknown2']);assert.equal(list[0].id,'unknown');});
test('song popularity looks up counters by exact ID and reuses the cache',async()=>{let players=0;const api=createCatalog(async(endpoint,body)=>{if(endpoint==='search')return[row('aaaaaaaaaaa','One','Artist • 2:00',true),row('bbbbbbbbbbb','Two','Artist • 2:00',true)];if(endpoint==='player'){players++;return{videoDetails:{viewCount:body.videoId==='aaaaaaaaaaa'?'10':'90'}};}throw Error('unexpected');});assert.deepEqual((await api.search('Artist','songs','popular')).map(t=>t.id),['bbbbbbbbbbb','aaaaaaaaaaa']);await api.search('Artist','songs','popular');assert.equal(players,2);});
test('browse validates IDs and a failed metric leaves a visible result available',async()=>{const api=createCatalog(async endpoint=>{if(endpoint==='search')return[row('aaaaaaaaaaa','One','Artist • 2:00',true)];throw Error('offline');});await assert.rejects(api.browse('../private','albums'),/Invalid/);const songs=await api.search('One','songs','popular');assert.equal(songs.length,1);assert.equal(songs[0].popularity,null);});
test('album tracks inherit the actual artist/cover and read fixed-column durations and play counts',()=>{
 const item=row('aaaaaaaaaaa','Song','',true);const r=item.musicResponsiveListItemRenderer;r.flexColumns.push({musicResponsiveListItemFlexColumnRenderer:{text:{runs:[{text:'552K plays'}]}}});r.fixedColumns=[{musicResponsiveListItemFixedColumnRenderer:{text:{runs:[{text:'3:15'}]}}}];
 const [song]=parseItems([item],'songs',{artist:'Rio',artistId:'UCartist',title:'Album',thumbnail:'https://example.com/cover.jpg'});assert.equal(song.artist,'Rio');assert.equal(song.artistId,'UCartist');assert.equal(song.duration,195);assert.equal(song.popularity,552000);assert.equal(song.thumbnail,'https://example.com/cover.jpg');
});
test('artist album cards use two-row renderer thumbnails and browse IDs',()=>{
 const cards=parseItems({musicTwoRowItemRenderer:{title:{runs:[{text:'Album'}]},navigationEndpoint:{browseEndpoint:{browseId:'MPREbalbum'}},thumbnailRenderer:{musicThumbnailRenderer:{thumbnail:{thumbnails:[{url:'https://example.com/image=w120-h120'}]}}},subtitle:{runs:[{text:'Album • 2026'}]}}},'albums',{artist:'Rio'});
 assert.equal(cards[0].artist,'Rio');assert.equal(cards[0].thumbnail,'https://example.com/image=w544-h544');assert.equal(cards[0].id,'MPREbalbum');
});
test('All search retains distinct categories, original IDs and successful categories on a partial failure',async()=>{
 const api=createCatalog(async(endpoint,body)=>{
  if(endpoint!=='search')throw Error('unexpected');
  if(body.params.includes('Ig'))throw Error('artist service unavailable');
  if(body.params.includes('IY'))return[row('MPREbalbum','Album','Album • Artist • 2026')];
  return[row('aaaaaaaaaaa','Song','Artist • 2:00',true)];
 });
 const all=await api.searchAll('Artist','relevance');assert.equal(all.groups.songs[0].id,'aaaaaaaaaaa');assert.equal(all.groups.albums[0].id,'MPREbalbum');assert.deepEqual(all.groups.artists,[]);assert.deepEqual(all.unavailable,['artists']);
});
test('canceling an obsolete live search aborts category requests instead of returning stale results',async()=>{
 let requests=0;const controller=new AbortController();
 const api=createCatalog(async(endpoint,body,timeout,signal)=>{requests++;return new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});});
 const pending=api.searchAll('R','popular',controller.signal);controller.abort();await assert.rejects(pending);assert.equal(requests,3);
});

test('My Wave requests the seed radio and keeps distinct playable recordings', async () => {
 const seed = 'abcdefghijk';
 const recommendation = 'lmnopqrstuv';
 const item = videoId => ({ playlistPanelVideoRenderer: {
  videoId, title: { simpleText: 'Song' }, shortBylineText: { simpleText: 'Artist' },
  lengthText: { simpleText: '2:10' }
 } });
 const api = createCatalog(async (endpoint, body) => {
  assert.equal(endpoint, 'next');
  assert.equal(body.playlistId, 'RDAMVM' + seed);
  return { contents: [item(seed), item(recommendation), item(recommendation), item('invalid')] };
 });
 const tracks = await api.wave(seed);
 assert.deepEqual(tracks.map(track => [track.id, track.duration]), [[recommendation, 130]]);
});
