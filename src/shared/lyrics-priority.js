'use strict';
// Never estimate timing: replace wording only when the entire sung sequence matches.
function preferGenius(genius, existing) {
 if (!genius || !genius.trim()) return existing;
 if (!/\[\d{2}:\d{2}/.test(existing || '')) return genius;
 if (/<\d{2}:\d{2}/.test(existing)) return existing;
 const normalize = s => s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
 const words = genius.split(/\r?\n/).map(s => s.trim()).filter(s => s && !/^\[.*\]$/.test(s));
 const lines = existing.split(/\r?\n/);
 const pattern = /^((?:\[\d{2}:\d{2}(?:[.:]\d+)?\])+)(.*)$/;
 const sung = lines.map(s => s.match(pattern)).filter(m => m && normalize(m[2]));
 if (sung.length !== words.length || sung.some((m, i) => normalize(m[2]) !== normalize(words[i]))) return existing;
 let index = 0;
 return lines.map(line => {
  const match = line.match(pattern);
  return match && normalize(match[2]) ? match[1] + words[index++] : line;
 }).join('\n');
}
function boundedLyrics(fetcher, milliseconds = 3000) {
 return new Promise(resolve => {
  const timer = setTimeout(() => resolve(''), milliseconds);
  Promise.resolve().then(fetcher).then(value => { clearTimeout(timer); resolve(value || ''); }, () => { clearTimeout(timer); resolve(''); });
 });
}
module.exports = { preferGenius, boundedLyrics };
