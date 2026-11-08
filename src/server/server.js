const spotifyImport = require('./spotify-import');
const playlistImport = require('./playlist-import');
const panelLyrics = require('./lyrics').createLyrics();
const catalog = require('./catalog').createCatalog();
const { primeDirectAudio, resolveDirectAudio } = require('./direct-audio');
const { preferExplicit } = require('../shared/explicit-priority');
const http = require('http');
const https = require('https');
const keepAliveHttpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 32,
  maxFreeSockets: 10,
  family: 4
});
const url = require('url');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require("child_process");
const { StringDecoder } = require("string_decoder");
const dns = require('dns');
const net = require('net');

const os = require('os');
const PORT = 38472;
let ACTIVE_PORT = PORT;
const { DATA_DIR, CACHE_DIR, CUSTOM_LYRICS_DIR, LYRICS_DIR, THUMBNAILS_DIR, METADATA_PATH, LIBRARY_DIR, LIBRARY_PATH, ytDlpCommand, resolveDownloadDir, defaultDownloadDir, resolveBinary, clearBinaryCache, cookieJarHasYtLogin, readStartupConfig, writeStartupConfig } = require('../shared/platform');
const { createAudioCache } = require('./audio-cache');
const YT_COOKIES_FILE = path.join(DATA_DIR, 'yt-cookies.txt');
const DEFAULTS_FILE = path.join(__dirname, '../renderer/defaults.json');

let ytCookieCache = { mtime: -1, valid: false };
function hasYtLoginCookies() {
  try {
    if (!fs.existsSync(YT_COOKIES_FILE)) {
      ytCookieCache = { mtime: -1, valid: false };
      return false;
    }
    const stat = fs.statSync(YT_COOKIES_FILE);
    if (stat.mtimeMs === ytCookieCache.mtime) return ytCookieCache.valid;
    const txt = fs.readFileSync(YT_COOKIES_FILE, 'utf8');
    const valid = cookieJarHasYtLogin(txt);
    ytCookieCache = { mtime: stat.mtimeMs, valid };
    return valid;
  } catch (_) {
    return false;
  }
}

const I18N_DIR = path.join(DATA_DIR, 'i18n');
try { fs.mkdirSync(I18N_DIR, { recursive: true }); } catch (_) {}
try {
  const files = fs.readdirSync(I18N_DIR);
  for (const f of files) {
    const p = path.join(I18N_DIR, f);
    const content = fs.readFileSync(p, 'utf8');
    if (content.includes('linux.do')) fs.unlinkSync(p);
  }
} catch (_) {}

const I18N_FIX = {
  ru: {
    'About': 'О приложении',
    'About the artist': 'Об исполнителе',
    'Follow': 'Подписаться',
    'Following': 'Вы подписаны',
    'Word': 'Слово',
    'Line': 'Строка',
    'Default output': 'Устройство по умолчанию',
    'No local tracks in library yet.': 'В библиотеке пока нет локальных треков.',
    'Add files': 'Добавить файлы'
  }
};


const logger = require('../shared/logger');
const { getSystemAudioOutputInfo } = require('../shared/audio-output');

let serverActiveProxy = '';

const _nativeFetch = typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null;
function riffFetch(...args) {
  if (serverActiveProxy && typeof global.riffSessionFetch === 'function') {
    return global.riffSessionFetch(...args);
  }
  return _nativeFetch ? _nativeFetch(...args) : Promise.reject(new Error('fetch not available'));
}
globalThis.fetch = riffFetch;
const fetch = riffFetch;

function stripYoutubeTopic(artist) {
  if (!artist || typeof artist !== 'string') return artist || '';
  return artist.endsWith(' - Topic') ? artist.slice(0, -8).trim() : artist;
}

function boundMap(map, maxSize = 35) {
  if (!map) return;
  if (map instanceof Map) {
    while (map.size > maxSize) {
      const firstKey = map.keys().next().value;
      map.delete(firstKey);
    }
  } else if (typeof map === 'object') {
    const keys = Object.keys(map);
    if (keys.length > maxSize) {
      for (let i = 0; i < keys.length - maxSize; i++) {
        delete map[keys[i]];
      }
    }
  }
}

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const SAFE_MEDIA_URL = /^https?:\/\//i;

function streamFileToResponse(stream, res) {
  stream.on('error', () => {
    if (!res.headersSent) {
      try { res.writeHead(500); } catch (e) {}
    }
    try { res.end('Error reading file'); } catch (e) {}
    try { stream.destroy(); } catch (e) {}
  });
  res.on('close', () => { try { stream.destroy(); } catch (e) {} });
  stream.pipe(res);
}

const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;

function parseByteRange(rangeHeader, fileSize) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(rangeHeader).trim());
  if (!match) return null;
  const startRaw = match[1];
  const endRaw = match[2];
  if (startRaw === '' && endRaw === '') return null;
  let start;
  let end;
  if (startRaw === '') {
    const suffix = parseInt(endRaw, 10);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, fileSize - suffix);
    end = fileSize - 1;
  } else {
    start = parseInt(startRaw, 10);
    end = endRaw === '' ? fileSize - 1 : parseInt(endRaw, 10);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= fileSize) return null;
  if (end >= fileSize) end = fileSize - 1;
  return { start, end };
}

if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
if (!fs.existsSync(CUSTOM_LYRICS_DIR)) fs.mkdirSync(CUSTOM_LYRICS_DIR, { recursive: true });
if (!fs.existsSync(LYRICS_DIR)) fs.mkdirSync(LYRICS_DIR, { recursive: true });
if (!fs.existsSync(THUMBNAILS_DIR)) fs.mkdirSync(THUMBNAILS_DIR, { recursive: true });
if (!fs.existsSync(LIBRARY_DIR)) fs.mkdirSync(LIBRARY_DIR, { recursive: true });

let trackMetadataIndex = {};
try {
  if (fs.existsSync(METADATA_PATH)) {
    trackMetadataIndex = JSON.parse(fs.readFileSync(METADATA_PATH, 'utf-8'));
  }
} catch (e) {
  trackMetadataIndex = {};
}

function saveTrackMetadata(cleanId, meta) {
  if (!cleanId) return;
  trackMetadataIndex[cleanId] = {
    ...(trackMetadataIndex[cleanId] || {}),
    ...meta,
    lastPlayed: Date.now()
  };
  try {
    fs.writeFileSync(METADATA_PATH, JSON.stringify(trackMetadataIndex, null, 2), 'utf-8');
  } catch (e) {}
}

let libraryIndex = {};
try {
  if (fs.existsSync(LIBRARY_PATH)) {
    libraryIndex = JSON.parse(fs.readFileSync(LIBRARY_PATH, 'utf-8'));
  }
} catch (e) {
  libraryIndex = {};
}

const searchCache = new Map();
const streamUrlCache = new Map();
const streamCache = streamUrlCache;
const urlCache = streamUrlCache;
const streamInfoInflight = new Map();
const lyricsCache = new Map();
const artistCache = new Map();
const vibeCache = new Map();
const ytArtistCache = new Map();
const scClientCache = new Map();
const downloadingSet = new Set();
const prefetchingSet = new Set();
const downloadInFlight = new Map();

[lyricsCache, searchCache, streamUrlCache, artistCache, scClientCache].forEach(m => {
  const origSet = m.set.bind(m);
  m.set = function(k, v) {
    const res = origSet(k, v);
    boundMap(m, m === streamUrlCache ? 150 : 35);
    return res;
  };
});

const cacheMaintenanceTimer = setInterval(() => {
  boundMap(searchCache, 20);
  boundMap(lyricsCache, 30);
}, 300000);
cacheMaintenanceTimer.unref();

const MAX_CACHE_ENTRIES = 500;


let currentAppState = {};
const sseClients = new Set();
const YT_PLAYER_CLIENTS = ['default', 'android_vr'];
const YT_EXTRACTOR_ARGS = 'youtube:player_client=' + YT_PLAYER_CLIENTS.join(',');
const ytContentLengthByUrl = new Map();

let lastGoodYtClient = null;

let _bgYtDlpActive = 0;
const _bgYtDlpQueue = [];


function broadcastSSE(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(msg);
    } catch (e) {
      sseClients.delete(client);
    }
  }
}

function cleanTrackId(id) {
  return (id || '').replace(/[^a-zA-Z0-9_-]/g, '_');
}

