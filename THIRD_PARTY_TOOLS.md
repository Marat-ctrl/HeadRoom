# HeadRoom bundled tools

HeadRoom is based on Riff by rootscripts, under the original MIT license in LICENSE.
The following independent command-line programs are bundled and invoked as separate processes.
They retain their own licenses; HeadRoom's MIT license does not replace them.

## yt-dlp

Project and releases: https://github.com/yt-dlp/yt-dlp
Source and third-party license notices: https://github.com/yt-dlp/yt-dlp#license
Release version is recorded in bin/versions.json inside application resources.
Bundled executable distributions contain third-party components; consult the project's
THIRD_PARTY_LICENSES.txt file and release source for those terms.

## FFmpeg and FFprobe

Project and source: https://ffmpeg.org/ and https://github.com/FFmpeg/FFmpeg
Binary build provider: https://github.com/jellyfin/jellyfin-ffmpeg
Provider build scripts and exact patched source: https://github.com/jellyfin/jellyfin-ffmpeg/tree/v8.1.3-2
FFmpeg upstream source: https://github.com/FFmpeg/FFmpeg/tree/n8.1.3
Build version is recorded in bin/versions.json inside application resources.
The provider's platform-specific FFmpeg-LICENSE.txt and FFmpeg-README.txt are included
alongside the executables. These binaries may include GPL components; applicable
GPL and LGPL license texts are supplied alongside them.
FFmpeg includes software developed by the FFmpeg contributors and the Independent JPEG Group.

## Updates

At startup HeadRoom checks the two providers above at most once per 24 hours.
Updates are downloaded to the user's HeadRoom data directory, checked against GitHub's
published SHA-256 asset digest, and tested before activation. Bundled binaries remain
unchanged, so a failed download or validation does not remove the working fallback.
No HeadRoom application update is obtained from the upstream Riff repository.
