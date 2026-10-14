/* Mintrage — shared UI helpers for login, portal and admin. All text is inserted with textContent (no innerHTML). */
(function () {
  "use strict";
  var LABELS = {
    pending: ["Pending", "warn"], active: ["Active", "ok"], suspended: ["Suspended", "bad"], rejected: ["Rejected", "bad"], expired: ["Expired", "warn"], admin: ["Admin", "info"],
    pending_payment: ["Pending payment", "warn"], needs_information: ["Needs information", "warn"], payment_verified: ["Payment verified", "info"], in_production: ["In production", "info"],
    quality_check: ["Quality check", "info"], delivered: ["Delivered", "ok"], revision_requested: ["Revision requested", "warn"], completed: ["Completed", "ok"], on_hold: ["On hold", "warn"], cancelled: ["Cancelled", "bad"],
    unpaid: ["Unpaid", "warn"], verified: ["Verified", "ok"], test_paid: ["Test payment", "info"], refunded: ["Refunded", "bad"]
  };
  function h(tag, attrs) {
    var e = document.createElement(tag), k, v;
    for (k in (attrs || {})) {
      v = attrs[k]; if (v == null || v === false) continue;
      if (k === "class") e.className = v;
      else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), v);
      else if (k === "value") e.value = v;
      else if (k === "checked") e.checked = !!v;
      else if (k === "disabled") e.disabled = !!v;
      else if (k === "selected") e.selected = !!v;
      else e.setAttribute(k, v === true ? "" : v);
    }
    for (var i = 2; i < arguments.length; i++) append(e, arguments[i]);
    return e;
  }
  function append(e, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { append(e, x); }); return; }
    e.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  function api(method, path, body) {
    return fetch("/api" + path, { method: method, credentials: "same-origin", headers: body !== undefined ? { "Content-Type": "application/json" } : {}, body: body !== undefined ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { var e = new Error(j.error || "Request failed"); e.status = r.status; throw e; } return j; }); });
  }
  function badge(key) { var l = LABELS[key] || [key, "info"]; return h("span", { class: "badge " + l[1] }, l[0]); }
  var label = function (key) { return (LABELS[key] || [key])[0]; };
  var money = function (n) { return "US$" + Number(n).toFixed(Number(n) % 1 ? 2 : 0); };
  var date = function (iso) { return iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "-"; };
  var dateTime = function (iso) { return iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "-"; };
  function toast(msg, bad) { var t = h("div", { class: "toast" + (bad ? " bad" : ""), role: "status" }, msg); document.body.append(t); setTimeout(function () { t.remove(); }, 4500); }
  var uid = 0;
  function field(labelText, input, hint) { var id = "f" + (++uid); input.id = id; return h("div", { class: "field" }, h("label", { for: id }, labelText), input, hint ? h("span", { class: "hint" }, hint) : null); }
  function kv(pairs) { var d = h("dl", { class: "kv" }); pairs.forEach(function (p) { d.append(h("dt", null, p[0]), h("dd", null, p[1] == null || p[1] === "" ? "-" : p[1])); }); return d; }
  function linkify(text) { // plain-text links, one per line, safe (http/https only)
    var box = h("div"); String(text || "").split("\n").filter(Boolean).forEach(function (l) { box.append(/^https?:\/\//i.test(l) ? h("div", null, h("a", { href: l, target: "_blank", rel: "noopener noreferrer" }, l)) : h("div", null, l)); }); return box;
  }
  window.MT = { h: h, api: api, badge: badge, label: label, money: money, date: date, dateTime: dateTime, toast: toast, field: field, kv: kv, linkify: linkify };
})();
