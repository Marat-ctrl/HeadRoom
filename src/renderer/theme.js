(function (root) {
  'use strict';
  function normalizeMode() { return 'dark'; }
  function resolveMode() { return 'dark'; }
  const api = { normalizeMode, resolveMode };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HeadRoomTheme = api;
})(typeof window === 'object' ? window : globalThis);
