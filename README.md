# HeadRoom

HeadRoom is a music player for Mac with Apple Silicon. The current release is a public beta.

## Download

Download the macOS ARM64 ZIP from [GitHub Releases](https://github.com/Marat-ctrl/HeadRoom/releases). Unzip it and move **HeadRoom.app** to **Applications**.

This beta uses an ad-hoc signature and is not notarized. If macOS blocks it on first launch, try opening it once, then go to **System Settings → Privacy & Security → Open Anyway**.

## Features

- Live search across songs, albums and artists, with separate tabs and popularity sorting where data is available.
- Liked songs, saved albums and artists, playlists, a queue and My Wave recommendations.
- Standard and Plus audio modes, crossfade and audio effects.
- Lyrics in the side panel and the expanded player. Synchronized lyrics are shown when matching timestamps are available.
- Playlist import from public Spotify, Yandex Music and VK Music links where track data is available.

Playback and import availability depend on the source services. Report beta issues on [GitHub Issues](https://github.com/Marat-ctrl/HeadRoom/issues).

## Development

On macOS with Apple Silicon, run `npm ci`, `npm run tools:prepare`, then `npm start`. Run `npm test` for the test suite. Run `npm run preview:mac` to build the ARM64 app in `dist/mac-arm64`.

## Credits and licensing

HeadRoom is based on [Riff](https://github.com/rootscripts/riff) by **rootscripts (rootless)**. It reuses parts of Riff's Electron player, playback code and interface, with changes for HeadRoom. The original code and HeadRoom's modifications are distributed under the [MIT License](LICENSE), which preserves the upstream copyright notice.

Bundled tools keep their own licenses. See [Third-party tools and corresponding source](THIRD_PARTY_TOOLS.md).
