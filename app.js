/* Mintrage — public site scripts (no secrets here; this file is public). */
(function () {
  "use strict";
  var CONFIG = { supportEmail: "support@mintrage.com", registrationEndpoint: "/api/register" };
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var fmt = function (n) { return "US$" + n; };
  var days = function (s) { return s.deliveryMinDays + "–" + s.deliveryMaxDays + " days"; };
  var revs = function (s) { return s.revisions == null ? "Revisions confirmed on order" : "Up to " + s.revisions + " revisions"; };
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  function loadCatalogue() {
    return fetch("/api/catalogue", { headers: { Accept: "application/json" } })
      .then(function (r) { if (!r.ok) throw new Error("api"); return r.json(); })
      .catch(function () { return fetch("/catalogue.json").then(function (r) { if (!r.ok) throw new Error("catalogue"); return r.json(); }); })
      .then(function (d) { return d.services.filter(function (s) { return s.active; }); });
  }

  function renderRows(list, services) {
    list.textContent = "";
    services.forEach(function (s) {
      var li = el("li", "row");
      var name = el("span", "name", s.name);
      if (s.scope) name.appendChild(el("small", null, s.scope));
      li.appendChild(name);
      li.appendChild(el("span", "price", fmt(s.basePrice)));
      var meta = el("span", "meta");
      meta.appendChild(el("span", "cat", s.category));
      meta.appendChild(el("span", null, days(s)));
      meta.appendChild(el("span", "rev", revs(s)));
      li.appendChild(meta);
      list.appendChild(li);
    });
  }

  function initCatalogue(list, services, filters) {
    renderRows(list, services);
    if (!filters) return;
    var cats = ["All"]; services.forEach(function (s) { if (cats.indexOf(s.category) < 0) cats.push(s.category); });
    cats.forEach(function (c, i) {
      var b = el("button", "chip", c); b.type = "button"; b.setAttribute("aria-pressed", i === 0 ? "true" : "false");
      b.addEventListener("click", function () {
        filters.querySelectorAll(".chip").forEach(function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
        renderRows(list, c === "All" ? services : services.filter(function (s) { return s.category === c; }));
      });
      filters.appendChild(b);
    });
  }

  function initCalc(services) {
    var sel = $("#calc-service"), price = $("#calc-price"); if (!sel || !price) return;
    services.forEach(function (s) { var o = el("option", null, s.name + " (" + fmt(s.basePrice) + ")"); o.value = s.id; sel.appendChild(o); });
    var base = $("#calc-base"), out = $("#calc-profit"), box = $("#calc-result");
    function update() {
      var s = services.filter(function (x) { return x.id === sel.value; })[0]; if (!s) return;
      base.textContent = fmt(s.basePrice);
      var v = parseFloat(price.value);
      if (isNaN(v) || v < 0) { out.textContent = "–"; box.classList.remove("neg"); return; }
      var p = Math.round((v - s.basePrice) * 100) / 100;
      out.textContent = (p < 0 ? "−" : "") + fmt(Math.abs(p));
      box.classList.toggle("neg", p < 0);
    }
    sel.addEventListener("change", update); price.addEventListener("input", update); update();
  }

  function initForm() {
    var f = $("#reg-form"); if (!f) return;
    var st = $("#status"), btn = $("#reg-submit"), mode = "gateway";
    function say(c, t) { st.className = c; st.textContent = t; }
    fetch("/api/config").then(function (r) { return r.json(); }).then(function (c) {
      mode = c.registrationMode;
      if (!c.checkoutAvailable) {
        $("#mode-note").hidden = false; btn.textContent = "Submit registration";
        var steps = $("#reg-steps"); if (steps) steps.innerHTML = ""; // static text only, below
        ["Fill in the form.", "We email you payment details.", "Pay and confirm your email.", "Your account is activated once your payment is verified."].forEach(function (t) { steps.appendChild(el("li", null, t)); });
      }
    }).catch(function () {});
    f.addEventListener("submit", function (ev) {
      ev.preventDefault();
      if (!f.checkValidity()) { f.reportValidity(); say("bad", "Please complete the highlighted fields."); return; }
      var data = {}; new FormData(f).forEach(function (v, k) { data[k] = v; });
      ["acceptAgreement", "acceptTerms", "acceptPrivacy"].forEach(function (k) { data[k] = data[k] === "on"; });
      btn.disabled = true; say("", "Submitting…");
      fetch(CONFIG.registrationEndpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (x) {
          if (!x.ok) { btn.disabled = false; say("bad", (x.j && x.j.error) || "Could not submit. Please try again."); return; }
          if (x.j.checkoutUrl && /^https:\/\//.test(x.j.checkoutUrl)) { say("ok", "Registration saved. Taking you to secure checkout…"); location.href = x.j.checkoutUrl; return; }
          f.reset();
          say("ok", x.j.mode === "gateway" ? "Registration saved. Log in to continue to payment, and check your email to confirm your address." : "Registration received. Check your email to confirm your address. We will email you payment details.");
        })
        .catch(function () { btn.disabled = false; say("bad", "Network problem. Please try again or email " + CONFIG.supportEmail + "."); });
    });
  }

  function initTabs() {
    var btns = document.querySelectorAll(".tab"); if (!btns.length) return;
    function show(id) {
      btns.forEach(function (b) {
        var on = b.getAttribute("data-tab") === id;
        b.setAttribute("aria-pressed", on ? "true" : "false");
        var p = document.getElementById(b.getAttribute("data-tab")); if (p) p.hidden = !on;
      });
    }
    btns.forEach(function (b) { b.addEventListener("click", function () { show(b.getAttribute("data-tab")); }); });
    show(btns[0].getAttribute("data-tab"));
  }

  document.addEventListener("DOMContentLoaded", function () {
    initTabs();
    var list = $("#catalogue-list"), calc = $("#calc-service");
    initForm();
    if (!list && !calc) return;
    loadCatalogue().then(function (services) {
      if (list) initCatalogue(list, services, $("#catalogue-filters"));
      initCalc(services);
    }).catch(function () {
      if (list) { list.textContent = ""; list.appendChild(el("li", "row", "The catalogue could not be loaded. Please refresh, or email " + CONFIG.supportEmail + ".")); }
    });
  });
})();
