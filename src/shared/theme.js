(function () {
  const media = matchMedia('(prefers-color-scheme: dark)');
  // Dark is the first-run default; explicit light/system choices remain saved.
  let mode = 'dark';
  try { mode = localStorage.getItem('lane-theme') || 'dark'; } catch {}
  function apply(value, persist = true) {
    mode = ['light','dark','system'].includes(value) ? value : 'dark';
    document.documentElement.dataset.theme = mode === 'system' ? media.matches ? 'dark' : 'light' : mode;
    document.documentElement.dataset.themePreference = mode;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content',document.documentElement.dataset.theme==='dark' ? '#101b20' : '#f5f6f2');
    if (persist) try { localStorage.setItem('lane-theme',mode); } catch {}
    window.dispatchEvent(new CustomEvent('lane:theme', { detail: { mode, dark: document.documentElement.dataset.theme === 'dark' } }));
  }
  media.addEventListener('change',()=>apply(mode,false));
  window.LaneTheme = {apply,mode:()=>mode}; apply(mode,false);
})();