async function findCachedFile(trackId, quality = '', keep = false) {
  const id = String(trackId || '');
  if (!/^[a-zA-Z0-9_-]{11}$/.test(id)) return null;
  const root = path.join(CACHE_DIR, 'exact');
  const modes = quality ? [quality] : ['', 'standard', 'plus'];
  for (const mode of modes) {
    for (const ext of ['m4a', 'webm', 'opus', 'mp3']) {
      const file = path.join(root, mode, id + '.' + ext);
      try {
        if ((await fs.promises.stat(file)).size <= (mode ? 0 : 60000)) continue;
        if (keep) {
          audioCache.keep(file);
          if (!fs.existsSync(file)) continue;
        }
        return file;
      } catch (_) {}
    }
  }
  return null;
}

const validCacheLimit = value => Number.isInteger(value) && value >= 1 && value <= 8;
const savedCacheLimit = readStartupConfig().audioCacheLimitGB;
let audioCacheLimitGB = validCacheLimit(savedCacheLimit) ? savedCacheLimit : 2;
const audioCache = createAudioCache({
  root: CACHE_DIR,
  getLimit: () => audioCacheLimitGB * 1_000_000_000,
  isCurrentTrack: id => id === currentAppState?.trackId,
  onError: error => console.warn('Audio cache cleanup failed:', error)
});
audioCache.prune();

function parseDurationSeconds(str) {
  if (!str) return 0;
  const parts = str.split(':').map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

function isSpamOrUnofficial(title, duration, channelName = '') {
  if (duration && (duration < 90 || duration > 420)) return true;

  const t = (title || '').toLowerCase();
  const c = (channelName || '').toLowerCase();
  const combined = `${t} ${c}`;

  const nonMusicWordPatterns = [
    /\blecture\b/i,
    /\btalk\b/i,
    /\bconversation\b/i,
    /\bin conversation\b/i,
    /\bacademy\b/i,
    /\bmasterclass\b/i,
    /\bdocumentary\b/i,
    /\bbehind the scenes\b/i,
    /\bmaking of\b/i,
    /\bexplained\b/i,
    /\bhistory of\b/i,
    /\bhow to\b/i,
    /\bnews\b/i,
    /\blive stream\b/i,
    /\blivestream\b/i,
    /\bfull concert\b/i,
    /\bfull set\b/i,
    /\blive at\b/i,
    /\bofficial video essay\b/i
  ];
  if (nonMusicWordPatterns.some(pat => pat.test(combined))) return true;

  const nonMusicPatterns = [
    /\bepisode\s*\d+/i,
    /\bseason\s*\d+/i,
    /\bs\d+e\d+\b/i,
    /\bep\s*\.?\s*\d+\b/i,
    /\bseries\b/i,
    /\btrailer\b/i,
    /\bteaser\b/i,
    /\bfull movie\b/i,
    /\bshort film\b/i,
    /\bpodcast\b/i,
    /\bgameplay\b/i,
    /\bwalkthrough\b/i,
    /\bplaythrough\b/i,
    /\breview\b/i,
    /\breaction\b/i,
    /\binterview\b/i,
    /\baudiobook\b/i,
    /\bvlog\b/i,
    /\bunboxing\b/i,
    /\btutorial\b/i,
    /\bparody\b/i
  ];
  if (nonMusicPatterns.some(pat => pat.test(combined))) return true;

  const badKeywords = [
    '1 hour', '2 hours', '10 hours', 'hour loop', 'hours loop',
    'full album', 'discography', 'ost compilation', 'soundtrack compilation',
    'playlist mix', 'dj set', 'type beat', 'slowed + reverb', 'slowed down',
    'sped up', 'bass boosted', 'nightcore', 'reaction to', 'reacting to'
  ];
  if (badKeywords.some(bad => combined.includes(bad))) return true;

  return false;
}

const YTM_CLIENT_VERSION = '1.20250101.01.00';

const recentlyRecommendedTrackIds = new Set();
const recentlyRecommendedKeys = new Set();

function verifyStreamPlayable(streamUrl, userAgent, redirectsLeft = 3) {
  return new Promise((resolve) => {
    if (!streamUrl || typeof streamUrl !== 'string') return resolve(false);
    if (streamUrl.includes('.m3u8')) return resolve(true);
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    try {
      const parsed = new URL(streamUrl);
      const cParam = (parsed.searchParams.get('c') || '').toUpperCase();
      let ua = userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';
      if (!userAgent) {
        if (cParam === 'IOS') ua = 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)';
        else if (cParam === 'ANDROID_VR') ua = 'com.google.android.apps.youtube.vr.oculus/1.61.48 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip';
      }
      const req = https.request(streamUrl, {
        method: 'GET',
        agent: keepAliveHttpsAgent,
        family: 4,
        timeout: 5000,
        headers: {
          'Host': parsed.host,
          'Range': 'bytes=0-0',
          'User-Agent': ua,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-us,en;q=0.5'
        }
      }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirectsLeft > 0) {
          res.resume();
          const nextUrl = new URL(res.headers.location, streamUrl).toString();
          return verifyStreamPlayable(nextUrl, ua, redirectsLeft - 1).then(done);
        }
        if (res.statusCode === 200 || res.statusCode === 206) {
          res.destroy();
          return done(true);
        }
        res.destroy();
        return done(false);
      });
      req.on('timeout', () => { req.destroy(); done(false); });
      req.on('error', () => done(false));
      req.end();
    } catch (_) {
      done(false);
    }
  });
}
const verifyGoogleVideoStream = verifyStreamPlayable;

