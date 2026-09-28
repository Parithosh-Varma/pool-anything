/* pool-anything tools-site backend shim (Cloudflare Pages static export).
 *
 * The admin UI was built as same-origin fetch('/api/...') calls. When the UI
 * is hosted on Cloudflare Pages it must talk to a backend running elsewhere
 * (localhost, VPS, ...), so this file:
 *   1. resolves an API base URL from ?api= / localStorage ('' = same origin),
 *   2. exposes it as window.__API_BASE__,
 *   3. patches window.fetch so relative /api/* calls (and absolute
 *      same-origin /api/* URLs, e.g. playground snippets) are re-targeted,
 *   4. injects an optional Bearer token (?token= / localStorage) for backends
 *      that set POOL_API_TOKEN,
 *   5. renders a small "Backend" settings widget to view/change the target.
 *
 * No dependencies. Loaded synchronously in <head> before any inline script.
 */
(function () {
  "use strict";

  var LS_BASE = "pa-api-base";
  var LS_TOKEN = "pa-api-token";

  function trimSlash(s) {
    return String(s || "").replace(/\/+$/, "");
  }

  function lsGet(k) {
    try {
      return localStorage.getItem(k) || "";
    } catch (e) {
      return "";
    }
  }

  function lsSet(k, v) {
    try {
      if (v) localStorage.setItem(k, v);
      else localStorage.removeItem(k);
    } catch (e) {}
  }

  // ?api= / ?token= bootstrap (keeps other params like ?pool= intact).
  // SECURITY: ?token= puts the bearer in the URL (Pages access logs, browser
  // history, referers) before it is stripped below. Prefer the Backend pill
  // for real tokens; use ?token= only for throwaway dev tokens.
  try {
    var qs = new URLSearchParams(location.search);
    var changed = false;
    if (qs.has("api")) {
      lsSet(LS_BASE, trimSlash(qs.get("api") || ""));
      qs.delete("api");
      changed = true;
    }
    if (qs.has("token")) {
      lsSet(LS_TOKEN, (qs.get("token") || "").trim());
      qs.delete("token");
      changed = true;
    }
    if (changed) {
      var rest = qs.toString();
      history.replaceState(null, "", location.pathname + (rest ? "?" + rest : "") + location.hash);
    }
  } catch (e) {}

  function apiBase() {
    return trimSlash(lsGet(LS_BASE));
  }

  function apiToken() {
    try {
      return (lsGet(LS_TOKEN) || "").trim();
    } catch (e) {
      return "";
    }
  }

  try {
    Object.defineProperty(window, "__API_BASE__", { get: apiBase, configurable: true });
  } catch (e) {
    window.__API_BASE__ = apiBase();
  }

  function rewriteUrl(u) {
    var base = apiBase();
    if (!base || typeof u !== "string") return u;
    if (u.indexOf("/api/") === 0) return base + u;
    try {
      var parsed = new URL(u, location.origin);
      if (parsed.origin === location.origin && parsed.pathname.indexOf("/api/") === 0) {
        return base + parsed.pathname + parsed.search + parsed.hash;
      }
    } catch (e) {}
    return u;
  }

  function isApiUrl(u) {
    if (typeof u !== "string") return false;
    if (u.indexOf("/api/") === 0) return true;
    var base = apiBase();
    if (base && u.indexOf(base + "/api/") === 0) return true;
    return false;
  }

  function withAuthHeader(init) {
    var tok = apiToken();
    if (!tok) return init;
    init = init || {};
    var headers = init.headers;
    if (!headers) {
      init.headers = { authorization: "Bearer " + tok };
    } else if (typeof Headers !== "undefined" && headers instanceof Headers) {
      if (!headers.has("authorization")) headers.set("authorization", "Bearer " + tok);
    } else if (Array.isArray(headers)) {
      var found = headers.some(function (h) {
        return String(h[0]).toLowerCase() === "authorization";
      });
      if (!found) headers.push(["authorization", "Bearer " + tok]);
    } else {
      var has = Object.keys(headers).some(function (k) {
        return k.toLowerCase() === "authorization";
      });
      if (!has) headers.authorization = "Bearer " + tok;
    }
    return init;
  }

  if (typeof window.fetch === "function" && !window.fetch.__paPatched) {
    var origFetch = window.fetch.bind(window);
    var patched = function (input, init) {
      if (typeof input === "string") {
        var nu = rewriteUrl(input);
        if (isApiUrl(nu)) init = withAuthHeader(init);
        return origFetch(nu, init);
      }
      if (input && typeof input.url === "string") {
        var rewritten = rewriteUrl(input.url);
        if (rewritten !== input.url) input = new Request(rewritten, input);
        if (isApiUrl(typeof input === "string" ? input : input.url)) init = withAuthHeader(init);
        return origFetch(input, init);
      }
      return origFetch(input, init);
    };
    patched.__paPatched = true;
    window.fetch = patched;
  }

  window.PA = {
    base: apiBase,
    token: apiToken,
    setBase: function (v) {
      lsSet(LS_BASE, trimSlash(String(v || "").trim()));
    },
    setToken: function (v) {
      lsSet(LS_TOKEN, String(v || "").trim());
    },
    test: function () {
      var b = apiBase();
      return fetch(b + "/health").then(function (r) {
        return r.text().then(function (t) {
          return { ok: r.ok, status: r.status, body: t };
        });
      });
    },
  };

  // Floating settings widget (injected at end of body).
  function mountWidget() {
    if (document.getElementById("pa-backend-btn")) return;
    var css =
      "#pa-backend-btn{position:fixed;left:12px;bottom:12px;z-index:9999;border:1px solid #E8E3D9;background:#fff;border-radius:999px;padding:7px 12px;font:500 12px/1.4 ui-sans-serif,system-ui,sans-serif;color:#1B1917;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.08)}" +
      "#pa-backend-btn .dot{display:inline-block;width:8px;height:8px;border-radius:99px;background:#8A8680;margin-right:7px;vertical-align:1px}" +
      "#pa-backend-btn.ok .dot{background:#1E6B32}#pa-backend-btn.err .dot{background:#B3261E}" +
      "#pa-panel{position:fixed;left:12px;bottom:48px;z-index:9999;width:300px;background:#fff;border:1px solid #E8E3D9;border-radius:12px;padding:14px;font:400 13px/1.5 ui-sans-serif,system-ui,sans-serif;color:#1B1917;box-shadow:0 12px 40px rgba(0,0,0,.14)}" +
      "#pa-panel b{font-size:13px}#pa-panel p{margin:6px 0 10px;font-size:12px;color:#57534E}" +
      "#pa-panel label{display:block;font-size:11px;font-weight:600;color:#57534E;margin:8px 0 4px}" +
      "#pa-panel input{width:100%;border:1px solid #E8E3D9;border-radius:8px;min-height:34px;padding:0 10px;font-size:13px;box-sizing:border-box}" +
      "#pa-panel .row{display:flex;gap:8px;margin-top:10px}" +
      "#pa-panel button{border:1px solid #E8E3D9;background:#1B1917;color:#fff;border-radius:8px;min-height:30px;padding:0 12px;font-size:13px;cursor:pointer}" +
      "#pa-panel button.ghost{background:#fff;color:#1B1917}" +
      "#pa-status{font-size:12px;color:#57534E;margin-top:8px;min-height:18px;word-break:break-word}";
    var st = document.createElement("style");
    st.textContent = css;
    document.head.appendChild(st);

    var btn = document.createElement("button");
    btn.id = "pa-backend-btn";
    btn.type = "button";
    btn.title = "Configure which backend this UI talks to";
    document.body.appendChild(btn);

    var panel = document.createElement("div");
    panel.id = "pa-panel";
    panel.hidden = true;
    panel.innerHTML =
      "<b>Backend</b><p>Where should this UI send API calls? Empty = same origin.</p>" +
      '<label for="pa-base">API base URL</label><input id="pa-base" placeholder="https://your-server:3000" spellcheck="false" autocomplete="off"/>' +
      '<label for="pa-tok">Bearer token (only if backend sets POOL_API_TOKEN)</label><input id="pa-tok" type="password" placeholder="optional" autocomplete="off"/>' +
      '<div class="row"><button id="pa-save" type="button">Save</button>' +
      '<button id="pa-test" class="ghost" type="button">Test</button>' +
      '<button id="pa-clear" class="ghost" type="button">Clear</button></div>' +
      '<div id="pa-status"></div>';
    document.body.appendChild(panel);

    var baseInput = panel.querySelector("#pa-base");
    var tokInput = panel.querySelector("#pa-tok");
    var status = panel.querySelector("#pa-status");

    function paintBtn(state) {
      var b = apiBase();
      btn.className = state || "";
      btn.innerHTML =
        '<span class="dot"></span>Backend: ' +
        (b ? String(b).replace(/^https?:\/\//, "").slice(0, 28) : "same-origin");
    }

    function say(t) {
      status.textContent = t || "";
    }

    btn.onclick = function () {
      panel.hidden = !panel.hidden;
      if (!panel.hidden) {
        baseInput.value = apiBase();
        tokInput.value = apiToken();
        baseInput.focus();
      }
    };
    panel.querySelector("#pa-save").onclick = function () {
      window.PA.setBase(baseInput.value);
      window.PA.setToken(tokInput.value);
      say("Saved. Reloading…");
      setTimeout(function () {
        location.reload();
      }, 350);
    };
    panel.querySelector("#pa-clear").onclick = function () {
      window.PA.setBase("");
      window.PA.setToken("");
      say("Cleared. Reloading…");
      setTimeout(function () {
        location.reload();
      }, 350);
    };
    panel.querySelector("#pa-test").onclick = function () {
      window.PA.setBase(baseInput.value);
      window.PA.setToken(tokInput.value);
      say("Testing…");
      window.PA.test().then(
        function (r) {
          var ok = r.ok && (r.body || "").trim() === "ok";
          say(ok ? "OK — backend reachable." : "HTTP " + r.status + ": " + String(r.body).slice(0, 120));
          paintBtn(ok ? "ok" : "err");
        },
        function (e) {
          say("Unreachable: " + (e && e.message ? e.message : e));
          paintBtn("err");
        }
      );
    };

    paintBtn("");
    // Silent reachability probe (best-effort; offline backends stay neutral).
    try {
      window.PA.test().then(
        function (r) {
          paintBtn(r.ok && (r.body || "").trim() === "ok" ? "ok" : "err");
        },
        function () {
          paintBtn("err");
        }
      );
    } catch (e) {}
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountWidget);
  } else {
    mountWidget();
  }
})();
