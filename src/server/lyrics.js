'use strict';
const normalize=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/\s*\((?:explicit|clean|official audio)\)\s*/g,' ').replace(/[^\p{L}\p{N}]/gu,'');
function matches(title,artist,candidateTitle,candidateArtist){const t=normalize(title),a=normalize(artist),ct=normalize(candidateTitle),ca=normalize(candidateArtist);return !!t&&t===ct&&!!a&&(a===ca||ca.includes(a)||a.includes(ca)&&!!ca);}
function plainLrc(text){return String(text||'').replace(/^\[\d+:\d+(?:[.:]\d+)?\]/gm,'').replace(/<\d+:\d+(?:[.:]\d+)?>/g,'').trim();}
function parseTimedLines(lrc, duration) {
 const offset = Number(lrc.match(/^\[offset:([+-]?\d+)\]$/im)?.[1] || 0) / 1000;
 const lines = [];
 for (const line of lrc.split(/\r?\n/)) {
  const timestamps = line.match(/^(?:\[\d+:\d{2}(?:[.:]\d+)?\])+/)?.[0];
  if (!timestamps) continue;
  const text = line.slice(timestamps.length).replace(/<\d+:\d+(?:[.:]\d+)?>/g, '').trim();
  for (const [, minutes, seconds, fraction] of timestamps.matchAll(/\[(\d+):(\d{2})(?:[.:](\d+))?\]/g)) {
   const time = Math.max(0, Number(minutes) * 60 + Number(seconds) + Number('0.' + (fraction || '0')) + offset);
   if (Number(seconds) < 60 && time <= duration) lines.push({time, text});
  }
 }
 return lines.sort((a, b) => a.time - b.time);
}
function createLyrics(fetcher=(...args)=>(global.riffSessionFetch||fetch)(...args)){
 const cache=new Map();
 async function request(url) {
  const res = await fetcher(url, {
   signal: AbortSignal.timeout(5000),
   headers: {'User-Agent': 'HeadRoom/0.4.0', Accept: 'application/json'}
  });
  if (!res.ok) throw Error('Provider unavailable');
  return res.json();
 }
 function searchLrclib(title, artist) {
  const params = new URLSearchParams({track_name: title, artist_name: artist});
  const key = 'lrclib:' + params;
  const entry = cache.get(key);
  if (entry && entry.expires > Date.now()) return entry.value;
  const value = request('https://lrclib.net/api/search?' + params).then(data => Array.isArray(data) ? data : []);
  cache.set(key, {value, expires: Date.now() + 60000});
  if (cache.size > 100) cache.delete(cache.keys().next().value);
  return value;
 }
 const lrclibCredit = {source: 'LRCLIB', url: 'https://lrclib.net/'};
 async function lrclib(title, artist, duration) {
  const results = await searchLrclib(title, artist);
  const found = results.find(record => matches(title, artist, record.trackName, record.artistName) &&
   (!duration || !record.duration || Math.abs(duration - record.duration) <= 8) &&
   (record.plainLyrics || record.syncedLyrics));
  const text = found?.plainLyrics?.trim() || plainLrc(found?.syncedLyrics);
  return text ? {text, ...lrclibCredit} : null;
 }
 async function getTimed(title, artist, duration) {
  title = String(title || '').slice(0, 300).trim();
  artist = String(artist || '').slice(0, 300).trim();
  if (!title || !artist || !Number.isFinite(duration) || duration <= 0) return null;
  const versionKey = text => String(text || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const results = await searchLrclib(title, artist).catch(() => []);
  const candidates = results.filter(record => typeof record.syncedLyrics === 'string' &&
   versionKey(title) === versionKey(record.trackName) && versionKey(artist) === versionKey(record.artistName) &&
   Number.isFinite(record.duration) && Math.abs(duration - record.duration) <= 2);
  candidates.sort((a, b) => Math.abs(duration - a.duration) - Math.abs(duration - b.duration));
  for (const candidate of candidates) {
   const lines = parseTimedLines(candidate.syncedLyrics, duration);
   if (lines.some(line => line.text)) return {lines, ...lrclibCredit};
  }
  return null;
 }
 async function youtube(videoId){
  if(!/^[\w-]{11}$/.test(videoId||''))return null;
  async function post(endpoint,body){const response=await fetcher('https://music.youtube.com/youtubei/v1/'+endpoint+'?prettyPrint=false',{method:'POST',signal:AbortSignal.timeout(6000),headers:{'Content-Type':'application/json','Origin':'https://music.youtube.com','Referer':'https://music.youtube.com/'},body:JSON.stringify({context:{client:{clientName:'WEB_REMIX',clientVersion:'1.20250101.01.00',hl:'en',gl:'US'}},...body})});if(!response.ok)throw Error('YouTube Music unavailable');return response.json();}
  function find(root,predicate){if(!root||typeof root!=='object')return null;if(predicate(root))return root;for(const value of Object.values(root)){const match=find(value,predicate);if(match)return match;}return null;}
  const next=await post('next',{videoId,playlistId:'RDAMVM'+videoId,isAudioOnly:true,enablePersistentPlaylistPanel:true});
  const endpoint=find(next,n=>typeof n.browseId==='string'&&n.browseId.startsWith('MPLY'));
  if(!endpoint)return null;
  const page=await post('browse',{browseId:endpoint.browseId});
  const shelf=find(page,n=>!!n.musicDescriptionShelfRenderer)?.musicDescriptionShelfRenderer;
  const text=(shelf?.description?.runs||[]).map(r=>r.text||'').join('').trim();
  const provider=(shelf?.footer?.runs||[]).map(r=>r.text||'').join('').trim();
  return text?{text,source:'YouTube Music',provider,url:'https://music.youtube.com/watch?v='+videoId}:null;
 }
 async function get(title, artist, duration = 0, videoId = '') {
  title = String(title || '').slice(0, 300).trim();
  artist = String(artist || '').slice(0, 300).trim();
  if (!title || !artist) return null;

  const key = JSON.stringify([normalize(title), normalize(artist), duration, videoId]);
  const entry = cache.get(key);
  if (entry && entry.expires > Date.now()) return entry.value;

  let value = await youtube(videoId).catch(() => null);
  if (!value) value = await lrclib(title, artist, duration).catch(() => null);
  cache.set(key, {value, expires: Date.now() + (value ? 3600000 : 60000)});
  if (cache.size > 100) cache.delete(cache.keys().next().value);
  return value;
 }
 return {get, getTimed};
}
module.exports={createLyrics,matches,plainLrc};