let cachedYtVisitorData = '';
let cachedYtVisitorTs = 0;
async function getYtVisitorData() {
  if (cachedYtVisitorData && (Date.now() - cachedYtVisitorTs < 30 * 60 * 1000)) return cachedYtVisitorData;
  try {
    const r = await fetch('https://www.youtube.com/sw.js_data', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' },
      signal: AbortSignal.timeout(2500)
    });
    if (r.ok) {
      const txt = await r.text();
      const m = txt.match(/["']([Cgt][a-zA-Z0-9_%-]{10,60})["']/);
      if (m && m[1]) {
        cachedYtVisitorData = m[1];
        cachedYtVisitorTs = Date.now();
        return cachedYtVisitorData;
      }
    }
  } catch (_) {}
  return cachedYtVisitorData;
}

let serverScClientId = 'tHVbSbDP4TaoMbPppngv6Tdry83vNbMQ';
let serverScClientIdTs = 0;
scClientCache.set('clientId', serverScClientId);
boundMap(scClientCache, 35);

async function refreshSoundCloudClientId(force = false) {
  if (!force && serverScClientId && (Date.now() - serverScClientIdTs < 30 * 60 * 1000)) {
    return serverScClientId;
  }
  try {
    const html = await fetch('https://soundcloud.com', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0 Safari/537.36' }
    }).then(r => r.text());
    const scripts = [...html.matchAll(/src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)].map(m => m[1]);
    for (let i = scripts.length - 1; i >= Math.max(0, scripts.length - 5); i--) {
      try {
        const js = await fetch(scripts[i]).then(r => r.text());
        const m = js.match(/client_id\s*[:=]\s*["']([a-zA-Z0-9]{32})["']/);
        if (m && m[1]) {
          serverScClientId = m[1];
          serverScClientIdTs = Date.now();
          scClientCache.set('clientId', serverScClientId);
          boundMap(scClientCache, 35);
          return serverScClientId;
        }
      } catch (_) {}
    }
  } catch (_) {}
  return serverScClientId;
}

const refreshServerScClientId = () => refreshSoundCloudClientId(true);

const dzArtistIdCache = new Map();

const ytMixCache = new Map();

const resolvedCache = new Map();

function isTextExplicit(text) {
  if (!text) return false;
  return /\bexplicit\b|\[e\]|\(e\)|\[explicit\]|\(explicit\)|\b18\+\b|\[18\+\]|\(18\+\)|\b\+18\b|\[\+18\]|\(\+18\)|\buncensored\b|\[uncensored\]|\(uncensored\)|\bdirty\b|\[dirty\]|\(dirty\)|без\s+цензуры|нецензурн|\bмат\b/i.test(text) || (typeof isLyricsExplicit === 'function' && isLyricsExplicit(text));
}

function directYoutubeSearch(query, isMusic = false, limit = 40) {
  const filterSpam = !!isMusic;
  return new Promise((resolve) => {
    const bodyPayload = JSON.stringify({
      context: { client: { clientName: 'WEB', clientVersion: '2.20250101.00.00', hl: 'en', gl: 'US' } },
      query
    });

    const req = https.request({
      hostname: 'www.youtube.com',
      path: '/youtubei/v1/search?prettyPrint=false',
      method: 'POST',
      agent: keepAliveHttpsAgent,
      family: 4,
      timeout: 8000,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyPayload),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    }, (res) => {
      let raw = '';
      const dec = new StringDecoder('utf8');
      res.on('data', chunk => { raw += dec.write(chunk); });
      res.on('end', async () => {
        try {
          const json = JSON.parse(raw);
          const contents = json.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents ||
                           json.contents?.sectionListRenderer?.contents || [];
          const tracks = [];

          searchLoop:
          for (const section of contents) {
            const items = section.itemSectionRenderer?.contents || [];
            for (const item of items) {
              if (tracks.length >= limit) break searchLoop;
              const v = item.videoRenderer;
              if (v && v.videoId) {
                const vidId = v.videoId;
                const title = (v.title?.runs?.[0]?.text || 'untitled');
                if (!item.uploader && !item.channel && !item.artist && v.ownerText?.runs?.[0]?.text) {
                  item.artist = v.ownerText.runs[0].text;
                }
                const artist = stripYoutubeTopic(item.uploader || item.channel || item.artist || 'Unknown Artist');
                const durStr = v.lengthText?.simpleText || '0:00';
                const durSec = parseDurationSeconds(durStr);
                const thumbs = v.thumbnail?.thumbnails || [];
                const thumbnail = thumbs.length > 0 ? thumbs[thumbs.length - 1].url : '';

                if (filterSpam && isSpamOrUnofficial(title, durSec, artist)) {
                  continue;
                }

                const isCached = await findCachedFile(vidId);
                const isExplicit = Boolean(
                  (v.badges && v.badges.some(b => {
                    const mb = b.metadataBadgeRenderer;
                    return mb && (/explicit|18\+/i.test(mb.label || '') || /explicit/i.test(mb.style || '') || /explicit/i.test(mb.accessibilityData?.label || ''));
                  })) || isTextExplicit(title)
                );

                tracks.push({
                  id: vidId,
                  title: title,
                  artist: artist,
                  duration: durSec,
                  thumbnail: thumbnail,
                  url: `https://www.youtube.com/watch?v=${vidId}`,
                  platform: 'youtube',
                  isCached: !!isCached,
                  isExplicit: isExplicit
                });
              }
            }
          }
          resolve(tracks);
        } catch (e) {
          resolve([]);
        }
      });
    });

    req.on('error', () => resolve([]));
    req.on('timeout', () => { req.destroy(); resolve([]); });
    req.write(bodyPayload);
    req.end();
  });
}

function executeYtDlp(args, timeoutMs = 15000, opts = {}) {
  return new Promise((resolve, reject) => {
    const cleanEnv = Object.assign({}, process.env);
    {
      const home = os.homedir();
      const extra = ['/usr/bin', '/usr/local/bin', path.join(home, '.local/bin'), path.join(home, '.deno/bin'), '/opt/homebrew/bin'];
      const cur = (cleanEnv.PATH || '').split(path.delimiter).filter(Boolean);
      for (const d of extra) if (!cur.includes(d)) cur.push(d);
      cleanEnv.PATH = cur.join(path.delimiter);
    }
    let finalArgs = Array.isArray(args) ? [...args] : [];
    const prependFlags = [];
    let cookieJarPath = null;
    const cleanupCookieJar = () => {
      if (!cookieJarPath) return;
      const p = cookieJarPath;
      cookieJarPath = null;
      try { fs.unlinkSync(p); } catch (_) {}
    };
    if (!finalArgs.includes('--force-ipv4')) prependFlags.push('--force-ipv4');
    if (!finalArgs.includes('--geo-bypass')) prependFlags.push('--geo-bypass');
    if (!opts.noCookies && hasYtLoginCookies() && !finalArgs.includes('--cookies')) {
      try {
        cookieJarPath = path.join(DATA_DIR, `.yt-cookies-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.tmp`);
        fs.copyFileSync(YT_COOKIES_FILE, cookieJarPath);
        prependFlags.push('--cookies', cookieJarPath);
      } catch (_) {
        prependFlags.push('--cookies', YT_COOKIES_FILE);
      }
    }
    if (prependFlags.length > 0) {
      finalArgs.unshift(...prependFlags);
    }
    const hasProxy = finalArgs.some(a => typeof a === 'string' && (a === '--proxy' || a.startsWith('--proxy=')));
    if (!hasProxy) {
      if (serverActiveProxy && typeof serverActiveProxy === 'string' && serverActiveProxy.trim()) {
        finalArgs.unshift('--proxy', serverActiveProxy.trim());
      } else {
        delete cleanEnv.HTTP_PROXY;
        delete cleanEnv.HTTPS_PROXY;
        delete cleanEnv.ALL_PROXY;
        delete cleanEnv.http_proxy;
        delete cleanEnv.https_proxy;
        delete cleanEnv.all_proxy;
      }
    }
    let cmd;
    try {
      cmd = ytDlpCommand(finalArgs);
    } catch (cmdErr) {
      cleanupCookieJar();
      return reject(cmdErr);
    }
    const YTDLP_PATH = cmd.bin;
    const proc = spawn(YTDLP_PATH, cmd.args, { windowsHide: true, env: cleanEnv });
    if (opts && typeof opts.onChild === 'function') {
      try { opts.onChild(proc); } catch (_) {}
    }
    let stdout = '';
    let stderr = '';
    const outDecoder = new StringDecoder('utf8');
    const errDecoder = new StringDecoder('utf8');
    let timer = null;

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch (e) {}
        cleanupCookieJar();
        reject(new Error(`yt-dlp timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    }

    proc.stdout.on('data', (d) => { stdout += outDecoder.write(d); });
    proc.stderr.on('data', (d) => { stderr += errDecoder.write(d); });

    proc.on('close', (code) => {
      cleanupCookieJar();
      if (timer) clearTimeout(timer);
      if (code === 0) {
        resolve(stdout);
      } else {
        const firstArgs = (args || []).slice(0, 3).join(' ');
        const errSnippet = String(stderr || `code ${code}`).slice(0, 300);
        const isWarn = !stderr || /not available|unavailable|private video|timed out/i.test(errSnippet);
        if (!opts.quiet) {
          try { logger.log(isWarn ? 'warn' : 'error', `yt-dlp failed: ${firstArgs} - ${errSnippet}`); } catch (_) {}
        }
        reject(new Error(stderr || `yt-dlp exited with code ${code}`));
      }
    });

    proc.on('error', (err) => {
      cleanupCookieJar();
      if (timer) clearTimeout(timer);
      const firstArgs = (args || []).slice(0, 3).join(' ');
      const errSnippet = String(err && err.message ? err.message : err).slice(0, 300);
      try { logger.log('error', `yt-dlp spawn error: ${firstArgs} - ${errSnippet}`); } catch (_) {}
      if (err && err.code === 'ENOENT' && !opts.retried) {
        clearBinaryCache();
        try {
          resolveBinary('yt-dlp');
        } catch (_) {}
        return executeYtDlp(args, timeoutMs, Object.assign({}, opts, { retried: true })).then(resolve, reject);
      }
      reject(err);
    });
  });
}

const thumbHostFails = new Map();

async function lookupCoverArt(artist, title) {
  const key = crypto.createHash('sha1').update(`${artist}\u0000${title}`.toLowerCase()).digest('hex').slice(0, 16);
  const dest = path.join(THUMBNAILS_DIR, `cover-${key}.jpg`);
  if (fs.existsSync(dest)) return dest;
  try {
    const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(`${artist} ${title}`)}&entity=song&limit=5`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json();
    const item = (data.results || [])[0];
    if (!item || !item.artworkUrl100) return null;
    const art = await fetch(item.artworkUrl100.replace('100x100', '600x600'), { signal: AbortSignal.timeout(8000) });
    if (!art.ok) return null;
    const buf = Buffer.from(await art.arrayBuffer());
    if (buf.length < 500) return null;
    await fs.promises.writeFile(dest, buf);
    return dest;
  } catch (e) {
    return null;
  }
}

const creditsCache = new Map();

async function imageContentType(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.length > 6 && buf.toString('ascii', 0, 3) === 'GIF') return 'image/gif';
  return 'image/jpeg';
}

const YTM_SONGS_PARAMS = 'EgWKAQIIAWoMEA4QChADEAQQCRAF';
let ytmFailUntil = 0;
let ytmFailCount = 0;

async function ytmSearchRequest(query, params = YTM_SONGS_PARAMS, attempt = 0, timeoutMs = 10000, maxRetries = 2) {
  const reqBody = {
    context: { client: { clientName: 'WEB_REMIX', clientVersion: YTM_CLIENT_VERSION, hl: 'en', gl: 'US' } },
    query
  };
  if (params) reqBody.params = params;
  const body = JSON.stringify(reqBody);

  if (typeof global.riffSessionFetch === 'function') {
    return global.riffSessionFetch('https://music.youtube.com/youtubei/v1/search?prettyPrint=false', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'https://music.youtube.com',
        'Referer': 'https://music.youtube.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
      },
      body,
      signal: AbortSignal.timeout(timeoutMs)
    }).then(r => {
      if (!r.ok) throw new Error('status ' + r.status);
      return r.json();
    });
  }

  return new Promise((resolve, reject) => {
    const doSessionFallback = () => {
      if (typeof global.riffSessionFetch === 'function') {
        return global.riffSessionFetch('https://music.youtube.com/youtubei/v1/search?prettyPrint=false', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Origin': 'https://music.youtube.com',
            'Referer': 'https://music.youtube.com/',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
          },
          body,
          signal: AbortSignal.timeout(7000)
        }).then(r => r.json()).then(resolve).catch(reject);
      }
      return false;
    };

    const req = https.request({
      hostname: 'music.youtube.com',
      path: '/youtubei/v1/search?prettyPrint=false',
      method: 'POST',
      agent: attempt === 0 ? keepAliveHttpsAgent : false,
      family: 4,
      timeout: timeoutMs,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Origin': 'https://music.youtube.com',
        'Referer': 'https://music.youtube.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
      }
    }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        try { logger.log('warn', `ytmusic search status ${res.statusCode}`); } catch (_) {}
        res.resume();
        if (typeof global.riffSessionFetch === 'function') {
          return doSessionFallback();
        }
        return reject(new Error(`ytmusic status ${res.statusCode}`));
      }
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(raw));
        } catch (err) {
          try { logger.log('warn', `ytmusic search parse error: ${err.message}`); } catch (_) {}
          if (typeof global.riffSessionFetch === 'function') {
            return doSessionFallback();
          }
          reject(err);
        }
      });
    });
    let retryStarted = false;
    const retryOrReject = (err) => {
      if (retryStarted) return;
      retryStarted = true;
      if (attempt < maxRetries) {
        return resolve(ytmSearchRequest(query, params, attempt + 1, timeoutMs, maxRetries));
      }
      if (typeof global.riffSessionFetch === 'function') {
        return doSessionFallback();
      }
      try { logger.log('warn', `ytmusic search error: ${err.message}`); } catch (_) {}
      reject(err);
    };
    req.on('timeout', () => {
      req.destroy();
      retryOrReject(new Error('The operation was aborted due to timeout'));
    });
    req.on('error', (err) => {
      if (/ECONNRESET|socket hang up|EPIPE|ETIMEDOUT/i.test(err && err.message || '')) {
        return retryOrReject(err);
      }
      if (typeof global.riffSessionFetch === 'function') {
        return doSessionFallback();
      }
      try { logger.log('warn', `ytmusic search error: ${err.message}`); } catch (_) {}
      reject(err);
    });
    req.write(body);
    req.end();
  });
}

