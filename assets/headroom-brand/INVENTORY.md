# HeadRoom brand resource inventory

Inspected 38 canonical image files in the source project. Generated app copies and dependencies are excluded.

| Source | Dimensions | Role | Treatment |
|---|---|---|---|
| assets/01-default.svg | 512×512 | Legacy customization icon | Do not recreate; retire with customization later |
| assets/02-editor.svg | 512×512 | Legacy customization icon | Do not recreate; retire with customization later |
| assets/03-orbit.svg | 512×512 | Legacy customization icon | Do not recreate; retire with customization later |
| assets/04-vinyl.svg | 512×512 | Legacy customization icon | Do not recreate; retire with customization later |
| assets/05-hyperspace.svg | 512×512 | Legacy customization icon | Do not recreate; retire with customization later |
| assets/06-cosmos.svg | 512×512 | Legacy customization icon | Do not recreate; retire with customization later |
| assets/07-aurora.svg | 512×512 | Legacy customization icon | Do not recreate; retire with customization later |
| assets/08-sunset.svg | 512×512 | Legacy customization icon | Do not recreate; retire with customization later |
| assets/09-amethyst.svg | 512×512 | Legacy customization icon | Do not recreate; retire with customization later |
| assets/10-y2k-disc.svg | 512×512 | Legacy customization icon | Do not recreate; retire with customization later |
| assets/11-cassette.svg | 512×512 | Legacy customization icon | Do not recreate; retire with customization later |
| assets/12-invincible.svg | 512×512 | Legacy customization icon | Do not recreate; retire with customization later |
| assets/13-blueprint.svg | 512×512 | Legacy customization icon | Do not recreate; retire with customization later |
| assets/14-galaxy.svg | 512×512 | Legacy customization icon | Do not recreate; retire with customization later |
| assets/15-opal.svg | 512×512 | Legacy customization icon | Do not recreate; retire with customization later |
| assets/16-chrome.svg | 512×512 | Legacy customization icon | Do not recreate; retire with customization later |
| assets/17-eclipse.svg | 512×512 | Legacy customization icon | Do not recreate; retire with customization later |
| assets/18-nebula.svg | 512×512 | Legacy customization icon | Do not recreate; retire with customization later |
| assets/19-horizon.svg | 512×512 | Legacy customization icon | Do not recreate; retire with customization later |
| assets/20-halloween.svg | 512×512 | Legacy customization icon | Do not recreate; retire with customization later |
| assets/deezer-icon.png | 414×416 | Third-party Deezer identity | Preserve provider branding |
| assets/devsize/photo_2026-10-24_12-37-42.jpg | 640×640 | Legacy memes / easter egg | Not HeadRoom branding; review with feature cleanup |
| assets/devsize/photo_2026-10-31_18-09-01.jpg | 512×512 | Legacy memes / easter egg | Not HeadRoom branding; review with feature cleanup |
| assets/devsize/photo_2026-10-31_18-09-13.jpg | 512×512 | Legacy memes / easter egg | Not HeadRoom branding; review with feature cleanup |
| assets/devsize/photo_2026-10-31_18-09-22.jpg | 512×512 | Legacy memes / easter egg | Not HeadRoom branding; review with feature cleanup |
| assets/devsize/photo_2026-10-31_18-31-51.jpg | 512×512 | Legacy memes / easter egg | Not HeadRoom branding; review with feature cleanup |
| assets/devsize/photo_2026-10-31_18-32-26.jpg | 512×512 | Legacy memes / easter egg | Not HeadRoom branding; review with feature cleanup |
| assets/devsize/sticker.webp | 512×512 | Legacy memes / easter egg | Not HeadRoom branding; review with feature cleanup |
| assets/icon-1024.png | 1024×1024 | Application and UI icon | Replacement exports in dark/ and light/ |
| assets/icon-512x512.png | 512×512 | Application and UI icon | Replacement exports in dark/ and light/ |
| assets/icon.png | 1546×1546 | Application and UI icon | Replacement exports in dark/ and light/ |
| assets/riff.svg | 578×555 | Monochrome Riff logo / CSS mask | Replacement mark.svg and 578x555 exports |
| assets/spotify-to-riff.png | 345×140 | Legacy Spotify import illustration (no active source reference found) | Replacement 345x140 in both themes |
| assets/trayTemplate.png | 18×18 | Menu bar template | Replacement exports in dark/ and light/; macOS template normally tints automatically |
| assets/trayTemplate@2x.png | 36×36 | Menu bar template | Replacement exports in dark/ and light/; macOS template normally tints automatically |
| banner.png | 1644×469 | README header | Replacement 1644x469 in both themes |
| github/readme/emoj2i.gif | 128×128 | README decorative animation | Use static mark-128.png later, no new animation |
| readmeerror.png | 1024×972 | Legacy macOS error screenshot | Do not fabricate a new system screenshot; retire documentation example later |

## New deliverables

Exactly two themes: dark and light. One HeadRoom identity, no replacement gallery of custom themes.

- Icon exports: 1546, 1024, 512, 256 and 128 px square.
- README banner: 1644×469 px.
- Import illustration: 345×140 px.
- Transparent SVG mark: 512×512 plus 578×555 wrapper.
- Transparent PNG mark: 512, 128 px; 578×555 px.
- Menu bar template: 18×18 and 36×36 px.

Original image_gen outputs are preserved in sources/. Sized PNG exports use sips. The clean SVG is a manual adaptation of the generated monogram, to avoid noisy alpha edges at small sizes.

Approved assets are integrated into the application. UI icons use clean vector-derived exports with transparent exterior corners; the original image_gen masters remain in sources/. Original Riff license/attribution remains intact.
