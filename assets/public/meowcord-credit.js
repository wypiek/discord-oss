(() => {
  const credit = document.getElementById("meowcord-credit");
  if (!credit) return;
  const style = document.createElement("style");
  style.textContent = `
        #meowcord-credit:not([hidden]) { position: fixed; inset: auto 0 0; z-index: 100; padding: 8px 16px calc(8px + env(safe-area-inset-bottom)); color: #f2f2f5; text-align: center; font: 14px/24px system-ui, sans-serif; }
        #meowcord-credit a { color: white; font-weight: 500; text-underline-offset: 3px; display: inline-block; min-height: 24px; text-decoration: underline; }
        #meowcord-credit a:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }
        html[data-meowcord-credit] #app-mount { height: calc(100% - 40px - env(safe-area-inset-bottom)); }
    `;
  document.head.append(style);
  const update = () => {
    const visible = location.pathname === "/" || /^\/login\/?$/.test(location.pathname);
    credit.hidden = !visible;
    document.documentElement.toggleAttribute("data-meowcord-credit", visible);
  };
  for (const name of ["pushState", "replaceState"]) {
    const original = history[name];
    history[name] = function (...args) {
      const result = original.apply(this, args);
      update();
      return result;
    };
  }
  addEventListener("popstate", update);
  update();
})();