function parseYtmDuration(text) {
  if (!text || !/^\d+(:\d{1,2}){1,2}$/.test(text.trim())) return 0;
  return text.trim().split(':').map(Number).reduce((acc, n) => acc * 60 + n, 0);
}

function parseYtmSongs(json) {
  const out = [];
  const tabs = (json && json.contents && json.contents.tabbedSearchResultsRenderer && json.contents.tabbedSearchResultsRenderer.tabs) || [];
  const sections = (tabs[0] && tabs[0].tabRenderer && tabs[0].tabRenderer.content && tabs[0].tabRenderer.content.sectionListRenderer && tabs[0].tabRenderer.content.sectionListRenderer.contents) || [];
  for (const section of sections) {
    const items = [];
    if (section && section.musicShelfRenderer && Array.isArray(section.musicShelfRenderer.contents)) {
      items.push(...section.musicShelfRenderer.contents);
    }
    if (section && section.itemSectionRenderer && Array.isArray(section.itemSectionRenderer.contents)) {
      items.push(...section.itemSectionRenderer.contents);
    }
    if (section && section.musicCardShelfRenderer && Array.isArray(section.musicCardShelfRenderer.contents)) {
      items.push(...section.musicCardShelfRenderer.contents);
    }
    for (const wrap of items) {
      const r = wrap && wrap.musicResponsiveListItemRenderer;
      if (!r) continue;
      const cols = r.flexColumns || [];
      const runsOf = (i) => (cols[i] && cols[i].musicResponsiveListItemFlexColumnRenderer && cols[i].musicResponsiveListItemFlexColumnRenderer.text && cols[i].musicResponsiveListItemFlexColumnRenderer.text.runs) || [];
      const overlay = r.overlay && r.overlay.musicItemThumbnailOverlayRenderer && r.overlay.musicItemThumbnailOverlayRenderer.content && r.overlay.musicItemThumbnailOverlayRenderer.content.musicPlayButtonRenderer;
      const videoId = (r.playlistItemData && r.playlistItemData.videoId) || (overlay && overlay.playNavigationEndpoint && overlay.playNavigationEndpoint.watchEndpoint && overlay.playNavigationEndpoint.watchEndpoint.videoId);
      if (!videoId || !/^[\w-]{11}$/.test(videoId)) continue;

      const title = runsOf(0).map((x) => x.text).join('').trim();
      const segments = [];
      let cur = [];
      for (const run of runsOf(1)) {
        if (run.text === ' • ') { segments.push(cur.join('').trim()); cur = []; } else cur.push(run.text);
      }
      segments.push(cur.join('').trim());
      const clean = segments.filter((s) => s && !/^(song|video)$/i.test(s));
      let duration = 0;
      if (clean.length && parseYtmDuration(clean[clean.length - 1])) duration = parseYtmDuration(clean.pop());
      const artist = (clean[0] || '').replace(/\s*-\s*Topic$/i, '').trim();
      const album = clean[1] || '';

      const thumbs = (r.thumbnail && r.thumbnail.musicThumbnailRenderer && r.thumbnail.musicThumbnailRenderer.thumbnail && r.thumbnail.musicThumbnailRenderer.thumbnail.thumbnails) || [];
      let thumbnail = thumbs.length ? thumbs[thumbs.length - 1].url : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
      thumbnail = thumbnail.replace(/=w\d+-h\d+[^&]*$/, '=w544-h544');

      const isExplicit = Boolean(
        (r.badges && r.badges.some((b) => {
          const badge = b.musicInlineBadgeRenderer;
          return badge && (
            badge.icon?.iconType === 'MUSIC_EXPLICIT_BADGE' ||
            /explicit|нецензурн|18\+/i.test(badge.accessibilityData?.accessibilityData?.label || '')
          );
        })) ||
        isTextExplicit(title) ||
        isTextExplicit(album)
      );

      if (!title || (duration && duration < 30)) continue;
      out.push({ id: videoId, title, artist: artist || 'Unknown Artist', album, duration, thumbnail, isExplicit });
    }
  }
  return out;
}

async function ytmusicSearch(query, options = {}) {
  const limit = typeof options === 'number' ? options : (typeof options === 'object' && options?.limit) || 0;
  const timeoutMs = (typeof options === 'object' && options?.timeoutMs) || 10000;
  const maxRetries = (typeof options === 'object' && Number.isInteger(options?.maxRetries)) ? options.maxRetries : 2;
  const useFallback = typeof options === 'object' && options?.fallback !== false;
  let json;
  try {
    json = await ytmSearchRequest(query, YTM_SONGS_PARAMS, 0, timeoutMs, maxRetries);
  } catch (_) {
    if (!useFallback) return [];
    try {
      const fbTracks = await directYoutubeSearch(query, true).then(tracks => tracks || []);
      return limit > 0 ? fbTracks.slice(0, limit) : fbTracks;
    } catch (_) { return []; }
  }
  try {
    let songs = parseYtmSongs(json);
    if (songs && songs.length > 0) {
      if (limit > 0) songs = songs.slice(0, limit);
      return songs.map(s => {
        const artist = stripYoutubeTopic(s.artist);
        ytArtistCache.set(s.id, artist);
        return {
          id: s.id,
          title: s.title,
          artist: stripYoutubeTopic(artist),
          album: s.album,
          duration: s.duration || 180,
          thumbnail: s.thumbnail || `https://i.ytimg.com/vi/${s.id}/hqdefault.jpg`,
          url: `https://www.youtube.com/watch?v=${s.id}`,
          platform: 'youtube',
          isExplicit: !!s.isExplicit
        };
      });
    }
  } catch (_) {}
  if (!useFallback) return [];
  return [];
}

