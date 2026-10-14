/* Mintrage — one-time admin setup. The server refuses this once an admin exists. */
(function () {
  "use strict";
  var f = document.getElementById("setup-form"), s = document.getElementById("setup-status"); if (!f) return;
  f.addEventListener("submit", function (ev) {
    ev.preventDefault(); if (!f.checkValidity()) { f.reportValidity(); return; }
    var d = {}; new FormData(f).forEach(function (v, k) { d[k] = v; });
    s.className = "auth-status"; s.textContent = "Please wait…";
    window.MT.api("POST", "/setup", d).then(function () { s.className = "auth-status ok"; s.textContent = "Admin account created. Now delete SETUP_TOKEN in Cloudflare and log in."; f.reset(); })
      .catch(function (e) { s.className = "auth-status bad"; s.textContent = e.message; });
  });
})();
