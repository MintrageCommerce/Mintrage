/* Mintrage — admin panel. Access is enforced by the server on every request (role = admin). */
(function () {
  "use strict";
  var MT = window.MT, h = MT.h, api = MT.api, app = document.getElementById("app"), me = null;
  var NAV = [["#/sellers", "Sellers"], ["#/orders", "Orders"], ["#/catalogue", "Catalogue"], ["#/resources", "Resources"], ["#/emails", "Emails"], ["#/settings", "Settings"]];
  var STATUSES = ["pending_payment", "needs_information", "in_production", "quality_check", "revision_requested", "completed", "on_hold", "cancelled"];

  function logout(e) { e.preventDefault(); api("POST", "/auth/logout", {}).then(function () { location.href = "/login"; }); }
  function shell(route, content) {
    app.replaceChildren(h("nav", { class: "subnav", "aria-label": "Admin" }, NAV.map(function (n) { return h("a", { href: n[0], "aria-current": route === n[0] ? "page" : null }, n[1]); }), h("a", { href: "#", onclick: logout }, "Log out")), content);
  }
  function fail(e) { if (e.status === 401 || e.status === 403) { location.replace("/login"); return; } MT.toast(e.message, true); }
  // run an admin action, toast the result, then refresh the current view
  function act(method, path, body, okMsg, after) {
    return api(method, path, body).then(function (r) {
      if (r && r.emailStatus && r.emailStatus !== "sent" && r.emailStatus !== "skipped") MT.toast((okMsg || "Done") + ". Email NOT sent (" + r.emailStatus.replace("_", " ") + "). Check Settings.", true);
      else MT.toast(okMsg || "Done");
      (after || route)();
    }).catch(fail);
  }
  var btn = function (t, fn, cls) { return h("button", { class: "btn btn-sm " + (cls || "btn-s"), type: "button", onclick: fn }, t); };
  var area = function (ph, v) { return h("textarea", { placeholder: ph, value: v || "", maxlength: 4000 }); };

  // ---------- sellers ----------
  function sellers() {
    var q = h("input", { type: "search", placeholder: "Search name, email or Seller ID" }), st = h("select", null, [["", "All statuses"], ["pending", "Pending"], ["active", "Active"], ["suspended", "Suspended"], ["rejected", "Rejected"]].map(function (o) { return h("option", { value: o[0] }, o[1]); }));
    var out = h("div"), sum = h("div", { class: "cards" });
    function load() {
      api("GET", "/admin/sellers?q=" + encodeURIComponent(q.value) + "&status=" + st.value).then(function (r) {
        out.replaceChildren(r.sellers.length ? h("div", { class: "tbl-wrap" }, h("table", { class: "tbl" }, h("thead", null, h("tr", null, ["Seller", "ID", "Status", "Payment", "Registered", "Expires"].map(function (t) { return h("th", null, t); }))),
          h("tbody", null, r.sellers.map(function (s) { return h("tr", { class: "click", onclick: function () { location.hash = "#/sellers/" + s.id; } }, h("td", null, h("a", { href: "#/sellers/" + s.id }, s.fullName), h("div", { class: "small" }, s.email)), h("td", null, s.sellerCode), h("td", null, MT.badge(s.status)), h("td", null, MT.badge(s.paymentStatus)), h("td", null, MT.date(s.createdAt)), h("td", null, MT.date(s.expiresAt))); })))) : h("p", null, "No sellers found."));
      }).catch(fail);
    }
    api("GET", "/admin/summary").then(function (s) {
      var c = function (n, l) { return h("div", { class: "panel" }, h("div", { class: "stat" }, String(n)), h("div", { class: "stat-l" }, l)); };
      sum.replaceChildren(c(s.pendingSellers, "Pending registrations"), c(s.activeSellers, "Active sellers"), c(s.awaitingPayment, "Orders awaiting payment"), c(s.inProduction, "Orders in progress"));
    }).catch(fail);
    q.addEventListener("input", function () { clearTimeout(q._t); q._t = setTimeout(load, 300); }); st.addEventListener("change", load);
    shell("#/sellers", h("div", null, h("h1", null, "Sellers"), sum, h("div", { class: "toolbar" }, q, st), h("div", { class: "panel" }, out)));
    load();
  }

  function sellerDetail(id) {
    api("GET", "/admin/sellers/" + id).then(function (r) {
      var s = r.seller, base = "/admin/sellers/" + id;
      var instr = area("Payment instructions to email (bank/mobile account details, reference to use)…"), pm = h("input", { placeholder: "e.g. Bank transfer" }), pr = h("input", { placeholder: "Transaction ID / reference" });
      var why = area("Reason (optional)"), refunded = h("input", { type: "checkbox" }), sub = h("input", { placeholder: "Subject" }), msg = area("Message to the seller"), notes = area("Internal notes", s.adminNotes), sets = h("input", { type: "number", min: 0, max: 20, value: s.marketingSets });
      shell("#/sellers", h("div", null, h("p", null, h("a", { href: "#/sellers" }, "← All sellers")), h("h1", null, s.fullName),
        h("div", { class: "grid2" },
          h("div", null,
            h("div", { class: "panel" }, h("h3", null, "Details"), MT.kv([["Status", MT.badge(s.status)], ["Seller ID", s.sellerCode], ["Email", s.email + (s.emailVerified ? " (verified)" : " (NOT verified)")], ["Residence", s.countryResidence], ["Business country", s.countryBusiness], ["Page", s.businessPage ? h("a", { href: s.businessPage, target: "_blank", rel: "noopener noreferrer" }, s.businessPage) : "-"], ["Registered", MT.dateTime(s.createdAt)], ["Agreement", s.agreementVersion ? "v" + s.agreementVersion + " accepted " + MT.dateTime(s.agreementAcceptedAt) : "-"], ["Payment", MT.badge(s.paymentStatus)], ["Payment method", s.paymentMethod], ["Payment reference", s.paymentReference], ["Payment verified", MT.dateTime(s.paymentVerifiedAt)], ["Instructions sent", MT.dateTime(s.instructionsSentAt)], ["Activated", MT.dateTime(s.activatedAt)], ["Expires", MT.date(s.expiresAt)], ["Rejection reason", s.rejectReason]])),
            h("div", { class: "panel" }, h("h3", null, "Orders"), r.orders.length ? h("ul", { class: "plain" }, r.orders.map(function (o) { return h("li", null, h("a", { href: "#/orders/" + o.orderCode }, o.orderCode), " " + o.service + " ", MT.badge(o.status)); })) : h("p", null, "No orders."))),
          h("div", null,
            h("div", { class: "panel" }, h("h3", null, "1. Send agreement and payment instructions"), instr, h("div", { class: "row-actions" }, btn("Email instructions", function () { act("POST", base + "/send-instructions", { instructions: instr.value }, "Instructions sent"); }))),
            h("div", { class: "panel" }, h("h3", null, "2. Record verified payment"), h("p", { class: "small" }, "Only after you have checked the money arrived."), h("div", { class: "inline" }, MT.field("Method", pm), MT.field("Reference", pr)), h("div", { class: "row-actions" }, btn("Record payment as verified", function () { act("POST", base + "/verify-payment", { method: pm.value, reference: pr.value }, "Payment recorded"); }))),
            h("div", { class: "panel" }, h("h3", null, "3. Activate"), h("p", { class: "small" }, "Requires a verified payment and a confirmed email. Also use this to renew after a new payment."), h("div", { class: "row-actions" }, btn("Activate / renew (12 months)", function () { act("POST", base + "/activate", {}, "Seller activated"); }, "btn-p"),
              s.rawStatus === "suspended" ? btn("Reinstate", function () { act("POST", base + "/reinstate", {}, "Reinstated"); }) : null, s.rawStatus === "active" ? btn("Suspend", function () { if (confirm("Suspend this seller?")) act("POST", base + "/suspend", {}, "Suspended"); }, "btn-danger") : null)),
            s.rawStatus !== "active" && s.rawStatus !== "rejected" ? h("div", { class: "panel" }, h("h3", null, "Reject registration"), why, h("label", { class: "check" }, refunded, h("span", null, "A paid fee will be refunded (10-15 days)")), h("div", { class: "row-actions" }, btn("Reject", function () { if (confirm("Reject this registration?")) act("POST", base + "/reject", { reason: why.value, refunded: refunded.checked }, "Rejected"); }, "btn-danger"))) : null,
            h("div", { class: "panel" }, h("h3", null, "Emails"), h("div", { class: "row-actions" }, ["verification", "received", "activation", "reset"].map(function (t) { return btn("Resend " + t, function () { act("POST", base + "/resend", { type: t }, "Sent"); }); })), h("div", { class: "mt2" }), sub, h("div", { class: "mt" }), msg, h("div", { class: "row-actions" }, btn("Send message", function () { act("POST", base + "/message", { subject: sub.value, body: msg.value }, "Message sent"); }))),
            h("div", { class: "panel" }, h("h3", null, "Notes and marketing sets"), notes, h("div", { class: "row-actions" }, btn("Save notes", function () { act("POST", base + "/notes", { notes: notes.value }, "Saved"); })), h("div", { class: "inline mt2" }, MT.field("Marketing sets unlocked", sets), btn("Save", function () { act("POST", base + "/marketing-sets", { sets: Number(sets.value) }, "Saved"); })))))));
    }).catch(fail);
  }

  // ---------- orders ----------
  function orders() {
    var q = h("input", { type: "search", placeholder: "Order ID, seller or service" }), st = h("select", null, h("option", { value: "" }, "All statuses"), ["pending_payment", "needs_information", "payment_verified", "in_production", "quality_check", "delivered", "revision_requested", "completed", "on_hold", "cancelled"].map(function (s) { return h("option", { value: s }, MT.label(s)); }));
    var out = h("div");
    function load() {
      api("GET", "/admin/orders?q=" + encodeURIComponent(q.value) + "&status=" + st.value).then(function (r) {
        out.replaceChildren(r.orders.length ? h("div", { class: "tbl-wrap" }, h("table", { class: "tbl" }, h("thead", null, h("tr", null, ["Order", "Seller", "Service", "Price", "Payment", "Status", "Submitted"].map(function (t) { return h("th", null, t); }))),
          h("tbody", null, r.orders.map(function (o) { return h("tr", { class: "click", onclick: function () { location.hash = "#/orders/" + o.orderCode; } }, h("td", null, h("a", { href: "#/orders/" + o.orderCode }, o.orderCode)), h("td", null, o.sellerName, h("div", { class: "small" }, o.sellerCode)), h("td", null, o.service), h("td", null, MT.money(o.basePrice)), h("td", null, MT.badge(o.paymentStatus)), h("td", null, MT.badge(o.status)), h("td", null, MT.date(o.createdAt))); })))) : h("p", null, "No orders found."));
      }).catch(fail);
    }
    q.addEventListener("input", function () { clearTimeout(q._t); q._t = setTimeout(load, 300); }); st.addEventListener("change", load);
    shell("#/orders", h("div", null, h("h1", null, "Orders"), h("div", { class: "toolbar" }, q, st), h("div", { class: "panel" }, out))); load();
  }

  function orderDetail(code) {
    api("GET", "/admin/orders/" + encodeURIComponent(code)).then(function (r) {
      var o = r.order, s = r.seller, base = "/admin/orders/" + encodeURIComponent(code);
      var instr = area("Payment instructions to email the seller…"), ref = h("input", { placeholder: "Payment reference" }), stSel = h("select", null, STATUSES.map(function (x) { return h("option", { value: x, selected: x === o.status }, MT.label(x)); })), stNote = h("input", { placeholder: "Note shown to the seller (optional)" });
      var durl = h("input", { type: "url", placeholder: "https:// secure download link" }), dnote = h("input", { placeholder: "Note to the seller (optional)", value: o.deliverableNote || "" }), dmail = h("input", { type: "checkbox", checked: true });
      var msg = area("Message to the seller"), notes = area("Internal notes (never shown to the seller)", o.internalNotes);
      shell("#/orders", h("div", null, h("p", null, h("a", { href: "#/orders" }, "← All orders")), h("h1", null, o.orderCode),
        h("div", { class: "grid2" },
          h("div", null,
            h("div", { class: "panel" }, MT.kv([["Service", o.service], ["Seller", h("a", { href: "#/sellers/" + s.id }, s.name + " (" + s.code + ")")], ["Seller email", s.email], ["Seller account", MT.badge(s.status)], ["Base price", MT.money(o.basePrice)], ["Status", MT.badge(o.status)], ["Payment", MT.badge(o.paymentStatus)], ["Payment reference", o.paymentReference], ["Seller reference", o.sellerReference], ["Revisions", o.revisionsUsed + " used of " + (o.revisionsAllowed == null ? "unspecified" : o.revisionsAllowed)], ["Estimated delivery", o.deliveryMin + "-" + o.deliveryMax + " days"], ["Submitted", MT.dateTime(o.createdAt)], ["Delivered", MT.dateTime(o.deliveredAt)], ["Deliverable", o.deliverableUrl ? h("a", { href: o.deliverableUrl, target: "_blank", rel: "noopener noreferrer" }, o.deliverableUrl) : "-"]])),
            h("div", { class: "panel" }, h("h3", null, "Requirements"), h("pre", { class: "pre" }, o.requirements), o.links ? [h("h3", { class: "mt" }, "Links"), MT.linkify(o.links)] : null),
            h("div", { class: "panel" }, h("h3", null, "History"), h("ul", { class: "timeline" }, r.events.map(function (ev) { return h("li", null, (ev.to_status ? MT.label(ev.to_status) : ev.type.replace(/_/g, " ")) + (ev.is_public ? "" : " (internal)"), h("small", null, MT.dateTime(ev.created_at)), ev.note ? h("small", null, ev.note) : null); })))),
          h("div", null,
            h("div", { class: "panel" }, h("h3", null, "1. Email payment instructions"), instr, h("div", { class: "row-actions" }, btn("Send instructions", function () { act("POST", base + "/payment-instructions", { instructions: instr.value }, "Instructions sent", function () { orderDetail(code); }); }))),
            h("div", { class: "panel" }, h("h3", null, "2. Verify payment"), o.paymentStatus === "verified" ? h("p", null, "Payment already verified.") : [h("p", { class: "small" }, "Only after you have checked the money arrived. The seller is emailed."), MT.field("Reference", ref), h("div", { class: "row-actions" }, btn("Mark payment verified", function () { act("POST", base + "/verify-payment", { reference: ref.value }, "Payment verified", function () { orderDetail(code); }); }, "btn-p"))]),
            h("div", { class: "panel" }, h("h3", null, "3. Update status"), MT.field("Status", stSel), MT.field("Note", stNote), h("div", { class: "row-actions" }, btn("Update status", function () { act("POST", base + "/status", { status: stSel.value, note: stNote.value }, "Status updated", function () { orderDetail(code); }); }))),
            h("div", { class: "panel" }, h("h3", null, "4. Deliver"), MT.field("Download link (https)", durl), MT.field("Note", dnote), h("label", { class: "check" }, dmail, h("span", null, "Email the seller")), h("div", { class: "row-actions" }, btn("Deliver order", function () { act("POST", base + "/deliver", { url: durl.value, note: dnote.value, sendEmail: dmail.checked }, "Delivered", function () { orderDetail(code); }); }, "btn-p"))),
            h("div", { class: "panel" }, h("h3", null, "Message and notes"), msg, h("div", { class: "row-actions" }, btn("Email message", function () { act("POST", base + "/message", { body: msg.value }, "Message sent", function () { orderDetail(code); }); })), h("div", { class: "mt2" }), notes, h("div", { class: "row-actions" }, btn("Save notes", function () { act("POST", base + "/notes", { notes: notes.value }, "Saved", function () { orderDetail(code); }); })))))));
    }).catch(fail);
  }

  // ---------- catalogue ----------
  function catalogue(editId) {
    api("GET", "/admin/services").then(function (r) {
      var cur = editId ? r.services.filter(function (s) { return s.id === editId; })[0] : null, f = cur || { name: "", category: r.categories[0], scope: "", description: "", specs: "", basePrice: "", deliveryMinDays: "", deliveryMaxDays: "", revisions: "", sortOrder: r.services.length, active: true };
      var i = { name: h("input", { value: f.name, maxlength: 100 }), cat: h("select", null, r.categories.map(function (c) { return h("option", { value: c, selected: c === f.category }, c); })), scope: h("input", { value: f.scope, maxlength: 120, placeholder: "e.g. Up to 5 reels" }), desc: area("Description (shown to sellers)", f.description), specs: area("Specifications (shown to sellers)", f.specs), price: h("input", { type: "number", min: 1, step: "0.01", value: f.basePrice }), min: h("input", { type: "number", min: 1, value: f.deliveryMinDays }), max: h("input", { type: "number", min: 1, value: f.deliveryMaxDays }), rev: h("input", { type: "number", min: 0, value: f.revisions == null ? "" : f.revisions, placeholder: "blank = confirmed on order" }), sort: h("input", { type: "number", min: 0, value: f.sortOrder }), act: h("input", { type: "checkbox", checked: f.active }) };
      var newCat = h("input", { placeholder: "New category name" });
      function save() {
        var body = { name: i.name.value, category: i.cat.value, scope: i.scope.value, description: i.desc.value, specs: i.specs.value, basePrice: i.price.value, deliveryMinDays: i.min.value, deliveryMaxDays: i.max.value, revisions: i.rev.value === "" ? null : i.rev.value, sortOrder: i.sort.value, active: i.act.checked };
        act(cur ? "PUT" : "POST", cur ? "/admin/services/" + cur.id : "/admin/services", body, cur ? "Service updated" : "Service added", function () { location.hash = "#/catalogue"; catalogue(); });
      }
      shell("#/catalogue", h("div", null, h("h1", null, "Catalogue"), h("p", { class: "small" }, "Changing a price affects new orders only. Existing orders keep the price recorded when they were submitted."),
        h("div", { class: "panel" }, h("div", { class: "tbl-wrap" }, h("table", { class: "tbl" }, h("thead", null, h("tr", null, ["Service", "Category", "Base price", "Delivery", "Revisions", "Active", ""].map(function (t) { return h("th", null, t); }))),
          h("tbody", null, r.services.map(function (s) { return h("tr", null, h("td", null, s.name, s.scope ? h("div", { class: "small" }, s.scope) : null), h("td", null, s.category), h("td", null, MT.money(s.basePrice)), h("td", null, s.deliveryMinDays + "-" + s.deliveryMaxDays + " days"), h("td", null, s.revisions == null ? "-" : s.revisions), h("td", null, s.active ? "Yes" : "No"), h("td", null, btn("Edit", function () { catalogue(s.id); }))); }))))),
        h("div", { class: "panel" }, h("h3", null, cur ? "Edit: " + cur.name : "Add a service"), MT.field("Name", i.name), MT.field("Category", i.cat), MT.field("Scope (optional)", i.scope), MT.field("Description", i.desc), MT.field("Specifications", i.specs), h("div", { class: "inline" }, MT.field("Base price (US$)", i.price), MT.field("Min days", i.min), MT.field("Max days", i.max), MT.field("Revisions", i.rev), MT.field("Sort order", i.sort)),
          h("label", { class: "check" }, i.act, h("span", null, "Active (visible in the catalogue and orderable)")), h("div", { class: "row-actions" }, btn(cur ? "Save changes" : "Add service", save, "btn-p"), cur ? btn("Cancel", function () { catalogue(); }) : null)),
        h("div", { class: "panel" }, h("h3", null, "Add a category"), h("div", { class: "inline" }, MT.field("Category", newCat), btn("Add category", function () { act("POST", "/admin/categories", { name: newCat.value }, "Category added", function () { catalogue(); }); })))));
    }).catch(fail);
  }

  // ---------- resources ----------
  function resources(editId) {
    Promise.all([api("GET", "/admin/resources"), api("GET", "/admin/services")]).then(function (rs) {
      var list = rs[0].resources, svcs = rs[1].services, cur = editId ? list.filter(function (x) { return x.id === editId; })[0] : null, f = cur || { title: "", description: "", url: "", setNo: 1, serviceId: "", active: true };
      var t = h("input", { value: f.title, maxlength: 120 }), d = area("Description (optional)", f.description), u = h("input", { type: "url", value: f.url, placeholder: "https:// link (e.g. a restricted Drive folder)" }), n = h("input", { type: "number", min: 1, max: 20, value: f.setNo }), sv = h("select", null, h("option", { value: "" }, "All services"), svcs.map(function (s) { return h("option", { value: s.id, selected: s.id === f.serviceId }, s.name); })), a = h("input", { type: "checkbox", checked: f.active });
      shell("#/resources", h("div", null, h("h1", null, "Marketing materials"), h("p", { class: "small" }, "Sellers see sets up to the number unlocked on their account (new sellers get set 1 by default). Only logged-in active sellers receive these links."),
        h("div", { class: "panel" }, list.length ? h("div", { class: "tbl-wrap" }, h("table", { class: "tbl" }, h("thead", null, h("tr", null, ["Title", "Set", "Active", ""].map(function (x) { return h("th", null, x); }))), h("tbody", null, list.map(function (x) { return h("tr", null, h("td", null, x.title), h("td", null, x.setNo), h("td", null, x.active ? "Yes" : "No"), h("td", null, h("div", { class: "row-actions" }, btn("Edit", function () { resources(x.id); }), btn("Delete", function () { if (confirm("Delete this resource?")) act("DELETE", "/admin/resources/" + x.id, undefined, "Deleted", function () { resources(); }); }, "btn-danger")))); })))) : h("p", null, "No resources yet. Add your first one below.")),
        h("div", { class: "panel" }, h("h3", null, cur ? "Edit resource" : "Add a resource"), MT.field("Title", t), MT.field("Description", d), MT.field("Link (https)", u), h("div", { class: "inline" }, MT.field("Set number", n), MT.field("Service", sv)), h("label", { class: "check" }, a, h("span", null, "Active")),
          h("div", { class: "row-actions" }, btn(cur ? "Save changes" : "Add resource", function () { act(cur ? "PUT" : "POST", cur ? "/admin/resources/" + cur.id : "/admin/resources", { title: t.value, description: d.value, url: u.value, setNo: Number(n.value), serviceId: sv.value, active: a.checked }, "Saved", function () { resources(); }); }, "btn-p"), cur ? btn("Cancel", function () { resources(); }) : null))));
    }).catch(fail);
  }

  // ---------- emails + settings ----------
  function emails() {
    api("GET", "/admin/emails").then(function (r) {
      shell("#/emails", h("div", null, h("h1", null, "Email log"), h("p", { class: "small" }, "Every email the system tried to send. \"Not configured\" means the email provider is not set up, so nothing was sent."),
        h("div", { class: "panel" }, r.emails.length ? h("div", { class: "tbl-wrap" }, h("table", { class: "tbl" }, h("thead", null, h("tr", null, ["When", "To", "Subject", "Type", "Status"].map(function (x) { return h("th", null, x); }))), h("tbody", null, r.emails.map(function (e) { return h("tr", null, h("td", null, MT.dateTime(e.created_at)), h("td", null, e.to_email), h("td", null, e.subject), h("td", null, e.template), h("td", null, h("span", { class: "badge " + (e.status === "sent" ? "ok" : e.status === "failed" ? "bad" : "warn"), title: e.error || "" }, e.status.replace("_", " ")))); })))) : h("p", null, "No emails yet."))));
    }).catch(fail);
  }
  function settings() {
    api("GET", "/admin/status").then(function (r) {
      var s = r.settings, notify = h("input", { type: "email", value: s.notifyEmail }), mode = h("select", null, [["manual", "Manual (review and verify payments yourself)"], ["gateway", "Gateway (automatic checkout and verification)"]].map(function (o) { return h("option", { value: o[0], selected: o[0] === s.registrationMode }, o[1]); })), sets = h("input", { type: "number", min: 1, max: 20, value: s.defaultMarketingSets });
      var yes = function (b) { return h("span", { class: "badge " + (b ? "ok" : "warn") }, b ? "Yes" : "No"); };
      shell("#/settings", h("div", { class: "grid2" },
        h("div", { class: "panel" }, h("h2", null, "Settings"), MT.field("Notification email (receives new registrations and orders)", notify), MT.field("Registration mode", mode, "Gateway mode can only be switched on after a payment provider is configured."), MT.field("Marketing sets for new sellers", sets),
          h("div", { class: "row-actions" }, btn("Save settings", function () { act("PUT", "/admin/settings", { notifyEmail: notify.value, registrationMode: mode.value, defaultMarketingSets: Number(sets.value) }, "Settings saved", settings); }, "btn-p"))),
        h("div", { class: "panel" }, h("h2", null, "System status"), MT.kv([["Email sending configured", yes(r.emailConfigured)], ["Email provider", r.emailProvider], ["Sender", r.emailFrom], ["Payment provider", r.gatewayProvider || "none"], ["Provider configured", yes(r.gatewayConfigured)], ["Payment environment", r.paymentEnv], ["Test payments can activate", yes(r.allowTestActivation)], ["Site URL", r.siteUrl]]),
          h("p", { class: "small mt2" }, "Keys and secrets live in Cloudflare environment variables and are never shown here."))));
    }).catch(fail);
  }

  function route() {
    var r = location.hash || "#/sellers", m;
    if (r === "#/sellers" || r === "#" || r === "#/") sellers();
    else if ((m = r.match(/^#\/sellers\/([A-Za-z0-9-]+)$/))) sellerDetail(m[1]);
    else if (r === "#/orders") orders();
    else if ((m = r.match(/^#\/orders\/([A-Za-z0-9-]+)$/))) orderDetail(m[1]);
    else if (r === "#/catalogue") catalogue();
    else if (r === "#/resources") resources();
    else if (r === "#/emails") emails();
    else if (r === "#/settings") settings();
    else sellers();
    window.scrollTo(0, 0);
  }
  api("GET", "/me").then(function (r) {
    me = r.profile; if (me.role !== "admin") { location.replace("/portal"); return; }
    window.addEventListener("hashchange", route); route();
  }).catch(function () { location.replace("/login"); });
})();