async function handleSearch(req, res, query, platform = 'ytmusic', limit = 24, offset = 0, type = 'songs', sort = 'popular') {
 const controller = new AbortController();
 res.once?.('close',()=>controller.abort());
 try {
  if(type === 'all') {
   const result = await catalog.searchAll(query, sort, controller.signal);
   res.writeHead(200, { 'Content-Type':'application/json' });
   return res.end(JSON.stringify({success:true,type,...result,items:Object.values(result.groups).flat(),tracks:result.groups.songs,hasMore:false}));
  }
  const items = await catalog.search(query, type, sort, controller.signal);
  res.writeHead(200, { 'Content-Type':'application/json' });
  return res.end(JSON.stringify({success:true, type, items, tracks:type === 'songs' ? items : [], hasMore:false}));
 } catch(error) {
  if(controller.signal.aborted || res.destroyed)return;
  res.writeHead(502, { 'Content-Type':'application/json' });
  return res.end(JSON.stringify({success:false,error:'Could not load search results. Try again.'}));
 }
}

async function checkNetConnectivity() {
  const tryReq = (urlStr) => new Promise((resolve) => {
    try {
      const parsed = new URL(urlStr);
      const mod = parsed.protocol === 'http:' ? http : https;
      const req = mod.request(parsed, {
        method: 'HEAD',
        timeout: 3500,
        family: 4,
        headers: { 'User-Agent': 'HeadRoom' }
      }, (res) => {
        res.resume();
        resolve(res.statusCode >= 200 && res.statusCode < 400);
      });
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
      req.on('error', () => {
        resolve(false);
      });
      req.end();
    } catch (_) {
      resolve(false);
    }
  });

  const googleOk = await tryReq('https://www.google.com/generate_204');
  if (googleOk) return true;
  return await tryReq('https://api.deezer.com/chart/0/tracks?limit=1');
}

const audioMode = value => value === 'plus' ? 'plus' : 'standard';
const directAudioCache = new Map();
const ageRestrictionMessage = 'This recording requires age verification on YouTube.';

function isAgeRestriction(error) {
 return error?.code === 'AGE_RESTRICTED' ||
  /confirm your age|age.restricted|age.verification required/i.test(String(error?.message || ''));
}

function cacheDirectAudio(mode, id, url, alternateUrl) {
 const source = URL.parse(url);
 if (source?.protocol !== 'https:' || !source.hostname.endsWith('.googlevideo.com')) return false;
 const now = Date.now();
 const expires = Math.min(now + 15 * 60 * 1000, (Number(source.searchParams.get('expire')) || Infinity) * 1000 - 60000);
 if (expires <= now) return false;
 if (directAudioCache.size >= 100) directAudioCache.delete(directAudioCache.keys().next().value);
 directAudioCache.set(mode + ':' + id, { url: source.href, expires, alternateUrl });
 return true;
}

async function handleStreamInfo(req, res, trackId, title, artist, duration, thumbnail, quality, download, resolveOnly = false) {
// Keep Riff's yt-dlp execution, metadata/cache and local playback; remove title/service substitution.
 const id = String(trackId || '');
 if (!/^[a-zA-Z0-9_-]{11}$/.test(id)) {
  res.writeHead(422, { 'Content-Type': 'application/json' });
  return res.end(JSON.stringify({success:false,error:'Please find this song again using search.'}));
 }
 const key = quality + ':' + id;
 const format = 'bestaudio[protocol=https]';
 const standardFormat = format + '[abr<=80]/' + format + '[abr<=128]/' + format;
 const audioFormat = (quality === 'plus' ? format : standardFormat) + '/bestaudio';
 const args = ['--ignore-config', '--no-playlist', '--no-warnings', '--no-progress', '--socket-timeout', '8', '--retries', '0'];
 const watchUrl = 'https://music.youtube.com/watch?v=' + id;
 try {
  let file = await findCachedFile(id, quality, true);
  if (!file && !download) {
   const directKey = 'direct:' + id;
   let entry = directAudioCache.get(key);
   if (!entry || entry.expires <= Date.now()) {
    let pending = streamInfoInflight.get(directKey);
    if (!pending) {
     pending = (async () => {
      const fast = serverActiveProxy ? null : await resolveDirectAudio(id).catch(() => null);
      if (fast?.restricted === 'age') {
       throw Object.assign(new Error(ageRestrictionMessage), { code: 'AGE_RESTRICTED' });
      }
      if (fast) {
       const standardReady = cacheDirectAudio('standard', id, fast.standard, fast.standardAlternate);
       const plusReady = cacheDirectAudio('plus', id, fast.plus, fast.plusAlternate);
       if (standardReady && plusReady) return;
      }
      const output = await executeYtDlp([...args, '-f', standardFormat + ',' + format, '--skip-download',
        '--print', '%(.{id,url,protocol,vcodec})j', watchUrl], 14500, { noCookies:true, quiet:true });
      const rows = output.trim().split('\n').map(line => JSON.parse(line));
      if (rows.length !== 2) return;
      for (const [index, mode] of ['standard', 'plus'].entries()) {
       const info = rows[index];
       if (info.id !== id || info.vcodec !== 'none' || info.protocol !== 'https' || !info.url) continue;
       cacheDirectAudio(mode, id, info.url);
      }
     })();
     streamInfoInflight.set(directKey, pending);
     pending.finally(() => streamInfoInflight.delete(directKey)).catch(() => {});
    }
    await pending.catch(error => {
     if (isAgeRestriction(error)) throw error;
    });
    entry = directAudioCache.get(key);
   }
   if (entry && entry.expires > Date.now()) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success:true, isDirect:true, resolvedId:id, streamUrl:entry.url, alternateUrl:entry.alternateUrl }));
   }
  }
  if (!file && resolveOnly) {
   res.writeHead(204);
   return res.end();
  }
  if (!file) {
   let pending = streamInfoInflight.get(key);
   if (!pending) {
    pending = (async () => {
     const directory = path.join(CACHE_DIR, 'exact', quality);
     await fs.promises.mkdir(directory, { recursive:true });
     const temp = await fs.promises.mkdtemp(path.join(directory, '.loading-'));
     try {
      await executeYtDlp([...args, '-f', audioFormat, '--no-mtime', '--write-info-json', '-o', path.join(temp, 'audio.%(ext)s'), watchUrl], download ? 20000 : 12500, { noCookies:true });
      const info = JSON.parse(await fs.promises.readFile(path.join(temp,'audio.info.json'),'utf8'));
      if (info.id !== id || !['m4a','webm','opus','mp3'].includes(info.ext)) throw new Error('Recording identity mismatch');
      const source = path.join(temp,'audio.'+info.ext);
      const size = (await fs.promises.stat(source)).size;
      if (!size) throw new Error('Incomplete audio');
      const output = path.join(directory,id+'.'+info.ext);
      audioCache.keep(output);
      await fs.promises.rename(source,output);
      audioCache.prune();
      saveTrackMetadata(id,{id,title:info.track||info.title||title,artist:info.artist||artist,duration:info.duration||duration,thumbnail,platform:'youtube',fileSize:size});
      return output;
     } finally { await fs.promises.rm(temp,{recursive:true,force:true}); }
    })();
    streamInfoInflight.set(key,pending);
    pending.finally(()=>{if(streamInfoInflight.get(key)===pending)streamInfoInflight.delete(key);}).catch(()=>{});
   }
   file = await pending;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  return res.end(JSON.stringify({success:true,isLocal:true,resolvedId:id,streamUrl:'http://127.0.0.1:'+ACTIVE_PORT+'/api/local-track?'+new URLSearchParams({id,quality})}));
 } catch(error) {
  if (isAgeRestriction(error)) {
   if (resolveOnly) {
    res.writeHead(204);
    return res.end();
   }
   res.writeHead(403, { 'Content-Type': 'application/json' });
   return res.end(JSON.stringify({ success: false, code: 'AGE_RESTRICTED', error: ageRestrictionMessage }));
  }
  logger.log('error', 'Exact playback failed id='+id+': '+String(error.message).slice(0,200));
  res.writeHead(502, { 'Content-Type': 'application/json' });
  return res.end(JSON.stringify({success:false,error:'Could not load this recording. Try again.'}));
 }
}

const geniusArtCache = new Map();

