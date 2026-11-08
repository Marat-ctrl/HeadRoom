'use strict';
// Catalog parsing extends Riff's musicResponsiveListItemRenderer / browse-ID approach.
const {preferExplicit}=require('../shared/explicit-priority');
const PARAMS={songs:'EgWKAQIIAWoMEA4QChADEAQQCRAF',artists:'EgWKAQIgAWoMEA4QChADEAQQCRAF',albums:'EgWKAQIYAWoMEA4QChADEAQQCRAF'};
const VIDEO=/^[\w-]{11}$/;
const text=value=>typeof value==='string'?value:(value?.runs||[]).map(r=>r.text||'').join('')||value?.simpleText||'';
function count(value){
 const s=text(value).replace(/,/g,'').replace(/\u00a0/g,' ');
 const m=s.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*(billion|million|thousand|[KMB])?(?:\s|$)/i);
 if(!m)return null;const unit=(m[2]||'').toLowerCase();return Math.round(Number(m[1])*({b:1e9,billion:1e9,m:1e6,million:1e6,k:1e3,thousand:1e3}[unit]||1));
}
function duration(value){const s=text(value);return /^\d+(?::\d{1,2}){1,2}$/.test(s)?s.split(':').reduce((a,x)=>a*60+Number(x),0):0;}
function collect(json,key){const result=[];function visit(n){if(!n||typeof n!=='object')return;if(n[key]){result.push(n[key]);return;}for(const v of Object.values(n))if(Array.isArray(v))v.forEach(visit);else if(v&&typeof v==='object')visit(v);}visit(json);return result;}
function cover(r){const list=r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails||r.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails||r.thumbnail?.croppedSquareThumbnailRenderer?.thumbnail?.thumbnails||r.thumbnail?.thumbnails||[];const url=list.at(-1)?.url||'';return url.startsWith('https://')?url.replace(/=w\d+-h\d+[^&]*$/,'=w544-h544'):'';}
function endpoint(r){return r.navigationEndpoint?.browseEndpoint||r.title?.runs?.find(x=>x.navigationEndpoint?.browseEndpoint)?.navigationEndpoint.browseEndpoint;}
function columns(r){return(r.flexColumns||[]).map(c=>c.musicResponsiveListItemFlexColumnRenderer?.text||{});}
function explicit(r){return !![...(r.badges||[]),...(r.subtitleBadges||[])].some(b=>b.musicInlineBadgeRenderer?.icon?.iconType==='MUSIC_EXPLICIT_BADGE');}
function parseItems(json,type,fallback={}){
 const seen=new Set(),result=[];
 for(const r of [...collect(json,'musicResponsiveListItemRenderer'),...collect(json,'musicTwoRowItemRenderer')]){
  const cols=columns(r),title=text(cols[0]||r.title).trim();if(!title)continue;
  const sub=text(cols[1]||r.subtitle);const parts=sub.split(/\s+[•·]\s+/);
  const nav=endpoint(r);let id;
  if(type==='songs'){
   id=r.playlistItemData?.videoId||r.navigationEndpoint?.watchEndpoint?.videoId||cols[0]?.runs?.find(x=>x.navigationEndpoint?.watchEndpoint)?.navigationEndpoint.watchEndpoint.videoId||r.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId;
   if(!VIDEO.test(id||''))continue;
  }else{
   id=nav?.browseId;
   if(!id || (type==='artists'?!/^UC[\w-]+$/.test(id):!/^MPRE[\w-]+$/.test(id)))continue;
  }
  if(seen.has(id))continue;seen.add(id);
  const all=[...cols,...(r.fixedColumns||[]).map(c=>c.musicResponsiveListItemFixedColumnRenderer?.text||{})].map(text);
  const views=all.find(s=>/\b(?:plays|views)\b/i.test(s));
  const audience=parts.find(s=>/monthly audience|subscribers|listeners/i.test(s));
  const artistRuns=(cols[1]?.runs||[]).filter(run=>/^UC/.test(run.navigationEndpoint?.browseEndpoint?.browseId||''));
  const artist=artistRuns.length?artistRuns.map(x=>x.text).join(' & '):parts.find(s=>s&&!/^(song|album|single|ep|artist|video|\d{4})$/i.test(s)&&!duration(s)&&!/plays|views|audience|subscribers/i.test(s))||fallback.artist||'';
  const albumRun=(cols[1]?.runs||[]).find(run=>/^MPRE/.test(run.navigationEndpoint?.browseEndpoint?.browseId||''));
  result.push({id,title,artist:type==='artists'?title:artist,artistId:artistRuns[0]?.navigationEndpoint?.browseEndpoint?.browseId||fallback.artistId||'',album:albumRun?.text||fallback.title||'',albumId:albumRun?.navigationEndpoint?.browseEndpoint?.browseId||fallback.albumId||'',duration:all.map(duration).find(Boolean)||parts.map(duration).find(Boolean)||0,thumbnail:cover(r)||fallback.thumbnail||'',cover:cover(r)||fallback.thumbnail||'',year:parts.find(s=>/^\d{4}$/.test(s))||'',isExplicit:explicit(r),platform:'youtube',type:type==='songs'?'song':type==='artists'?'artist':'album',popularity:type==='artists'?count(audience||''):views?count(views):null,popularityLabel:type==='artists'?(audience||''):views||''});
 }
 return result;
}
function header(json){const r=collect(json,'musicResponsiveHeaderRenderer')[0]||collect(json,'musicDetailHeaderRenderer')[0]||collect(json,'musicImmersiveHeaderRenderer')[0]||{};const strap=text(r.straplineTextOne||r.straplineText);return{title:text(r.title),artist:strap,artistId:(r.straplineTextOne?.runs||r.straplineText?.runs||[]).find(x=>/^UC/.test(x.navigationEndpoint?.browseEndpoint?.browseId||''))?.navigationEndpoint.browseEndpoint.browseId||'',thumbnail:cover(r),description:text(r.description),subtitle:text(r.subtitle),audience:count(r.subscriptionButton?.subscribeButtonRenderer?.subscriberCountText)};}
function sortPopular(items){return [...items].map((item,index)=>({item,index})).sort((a,b)=>{const x=a.item.popularity,y=b.item.popularity;if(x==null)return y==null?a.index-b.index:1;if(y==null)return -1;return y-x||a.index-b.index;}).map(x=>x.item);}
async function post(endpoint,body,timeout=8000,signal){
 const fetcher=typeof global.riffSessionFetch==='function'?global.riffSessionFetch:fetch;
 const response=await fetcher('https://music.youtube.com/youtubei/v1/'+endpoint+'?prettyPrint=false',{method:'POST',headers:{'Content-Type':'application/json','Origin':'https://music.youtube.com','Referer':'https://music.youtube.com/'},body:JSON.stringify({context:{client:{clientName:'WEB_REMIX',clientVersion:'1.20250101.01.00',hl:'en',gl:'US'}},...body}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(timeout)]):AbortSignal.timeout(timeout)});
 if(!response.ok)throw new Error('Catalog request failed ('+response.status+').');return response.json();
}
function createCatalog(request=post){
 const searches=new Map(),pages=new Map(),metrics=new Map();
 const trackDurations = new Map();
 async function fillArtistDurations(tracks, signal) {
  const missing = tracks.filter(track => !track.duration);
  const deadline = Date.now() + 5500;
  let index = 0;
  await Promise.all(Array.from({length: Math.min(4, missing.length)}, async () => {
   while (index < missing.length && Date.now() < deadline && !signal?.aborted) {
    const track = missing[index++];
    try {
     let seconds = trackDurations.get(track.id);
     if (!seconds) {
      const data = await request('player', {videoId: track.id}, Math.min(2200, Math.max(1, deadline - Date.now())), signal);
      const details = data.videoDetails;
      if (details?.videoId !== track.id) continue;
      seconds = Number(details.lengthSeconds);
      if (!Number.isFinite(seconds) || seconds <= 0) continue;
      if (trackDurations.size >= 300) trackDurations.delete(trackDurations.keys().next().value);
      trackDurations.set(track.id, seconds);
     }
     track.duration = seconds;
    } catch {}
   }
  }));
  signal?.throwIfAborted();
 }
 const cached=async(map,key,fn)=>{const previous=map.get(key);if(previous&&Date.now()-previous.time<15*60*1000)return previous.value;const value=await fn();if(map.size>=100)map.delete(map.keys().next().value);map.set(key,{time:Date.now(),value});return value;};
 async function browse(id,type,timeout=8000,signal,forWave=false){
  if(!(type==='artists'?/^UC[\w-]+$/:/^MPRE[\w-]+$/).test(String(id)))throw new Error('Invalid catalog ID.');
  const pageKey = type + id;
  const lightArtistPage = forWave && type === 'artists';
  const existing = pages.get(pageKey);
  if (lightArtistPage && existing && Date.now() - existing.time < 15 * 60 * 1000) return existing.value;
  return cached(pages, lightArtistPage ? pageKey + ':wave' : pageKey, async () => {
   const json = await request('browse', {browseId:id}, timeout, signal);
   const meta = header(json);
   const tracks = parseItems(json, 'songs', {...meta, albumId:type === 'albums' ? id : ''});
   if (type === 'artists' && !lightArtistPage) await fillArtistDurations(tracks, signal);
   return {...meta, id, type,
    tracks: type === 'artists' ? preferExplicit(sortPopular(tracks)) : tracks,
    albums: type === 'artists' ? preferExplicit(parseItems(json,'albums',{artist:meta.title})) : [],
    popularity: tracks.length && tracks.every(t => t.popularity != null) ? tracks.reduce((a,t) => a+t.popularity,0) : null};
  });
 }
 async function popular(items,type,signal){
  const output=items.map(t=>({...t}));let next=0;const deadline=Date.now()+8000;
  await Promise.all(Array.from({length:4},async()=>{while(next<output.length&&Date.now()<deadline&&!signal?.aborted){const item=output[next++];if(item.popularity!=null || type==='artists')continue;try{
   const value=await cached(metrics,type+item.id,async()=>{
    if(type==='songs'){const data=await request('player',{videoId:item.id},2500,signal);const raw=data.videoDetails?.viewCount;return raw!=null&&/^\d+$/.test(String(raw))?Number(raw):null;}
    if(type==='albums')return(await browse(item.id,'albums',2500,signal)).popularity;
    return (await browse(item.id,'artists',2500,signal)).audience;
   });
   item.popularity=value;item.popularityLabel=value==null?'Popularity unavailable':new Intl.NumberFormat('en',{notation:'compact',maximumFractionDigits:1}).format(value)+(type==='artists'?' subscribers':' plays');
  }catch{item.popularity=null;}}}));signal?.throwIfAborted();return sortPopular(output);
 }
 async function search(query,type='songs',sort='popular',signal){
  signal?.throwIfAborted();
  if(!PARAMS[type])throw new Error('Unknown search category.');const q=String(query||'').trim().slice(0,200);if(!q)return[];
  const base=await cached(searches,type+q.toLowerCase(),async()=>{
   let items=parseItems(await request('search',{query:q,params:PARAMS[type]},8000,signal),type);
   if(type==='songs'){
    items=preferExplicit(items);
    if(items.length&&!items[0].isExplicit){const first=items[0];try{const extra=parseItems(await request('search',{query:`${first.artist} ${first.title} explicit`,params:PARAMS.songs},3000,signal),'songs');items=preferExplicit(items,extra);}catch{}}
   }return items.slice(0,30);
  });
  const ordered=sort==='popular'?await popular(base,type,signal):[...base];return type!=='artists'?preferExplicit(ordered):ordered;
 }
 async function searchAll(query,sort='popular',signal){
  const types=['songs','artists','albums'];
  const results=await Promise.allSettled(types.map(type=>search(query,type,sort,signal)));
  signal?.throwIfAborted();
  const groups={songs:[],artists:[],albums:[]},unavailable=[];
  results.forEach((result,index)=>{if(result.status==='fulfilled')groups[types[index]]=result.value;else unavailable.push(types[index]);});
  if(unavailable.length===types.length)throw new Error('Search is unavailable. Try again.');
  return{groups,unavailable};
 }
 async function wave(videoId) {
  if (!VIDEO.test(videoId || '')) throw new Error('Invalid video ID.');
  const page = await request('next', {
   videoId,
   playlistId: 'RDAMVM' + videoId,
   isAudioOnly: true,
   enablePersistentPlaylistPanel: true
  }, 5500);
  const seen = new Set([videoId]);
  const tracks = [];
  for (const item of collect(page, 'playlistPanelVideoRenderer')) {
   const id = item.videoId || item.navigationEndpoint?.watchEndpoint?.videoId;
   const title = text(item.title).trim();
   const artist = text(item.shortBylineText || item.longBylineText).trim();
   if (!VIDEO.test(id || '') || seen.has(id) || !title || !artist || item.unplayableText) continue;
   seen.add(id);
   tracks.push({id, title, artist, thumbnail:cover(item), duration:duration(item.lengthText), isExplicit:explicit(item), platform:'youtube'});
  }
  return preferExplicit(tracks).slice(0, 24);
 }
 return{search,browse,searchAll,wave};
}
module.exports={count,duration,parseItems,header,sortPopular,createCatalog};
