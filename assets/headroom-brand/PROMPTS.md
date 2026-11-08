# Image generation prompt set

Tool: built-in image_gen. Date: 2026-11-06.
One identity, exactly two themes. Original accepted outputs are in sources/.

## Shared direction

Use case: logo-brand. HeadRoom is a minimalist desktop music player. A single
geometric capital H, two thick upright pillars with softly rounded ends joined
by a gently arched central bridge, subtly recalling a headphone headband.
Quiet, precise, monochrome identity; legible at small sizes. No flower or gear
motifs from Riff, no extra letters, no 3D, no mockups, no decorative waveforms.

## Dark app icon

Create the single primary HeadRoom app icon for its dark theme. Square
1024x1024 composition: flat deep charcoal rounded-square tile, straight-on,
clean transparent exterior corners. Center one ivory-white H monogram occupying
about 55 percent of the tile width and height. No text, gradients, glow,
metallic texture, shadow, multiple variants or presentation board.

## Light app icon

Use the dark icon as edit target. Preserve the H geometry, position, scale,
arched crossbar and rounded ends. Light mode: uniform opaque ivory #F4F4F1
background and charcoal #191919 H. No transparent holes, shading, grain,
gradients or additional elements. The first transparent light attempt was
rejected; sources/icon-light.png is the accepted opaque revision.

## Dark README banner

Use the dark icon only as identity reference. Wide horizontal banner, target
aspect ratio 1644:469. Uniform charcoal #151515 background. White H symbol left
of the exact word "HeadRoom" in large modern sans-serif lettering, arranged
as one centered horizontal lockup with generous negative space. One H, one
word. Keep elements inside the central 75 percent of width and 60 percent of
height. No slogans, feature claims, badges, screenshots, photographs, mockups,
gradients, shadows, borders or other words.

## Light README banner

Edit the dark banner, preserving composition, H geometry, exact "HeadRoom"
text, size, spacing and margins. Change background to opaque #F4F4F1 and
H/text to solid #191919. No shadows, transparency, texture or extra objects.

## Dark playlist import illustration

Wide horizontal composition about 2.46:1, final target 345x140px. Charcoal
background. Spotify green circle with three dark curved lines at left, a
small white right arrow in the middle, the same white HeadRoom H without a
tile on the right. Generous space and equal optical scale. No text,
gradients, shadows, decoration, extra logos, screenshots or mockups.

## Light playlist import illustration

Edit the dark import illustration. Preserve composition, aspect ratio,
Spotify green circle, arrow position and HeadRoom H. Change background to
opaque #F4F4F1 and arrow/H to #191919. No text, texture, shadow or transparency.

## Export notes

The standalone transparent raster logo attempt was rejected because of noisy
alpha edges. mark.svg is a clean manual vector adaptation of the generated
monogram; PNG mark and tray exports were rendered from that SVG with AppKit.
Sized icon/banner/import PNGs were exported with sips. Banner exports crop
blank vertical margins before resizing to the measured original dimensions.
No existing application assets or source references have been replaced yet.