async function handleLocalTrack(req, res, trackId, quality) {
  const cleanId = cleanTrackId(trackId);
  let filePath = await findCachedFile(cleanId, quality, true);
  if (!filePath && !quality) {
    for (const [cid, meta] of Object.entries(trackMetadataIndex)) {
      if (cid === cleanId || (meta && meta.title && cleanTrackId(meta.title) === cleanId)) {
        const extensions = ['.opus', '.webm', '.m4a', '.mp3'];
        for (const ext of extensions) {
          const fp = path.join(CACHE_DIR, `${cid}${ext}`);
          if (fs.existsSync(fp)) { filePath = fp; break; }
        }
      }
      if (filePath) break;
    }
  }

  if (!filePath) {
    res.writeHead(404);
    return res.end('File not found in local cache');
  }

  audioCache.keep(filePath);
  try {
    const stat = await fs.promises.stat(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.opus': 'audio/ogg; codecs=opus',
      '.webm': 'audio/webm',
      '.m4a': 'audio/mp4',
      '.mp3': 'audio/mpeg'
    };
    const contentType = mimeTypes[ext] || 'audio/mpeg';

    if (range) {
      const parsed = parseByteRange(range, fileSize);
      if (!parsed) {
        res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` });
        res.end();
        return;
      }
      const { start, end } = parsed;
      const chunksize = (end - start) + 1;
      const file = fs.createReadStream(filePath, { start, end });
      file.once('close', audioCache.open(filePath));
      const head = {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': contentType,
      };
      res.writeHead(206, head);
      streamFileToResponse(file, res);
    } else {
      const head = {
        'Content-Length': fileSize,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes'
      };
      res.writeHead(200, head);
      const file = fs.createReadStream(filePath);
      file.once('close', audioCache.open(filePath));
      streamFileToResponse(file, res);
    }
  } catch (e) {
    res.writeHead(500);
    res.end('Error reading local file');
  }
}

const LIBRARY_MIME_TYPES = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.opus': 'audio/ogg; codecs=opus',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.webm': 'audio/webm',
  '.weba': 'audio/webm'
};

const GV_UA = {
  IOS: 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)',
  ANDROID_VR: 'com.google.android.apps.youtube.vr.oculus/1.61.48 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
  ANDROID_MUSIC: 'com.google.android.apps.youtube.music/7.27.52 (Linux; U; Android 14; en_US; Quest 3) gzip',
  TV: 'Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.5) AppleWebKit/537.36 (KHTML, like Gecko) 85.0.4183.93/6.5 TV Safari/537.36',
  ANDROID_TESTSUITE: 'com.google.android.youtube/1.9 (Linux; U; Android 11; en_US) gzip',
  ANDROID: 'com.google.android.youtube/19.44.38 (Linux; U; Android 14; en_US; sdk_gphone64_x86_64 Build/UE1A.230829.036) gzip',
  WEB: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
};

const gvRedirectCache = new Map();

const AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.flac', '.opus', '.wav', '.ogg', '.oga', '.aac', '.webm', '.weba']);

let downloadsIndex = null;
let downloadsIndexBuiltAt = 0;
const DOWNLOADS_INDEX_TTL = 15000;

function sanitizeForLyrics(title, artist) {
  let cleanTitle = (title || '')
  .replace(/\[.*?\]|\(.*?\)/g, '')
  .replace(/official\s*(music)?\s*video|official\s*audio|lyrics|hd|4k|remastered|visualizer|clip\s*officiel|video\s*clip/gi, '')
  .replace(/ft\.?|feat\.?/gi, '')
  .replace(/[^\w\s\u0400-\u04FF]/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim();

  let cleanArtist = (artist || '')
  .replace(/\[.*?\]|\(.*?\)/g, '')
  .replace(/- topic|vevo|records|official/gi, '')
  .replace(/[^\w\s\u0400-\u04FF]/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim();

  return { cleanTitle, cleanArtist };
}

function logNetworkFailure(targetUrl) {
  try {
    const u = new URL(targetUrl);
    logger.log('warn', `${u.host}${u.pathname}`);
  } catch (_) {}
}

function decodeUtf8Chunks(chunks) {
  return Buffer.concat(chunks).toString('utf8');
}

function fetchLyricsDirect(title, artist) {
  return new Promise((resolve) => {
    const { cleanTitle, cleanArtist } = sanitizeForLyrics(title, artist);
    const apiUrl = `https://lrclib.net/api/get?track_name=${encodeURIComponent(cleanTitle)}&artist_name=${encodeURIComponent(cleanArtist)}`;

    const req1 = https.get(apiUrl, { headers: { 'User-Agent': 'devsize/2.0' }, timeout: 8000 }, (res) => {
      let data = '';
      const dec = new StringDecoder('utf8');
      res.on('data', c => data += dec.write(c));
      res.on('end', () => {
        data += dec.end();
        try {
          if (res.statusCode === 200) {
            const parsed = JSON.parse(data);
            if (parsed.instrumental) {
              return resolve({ instrumental: true, syncedLyrics: '', plainLyrics: '' });
            }
            if (parsed.syncedLyrics || parsed.plainLyrics) {
              return resolve(parsed.syncedLyrics || parsed.plainLyrics);
            }
          }
        } catch (e) {}

        const query = `${cleanArtist} ${cleanTitle}`.trim();
        const searchUrl = `https://lrclib.net/api/search?q=${encodeURIComponent(query)}`;
        const req2 = https.get(searchUrl, { headers: { 'User-Agent': 'devsize/2.0' }, timeout: 8000 }, (res2) => {
          const chunks = [];
          res2.on('data', chunk => chunks.push(chunk));
          res2.on('end', () => {
            const data2 = decodeUtf8Chunks(chunks);
            try {
              const list = JSON.parse(data2);
              if (Array.isArray(list) && list.length > 0) {
                if (list[0].instrumental) {
                  return resolve({ instrumental: true, syncedLyrics: '', plainLyrics: '' });
                }
                const withSynced = list.find(item => item.syncedLyrics);
                if (withSynced) return resolve(withSynced.syncedLyrics);
                return resolve(list[0].syncedLyrics || list[0].plainLyrics || null);
              }
            } catch (e) {}
            resolve(null);
          });
        });
        req2.on('timeout', () => {
          req2.destroy();
          logNetworkFailure(searchUrl);
          resolve(null);
        });
        req2.on('error', () => {
          logNetworkFailure(searchUrl);
          resolve(null);
        });
      });
    });
    req1.on('timeout', () => {
      req1.destroy();
      logNetworkFailure(apiUrl);
      resolve(null);
    });
    req1.on('error', () => {
      logNetworkFailure(apiUrl);
      resolve(null);
    });
  });
}

let musixmatchToken = null;
let musixmatchTokenExpires = 0;

const fetchLrcLib = fetchLyricsDirect;

const SERVER_TOKEN = crypto.randomBytes(24).toString('hex');

const TOKEN_PROTECTED_ROUTES = new Set([
  '/api/save-default-settings',
  '/api/audio-cache-limit',
  '/api/state',
  '/api/translate',
  '/api/i18n-batch',
  '/api/vibe',
  '/api/search',
  '/api/artist',
  '/api/lyrics',
  '/api/download',
  '/api/spotify-import',
  '/api/spotify-auth-start',
  '/api/spotify-status',
  '/api/spotify-library',
  '/api/spotify-logout',
  '/api/prefetch',
  '/api/check-cache',
  '/api/stream-info',
  '/api/track-analysis',
  '/api/tools-status',
  '/api/tools-install',
  '/api/tools/status',
  '/api/tools/install',
  '/api/library',
  '/api/library-add',
  '/api/library-update',
  '/api/library-remove',
  '/api/offline-library',
  '/api/offline-delete',
  '/api/clear-offline-library',
  '/api/save-custom-lyrics',
  '/api/encode',
  '/api/yandex-import',
  '/api/tiktok-import',
  '/api/vk-import',
  '/api/check-playlist-unavailable'
]);

function getServerToken() {
  return SERVER_TOKEN;
}

function tokenMatches(provided) {
  if (typeof provided !== 'string') return false;
  const expected = Buffer.from(SERVER_TOKEN);
  const given = Buffer.from(provided);
  if (given.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(given, expected);
  } catch (e) {
    return false;
  }
}

function isLyricsExplicit(lyrics) {
  if (!lyrics || typeof lyrics !== 'string') return false;
  return /\b(fuck|fucking|fucked|fucker|fucks|shit|bitch|bitches|bitching|asshole|cunt|nigger|nigga|dick|pussy)\b|ху[йеяёюи]|пизд|залуп|муда[кч]|мудил|г[ао]ндон|дерьм|дроч|(?:^|[^а-яё])(?:бля[а-яё]*|сук[аиуео]|суч[екьяа][а-яё]*)|(?:^|[^а-яё])(?:[её]б[а-яё]+|[её]б\b|(?:вы|за|на|до|по|пере|про|разъ|раз|съ|въ|под|от|у)[её]б[а-яё]*)/i.test(lyrics);
}

const SPOTIFY_PATHFINDER_URL = 'https://api-partner.spotify.com/pathfinder/v1/query';
const SPOTIFY_FETCH_PLAYLIST_HASH = '8964e8eafb21aa992a7d951d256d83285c04be2105d209262901de70cb97584a';

const BRAND_ICON_COLORS = {
  spotify: '1ED760',
  youtubemusic: 'FF0000',
  youtube: 'FF0000',
  soundcloud: 'FF5500',
  applemusic: 'FA243C',
  deezer: 'A238FF',
  yandexmusic: 'FFCC00',
  tiktok: 'FFFFFF',
  vk: '0077FF',
  json: '7E7A8A'
};

const YANDEX_API = 'https://api.music.yandex.net';
const YANDEX_HEADERS = {
  'User-Agent': 'Yandex-Music-API',
  'X-Yandex-Music-Client': 'YandexMusicAndroid/24023231',
  'Accept': 'application/json'
};

const SPOTIFY_SCOPES = 'user-library-read playlist-read-private playlist-read-collaborative';
let spotifyAuth = { verifier: '', state: '', clientId: '', token: '', refreshToken: '', expiresAt: 0 };
let spotifyAuthError = '';
let spotifyAuthLoaded = false;

let spotifyRefreshPromise = null;
const spotifyAuthPath = path.join(DATA_DIR, 'spotify-auth.enc');
const spotifySafeStorage = process.versions.electron ? require('electron').safeStorage : null;

const DEEPL_LANG_MAP = {
  'en': 'EN', 'ru': 'RU', 'uk': 'UK', 'de': 'DE', 'fr': 'FR',
  'es': 'ES', 'it': 'IT', 'pt': 'PT', 'pl': 'PL', 'nl': 'NL',
  'ja': 'JA', 'zh-CN': 'ZH', 'zh-TW': 'ZH', 'ko': 'KO', 'tr': 'TR',
  'sv': 'SV', 'da': 'DA', 'fi': 'FI', 'cs': 'CS', 'ro': 'RO',
  'hu': 'HU', 'el': 'EL', 'bg': 'BG', 'id': 'ID'
};

const albumCache = new Map();

let hotPicksCache = { data: null, expires: 0 };

const DEFAULT_LFM_KEY = '4b4f73bda181868353f9b438604adf52';
const DEFAULT_LFM_SECRET = '716cc0a784bb62835de5bd674e65eb57';

let i18nJobRunning = false;
const activeRequests = new Map();
let activeReqSeq = 0;
const LONG_LIVED_ROUTES = new Set([
  '/api/audio-proxy', '/api/lyrics-stream', '/api/local-track', '/api/downloaded-track',
  '/api/library-file', '/api/download', '/api/encode',
  '/api/playlist-import', '/api/spotify-import', '/api/apple-import', '/api/yandex-import',
  '/api/tiktok-import', '/api/vk-import'
]);
setInterval(() => {
  try {
    const now = Date.now();
    const stuck = [];
    for (const r of activeRequests.values()) if (now - r.t > 8000) stuck.push(`${r.path} ${Math.round((now - r.t) / 1000)}s${r.sent ? ' (headers sent)' : ' (NO RESPONSE)'}`);
    if (stuck.length) logger.log('warn', `Open requests (${activeRequests.size} total): ` + stuck.slice(0, 12).join(' | '));
  } catch (_) {}
}, 10000).unref();

const server = http.createServer((req, res) => {
  const _reqId = ++activeReqSeq;
  const _reqPath = String(req.url || '').split('?')[0];
  const _rec = { t: Date.now(), path: _reqPath, sent: false };
  activeRequests.set(_reqId, _rec);
  const _done = () => activeRequests.delete(_reqId);
  res.once('close', _done);
  res.once('finish', _done);
  if (!LONG_LIVED_ROUTES.has(_reqPath)) {
    const wd = setTimeout(() => {
      try {
        if (!res.headersSent && !res.writableEnded) {
          logger.log('error', `Watchdog 504: ${_reqPath} did not respond in 25s`);
          res.writeHead(504, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'server timeout' }));
        }
      } catch (_) {}
    }, 25000);
    res.once('close', () => clearTimeout(wd));
    res.once('finish', () => clearTimeout(wd));
  }
  const _wh = res.writeHead.bind(res);
  res.writeHead = (...a) => { if (res.headersSent || res.writableEnded) return res; _rec.sent = true; return _wh(...a); };
  const _end = res.end.bind(res);
  res.end = (...a) => res.writableEnded ? res : _end(...a);
  Promise.resolve(requestHandler(req, res)).catch((err) => {
    try { logger.log('error', 'Request failed: ' + (req.url || '').split('?')[0] + ' - ' + (err && err.message)); } catch (_) {}
    try {
      if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: false, error: 'internal error' })); }
      else res.destroy();
    } catch (_) {}
  });
});
async function requestHandler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  const requestOrigin = req.headers.origin;
  if (requestOrigin && requestOrigin !== 'null') {
    let originAllowed = false;
    try {
      const originUrl = new URL(requestOrigin);
      originAllowed = originUrl.protocol === 'file:' || originUrl.hostname === '127.0.0.1' || originUrl.hostname === 'localhost' || originUrl.hostname === '::1';
    } catch (e) {
      originAllowed = false;
    }
    if (!originAllowed) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'forbidden' }));
    }
  }

  const hostName = (req.headers.host || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  if (hostName && hostName !== '127.0.0.1' && hostName !== 'localhost' && hostName !== '::1') {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: false, error: 'forbidden' }));
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const baseRoutes = new Set(['/api/wave','/api/playlist-preview','/api/spotify-preview','/api/spotify-match','/api/panel-lyrics','/api/catalog','/api/search','/api/stream-info','/api/local-track','/api/default-settings','/api/state','/api/check-cache','/api/net-check','/api/image-proxy','/api/local-thumbnail','/api/tools-status','/api/tools/status','/api/tools-install','/api/tools/install','/api/audio-output-info','/api/track-analysis']);
  baseRoutes.add('/api/audio-cache-limit');
  if (!baseRoutes.has(pathname)) {
    res.writeHead(404, { 'Content-Type':'application/json' });
    return res.end(JSON.stringify({success:false,error:'This feature is not included in the minimal version.'}));
  }

  if (TOKEN_PROTECTED_ROUTES.has(parsedUrl.pathname) && !tokenMatches(req.headers['x-riff-token'])) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: false, error: 'forbidden' }));
  }

  if (pathname === '/api/audio-cache-limit') {
    let usedBytes;
    if (req.method === 'POST') {
      const limit = Number(parsedUrl.query.limit);
      if (!validCacheLimit(limit)) {
        res.writeHead(400);
        return res.end();
      }
      if (!writeStartupConfig({ audioCacheLimitGB: limit })) {
        res.writeHead(500);
        return res.end();
      }
      audioCacheLimitGB = limit;
      usedBytes = await audioCache.prune();
    } else if (req.method === 'GET') {
      usedBytes = await audioCache.usage();
    } else {
      res.writeHead(405, { Allow: 'GET, POST' });
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ limitGB: audioCacheLimitGB, usedBytes }));
  }

  if (parsedUrl.pathname === '/api/default-settings' && req.method === 'GET') {
    let defaults = {};
    try {
      if (fs.existsSync(DEFAULTS_FILE)) {
        defaults = JSON.parse(fs.readFileSync(DEFAULTS_FILE, 'utf8'));
      }
    } catch (_) {}
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true, defaults, isOwnerEnv: fs.existsSync('/home/rootless') }));
  }

  if (parsedUrl.pathname === '/api/audio-output-info' && req.method === 'GET') {
    const info = await getSystemAudioOutputInfo();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(info));
  }

  if (parsedUrl.pathname === '/api/state' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { if (res.writableEnded) return; body += chunk; if (body.length > MAX_BODY_BYTES) { body = ''; req.removeAllListeners('data'); req.removeAllListeners('end'); res.writeHead(413, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: false, error: 'payload too large' })); req.resume(); } });
    req.on('end', () => {
      try {
        const state = JSON.parse(body);
        const previousTrackId = currentAppState?.trackId;
        currentAppState = state;
        if (state?.trackId !== previousTrackId) audioCache.currentTrackChanged();
        broadcastSSE(state);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(400); res.end();
      }
    });
    return;
  }

  if (parsedUrl.pathname === '/api/playlist-preview') {
    try {
      const result = await playlistImport.readPlaylist(parsedUrl.query.url);
      res.writeHead(200, {'Content-Type':'application/json'});
      return res.end(JSON.stringify({success:true,...result}));
    } catch (error) {
      res.writeHead(502, {'Content-Type':'application/json'});
      return res.end(JSON.stringify({success:false,error:error.message}));
    }
  }

  if (parsedUrl.pathname === '/api/spotify-preview' || parsedUrl.pathname === '/api/spotify-match') {
    try {
      const q=parsedUrl.query;
      const result=parsedUrl.pathname === '/api/spotify-preview' ? await spotifyImport.readPlaylist(q.url) : {match:spotifyImport.chooseMatch({title:q.title,artist:q.artist,duration:Number(q.duration)||0},await catalog.search(String(q.artist||'').slice(0,300)+' '+String(q.title||'').slice(0,300),'songs','relevance'))};
      res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify({success:true,...result}));
    } catch(error) {res.writeHead(502,{'Content-Type':'application/json'});return res.end(JSON.stringify({success:false,error:error.message}));}
  }
  if (parsedUrl.pathname === '/api/panel-lyrics') {
    const { title, artist, duration, id, timed } = parsedUrl.query;
    const seconds = Number(duration) || 0;
    const result = timed === '1'
      ? await panelLyrics.getTimed(title, artist, seconds)
      : await panelLyrics.get(title, artist, seconds, id);
    res.writeHead(200,{'Content-Type':'application/json'});
    return res.end(JSON.stringify({success:true,lyrics:result}));
  }
  if (pathname === '/api/wave' && req.method === 'GET') {
    try {
      const tracks = await catalog.wave(parsedUrl.query.id);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ tracks }));
    } catch (_) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ tracks: [] }));
    }
  }

  if (parsedUrl.pathname === '/api/catalog') {
    try {
      const type = parsedUrl.query.type;
      if (!['artists','albums'].includes(type)) throw new Error('Invalid category');
      const forWave = parsedUrl.query.wave === '1';
      const page = await catalog.browse(parsedUrl.query.id, type, forWave ? 3500 : undefined, undefined, forWave);
      res.writeHead(200, { 'Content-Type':'application/json' });
      return res.end(JSON.stringify({success:true,...page}));
    } catch(error) {
      res.writeHead(502, { 'Content-Type':'application/json' });
      return res.end(JSON.stringify({success:false,error:'Could not open this page. Try again.'}));
    }
  }

  if (parsedUrl.pathname === '/api/search') {
    const q = parsedUrl.query.q || '';
    const platform = parsedUrl.query.platform || 'ytmusic';
    const limit = parseInt(parsedUrl.query.limit || '12', 10);
    const offset = parseInt(parsedUrl.query.offset || '0', 10);
    return handleSearch(req, res, q, platform, limit, offset, parsedUrl.query.type || 'songs', parsedUrl.query.sort || 'popular');
  }

  if (parsedUrl.pathname === '/api/net-check') {
    const online = await checkNetConnectivity();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ online: Boolean(online) }));
  }

  if (parsedUrl.pathname === '/api/check-cache') {
    const trackId = parsedUrl.query.id || '';
    const cleanId = cleanTrackId(trackId);
    const cachedFile = await findCachedFile(cleanId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      cached: !!cachedFile,
      streamUrl: cachedFile ? `http://127.0.0.1:${ACTIVE_PORT}/api/local-track?id=${encodeURIComponent(cleanId)}` : null
    }));
  }

  if (parsedUrl.pathname === '/api/tools-status' || parsedUrl.pathname === '/api/tools/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(require('./tools').toolsStatus()));
  }

  if (parsedUrl.pathname === '/api/tools-install' || parsedUrl.pathname === '/api/tools/install') {
    require('./tools').ensureTools().catch(() => {});
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ started: true }));
  }

  if (parsedUrl.pathname === '/api/stream-info') {
    const { id, title = '', artist = '', duration = 0, thumbnail = '', quality, download, resolve } = parsedUrl.query;
    return handleStreamInfo(req, res, id, title, artist, duration, thumbnail, audioMode(quality), download === '1', resolve === '1');
  }

  if (parsedUrl.pathname === '/api/local-track') {
    const trackId = parsedUrl.query.id || '';
    const quality = parsedUrl.query.quality ? audioMode(parsedUrl.query.quality) : '';
    return handleLocalTrack(req, res, trackId, quality);
  }

  if (parsedUrl.pathname === '/api/image-proxy') {
    const target = parsedUrl.query.url || '';
    if (!/^https?:\/\//i.test(target)) {
      res.writeHead(400);
      return res.end();
    }
    const key = crypto.createHash('sha1').update(target).digest('hex');
    const cachePath = path.join(THUMBNAILS_DIR, `proxy-${key}.img`);
    let buffer = null;
    try {
      if (fs.existsSync(cachePath)) buffer = await fs.promises.readFile(cachePath);
    } catch (e) {}
    let host = '';
    try { host = new URL(target).hostname; } catch (e) {}
    const hostDead = !!host && (thumbHostFails.get(host) || 0) > Date.now();
    if (!buffer && !hostDead) {
      try {
        const r = await fetch(target, {
          signal: AbortSignal.timeout(6000),
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36' }
        });
        if (!r.ok) throw new Error(String(r.status));
        const data = Buffer.from(await r.arrayBuffer());
        if (data.length < 500) throw new Error('empty image');
        buffer = data;
        fs.promises.writeFile(cachePath, data).catch(() => {});
      } catch (e) {
        if (host) thumbHostFails.set(host, Date.now() + 600000);
      }
    }
    if (!buffer && parsedUrl.query.artist && parsedUrl.query.title) {
      const alt = await lookupCoverArt(parsedUrl.query.artist, parsedUrl.query.title);
      if (alt) {
        try { buffer = await fs.promises.readFile(alt); } catch (e) {}
      }
    }
    if (!buffer) {
      res.writeHead(302, { Location: target });
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': imageContentType(buffer), 'Cache-Control': 'public, max-age=31536000' });
    return res.end(buffer);
  }

  if (parsedUrl.pathname === '/api/local-thumbnail') {
    const trackId = parsedUrl.query.id || '';
    const cleanId = cleanTrackId(trackId);
    const thumbPath = path.join(THUMBNAILS_DIR, `${cleanId}.jpg`);
    if (fs.existsSync(thumbPath)) {
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=31536000' });
      return streamFileToResponse(fs.createReadStream(thumbPath), res);
    }
    res.writeHead(404);
    return res.end('Thumbnail not cached');
  }

  if (parsedUrl.pathname === '/api/track-analysis') {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { if (res.writableEnded) return; body += chunk; if (body.length > MAX_BODY_BYTES) { body = ''; req.removeAllListeners('data'); req.removeAllListeners('end'); res.writeHead(413, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: false, error: 'payload too large' })); req.resume(); } });
      req.on('end', () => {
        try {
          const payload = JSON.parse(body || '{}');
          const cleanId = cleanTrackId(payload.id || '');
          if (cleanId && payload.analysis) {
            saveTrackMetadata(cleanId, { analysis: payload.analysis });
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }
    const cleanId = cleanTrackId(parsedUrl.query.id || '');
    const meta = trackMetadataIndex[cleanId] || {};
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true, analysis: meta.analysis || null }));
  }

  res.writeHead(404);
  res.end('Not found');
}

