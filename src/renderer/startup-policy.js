(function (root) {
 'use strict';
 function apply(storage) {
  storage.setItem('riff_theme_mode','dark');
  storage.setItem('riff_platform','ytmusic');
  storage.setItem('riff_home_next_to_search','0');
  storage.setItem('riff_sidebar_width','84');
  storage.setItem('riff_sidebar_expanded','0');
  storage.setItem('riff_autoplay','0');
  storage.setItem('riff_persist_sound_settings','0');
  storage.setItem('riff_custom_css','');
  storage.setItem('riff_show_local','false');
  storage.setItem('riff_show_local', 'false');
  storage.setItem('riff_perf_mode', '1');
  storage.setItem('riff_no_hand_cursor', '0');
  storage.setItem('riff_custom_bg_enabled', '0');
  storage.removeItem('riff_bg_url');
  storage.removeItem('riff_welcome_bg');
 }
 const api = { apply };
 if (typeof module === 'object' && module.exports) module.exports = api;
 else root.HeadRoomPolicy = api;
})(typeof window === 'object' ? window : globalThis);
