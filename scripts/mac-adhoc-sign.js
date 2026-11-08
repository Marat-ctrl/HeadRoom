// Ad-hoc signs the macOS app after packaging. Releases have no Developer ID
// (`mac.identity: null`), and electron-builder then leaves Electron's
// signature invalid once it rewrites Info.plist, which Apple Silicon reports
// as "Riff is damaged". An ad-hoc signature turns that into the regular
// "unidentified developer" prompt that users can approve.
const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  // A distinct icon resource name prevents Finder reusing Riff's cached icon.icns.
  const resources = path.join(appPath, 'Contents', 'Resources');
  const fs = require('fs');
  const generatedIcon = path.join(resources, 'icon.icns');
  if (fs.existsSync(generatedIcon)) fs.copyFileSync(generatedIcon, path.join(resources, 'HeadRoom.icns'));
  execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Set :CFBundleIconFile HeadRoom.icns', path.join(appPath, 'Contents', 'Info.plist')]);
  // yt-dlp is a signed PyInstaller executable; keep its original signature/payload.
  for (const tool of ['ffmpeg', 'ffprobe']) {
    const bin = path.join(appPath, 'Contents', 'Resources', 'bin', tool);
    if (require('fs').existsSync(bin)) execFileSync('codesign', ['--force', '--sign', '-', bin], { stdio: 'inherit' });
  }
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' });
};