function startServer(port = PORT) {
  getYtVisitorData().then(primeDirectAudio).catch(() => {});
  if (server.listening) {
    const address = server.address();
    return Promise.resolve(address && typeof address === 'object' ? address.port : port);
  }
  return new Promise((resolve, reject) => {
    server.listen(port, '127.0.0.1', () => {
      const p = server.address().port;
      ACTIVE_PORT = p;
      try { logger.log('info', `server.js build fix9 listening on ${p} (ACTIVE_PORT)`); } catch (_) {}
      console.log(`devsize internal server running on http://127.0.0.1:${p}`);
      require('./tools').updateYtDlpIfManaged().catch(() => {});
      resolve(p);
    }).on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        server.listen(0, '127.0.0.1', () => {
          const p = server.address().port;
          ACTIVE_PORT = p;
          try { logger.log('warn', `server.js build fix9: port ${PORT} busy, fallback to ${p}`); } catch (_) {}
          console.log(`devsize internal server running on fallback port http://127.0.0.1:${p}`);
          require('./tools').updateYtDlpIfManaged().catch(() => {});
          resolve(p);
        });
      } else {
        reject(err);
      }
    });
  });
}

function stopServer() {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

module.exports = { startServer, stopServer, PORT, getServerToken };

if (require.main === module) {
  startServer();
}
