/* Mintrage — login, forgot password, reset password, email verification. */
(function () {
  "use strict";
  var MT = window.MT, h = MT.h, api = MT.api;
  var q = new URLSearchParams(location.search);
  var root = document.getElementById("auth");
  function msg(el, text, kind) { el.className = kind || ""; el.textContent = text; }
  function show(id) { document.querySelectorAll("[data-view]").forEach(function (v) { v.hidden = v.getAttribute("data-view") !== id; }); }
  function bind(formId, statusId, fn) {
    var f = document.getElementById(formId), s = document.getElementById(statusId); if (!f) return;
    f.addEventListener("submit", function (ev) {
      ev.preventDefault(); if (!f.checkValidity()) { f.reportValidity(); return; }
      var b = f.querySelector("button[type=submit]"); b.disabled = true; msg(s, "Please wait…");
      var d = {}; new FormData(f).forEach(function (v, k) { d[k] = v; });
      fn(d, s).catch(function (e) { msg(s, e.message, "bad"); }).then(function () { b.disabled = false; });
    });
  }
  bind("login-form", "login-status", function (d, s) {
    return api("POST", "/auth/login", { email: d.email, password: d.password }).then(function (r) { location.href = r.profile.role === "admin" ? "/admin" : "/portal"; });
  });
  bind("forgot-form", "forgot-status", function (d, s) {
    return api("POST", "/auth/forgot", { email: d.email }).then(function (r) { msg(s, r.message, "ok"); });
  });
  bind("reset-form", "reset-status", function (d, s) {
    if (d.password !== d.password2) { msg(s, "The two passwords do not match.", "bad"); return Promise.resolve(); }
    return api("POST", "/auth/reset", { token: q.get("reset"), password: d.password }).then(function () { msg(s, "Password updated. You can now log in.", "ok"); setTimeout(function () { location.href = "/login"; }, 1500); });
  });
  document.querySelectorAll("[data-show]").forEach(function (a) { a.addEventListener("click", function (e) { e.preventDefault(); show(a.getAttribute("data-show")); }); });
  if (q.get("paid")) document.getElementById("paid-note").hidden = false;
  if (q.get("reset")) show("reset");
  else if (q.get("verify")) {
    show("verify"); var vs = document.getElementById("verify-status");
    api("POST", "/auth/verify", { token: q.get("verify") }).then(function () { msg(vs, "Email confirmed. You can log in now.", "ok"); setTimeout(function () { show("login"); }, 1200); }).catch(function (e) { msg(vs, e.message, "bad"); });
  } else {
    show("login");
    api("GET", "/me").then(function (r) { location.replace(r.profile.role === "admin" ? "/admin" : "/portal"); }).catch(function () {});
  }
})();
