// Applies the persisted/OS theme before first paint (FR-8.3) — no flash of the wrong theme.
// A same-origin file rather than an inline <script>, so the Content-Security-Policy can stay
// `script-src 'self'` with no 'unsafe-inline' (SEC-6). Loaded synchronously from <head>.
(function () {
  try {
    var stored = localStorage.getItem('topicmatrix.theme');
    var theme = stored === 'light' || stored === 'dark' ? stored : 'system';
    var resolved =
      theme === 'system'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : theme;
    if (resolved === 'dark') document.documentElement.classList.add('dark');
  } catch {
    /* localStorage unavailable (e.g. privacy mode) — default light theme is fine. */
  }
})();
