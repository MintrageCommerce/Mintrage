/* Mintrage — seller portal. Every request is authorised on the server; this file only draws the screens. */
(function () {
  "use strict";
  var MT = window.MT, h = MT.h, api = MT.api, app = document.getElementById("app"), me = null;
  var NAV = [["#/", "Dashboard"], ["#/catalogue", "Catalogue"], ["#/order", "Place an order"], ["#/orders", "My orders"], ["#/resources", "Marketing materials"], ["#/account", "Account"]];

  function logout(e) { e.preventDefault(); api("POST", "/auth/logout", {}).then(function () { location.href = "/login"; }); }
  function shell(route, content) {
    var nav = h("nav", { class: "subnav", "aria-label": "Seller portal" }, NAV.map(function (n) { return h("a", { href: n[0], "aria-current": route === n[0] ? "page" : null }, n[1]); }), h("a", { href: "#", onclick: logout }, "Log out"));
    app.replaceChildren(nav, content);
  }
  function err(e) {
    if (e.status === 401) { location.replace("/login"); return; }
    shell("", h("div", { class: "notice warn" }, h("p", null, e.message)));
  }
  function statusNotice() {
    var m = { pending: "Your registration is pending. We activate your account after we verify your payment and approve your registration. Check your email for the Seller Agreement and payment details.", suspended: "Your account is suspended. Please contact support@mintrage.com.", expired: "Your registration has expired. Contact support@mintrage.com to renew it.", rejected: "This registration was not approved." }[me.status];
    return m ? h("div", { class: "notice warn" }, h("p", null, m)) : null;
  }

  function onboarding() {
    return api("GET", "/config").then(function (cfg) {
      var gw = cfg.checkoutAvailable, emailOk = me.emailVerified, paid = me.paymentStatus === "verified";
      var step = function (done, title, body, action) { return h("div", { class: "panel" }, h("h3", null, (done ? "Done: " : "") + title), body ? h("p", null, body) : null, action); };
      var resend = h("button", { class: "btn btn-s btn-sm", type: "button", onclick: function (ev) { ev.target.disabled = true; api("POST", "/me/resend-verification", {}).then(function () { MT.toast("Confirmation email sent."); }).catch(function (e) { ev.target.disabled = false; MT.toast(e.message, true); }); } }, "Resend confirmation email");
      var pay = h("button", { class: "btn btn-p btn-sm", type: "button", onclick: function (ev) { ev.target.disabled = true; api("POST", "/me/checkout", {}).then(function (r) { if (/^https:\/\//.test(r.checkoutUrl)) location.href = r.checkoutUrl; }).catch(function (e) { ev.target.disabled = false; MT.toast(e.message, true); }); } }, "Continue to payment");
      var refresh = h("button", { class: "btn btn-s btn-sm", type: "button", onclick: function () { api("GET", "/me").then(function (r) { me = r.profile; route(); }).catch(err); } }, "Refresh status");
      shell("#/", h("div", null, h("h1", null, "Welcome, " + me.fullName), h("p", { class: "lead" }, "Two quick steps and your seller portal opens automatically."),
        step(emailOk, "1. Confirm your email", emailOk ? "Your email is confirmed." : "Open the confirmation email we sent to " + me.email + " and click the link.", emailOk ? null : resend),
        step(paid, "2. Pay the US$25 annual registration fee", paid ? "Payment verified." : gw ? "Pay at secure checkout. Your account is not active until the payment is verified." : "Online checkout is not available right now. We will email you payment details.", paid || !gw ? null : pay),
        emailOk && paid ? h("div", { class: "notice" }, h("p", null, "Everything is confirmed. Your account is being activated. Refresh in a moment, or contact support@mintrage.com if this stays here.")) : null,
        h("div", { class: "row-actions" }, refresh)));
    });
  }

  function dashboard() {
    if (me.status === "pending") return onboarding();
    var on = me.status === "active";
    var card = function (href, t, d) { return h("a", { class: "card" + (on ? "" : " disabled"), href: href }, h("h3", null, t), h("p", null, d)); };
    shell("#/", h("div", null,
      h("h1", null, "Welcome, " + me.fullName),
      statusNotice(),
      h("div", { class: "panel" }, MT.kv([["Status", MT.badge(me.status)], ["Seller ID", me.sellerCode], ["Registration expires", MT.date(me.expiresAt)], ["Email", me.email]])),
      h("div", { class: "cards" },
        card("#/catalogue", "Catalogue", "Services, base prices and specifications."),
        card("#/order", "Place an order", "Submit a customer order."),
        card("#/orders", "My orders", "Track status and download deliverables."),
        card("#/resources", "Marketing materials", "Resources for promoting your services."),
        h("a", { class: "card", href: "#/account" }, h("h3", null, "Account"), h("p", null, "Your details and password.")),
        h("a", { class: "card", href: "mailto:support@mintrage.com" }, h("h3", null, "Support"), h("p", null, "support@mintrage.com")))));
  }

  function catalogue() {
    return api("GET", "/seller/catalogue").then(function (r) {
      shell("#/catalogue", h("div", null, h("h1", null, "Catalogue"), r.services.map(function (s) {
        return h("div", { class: "panel" }, h("h3", null, s.name), s.scope ? h("p", { class: "small" }, s.scope) : null,
          MT.kv([["Category", s.category], ["Base price", MT.money(s.basePrice)], ["Estimated delivery", s.deliveryMinDays + "-" + s.deliveryMaxDays + " days"], ["Revisions", s.revisions == null ? "Confirmed on order" : "Up to " + s.revisions]]),
          s.description ? h("p", { class: "mt" }, s.description) : null, s.specs ? h("pre", { class: "pre mt" }, s.specs) : null);
      }), h("p", { class: "small" }, "Delivery times are estimates, not guaranteed dates. Terms are confirmed when an order is accepted.")));
    });
  }

  function orderForm() {
    return api("GET", "/seller/catalogue").then(function (r) {
      var svc = h("select", null, h("option", { value: "" }, "Choose a service"), r.services.map(function (s) { return h("option", { value: s.id }, s.name + " (" + MT.money(s.basePrice) + ")"); }));
      var info = h("div", { class: "hint", "aria-live": "polite" }, "Select a service to see its base price and estimated delivery.");
      var req = h("textarea", { maxlength: 5000, placeholder: "Describe exactly what your customer needs: names, text, style, colours, formats, deadlines." });
      var links = h("textarea", { maxlength: 2000, placeholder: "One link per line (reference images, files, pages)" });
      var ref = h("input", { maxlength: 80, placeholder: "Optional, for your own records" });
      var box = h("div"), review = h("div");
      svc.addEventListener("change", function () {
        var s = r.services.filter(function (x) { return x.id === svc.value; })[0];
        info.textContent = s ? "Base price " + MT.money(s.basePrice) + ". Estimated delivery " + s.deliveryMinDays + "-" + s.deliveryMaxDays + " days after payment is verified (an estimate). " + (s.revisions == null ? "Revisions are confirmed on order." : "Up to " + s.revisions + " revisions included.") : "Select a service to see its base price and estimated delivery.";
      });
      function toReview() {
        var s = r.services.filter(function (x) { return x.id === svc.value; })[0];
        if (!s) return MT.toast("Please choose a service.", true);
        if (req.value.trim().length < 10) return MT.toast("Please describe the order requirements (at least 10 characters).", true);
        box.hidden = true;
        review.replaceChildren(h("div", { class: "panel" }, h("h2", null, "Review your order"),
          MT.kv([["Service", s.name], ["Base price", MT.money(s.basePrice)], ["Estimated delivery", s.deliveryMinDays + "-" + s.deliveryMaxDays + " days"], ["Your reference", ref.value.trim()]]),
          h("h3", { class: "mt" }, "Requirements"), h("pre", { class: "pre" }, req.value.trim()), links.value.trim() ? [h("h3", { class: "mt" }, "Links"), MT.linkify(links.value.trim())] : null,
          h("p", { class: "small mt" }, "After you submit, we review the order and email you payment instructions. Production starts only after we verify your payment."),
          h("div", { class: "row-actions" },
            h("button", { class: "btn btn-p", type: "button", onclick: function (ev) { submit(ev.target, s); } }, "Submit order"),
            h("button", { class: "btn btn-s", type: "button", onclick: function () { review.replaceChildren(); box.hidden = false; } }, "Edit"))));
      }
      function submit(btn, s) {
        btn.disabled = true;
        api("POST", "/seller/orders", { serviceId: s.id, requirements: req.value.trim(), links: links.value.trim(), sellerReference: ref.value.trim() })
          .then(function (res) { MT.toast("Order " + res.orderCode + " submitted."); location.hash = "#/orders/" + res.orderCode; })
          .catch(function (e) { btn.disabled = false; MT.toast(e.message, true); });
      }
      box.append(MT.field("Service", svc), info, h("div", { class: "mt" }), MT.field("Order requirements", req), MT.field("Reference links", links), MT.field("Your order reference", ref), h("button", { class: "btn btn-p", type: "button", onclick: toReview }, "Review order"));
      shell("#/order", h("div", { class: "grid2" }, h("div", null, h("h1", null, "Place an order"), h("div", { class: "panel" }, box), review)));
    });
  }

  function orders() {
    return api("GET", "/seller/orders").then(function (r) {
      var body = r.orders.length ? h("div", { class: "tbl-wrap" }, h("table", { class: "tbl" }, h("thead", null, h("tr", null, ["Order", "Service", "Base price", "Status", "Submitted"].map(function (t) { return h("th", null, t); }))),
        h("tbody", null, r.orders.map(function (o) { return h("tr", { class: "click", onclick: function () { location.hash = "#/orders/" + o.orderCode; } }, h("td", null, h("a", { href: "#/orders/" + o.orderCode }, o.orderCode)), h("td", null, o.service), h("td", null, MT.money(o.basePrice)), h("td", null, MT.badge(o.status)), h("td", null, MT.date(o.createdAt))); }))))
        : h("p", null, "You have no orders yet. ", h("a", { href: "#/order" }, "Place your first order"), ".");
      shell("#/orders", h("div", null, h("h1", null, "My orders"), h("div", { class: "panel" }, body)));
    });
  }

  function orderDetail(code) {
    return api("GET", "/seller/orders/" + encodeURIComponent(code)).then(function (r) {
      var o = r.order, extra = [];
      if (o.deliverableUrl) extra.push(h("div", { class: "panel" }, h("h2", null, "Your deliverable"), o.deliverableNote ? h("p", null, o.deliverableNote) : null, h("a", { class: "btn btn-p", href: o.deliverableUrl, target: "_blank", rel: "noopener noreferrer" }, "Download deliverable")));
      if (o.status === "delivered") {
        var left = o.revisionsAllowed == null ? null : o.revisionsAllowed - o.revisionsUsed, note = h("textarea", { maxlength: 2000, placeholder: "Describe exactly what needs to change" });
        extra.push(h("div", { class: "panel" }, h("h2", null, "Request a revision"), h("p", { class: "small" }, left == null ? "Revisions are confirmed on order." : left + " revision(s) remaining."),
          left === 0 ? h("p", null, "No revisions remain. Contact support@mintrage.com.") : [MT.field("What should change?", note), h("button", { class: "btn btn-s", type: "button", onclick: function (ev) { ev.target.disabled = true; api("POST", "/seller/orders/" + encodeURIComponent(code) + "/revision", { note: note.value.trim() }).then(function () { MT.toast("Revision requested."); orderDetail(code); }).catch(function (e) { ev.target.disabled = false; MT.toast(e.message, true); }); } }, "Send revision request")]));
      }
      shell("#/orders", h("div", { class: "grid2" },
        h("div", null, h("h1", null, o.orderCode), h("div", { class: "panel" }, MT.kv([["Service", o.service], ["Status", MT.badge(o.status)], ["Payment", MT.badge(o.paymentStatus)], ["Base price", MT.money(o.basePrice)], ["Estimated delivery", o.deliveryMin + "-" + o.deliveryMax + " days after payment (estimate)"], ["Your reference", o.sellerReference], ["Submitted", MT.dateTime(o.createdAt)]])),
          h("div", { class: "panel" }, h("h3", null, "Requirements"), h("pre", { class: "pre" }, o.requirements), o.links ? [h("h3", { class: "mt" }, "Links"), MT.linkify(o.links)] : null), extra),
        h("div", { class: "panel" }, h("h2", null, "Progress"), h("ul", { class: "timeline" }, r.events.map(function (ev) { return h("li", null, ev.to_status ? MT.label(ev.to_status) : ev.type.replace(/_/g, " "), h("small", null, MT.dateTime(ev.created_at)), ev.note ? h("small", null, ev.note) : null); })))));
    });
  }

  function resources() {
    return api("GET", "/seller/resources").then(function (r) {
      shell("#/resources", h("div", null, h("h1", null, "Marketing materials"),
        r.resources.length ? r.resources.map(function (x) { return h("div", { class: "panel" }, h("h3", null, x.title), h("p", { class: "small" }, "Set " + x.setNo), x.description ? h("p", null, x.description) : null, h("a", { class: "btn btn-s btn-sm", href: x.url, target: "_blank", rel: "noopener noreferrer" }, "Open")); })
          : h("div", { class: "notice" }, h("p", null, "Your marketing materials will appear here once we have uploaded them."))));
    });
  }

  function account() {
    var name = h("input", { value: me.fullName, maxlength: 120 }), biz = h("input", { value: me.countryBusiness || "", maxlength: 80 }), page = h("input", { value: me.businessPage || "", type: "url", maxlength: 300, placeholder: "https://" });
    var cur = h("input", { type: "password", autocomplete: "current-password" }), np = h("input", { type: "password", autocomplete: "new-password", minlength: 10 });
    shell("#/account", h("div", { class: "grid2" },
      h("div", { class: "panel" }, h("h2", null, "Your details"), MT.kv([["Email", me.email], ["Seller ID", me.sellerCode], ["Status", MT.badge(me.status)]]), h("div", { class: "mt2" }),
        MT.field("Full name", name), MT.field("Country of business", biz), MT.field("Business or social media page", page),
        h("button", { class: "btn btn-p", type: "button", onclick: function () { api("PUT", "/me", { fullName: name.value, countryBusiness: biz.value, businessPage: page.value }).then(function (r) { me = r.profile; MT.toast("Saved."); }).catch(function (e) { MT.toast(e.message, true); }); } }, "Save")),
      h("div", { class: "panel" }, h("h2", null, "Change password"), MT.field("Current password", cur), MT.field("New password", np, "At least 10 characters."),
        h("button", { class: "btn btn-s", type: "button", onclick: function () { api("POST", "/auth/change-password", { current: cur.value, password: np.value }).then(function () { cur.value = ""; np.value = ""; MT.toast("Password changed."); }).catch(function (e) { MT.toast(e.message, true); }); } }, "Change password"),
        h("p", { class: "small mt2" }, "Need help? support@mintrage.com"))));
  }

  function route() {
    var r = location.hash || "#/", m;
    var go = r === "#/" || r === "#" ? dashboard : r === "#/catalogue" ? catalogue : r === "#/order" ? orderForm : r === "#/orders" ? orders : r === "#/resources" ? resources : r === "#/account" ? account : (m = r.match(/^#\/orders\/([A-Za-z0-9-]+)$/)) ? function () { return orderDetail(m[1]); } : dashboard;
    Promise.resolve().then(go).catch(err);
    window.scrollTo(0, 0);
  }
  api("GET", "/me").then(function (r) {
    me = r.profile;
    if (me.role === "admin") { location.replace("/admin"); return; }
    window.addEventListener("hashchange", route); route();
  }).catch(function () { location.replace("/login"); });
})();
