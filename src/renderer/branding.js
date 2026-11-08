/* HeadRoom assets follow the effective UI theme; custom user images are preserved. */
(function () {
  'use strict';
  const base = '../../assets/headroom-brand/';
  const theme = () => document.body.dataset.theme === 'light' ? 'light' : 'dark';
  const icon = () => `${base}${theme()}/icon-512.png`;
  const isBrandAsset = src => !src || /(?:headroom-brand\/|assets\/icon\.png|assets\/\d\d-[\w-]+\.svg)/.test(src);
  function refresh() {
    for (const image of document.querySelectorAll('[data-headroom-icon]')) {
      if (isBrandAsset(image.getAttribute('src'))) image.src = icon();
    }
    for (const image of document.querySelectorAll('[data-headroom-mark]')) image.src = `${base}${theme()}/mark.svg`;
  }
  window.HeadRoomBrand = { icon, refresh };
  new MutationObserver(refresh).observe(document.body, { attributes: true, attributeFilter: ['data-theme'] });
  refresh();
})();
