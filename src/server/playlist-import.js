'use strict';

const spotify = require('./spotify-import');

const MAX_TRACKS = 500;
const YANDEX_HOSTS = new Set(['music.yandex.ru', 'music.yandex.com', 'music.yandex.kz', 'music.yandex.by', 'music.yandex.uz']);
const VK_HOSTS = new Set(['vk.com', 'vk.ru', 'm.vk.com', 'm.vk.ru', 'www.vk.com', 'www.vk.ru']);
const YANDEX_UUID = /^(?:[a-z]{2}\.)?[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const VK_PLAYLIST = /^(-?\d{1,15})_(\d{1,15})(?:_([a-z0-9]{6,64}))?$/i;
const INVALID_LINK = 'Enter a public Spotify, Yandex Music or VK Music playlist link.';

function sourceFor(input) {
  const value = String(input || '').trim();
  if (value.startsWith('spotify:playlist:')) return { provider: 'Spotify' };
  const url = URL.parse(value);
  if (!url || url.protocol !== 'https:' || url.username || url.password || url.port) throw Error(INVALID_LINK);
  if (url.hostname === 'open.spotify.com') return { provider: 'Spotify' };
  if (YANDEX_HOSTS.has(url.hostname)) {
    const user = url.pathname.match(/^\/users\/([a-z0-9._-]{1,64})\/playlists\/([^/]+)\/?$/i);
    const id = user?.[2] || url.pathname.match(/^\/playlists\/([^/]+)\/?$/i)?.[1];
    if (YANDEX_UUID.test(id || '')) {
      return { provider: 'Yandex Music', endpoint: 'https://api.music.yandex.net/playlist/' + id };
    }
    if (user && /^\d{1,15}$/.test(id)) {
      return { provider: 'Yandex Music', endpoint: 'https://api.music.yandex.net/users/' + user[1] + '/playlists/' + id };
    }
  }
  if (VK_HOSTS.has(url.hostname)) {
    const path = url.pathname.match(/^\/(?:music\/playlist\/|audio_playlist)([^/]+)\/?$/i)?.[1];
    const legacy = url.pathname === '/audio' ? (url.searchParams.get('z') || url.searchParams.get('act'))?.match(/^audio_playlist(.+?)(?:\/|$)/i)?.[1] : null;
    const playlist = (path || legacy || '').match(VK_PLAYLIST);
    if (playlist) {
      const [, oid, pid, hash = ''] = playlist;
      const params = new URLSearchParams({ oid, pid, hash });
      return { provider: 'VK Music', endpoint: 'https://vk.com/widget_playlist.php?' + params };
    }
  }
  throw Error(INVALID_LINK);
}

function durationSeconds(value, scale = 1) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number / scale) : 0;
}

function preview(provider, name, tracks, total) {
  const available = tracks.filter(track => track.title && track.artist).slice(0, MAX_TRACKS);
  if (!available.length) throw Error(`${provider} did not expose any songs. Check that the playlist is public.`);
  const count = Number(total);
  const knownTotal = Number.isSafeInteger(count) && count >= available.length ? count : null;
  return {
    name: String(name || `${provider} playlist`).trim(),
    tracks: available,
    limited: knownTotal === null || knownTotal > available.length,
    total: knownTotal
  };
}

function parseYandexPlaylist(data) {
  const playlist = data?.result;
  if (!playlist || playlist.available === false || playlist.visibility === 'private' || !Array.isArray(playlist.tracks)) {
    throw Error('Yandex Music could not open this playlist. Check that it is public.');
  }
  const tracks = playlist.tracks.slice(0, MAX_TRACKS).map(entry => {
    const track = entry?.track;
    return {
      title: [track?.title, track?.version && `(${track.version})`].filter(Boolean).join(' ').trim(),
      artist: (Array.isArray(track?.artists) ? track.artists : []).map(artist => artist?.name).filter(Boolean).join(', ').trim(),
      duration: durationSeconds(track?.durationMs, 1000)
    };
  });
  return preview('Yandex Music', playlist.title, tracks, playlist.trackCount ?? playlist.tracks.length);
}

function decodeEntities(value) {
  const named = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, key) => {
    if (key[0] !== '#') return named[key.toLowerCase()] ?? entity;
    const hex = key[1].toLowerCase() === 'x';
    const number = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10);
    return number <= 0x10ffff ? String.fromCodePoint(number) : entity;
  });
}

function parseVkPlaylist(html) {
  const snippet = html.match(/<div\b[^>]*\bclass=(["'])[^"']*\baudio_pl_snippet_embed\b[^"']*\1[^>]*>/i)?.[0] || '';
  if (!snippet) throw Error('VK Music could not open this playlist. Check that it is public.');
  const name = decodeEntities(snippet.match(/\bdata-title=(["'])([\s\S]*?)\1/i)?.[2] || '');
  const tracks = [];
  for (const [, , raw] of html.matchAll(/\bdata-audio=(["'])([\s\S]*?)\1/gi)) {
    let entry;
    try { entry = JSON.parse(decodeEntities(raw)); } catch (_) { continue; }
    if (!Array.isArray(entry) || typeof entry[3] !== 'string' || typeof entry[4] !== 'string') continue;
    tracks.push({ title: decodeEntities(entry[3]).trim(), artist: decodeEntities(entry[4]).trim(), duration: durationSeconds(entry[5]) });
    if (tracks.length >= MAX_TRACKS) break;
  }
  const count = html.match(/\bclass=["']audio_pl_snippet__stats["'][^>]*>([\s\S]*?)<\/div>/i)?.[1];
  return preview('VK Music', name, tracks, count ? decodeEntities(count.replace(/<[^>]*>/g, '')).match(/^\s*([\d\s,.]+)/)?.[1].replace(/\D/g, '') : null);
}

async function readPlaylist(input, fetcher = fetch) {
  const source = sourceFor(input);
  if (source.provider === 'Spotify') {
    return { ...(await spotify.readPlaylist(input, fetcher)), provider: source.provider };
  }
  const response = await fetcher(source.endpoint, {
    signal: AbortSignal.timeout(12000),
    redirect: 'error',
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'en-US,en;q=0.9' }
  });
  if (!response.ok) throw Error(`${source.provider} did not open this playlist (${response.status}). Check that it is public.`);
  if (source.provider === 'Yandex Music') return { ...parseYandexPlaylist(await response.json()), provider: source.provider };
  const type = response.headers.get('content-type') || '';
  const charset = /charset\s*=\s*(?:windows-1251|cp1251)/i.test(type) ? 'windows-1251' : 'utf-8';
  const html = new TextDecoder(charset).decode(await response.arrayBuffer());
  return { ...parseVkPlaylist(html), provider: source.provider };
}

module.exports = { readPlaylist, sourceFor, parseYandexPlaylist, parseVkPlaylist };
