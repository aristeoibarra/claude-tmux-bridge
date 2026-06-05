// Auto-injects the claude-tmux-bridge widget on every localhost page.
// Install once (unpacked) and the toolbar shows up on all your dev apps.
(function () {
  // Don't inject on the bridge's own setup page.
  if (location.port === "7331") return;
  if (window.__ctbInjected) return;
  window.__ctbInjected = true;

  var s = document.createElement("script");
  s.src = "http://localhost:7331/widget.js?t=" + Date.now();
  s.onerror = function () {
    // Bridge not running — fail silently, don't disturb the page.
  };
  (document.head || document.documentElement).appendChild(s);
})();
