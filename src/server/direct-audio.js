'use strict';

// Match yt-dlp's visionOS client. Use only audio URLs supplied directly by the player.
const userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';
const client = {
  clientName: 'VISIONOS', clientVersion: '1.02', deviceMake: 'Apple',
  deviceModel: 'RealityDevice17,1', osName: 'visionOS', osVersion: '26.5.23O471',
  userAgent, hl: 'en', gl: 'US'
};
let guestContext;

function validGuestContext(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_%=.\-]{1,512}$/.test(value);
}

function primeDirectAudio(visitorData) {
  if (!guestContext && validGuestContext(visitorData)) guestContext = visitorData;
}

async function requestPlayer(videoId, visitorData, signal, fetcher) {
  const headers = {
    'content-type': 'application/json', 'user-agent': userAgent,
    'x-youtube-client-name': '101', 'x-youtube-client-version': client.clientVersion
  };
  if (visitorData) headers['x-goog-visitor-id'] = visitorData;
  const response = await fetcher('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
    method: 'POST',
    headers,
    body: JSON.stringify({ context: { client: { ...client, visitorData } }, videoId }),
    signal
  });
  return response.ok ? response.json() : null;
}

function audioFormats(data, videoId) {
  if (data?.videoDetails?.videoId !== videoId || data.playabilityStatus?.status !== 'OK') return null;
  const candidates = [];
  for (const format of data.streamingData?.adaptiveFormats || []) {
    const bitrate = Number(format.averageBitrate || format.bitrate);
    if (!/^audio\/(?:webm|mp4)(?:;|$)/.test(format.mimeType) || !format.url ||
        !Number.isFinite(bitrate) || bitrate <= 0 || format.isDrc ||
        format.audioTrack?.audioIsDefault === false) continue;
    const url = URL.parse(format.url);
    if (url?.protocol === 'https:' && url.hostname.endsWith('.googlevideo.com')) {
      candidates.push({ url: url.href, bitrate, mimeType: format.mimeType.split(';')[0] });
    }
  }
  candidates.sort((a, b) => b.bitrate - a.bitrate);
  const plus = candidates[0];
  if (!plus) return null;
  const standard = candidates.find(format => format.bitrate <= 80000)
    || candidates.find(format => format.bitrate <= 128000) || plus;
  const result = { standard: standard.url, plus: plus.url };
  const standardAlternate = candidates.find(format => format.mimeType !== standard.mimeType &&
    format.bitrate <= 80000 && format.bitrate >= standard.bitrate * 0.75);
  if (standardAlternate) result.standardAlternate = standardAlternate.url;
  const alternate = candidates.find(format => format.mimeType !== plus.mimeType && format.bitrate >= plus.bitrate * 0.9);
  if (alternate) result.plusAlternate = alternate.url;
  return result;
}

function playerResult(data, videoId) {
  if (data?.videoDetails?.videoId === videoId &&
      ['LOGIN_REQUIRED', 'AGE_CHECK_REQUIRED', 'AGE_VERIFICATION_REQUIRED'].includes(data.playabilityStatus?.status) &&
      (/confirm your age|age.restricted|age verification/i.test(data.playabilityStatus.reason || '') ||
       data.playabilityStatus.status !== 'LOGIN_REQUIRED')) {
    return { restricted: 'age' };
  }
  return audioFormats(data, videoId);
}

async function resolveDirectAudio(videoId, fetcher = fetch) {
  const signal = AbortSignal.timeout(2100);
  const previous = guestContext;
  let data = await requestPlayer(videoId, previous, signal, fetcher);
  const visitor = data?.responseContext?.visitorData;
  const newContext = validGuestContext(visitor);
  if (newContext) guestContext = visitor;
  const formats = playerResult(data, videoId);
  if (formats || !newContext || visitor === previous ||
      (data?.videoDetails?.videoId && data.videoDetails.videoId !== videoId)) return formats;
  data = await requestPlayer(videoId, visitor, signal, fetcher);
  return playerResult(data, videoId);
}

module.exports = { primeDirectAudio, resolveDirectAudio };
