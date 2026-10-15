// Mintrage API — Cloudflare Pages Function (one file, all routes under /api/*).
// Secrets come from environment variables only. See SETUP.md.

const AGREEMENT_VERSION = "1.0";
const SESSION_DAYS = 7;
const COOKIE = "__Host-mt_session";
const enc = new TextEncoder();

// ---------- tiny helpers ----------
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const bad = (m) => new HttpError(400, m);
const nowIso = () => new Date().toISOString();
const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "x-robots-tag": "noindex", ...extra },
});
const siteUrl = (env) => (env.SITE_URL || "https://mintrage.com").replace(/\/$/, "");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const randToken = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
async function sha256(s) { return hex(await crypto.subtle.digest("SHA-256", enc.encode(s))); }
function safeEqual(a, b) {
  const x = enc.encode(String(a)), y = enc.encode(String(b));
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] || 0) ^ (y[i] || 0);
  return d === 0;
}
async function hmacHex(secret, data) {
  const k = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", k, enc.encode(data)));
}
const addMonths = (d, m) => { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + m); return x; };

// ---------- passwords (PBKDF2-SHA256, salted; 100k is the Workers maximum) ----------
const ITER = 100000;
async function pbkdf2(password, salt, iter) {
  const k = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, k, 256));
}
async function hashPassword(pw) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITER}$${b64url(salt)}$${b64url(await pbkdf2(pw, salt, ITER))}`;
}
const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
async function verifyPassword(pw, stored) {
  const [alg, it, s, h] = String(stored || "").split("$");
  if (alg !== "pbkdf2") return false;
  return safeEqual(b64url(await pbkdf2(pw, unb64(s), Number(it))), h);
}
const DUMMY_HASH = "pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

// ---------- validation ----------
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
function str(b, k, { min = 1, max = 200, label = k } = {}) {
  const v = typeof b[k] === "string" ? b[k].trim() : "";
  if (v.length < min || v.length > max) throw bad(min ? `${label} is required (max ${max} characters).` : `${label} is too long (max ${max} characters).`);
  return v;
}
function email(b, k = "email") {
  const v = str(b, k, { max: 254, label: "Email" }).toLowerCase();
  if (!EMAIL_RE.test(v)) throw bad("Please enter a valid email address.");
  return v;
}
function httpUrl(v, label, httpsOnly = false) {
  try {
    const u = new URL(v);
    if (!(u.protocol === "https:" || (!httpsOnly && u.protocol === "http:"))) throw 0;
    return u.href;
  } catch { throw bad(`${label} must be a valid ${httpsOnly ? "https " : ""}link.`); }
}
function password(b, k = "password") {
  const v = typeof b[k] === "string" ? b[k] : "";
  if (v.length < 10 || v.length > 128) throw bad("Password must be 10 to 128 characters.");
  return v;
}
const likeEsc = (s) => s.replace(/[\\%_]/g, (c) => "\\" + c);
const cents = (v) => { const n = Math.round(Number(v) * 100); if (!Number.isFinite(n) || n <= 0 || n > 10000000) throw bad("Price must be greater than 0."); return n; };
const intIn = (v, min, max, label) => { const n = Number(v); if (!Number.isInteger(n) || n < min || n > max) throw bad(`${label} must be a whole number from ${min} to ${max}.`); return n; };
const clientIp = (req) => req.headers.get("cf-connecting-ip") || "unknown";

async function rateLimit(env, key, limit, windowSec) {
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare("SELECT window_start, count FROM rate_limits WHERE k=?").bind(key).first();
  if (!row || now - row.window_start >= windowSec) {
    await env.DB.prepare("INSERT INTO rate_limits(k,window_start,count) VALUES(?,?,1) ON CONFLICT(k) DO UPDATE SET window_start=excluded.window_start,count=1").bind(key, now).run();
    return;
  }
  if (row.count >= limit) throw new HttpError(429, "Too many attempts. Please wait a while and try again.");
  await env.DB.prepare("UPDATE rate_limits SET count=count+1 WHERE k=?").bind(key).run();
}

// ---------- settings ----------
async function getSettings(env) {
  const { results } = await env.DB.prepare("SELECT key,value FROM settings").all();
  const s = Object.fromEntries(results.map((r) => [r.key, r.value]));
  return {
    registrationMode: s.registration_mode === "gateway" ? "gateway" : "manual",
    notifyEmail: s.notify_email || "mintrage.commerce@gmail.com",
    defaultMarketingSets: Number(s.default_marketing_sets || 1),
    feeCents: Number(s.registration_fee_cents || 2500),
    validityMonths: Number(s.registration_validity_months || 12),
    checkoutUrl: s.checkout_url || "",
    lastCheckoutError: s.last_checkout_error || "",
  };
}

// ---------- email (provider-independent; sender configurable via EMAIL_FROM) ----------
const EMAIL_PROVIDERS = {
  resend: {
    configured: (env) => !!env.RESEND_API_KEY,
    async send(env, m) {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: env.EMAIL_FROM || "Mintrage <support@mintrage.com>", to: [m.to], subject: m.subject, html: m.html, text: m.text, reply_to: env.EMAIL_REPLY_TO || "support@mintrage.com" }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || `Email provider error ${r.status}`);
      return j.id || null;
    },
  },
};
const emailProvider = (env) => EMAIL_PROVIDERS[env.EMAIL_PROVIDER || "resend"];
const emailConfigured = (env) => !!emailProvider(env)?.configured(env);

async function sendEmail(env, to, tpl, template) {
  const id = crypto.randomUUID();
  let status = "not_configured", providerId = null, error = null;
  try {
    if (emailConfigured(env)) { providerId = await emailProvider(env).send(env, { to, ...tpl }); status = "sent"; }
  } catch (e) { status = "failed"; error = String(e.message || e).slice(0, 300); }
  try {
    await env.DB.prepare("INSERT INTO email_log(id,to_email,subject,template,status,provider_id,error,created_at) VALUES(?,?,?,?,?,?,?,?)")
      .bind(id, to, tpl.subject, template, status, providerId, error, nowIso()).run();
  } catch (e) { console.error("email_log", e); }
  return status;
}

function mk(env, subject, lines, button) {
  const S = siteUrl(env);
  const body = lines.map((l) => `<p style="margin:0 0 14px">${esc(l).replace(/\n/g, "<br>")}</p>`).join("") +
    (button ? `<p style="margin:22px 0 6px"><a href="${esc(button.url)}" style="background:#1A2152;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;display:inline-block;font-weight:bold">${esc(button.label)}</a></p><p style="font-size:12px;color:#6B6D8A;word-break:break-all">${esc(button.url)}</p>` : "");
  const html = `<!doctype html><html><body style="margin:0;background:#F4F4F9;font-family:Arial,Helvetica,sans-serif;color:#1B1D3A"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="560" style="max-width:560px;width:100%;background:#fff;border-radius:14px;overflow:hidden"><tr><td bgcolor="#080817" style="background:#080817;padding:0"><img src="${S}/email-header.png" width="560" alt="Mintrage" style="display:block;width:100%;height:auto"></td></tr><tr><td style="padding:28px;font-size:15px;line-height:1.6">${body}</td></tr><tr><td style="padding:16px 28px;background:#F4F4F9;font-size:12px;color:#6B6D8A">Mintrage · support@mintrage.com</td></tr></table></td></tr></table></body></html>`;
  const text = lines.join("\n\n") + (button ? `\n\n${button.label}: ${button.url}` : "") + "\n\nMintrage · support@mintrage.com";
  return { subject, html, text };
}
const money = (c, cur = "USD") => `${cur === "USD" ? "US$" : cur + " "}${(c / 100).toFixed(c % 100 ? 2 : 0)}`;
const fdate = (iso) => (iso ? new Date(iso).toUTCString().slice(5, 16) : "");

const T = {
  verifyEmail: (env, u, link) => mk(env, "Confirm your email for Mintrage", [`Hello ${u.full_name},`, "We received your Mintrage seller registration. Please confirm your email address. The link works for 48 hours.", "Your seller account activates automatically as soon as your registration payment is verified and your email is confirmed."], { url: link, label: "Confirm email" }),
  received: (env, u, mode) => mk(env, "We received your Mintrage registration", [`Hello ${u.full_name},`, mode === "gateway" ? "Your registration is saved. Two steps remain:" : "Your registration is saved as pending. We will email you payment details.", mode === "gateway" ? "1. Confirm your email with the link in the separate email we sent you.\n2. Pay the US$25 registration fee at secure checkout. If you were not taken to checkout, log in and tap Continue to payment." : "", mode === "gateway" ? "Your seller portal opens automatically once both are done." : "Your account becomes active only after your payment is verified. A payment page redirect alone does not activate it."].filter(Boolean), mode === "gateway" ? { url: siteUrl(env) + "/login", label: "Log in and continue to payment" } : undefined),
  adminNewReg: (env, u) => mk(env, `New seller registration: ${u.full_name}`, [`Name: ${u.full_name}`, `Email: ${u.email}`, `Seller ID: ${u.seller_code}`, `Residence: ${u.country_residence}`, `Business country: ${u.country_business}`, `Page: ${u.business_page || "-"}`], { url: siteUrl(env) + "/admin", label: "Open admin" }),
  instructions: (env, u, text) => mk(env, "Your Mintrage registration: agreement and payment details", [`Hello ${u.full_name},`, `Please read the Seller Agreement (version ${AGREEMENT_VERSION}) at the link below. Your acceptance of it is already recorded from your registration.`, "Payment instructions for the US$25 annual registration fee:", text, "Please send us your payment details and proof of payment after you pay. Your account is activated only after we verify the payment."], { url: siteUrl(env) + "/seller-agreement", label: "Read the Seller Agreement" }),
  rejected: (env, u, reason, refunded) => mk(env, "Update on your Mintrage registration", [`Hello ${u.full_name},`, "We are unable to approve your registration at this time.", reason ? `Reason: ${reason}` : "", refunded ? "If you paid the registration fee, it will be refunded within 10 to 15 days." : ""].filter(Boolean)),
  activated: (env, u) => mk(env, "Your Mintrage seller account is active", [`Welcome to Mintrage, ${u.full_name}.`, `Your Seller ID is ${u.seller_code}. Your registration is valid until ${fdate(u.expires_at)}.`, "Log in to see the catalogue, place orders, track them and download your marketing materials. Registration does not guarantee sales or income.", "Questions? Reply to this email or write to support@mintrage.com."], { url: siteUrl(env) + "/portal", label: "Open seller portal" }),
  reset: (env, u, link) => mk(env, "Reset your Mintrage password", [`Hello ${u.full_name},`, "Use the link below to choose a new password. It works for 1 hour. If you did not ask for this, you can ignore this email."], { url: link, label: "Reset password" }),
  orderSubmitted: (env, u, o) => mk(env, `Order ${o.order_code} received`, [`Hello ${u.full_name},`, `We received your order for ${o.service_name}.`, `Order ID: ${o.order_code}\nBase price: ${money(o.base_price_cents, o.currency)}\nEstimated delivery after payment is verified: ${o.delivery_min_days}-${o.delivery_max_days} days (an estimate, not a guaranteed date).`, "We will review your order and email you payment instructions. Production starts only after we verify your payment."], { url: siteUrl(env) + "/portal#/orders/" + o.order_code, label: "View order" }),
  adminNewOrder: (env, u, o) => mk(env, `New order ${o.order_code}: ${o.service_name}`, [`Seller: ${u.full_name} (${u.seller_code}, ${u.email})`, `Service: ${o.service_name}`, `Base price: ${money(o.base_price_cents, o.currency)}`, `Seller reference: ${o.seller_reference || "-"}`], { url: siteUrl(env) + "/admin#/orders/" + o.order_code, label: "Open order" }),
  orderPayment: (env, u, o, text) => mk(env, `Payment details for order ${o.order_code}`, [`Hello ${u.full_name},`, `Please pay the base price of ${money(o.base_price_cents, o.currency)} for ${o.service_name}.`, text, "Send us your payment details and proof of payment. Production starts after we verify your payment."], { url: siteUrl(env) + "/portal#/orders/" + o.order_code, label: "View order" }),
  paymentVerified: (env, u, o) => mk(env, `Payment verified for order ${o.order_code}`, [`Hello ${u.full_name},`, `We verified your payment for ${o.service_name}. Production can now begin. Estimated delivery: ${o.delivery_min_days}-${o.delivery_max_days} days.`], { url: siteUrl(env) + "/portal#/orders/" + o.order_code, label: "View order" }),
  production: (env, u, o) => mk(env, `Production started: ${o.order_code}`, [`Hello ${u.full_name},`, `Production has started on your order for ${o.service_name}.`], { url: siteUrl(env) + "/portal#/orders/" + o.order_code, label: "View order" }),
  delivered: (env, u, o, url, note) => mk(env, `Order ${o.order_code} delivered`, [`Hello ${u.full_name},`, `Your order for ${o.service_name} is ready. Deliver it to your customer.`, note || "", "Request a revision from your portal if it needs changes, within the revisions included in the service."].filter(Boolean), { url, label: "Download your deliverable" }),
  revisionAdmin: (env, u, o, note) => mk(env, `Revision requested: ${o.order_code}`, [`Seller: ${u.full_name} (${u.seller_code})`, `Order: ${o.order_code} ${o.service_name}`, `Note: ${note}`], { url: siteUrl(env) + "/admin#/orders/" + o.order_code, label: "Open order" }),
  message: (env, u, subject, body) => mk(env, subject, [`Hello ${u.full_name},`, body]),
  paymentReceived: (env, u, link) => mk(env, "Payment received: confirm your email to open your portal", [`Hello ${u.full_name},`, "We received your Mintrage registration payment. One last step: confirm your email address and your seller portal opens right away.", "The link works for 48 hours."], { url: link, label: "Confirm email and open my portal" }),
  paymentFlag: (env, u, why) => mk(env, `Payment needs review: ${u.full_name}`, [`Seller: ${u.full_name} (${u.seller_code}, ${u.email})`, why], { url: siteUrl(env) + "/admin", label: "Open admin" }),
};

// ---------- payment gateways (provider-independent layer) ----------
// Each adapter: configured(env), verifyWebhook(rawBody, headers, env) -> normalized event or null, createCheckout(env, user, settings)
const GATEWAYS = {
  // "mock" lets you test the full pipeline with signed events and no real provider.
  mock: {
    configured: (env) => !!env.MOCK_WEBHOOK_SECRET,
    async verifyWebhook(raw, headers, env) {
      const sig = headers.get("x-mintrage-signature") || "";
      if (!env.MOCK_WEBHOOK_SECRET || !safeEqual(await hmacHex(env.MOCK_WEBHOOK_SECRET, raw), sig)) return null;
      const b = JSON.parse(raw);
      return { id: String(b.id), kind: b.type === "payment.succeeded" ? "paid" : b.type === "payment.refunded" ? "refunded" : "other", userId: b.registration_id, amountCents: Number(b.amount_cents), currency: b.currency, test: !!b.test };
    },
    hasCheckout: () => true,
    async createCheckout() { return null; },
  },
  // Lemon Squeezy adapter: written from the provider's public docs and NOT yet tested against a real account.
  lemonsqueezy: {
    // Webhook verification only needs the signing secret. A checkout can come from a payment link set in Admin > Settings, or from the API keys below.
    configured: (env) => !!env.LEMONSQUEEZY_WEBHOOK_SECRET,
    hasCheckout: (env) => !!(env.LEMONSQUEEZY_API_KEY && env.LEMONSQUEEZY_STORE_ID && env.LEMONSQUEEZY_VARIANT_ID),
    async verifyWebhook(raw, headers, env) {
      const sig = headers.get("x-signature") || "";
      if (!env.LEMONSQUEEZY_WEBHOOK_SECRET || !safeEqual(await hmacHex(env.LEMONSQUEEZY_WEBHOOK_SECRET, raw), sig)) return null;
      const b = JSON.parse(raw); const name = b?.meta?.event_name; const a = b?.data?.attributes || {};
      const paid = name === "order_created" && a.status === "paid";
      return { id: `${name}:${b?.data?.id}`, kind: paid ? "paid" : name === "order_refunded" ? "refunded" : "other", userId: b?.meta?.custom_data?.registration_id, amountCents: Number(a.total), currency: String(a.currency || "").toUpperCase(), test: !!(b?.meta?.test_mode ?? a.test_mode) };
    },
    async createCheckout(env, user) {
      const r = await fetch("https://api.lemonsqueezy.com/v1/checkouts", {
        method: "POST",
        headers: { Accept: "application/vnd.api+json", "Content-Type": "application/vnd.api+json", Authorization: `Bearer ${env.LEMONSQUEEZY_API_KEY}` },
        body: JSON.stringify({ data: { type: "checkouts", attributes: { ...(env.PAYMENT_ENV === "live" ? {} : { test_mode: true }), checkout_data: { email: user.email, name: user.full_name, custom: { registration_id: user.id } }, product_options: { redirect_url: siteUrl(env) + "/login?paid=1" } }, relationships: { store: { data: { type: "stores", id: String(env.LEMONSQUEEZY_STORE_ID) } }, variant: { data: { type: "variants", id: String(env.LEMONSQUEEZY_VARIANT_ID) } } } } }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`Lemon Squeezy answered ${r.status}: ${String(j?.errors?.[0]?.detail || j?.errors?.[0]?.title || j?.message || "no details").slice(0, 200)}`);
      if (!j?.data?.attributes?.url) throw new Error("Lemon Squeezy answered without a checkout link");
      return j?.data?.attributes?.url || null;
    },
  },
};
const gateway = (env) => GATEWAYS[env.PAYMENT_PROVIDER || ""] || null;
const gatewayConfigured = (env) => !!gateway(env)?.configured(env);
const checkoutReady = (env, settings) => !!gateway(env)?.configured(env) && !!(settings.checkoutUrl || gateway(env)?.hasCheckout?.(env));
async function setSetting(env, k, v) { await env.DB.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(k, String(v)).run(); }
// Build the link a buyer is sent to. Prefers the payment link pasted in Admin > Settings; otherwise asks the provider's API.
async function makeCheckout(env, user, settings) {
  if (settings.checkoutUrl) {
    try {
      const u = new URL(settings.checkoutUrl);
      u.searchParams.set("checkout[email]", user.email);
      u.searchParams.set("checkout[name]", user.full_name);
      u.searchParams.set("checkout[custom][registration_id]", user.id);
      return u.href;
    } catch { await setSetting(env, "last_checkout_error", nowIso() + " The saved payment link is not a valid link."); return null; }
  }
  const gw = gateway(env);
  if (!gw?.hasCheckout?.(env)) return null;
  try { return await gw.createCheckout(env, user, settings); }
  catch (e) { await setSetting(env, "last_checkout_error", nowIso() + " " + String(e.message || e).slice(0, 300)).catch(() => {}); console.error("checkout", e.message); return null; }
}
const paymentEnv = (env) => (env.PAYMENT_ENV === "live" ? "live" : "test");

// ---------- users & sessions ----------
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const code = (len) => [...crypto.getRandomValues(new Uint8Array(len))].map((b) => ALPHABET[b % ALPHABET.length]).join("");
const effStatus = (u) => (u.role === "admin" ? "admin" : u.status === "active" && u.expires_at && u.expires_at <= nowIso() ? "expired" : u.status);
const isActiveSeller = (u) => u.role === "seller" && effStatus(u) === "active" && !!u.email_verified_at;
const profile = (u) => ({
  id: u.id, sellerCode: u.seller_code, email: u.email, fullName: u.full_name, role: u.role, status: effStatus(u),
  countryResidence: u.country_residence, countryBusiness: u.country_business, businessPage: u.business_page,
  activatedAt: u.activated_at, expiresAt: u.expires_at, marketingSets: u.marketing_sets, emailVerified: !!u.email_verified_at, paymentStatus: u.payment_status, createdAt: u.created_at,
});
const adminSeller = (u) => ({ ...profile(u), rawStatus: u.status, paymentStatus: u.payment_status, paymentMethod: u.payment_method, paymentReference: u.payment_reference, paymentVerifiedAt: u.payment_verified_at, instructionsSentAt: u.instructions_sent_at, agreementVersion: u.agreement_version, agreementAcceptedAt: u.agreement_accepted_at, adminNotes: u.admin_notes || "", rejectReason: u.reject_reason });

async function sessionUser(c) {
  const m = (c.request.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return null;
  return await c.env.DB.prepare("SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?").bind(await sha256(m[1]), nowIso()).first();
}
async function startSession(env, userId) {
  const token = randToken(32);
  const exp = new Date(Date.now() + SESSION_DAYS * 864e5);
  await env.DB.prepare("INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)").bind(await sha256(token), userId, nowIso(), exp.toISOString()).run();
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}
const clearCookie = `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
async function makeToken(env, userId, purpose, hours) {
  const t = randToken(32);
  await env.DB.prepare("INSERT INTO tokens(token_hash,user_id,purpose,expires_at) VALUES(?,?,?,?)").bind(await sha256(t), userId, purpose, new Date(Date.now() + hours * 36e5).toISOString()).run();
  return t;
}
async function useToken(env, token, purpose) {
  if (typeof token !== "string" || token.length < 20 || token.length > 100) throw bad("This link is invalid or has expired.");
  const h = await sha256(token);
  const r = await env.DB.prepare("UPDATE tokens SET used_at=? WHERE token_hash=? AND purpose=? AND used_at IS NULL AND expires_at>? RETURNING user_id").bind(nowIso(), h, purpose, nowIso()).first();
  if (!r) throw bad("This link is invalid or has expired.");
  return r.user_id;
}
async function userById(env, id) { return await env.DB.prepare("SELECT * FROM users WHERE id=?").bind(id).first(); }

async function activateUser(env, u, set) {
  const months = (await getSettings(env)).validityMonths;
  const now = new Date();
  const base = u.status === "active" && u.expires_at && new Date(u.expires_at) > now ? new Date(u.expires_at) : now;
  const exp = addMonths(base, months).toISOString();
  const ts = nowIso();
  await env.DB.prepare("UPDATE users SET status='active', activated_at=COALESCE(activated_at,?), last_activation_at=?, expires_at=?, reject_reason=NULL, updated_at=? WHERE id=?").bind(ts, ts, exp, ts, u.id).run();
  const fresh = await userById(env, u.id);
  await sendEmail(env, fresh.email, T.activated(env, fresh), "activated");
  return fresh;
}
// Gateway path: only after a verified payment event AND the registration checks pass.
async function tryGatewayActivation(env, u) {
  if (u.role !== "seller" || u.status !== "pending" || u.payment_status !== "verified" || !u.email_verified_at) return false;
  if ((await getSettings(env)).registrationMode !== "gateway") return false;
  await activateUser(env, u);
  return true;
}

// ---------- order helpers ----------
const ORDER_STATUSES = ["pending_payment", "needs_information", "payment_verified", "in_production", "quality_check", "delivered", "revision_requested", "completed", "on_hold", "cancelled"];
const NEEDS_PAYMENT = ["in_production", "quality_check", "delivered", "completed", "revision_requested"];
async function addEvent(env, orderId, actorId, type, from, to, note, pub = 0) {
  await env.DB.prepare("INSERT INTO order_events(id,order_id,actor_id,type,from_status,to_status,note,is_public,created_at) VALUES(?,?,?,?,?,?,?,?,?)").bind(crypto.randomUUID(), orderId, actorId, type, from, to, note || null, pub, nowIso()).run();
}
const orderRow = (o, admin = false) => ({
  orderCode: o.order_code, service: o.service_name, basePrice: o.base_price_cents / 100, currency: o.currency, status: o.status, paymentStatus: o.payment_status,
  deliveryMin: o.delivery_min_days, deliveryMax: o.delivery_max_days, revisionsAllowed: o.revisions_allowed, revisionsUsed: o.revisions_used,
  sellerReference: o.seller_reference, createdAt: o.created_at, updatedAt: o.updated_at, deliveredAt: o.delivered_at,
  ...(admin ? { id: o.id, sellerId: o.seller_id } : {}),
});
const serviceRow = (s, full = false) => ({
  id: s.id, name: s.name, category: s.category, scope: s.scope, basePrice: s.base_price_cents / 100, currency: s.currency,
  deliveryMinDays: s.delivery_min_days, deliveryMaxDays: s.delivery_max_days, revisions: s.revisions, active: !!s.active,
  ...(full ? { description: s.description, specs: s.specs, sortOrder: s.sort_order } : {}),
});

// ---------- routes ----------
const routes = [];
const R = (method, path, auth, handler, opts = {}) => routes.push({ method, re: new RegExp("^" + path.replace(/:(\w+)/g, "(?<$1>[^/]+)") + "/?$"), auth, handler, opts });

// public
R("GET", "/config", "none", async (c) => {
  const s = await getSettings(c.env);
  return json({ registrationMode: s.registrationMode, checkoutAvailable: s.registrationMode === "gateway" && checkoutReady(c.env, s), fee: s.feeCents / 100, validityMonths: s.validityMonths });
});
R("GET", "/catalogue", "none", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM services WHERE active=1 ORDER BY sort_order, name").all();
  return json({ services: results.map((s) => serviceRow(s)) }, 200, { "cache-control": "public, max-age=60" });
});

R("POST", "/register", "none", async (c) => {
  const b = c.body;
  if (typeof b.website === "string" && b.website) return json({ ok: true, mode: "manual", message: "Registration received." }); // honeypot
  await rateLimit(c.env, `reg:${c.ip}`, 6, 3600);
  const fullName = str(b, "fullName", { max: 120, label: "Full name" });
  const em = email(b);
  const pw = password(b);
  const res = str(b, "countryResidence", { max: 80, label: "Country of residence" });
  const biz = str(b, "countryBusiness", { max: 80, label: "Country of business" });
  const page = typeof b.businessPage === "string" && b.businessPage.trim() ? httpUrl(b.businessPage.trim().slice(0, 300), "Business page") : "";
  if (b.acceptAgreement !== true || b.acceptTerms !== true || b.acceptPrivacy !== true) throw bad("Please accept the Seller Agreement, Terms and Privacy Policy.");
  const settings = await getSettings(c.env);
  const exists = await c.env.DB.prepare("SELECT id FROM users WHERE email=?").bind(em).first();
  const generic = { ok: true, message: "Registration received. Check your email to confirm your address. Your account is not active until we verify payment and approve it." };
  if (exists) return json({ ...generic, mode: settings.registrationMode });
  const id = crypto.randomUUID(), ts = nowIso(), hash = await hashPassword(pw);
  let inserted = false;
  for (let i = 0; i < 5 && !inserted; i++) {
    try {
      await c.env.DB.prepare("INSERT INTO users(id,seller_code,email,password_hash,role,status,full_name,country_residence,country_business,business_page,agreement_version,agreement_accepted_at,terms_accepted_at,privacy_accepted_at,marketing_sets,created_at,updated_at) VALUES(?,?,?,?,'seller','pending',?,?,?,?,?,?,?,?,?,?,?)")
        .bind(id, "MNT-" + code(6), em, hash, fullName, res, biz, page, AGREEMENT_VERSION, ts, ts, ts, settings.defaultMarketingSets, ts, ts).run();
      inserted = true;
    } catch (e) { if (!/UNIQUE/i.test(String(e.message))) throw e; if (await c.env.DB.prepare("SELECT 1 FROM users WHERE email=?").bind(em).first()) return json({ ...generic, mode: settings.registrationMode }); }
  }
  if (!inserted) throw new HttpError(500, "Could not create the registration. Please try again.");
  const u = await userById(c.env, id);
  const token = await makeToken(c.env, id, "verify", 48);
  await sendEmail(c.env, em, T.verifyEmail(c.env, u, `${siteUrl(c.env)}/login?verify=${token}`), "verify_email");
  await sendEmail(c.env, em, T.received(c.env, u, settings.registrationMode), "registration_received");
  await sendEmail(c.env, settings.notifyEmail, T.adminNewReg(c.env, u), "admin_new_registration");
  let checkoutUrl = null;
  if (settings.registrationMode === "gateway" && checkoutReady(c.env, settings)) checkoutUrl = await makeCheckout(c.env, u, settings);
  return json({ ...generic, mode: settings.registrationMode, checkoutUrl });
});

// auth
R("POST", "/auth/login", "none", async (c) => {
  const em = email(c.body), pw = typeof c.body.password === "string" ? c.body.password.slice(0, 200) : "";
  await rateLimit(c.env, `login-ip:${c.ip}`, 20, 900);
  await rateLimit(c.env, `login-em:${em}`, 8, 900);
  const u = await c.env.DB.prepare("SELECT * FROM users WHERE email=?").bind(em).first();
  const ok = await verifyPassword(pw, u ? u.password_hash : DUMMY_HASH);
  if (!u || !ok) throw new HttpError(401, "Email or password is incorrect.");
  if (u.status === "rejected") throw new HttpError(403, "This account is not active. Please contact support@mintrage.com.");
  const cookie = await startSession(c.env, u.id);
  return json({ ok: true, profile: profile(u) }, 200, { "set-cookie": cookie });
});
R("POST", "/auth/logout", "none", async (c) => {
  const m = (c.request.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (m) await c.env.DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(await sha256(m[1])).run();
  return json({ ok: true }, 200, { "set-cookie": clearCookie });
});
R("POST", "/auth/forgot", "none", async (c) => {
  const em = email(c.body);
  await rateLimit(c.env, `forgot-ip:${c.ip}`, 10, 3600);
  await rateLimit(c.env, `forgot-em:${em}`, 3, 3600);
  const u = await c.env.DB.prepare("SELECT * FROM users WHERE email=? AND status!='rejected'").bind(em).first();
  if (u) {
    const t = await makeToken(c.env, u.id, "reset", 1);
    await sendEmail(c.env, u.email, T.reset(c.env, u, `${siteUrl(c.env)}/login?reset=${t}`), "password_reset");
  }
  return json({ ok: true, message: "If that email has an account, we have sent a reset link." });
});
R("POST", "/auth/reset", "none", async (c) => {
  await rateLimit(c.env, `reset-ip:${c.ip}`, 20, 3600);
  const pw = password(c.body);
  const uid = await useToken(c.env, c.body.token, "reset");
  const ts = nowIso();
  await c.env.DB.prepare("UPDATE users SET password_hash=?, email_verified_at=COALESCE(email_verified_at,?), updated_at=? WHERE id=?").bind(await hashPassword(pw), ts, ts, uid).run();
  await c.env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(uid).run();
  const u = await userById(c.env, uid); if (u) await tryGatewayActivation(c.env, u);
  return json({ ok: true });
});
R("POST", "/auth/verify", "none", async (c) => {
  await rateLimit(c.env, `verify-ip:${c.ip}`, 30, 3600);
  const uid = await useToken(c.env, c.body.token, "verify");
  await c.env.DB.prepare("UPDATE users SET email_verified_at=COALESCE(email_verified_at,?), updated_at=? WHERE id=?").bind(nowIso(), nowIso(), uid).run();
  const u = await userById(c.env, uid); if (u) await tryGatewayActivation(c.env, u);
  return json({ ok: true });
});
R("POST", "/auth/change-password", "user", async (c) => {
  const cur = typeof c.body.current === "string" ? c.body.current : "";
  await rateLimit(c.env, `chpw:${c.user.id}`, 8, 900);
  if (!(await verifyPassword(cur, c.user.password_hash))) throw new HttpError(400, "Your current password is incorrect.");
  const pw = password(c.body, "password");
  await c.env.DB.prepare("UPDATE users SET password_hash=?, updated_at=? WHERE id=?").bind(await hashPassword(pw), nowIso(), c.user.id).run();
  const m = (c.request.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  await c.env.DB.prepare("DELETE FROM sessions WHERE user_id=? AND token_hash!=?").bind(c.user.id, m ? await sha256(m[1]) : "").run();
  return json({ ok: true });
});
R("GET", "/me", "user", async (c) => json({ profile: profile(c.user) }));
R("POST", "/me/resend-verification", "user", async (c) => {
  if (c.user.email_verified_at) throw bad("Your email is already confirmed.");
  await rateLimit(c.env, `resend:${c.user.id}`, 3, 3600);
  const st = await sendEmail(c.env, c.user.email, T.verifyEmail(c.env, c.user, `${siteUrl(c.env)}/login?verify=${await makeToken(c.env, c.user.id, "verify", 48)}`), "verify_email");
  return json({ ok: st === "sent", emailStatus: st });
});
R("POST", "/me/checkout", "user", async (c) => {
  const u = c.user, settings = await getSettings(c.env);
  if (u.role !== "seller" || u.status !== "pending") throw bad("Checkout is only available for pending registrations.");
  if (u.payment_status === "verified") throw bad("Your payment is already verified.");
  if (settings.registrationMode !== "gateway" || !checkoutReady(c.env, settings)) throw bad("Online checkout is not available right now. We will email you payment details.");
  await rateLimit(c.env, `checkout:${u.id}`, 10, 3600);
  const url = await makeCheckout(c.env, u, settings);
  if (!url) throw new HttpError(502, "Checkout could not be started. Please try again in a moment.");
  return json({ ok: true, checkoutUrl: url });
});
R("PUT", "/me", "user", async (c) => {
  const name = str(c.body, "fullName", { max: 120, label: "Full name" });
  const biz = str(c.body, "countryBusiness", { max: 80, label: "Country of business" });
  const page = typeof c.body.businessPage === "string" && c.body.businessPage.trim() ? httpUrl(c.body.businessPage.trim().slice(0, 300), "Business page") : "";
  await c.env.DB.prepare("UPDATE users SET full_name=?, country_business=?, business_page=?, updated_at=? WHERE id=?").bind(name, biz, page, nowIso(), c.user.id).run();
  return json({ profile: profile(await userById(c.env, c.user.id)) });
});

// seller portal (active, verified, unexpired sellers only)
R("GET", "/seller/catalogue", "seller", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM services WHERE active=1 ORDER BY sort_order, name").all();
  return json({ services: results.map((s) => serviceRow(s, true)) });
});
R("POST", "/seller/orders", "seller", async (c) => {
  await rateLimit(c.env, `order:${c.user.id}`, 20, 3600);
  const b = c.body;
  const svc = await c.env.DB.prepare("SELECT * FROM services WHERE id=? AND active=1").bind(String(b.serviceId || "")).first();
  if (!svc) throw bad("Please choose an available service.");
  const requirements = str(b, "requirements", { min: 10, max: 5000, label: "Order requirements" });
  const rawLinks = typeof b.links === "string" ? b.links.trim() : "";
  if (rawLinks.length > 2000) throw bad("Links are too long (max 2000 characters).");
  const links = rawLinks ? rawLinks.split(/\s*\n\s*/).filter(Boolean).slice(0, 10).map((l) => httpUrl(l, "Each reference link")).join("\n") : "";
  const ref = typeof b.sellerReference === "string" ? b.sellerReference.trim().slice(0, 80) : "";
  const id = crypto.randomUUID(), ts = nowIso();
  let orderCode = null;
  for (let i = 0; i < 5 && !orderCode; i++) {
    const oc = `ORD-${ts.slice(2, 4)}${ts.slice(5, 7)}${ts.slice(8, 10)}-${code(5)}`;
    try {
      await c.env.DB.prepare("INSERT INTO orders(id,order_code,seller_id,service_id,service_name,base_price_cents,currency,delivery_min_days,delivery_max_days,revisions_allowed,requirements,links,seller_reference,status,payment_status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'pending_payment','unpaid',?,?)")
        .bind(id, oc, c.user.id, svc.id, svc.name, svc.base_price_cents, svc.currency, svc.delivery_min_days, svc.delivery_max_days, svc.revisions, requirements, links, ref, ts, ts).run();
      orderCode = oc;
    } catch (e) { if (!/UNIQUE/i.test(String(e.message))) throw e; }
  }
  if (!orderCode) throw new HttpError(500, "Could not create the order. Please try again.");
  await addEvent(c.env, id, c.user.id, "submitted", null, "pending_payment", "Order submitted", 1);
  const o = await c.env.DB.prepare("SELECT * FROM orders WHERE id=?").bind(id).first();
  const settings = await getSettings(c.env);
  await sendEmail(c.env, c.user.email, T.orderSubmitted(c.env, c.user, o), "order_submitted");
  await sendEmail(c.env, settings.notifyEmail, T.adminNewOrder(c.env, c.user, o), "admin_new_order");
  return json({ ok: true, orderCode });
});
R("GET", "/seller/orders", "seller", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM orders WHERE seller_id=? ORDER BY created_at DESC LIMIT 200").bind(c.user.id).all();
  return json({ orders: results.map((o) => orderRow(o)) });
});
R("GET", "/seller/orders/:code", "seller", async (c) => {
  const o = await c.env.DB.prepare("SELECT * FROM orders WHERE order_code=? AND seller_id=?").bind(c.params.code, c.user.id).first();
  if (!o) throw new HttpError(404, "Order not found.");
  const ev = await c.env.DB.prepare("SELECT type,from_status,to_status,note,created_at FROM order_events WHERE order_id=? AND is_public=1 ORDER BY created_at").bind(o.id).all();
  const released = ["delivered", "completed", "revision_requested"].includes(o.status);
  return json({ order: { ...orderRow(o), requirements: o.requirements, links: o.links, deliverableUrl: released ? o.deliverable_url : null, deliverableNote: released ? o.deliverable_note : null }, events: ev.results });
});
R("POST", "/seller/orders/:code/revision", "seller", async (c) => {
  const note = str(c.body, "note", { min: 5, max: 2000, label: "Revision details" });
  const o = await c.env.DB.prepare("SELECT * FROM orders WHERE order_code=? AND seller_id=?").bind(c.params.code, c.user.id).first();
  if (!o) throw new HttpError(404, "Order not found.");
  if (o.status !== "delivered") throw bad("A revision can only be requested after delivery.");
  if (o.revisions_allowed !== null && o.revisions_used >= o.revisions_allowed) throw bad("No revisions remain for this order. Please contact support.");
  await c.env.DB.prepare("UPDATE orders SET status='revision_requested', revisions_used=revisions_used+1, updated_at=? WHERE id=?").bind(nowIso(), o.id).run();
  await addEvent(c.env, o.id, c.user.id, "revision_requested", "delivered", "revision_requested", note, 1);
  await sendEmail(c.env, (await getSettings(c.env)).notifyEmail, T.revisionAdmin(c.env, c.user, o, note), "admin_revision");
  return json({ ok: true });
});
R("GET", "/seller/resources", "seller", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT id,title,description,url,set_no,service_id FROM resources WHERE active=1 AND set_no<=? ORDER BY set_no,title").bind(c.user.marketing_sets).all();
  return json({ resources: results.map((r) => ({ id: r.id, title: r.title, description: r.description, url: r.url, setNo: r.set_no, serviceId: r.service_id })) });
});

// ---------- admin ----------
R("GET", "/admin/status", "admin", async (c) => {
  const e = c.env, s = await getSettings(e);
  return json({ emailConfigured: emailConfigured(e), emailProvider: e.EMAIL_PROVIDER || "resend", emailFrom: e.EMAIL_FROM || "Mintrage <support@mintrage.com>", gatewayProvider: e.PAYMENT_PROVIDER || null, gatewayConfigured: gatewayConfigured(e), paymentEnv: paymentEnv(e), allowTestActivation: e.ALLOW_TEST_ACTIVATION === "true", siteUrl: siteUrl(e), webhookUrl: e.PAYMENT_PROVIDER ? `${siteUrl(e)}/api/webhooks/${e.PAYMENT_PROVIDER}` : null, checkoutMethod: s.checkoutUrl ? "payment link" : gateway(e)?.hasCheckout?.(e) ? "provider API" : "none", settings: s });
});
R("GET", "/admin/summary", "admin", async (c) => {
  const q = async (sql) => (await c.env.DB.prepare(sql).first()).n;
  return json({
    pendingSellers: await q("SELECT COUNT(*) n FROM users WHERE role='seller' AND status='pending'"),
    activeSellers: await q("SELECT COUNT(*) n FROM users WHERE role='seller' AND status='active'"),
    awaitingPayment: await q("SELECT COUNT(*) n FROM orders WHERE status='pending_payment'"),
    inProduction: await q("SELECT COUNT(*) n FROM orders WHERE status IN ('payment_verified','in_production','quality_check','revision_requested')"),
  });
});
R("GET", "/admin/sellers", "admin", async (c) => {
  const q = (c.url.searchParams.get("q") || "").trim().slice(0, 80), st = c.url.searchParams.get("status") || "";
  const where = ["role='seller'"], args = [];
  if (q) { const l = `%${likeEsc(q)}%`; where.push("(email LIKE ? ESCAPE '\\' OR full_name LIKE ? ESCAPE '\\' OR seller_code LIKE ? ESCAPE '\\')"); args.push(l, l, l); }
  if (["pending", "active", "suspended", "rejected"].includes(st)) { where.push("status=?"); args.push(st); }
  const { results } = await c.env.DB.prepare(`SELECT * FROM users WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT 200`).bind(...args).all();
  return json({ sellers: results.map(adminSeller) });
});
const sellerOr404 = async (c) => {
  const u = await userById(c.env, c.params.id);
  if (!u || u.role !== "seller") throw new HttpError(404, "Seller not found.");
  return u;
};
R("GET", "/admin/sellers/:id", "admin", async (c) => {
  const u = await sellerOr404(c);
  const { results } = await c.env.DB.prepare("SELECT * FROM orders WHERE seller_id=? ORDER BY created_at DESC LIMIT 50").bind(u.id).all();
  return json({ seller: adminSeller(u), orders: results.map((o) => orderRow(o)) });
});
R("POST", "/admin/sellers/:id/verify-email", "admin", async (c) => {
  // Admin override: use only when you have confirmed the seller's email address yourself (for example while email sending is not set up).
  const u = await sellerOr404(c);
  if (u.email_verified_at) throw bad("The email is already confirmed.");
  const ts = nowIso();
  await c.env.DB.prepare("UPDATE users SET email_verified_at=?, updated_at=? WHERE id=?").bind(ts, ts, u.id).run();
  await tryGatewayActivation(c.env, await userById(c.env, u.id));
  return json({ ok: true, seller: adminSeller(await userById(c.env, u.id)) });
});
R("POST", "/admin/sellers/:id/send-instructions", "admin", async (c) => {
  const u = await sellerOr404(c);
  if (u.status === "rejected") throw bad("This registration was rejected.");
  const text = str(c.body, "instructions", { min: 5, max: 2000, label: "Payment instructions" });
  const st = await sendEmail(c.env, u.email, T.instructions(c.env, u, text), "registration_instructions");
  if (st === "sent") await c.env.DB.prepare("UPDATE users SET instructions_sent_at=?, updated_at=? WHERE id=?").bind(nowIso(), nowIso(), u.id).run();
  return json({ ok: st === "sent", emailStatus: st });
});
R("POST", "/admin/sellers/:id/verify-payment", "admin", async (c) => {
  const u = await sellerOr404(c);
  if (u.status === "rejected") throw bad("This registration was rejected.");
  const ref = str(c.body, "reference", { min: 0, max: 200, label: "Payment reference" });
  const method = str(c.body, "method", { min: 0, max: 80, label: "Payment method" });
  const ts = nowIso();
  await c.env.DB.prepare("UPDATE users SET payment_status='verified', payment_method=?, payment_reference=?, payment_verified_at=?, payment_verified_by=?, updated_at=? WHERE id=?").bind(method || "manual", ref, ts, c.user.id, ts, u.id).run();
  return json({ ok: true, seller: adminSeller(await userById(c.env, u.id)) });
});
R("POST", "/admin/sellers/:id/activate", "admin", async (c) => {
  const u = await sellerOr404(c);
  if (!["pending", "active"].includes(u.status)) throw bad("Only pending or active (renewing) sellers can be activated. Use Reinstate for suspended accounts.");
  if (u.payment_status !== "verified" || !u.payment_verified_at) throw bad("Record a verified payment first.");
  if (u.last_activation_at && u.payment_verified_at <= u.last_activation_at) throw bad("This payment has already been used. Record the new payment first.");
  if (!u.email_verified_at) throw bad("The seller has not confirmed their email yet. Resend the verification email first.");
  return json({ ok: true, seller: adminSeller(await activateUser(c.env, u)) });
});
R("POST", "/admin/sellers/:id/reject", "admin", async (c) => {
  const u = await sellerOr404(c);
  if (u.status === "active") throw bad("Suspend an active seller instead of rejecting.");
  const reason = str(c.body, "reason", { min: 0, max: 500, label: "Reason" });
  const refunded = c.body.refunded === true && u.payment_status === "verified";
  await c.env.DB.prepare("UPDATE users SET status='rejected', reject_reason=?, payment_status=?, updated_at=? WHERE id=?").bind(reason, refunded ? "refunded" : u.payment_status, nowIso(), u.id).run();
  await c.env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(u.id).run();
  await sendEmail(c.env, u.email, T.rejected(c.env, u, reason, refunded || u.payment_status === "verified"), "registration_rejected");
  return json({ ok: true, seller: adminSeller(await userById(c.env, u.id)) });
});
R("POST", "/admin/sellers/:id/suspend", "admin", async (c) => {
  const u = await sellerOr404(c);
  if (u.status !== "active") throw bad("Only active sellers can be suspended.");
  await c.env.DB.prepare("UPDATE users SET status='suspended', updated_at=? WHERE id=?").bind(nowIso(), u.id).run();
  return json({ ok: true, seller: adminSeller(await userById(c.env, u.id)) });
});
R("POST", "/admin/sellers/:id/reinstate", "admin", async (c) => {
  const u = await sellerOr404(c);
  if (u.status !== "suspended" || !u.activated_at) throw bad("Only suspended sellers who were previously active can be reinstated.");
  await c.env.DB.prepare("UPDATE users SET status='active', updated_at=? WHERE id=?").bind(nowIso(), u.id).run();
  return json({ ok: true, seller: adminSeller(await userById(c.env, u.id)) });
});
R("POST", "/admin/sellers/:id/notes", "admin", async (c) => {
  const u = await sellerOr404(c);
  await c.env.DB.prepare("UPDATE users SET admin_notes=?, updated_at=? WHERE id=?").bind(str(c.body, "notes", { min: 0, max: 3000, label: "Notes" }), nowIso(), u.id).run();
  return json({ ok: true });
});
R("POST", "/admin/sellers/:id/marketing-sets", "admin", async (c) => {
  const u = await sellerOr404(c);
  await c.env.DB.prepare("UPDATE users SET marketing_sets=?, updated_at=? WHERE id=?").bind(intIn(c.body.sets, 0, 20, "Marketing sets"), nowIso(), u.id).run();
  return json({ ok: true });
});
R("POST", "/admin/sellers/:id/resend", "admin", async (c) => {
  const u = await sellerOr404(c);
  const type = c.body.type;
  let st;
  if (type === "verification") {
    if (u.email_verified_at) throw bad("Email is already verified.");
    st = await sendEmail(c.env, u.email, T.verifyEmail(c.env, u, `${siteUrl(c.env)}/login?verify=${await makeToken(c.env, u.id, "verify", 48)}`), "verify_email");
  } else if (type === "received") st = await sendEmail(c.env, u.email, T.received(c.env, u, (await getSettings(c.env)).registrationMode), "registration_received");
  else if (type === "activation") { if (u.status !== "active") throw bad("The account is not active."); st = await sendEmail(c.env, u.email, T.activated(c.env, u), "activated"); }
  else if (type === "reset") st = await sendEmail(c.env, u.email, T.reset(c.env, u, `${siteUrl(c.env)}/login?reset=${await makeToken(c.env, u.id, "reset", 1)}`), "password_reset");
  else throw bad("Unknown email type.");
  return json({ ok: st === "sent", emailStatus: st });
});
R("POST", "/admin/sellers/:id/message", "admin", async (c) => {
  const u = await sellerOr404(c);
  const st = await sendEmail(c.env, u.email, T.message(c.env, u, str(c.body, "subject", { max: 150, label: "Subject" }), str(c.body, "body", { max: 4000, label: "Message" })), "admin_message");
  return json({ ok: st === "sent", emailStatus: st });
});

// admin: orders
R("GET", "/admin/orders", "admin", async (c) => {
  const q = (c.url.searchParams.get("q") || "").trim().slice(0, 80), st = c.url.searchParams.get("status") || "";
  const where = ["1=1"], args = [];
  if (q) { const l = `%${likeEsc(q)}%`; where.push("(o.order_code LIKE ? ESCAPE '\\' OR o.service_name LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\' OR u.full_name LIKE ? ESCAPE '\\' OR u.seller_code LIKE ? ESCAPE '\\')"); args.push(l, l, l, l, l); }
  if (ORDER_STATUSES.includes(st)) { where.push("o.status=?"); args.push(st); }
  const { results } = await c.env.DB.prepare(`SELECT o.*, u.full_name sname, u.seller_code scode, u.email semail FROM orders o JOIN users u ON u.id=o.seller_id WHERE ${where.join(" AND ")} ORDER BY o.created_at DESC LIMIT 200`).bind(...args).all();
  return json({ orders: results.map((o) => ({ ...orderRow(o), sellerName: o.sname, sellerCode: o.scode, sellerEmail: o.semail })) });
});
const orderOr404 = async (c) => {
  const o = await c.env.DB.prepare("SELECT * FROM orders WHERE order_code=?").bind(c.params.code).first();
  if (!o) throw new HttpError(404, "Order not found.");
  const s = await userById(c.env, o.seller_id);
  return [o, s];
};
R("GET", "/admin/orders/:code", "admin", async (c) => {
  const [o, s] = await orderOr404(c);
  const ev = await c.env.DB.prepare("SELECT type,from_status,to_status,note,is_public,created_at FROM order_events WHERE order_id=? ORDER BY created_at").bind(o.id).all();
  return json({ order: { ...orderRow(o, true), requirements: o.requirements, links: o.links, internalNotes: o.internal_notes, deliverableUrl: o.deliverable_url, deliverableNote: o.deliverable_note, paymentReference: o.payment_reference, paymentVerifiedAt: o.payment_verified_at }, seller: { id: s.id, name: s.full_name, code: s.seller_code, email: s.email, status: effStatus(s) }, events: ev.results, statuses: ORDER_STATUSES });
});
R("POST", "/admin/orders/:code/payment-instructions", "admin", async (c) => {
  const [o, s] = await orderOr404(c);
  const text = str(c.body, "instructions", { min: 5, max: 2000, label: "Payment instructions" });
  const st = await sendEmail(c.env, s.email, T.orderPayment(c.env, s, o, text), "order_payment_instructions");
  await addEvent(c.env, o.id, c.user.id, "payment_instructions_sent", null, null, st === "sent" ? "Payment instructions emailed" : `Email ${st}`, 1);
  return json({ ok: st === "sent", emailStatus: st });
});
R("POST", "/admin/orders/:code/verify-payment", "admin", async (c) => {
  const [o, s] = await orderOr404(c);
  if (o.status === "cancelled") throw bad("This order is cancelled.");
  if (o.payment_status === "verified") throw bad("Payment is already verified.");
  const ref = str(c.body, "reference", { min: 0, max: 200, label: "Payment reference" });
  const ts = nowIso();
  await c.env.DB.prepare("UPDATE orders SET payment_status='verified', payment_reference=?, payment_verified_at=?, payment_verified_by=?, status='payment_verified', updated_at=? WHERE id=?").bind(ref, ts, c.user.id, ts, o.id).run();
  await addEvent(c.env, o.id, c.user.id, "payment_verified", o.status, "payment_verified", ref ? `Reference: ${ref}` : "", 1);
  const fresh = await c.env.DB.prepare("SELECT * FROM orders WHERE id=?").bind(o.id).first();
  const st = await sendEmail(c.env, s.email, T.paymentVerified(c.env, s, fresh), "payment_verified");
  return json({ ok: true, emailStatus: st });
});
R("POST", "/admin/orders/:code/status", "admin", async (c) => {
  const [o, s] = await orderOr404(c);
  const to = c.body.status;
  if (!ORDER_STATUSES.includes(to)) throw bad("Unknown status.");
  if (to === "payment_verified") throw bad("Use Verify payment to set this status.");
  if (to === "delivered") throw bad("Use Deliver to set this status.");
  if (NEEDS_PAYMENT.includes(to) && o.payment_status !== "verified") throw bad("Payment must be verified before this status.");
  if (to === "pending_payment" && o.payment_status === "verified") throw bad("Payment is already verified.");
  const note = str(c.body, "note", { min: 0, max: 1000, label: "Note" });
  await c.env.DB.prepare("UPDATE orders SET status=?, updated_at=? WHERE id=?").bind(to, nowIso(), o.id).run();
  await addEvent(c.env, o.id, c.user.id, "status", o.status, to, note, 1);
  if (to === "in_production" && c.body.notify !== false) await sendEmail(c.env, s.email, T.production(c.env, s, o), "production_started");
  return json({ ok: true });
});
R("POST", "/admin/orders/:code/notes", "admin", async (c) => {
  const [o] = await orderOr404(c);
  await c.env.DB.prepare("UPDATE orders SET internal_notes=?, updated_at=? WHERE id=?").bind(str(c.body, "notes", { min: 0, max: 4000, label: "Notes" }), nowIso(), o.id).run();
  return json({ ok: true });
});
R("POST", "/admin/orders/:code/deliver", "admin", async (c) => {
  const [o, s] = await orderOr404(c);
  if (o.payment_status !== "verified") throw bad("Payment must be verified before delivery.");
  if (o.status === "cancelled") throw bad("This order is cancelled.");
  const url = httpUrl(str(c.body, "url", { max: 1000, label: "Deliverable link" }), "Deliverable link", true);
  const note = str(c.body, "note", { min: 0, max: 1000, label: "Note" });
  const ts = nowIso();
  await c.env.DB.prepare("UPDATE orders SET status='delivered', deliverable_url=?, deliverable_note=?, delivered_at=?, updated_at=? WHERE id=?").bind(url, note, ts, ts, o.id).run();
  await addEvent(c.env, o.id, c.user.id, "delivered", o.status, "delivered", note, 1);
  let st = "skipped";
  if (c.body.sendEmail !== false) st = await sendEmail(c.env, s.email, T.delivered(c.env, s, o, url, note), "order_delivered");
  return json({ ok: true, emailStatus: st });
});
R("POST", "/admin/orders/:code/message", "admin", async (c) => {
  const [o, s] = await orderOr404(c);
  const st = await sendEmail(c.env, s.email, T.message(c.env, s, `About order ${o.order_code}`, str(c.body, "body", { min: 2, max: 4000, label: "Message" })), "order_message");
  await addEvent(c.env, o.id, c.user.id, "message", null, null, "Message emailed to seller", 0);
  return json({ ok: st === "sent", emailStatus: st });
});

// admin: catalogue
function serviceFromBody(b) {
  const min = intIn(b.deliveryMinDays, 1, 365, "Minimum delivery days"), max = intIn(b.deliveryMaxDays, 1, 365, "Maximum delivery days");
  if (min > max) throw bad("Minimum delivery days cannot exceed maximum.");
  return {
    name: str(b, "name", { min: 2, max: 100, label: "Name" }), category: str(b, "category", { max: 60, label: "Category" }), scope: str(b, "scope", { min: 0, max: 120, label: "Scope" }),
    description: str(b, "description", { min: 0, max: 1500, label: "Description" }), specs: str(b, "specs", { min: 0, max: 4000, label: "Specifications" }),
    price: cents(b.basePrice), min, max, revisions: b.revisions === null || b.revisions === "" || b.revisions === undefined ? null : intIn(b.revisions, 0, 20, "Revisions"),
    active: b.active === false ? 0 : 1, sort: b.sortOrder === undefined ? 0 : intIn(b.sortOrder, 0, 9999, "Sort order"),
  };
}
R("GET", "/admin/services", "admin", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM services ORDER BY sort_order, name").all();
  const cats = await c.env.DB.prepare("SELECT name FROM categories ORDER BY sort_order, name").all();
  return json({ services: results.map((s) => serviceRow(s, true)), categories: cats.results.map((x) => x.name) });
});
R("POST", "/admin/categories", "admin", async (c) => {
  const name = str(c.body, "name", { min: 2, max: 60, label: "Category name" });
  await c.env.DB.prepare("INSERT OR IGNORE INTO categories(name,sort_order) VALUES(?,99)").bind(name).run();
  return json({ ok: true });
});
R("POST", "/admin/services", "admin", async (c) => {
  const v = serviceFromBody(c.body);
  if (!(await c.env.DB.prepare("SELECT 1 FROM categories WHERE name=?").bind(v.category).first())) throw bad("Choose an existing category or add it first.");
  const id = (v.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "service") + "-" + code(3).toLowerCase();
  await c.env.DB.prepare("INSERT INTO services(id,name,category,scope,description,specs,base_price_cents,currency,delivery_min_days,delivery_max_days,revisions,active,sort_order,updated_at) VALUES(?,?,?,?,?,?,?,'USD',?,?,?,?,?,?)").bind(id, v.name, v.category, v.scope, v.description, v.specs, v.price, v.min, v.max, v.revisions, v.active, v.sort, nowIso()).run();
  return json({ ok: true, id });
});
R("PUT", "/admin/services/:id", "admin", async (c) => {
  const v = serviceFromBody(c.body);
  if (!(await c.env.DB.prepare("SELECT 1 FROM categories WHERE name=?").bind(v.category).first())) throw bad("Choose an existing category or add it first.");
  const r = await c.env.DB.prepare("UPDATE services SET name=?,category=?,scope=?,description=?,specs=?,base_price_cents=?,delivery_min_days=?,delivery_max_days=?,revisions=?,active=?,sort_order=?,updated_at=? WHERE id=?").bind(v.name, v.category, v.scope, v.description, v.specs, v.price, v.min, v.max, v.revisions, v.active, v.sort, nowIso(), c.params.id).run();
  if (!r.meta.changes) throw new HttpError(404, "Service not found.");
  return json({ ok: true });
});

// admin: marketing resources
R("GET", "/admin/resources", "admin", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM resources ORDER BY set_no, title").all();
  return json({ resources: results.map((r) => ({ id: r.id, title: r.title, description: r.description, url: r.url, setNo: r.set_no, serviceId: r.service_id, active: !!r.active })) });
});
const resourceFromBody = (b) => ({ title: str(b, "title", { min: 2, max: 120, label: "Title" }), description: str(b, "description", { min: 0, max: 500, label: "Description" }), url: httpUrl(str(b, "url", { max: 1000, label: "Link" }), "Link", true), setNo: intIn(b.setNo ?? 1, 1, 20, "Set number"), serviceId: typeof b.serviceId === "string" && b.serviceId ? b.serviceId.slice(0, 80) : null, active: b.active === false ? 0 : 1 });
R("POST", "/admin/resources", "admin", async (c) => {
  const v = resourceFromBody(c.body);
  await c.env.DB.prepare("INSERT INTO resources(id,title,description,url,set_no,service_id,active,created_at) VALUES(?,?,?,?,?,?,?,?)").bind(crypto.randomUUID(), v.title, v.description, v.url, v.setNo, v.serviceId, v.active, nowIso()).run();
  return json({ ok: true });
});
R("PUT", "/admin/resources/:id", "admin", async (c) => {
  const v = resourceFromBody(c.body);
  const r = await c.env.DB.prepare("UPDATE resources SET title=?,description=?,url=?,set_no=?,service_id=?,active=? WHERE id=?").bind(v.title, v.description, v.url, v.setNo, v.serviceId, v.active, c.params.id).run();
  if (!r.meta.changes) throw new HttpError(404, "Resource not found.");
  return json({ ok: true });
});
R("DELETE", "/admin/resources/:id", "admin", async (c) => {
  await c.env.DB.prepare("DELETE FROM resources WHERE id=?").bind(c.params.id).run();
  return json({ ok: true });
});

// admin: settings + email log
R("PUT", "/admin/settings", "admin", async (c) => {
  const b = c.body;
  const notify = email({ e: b.notifyEmail }, "e");
  const mode = b.registrationMode === "gateway" ? "gateway" : b.registrationMode === "manual" ? "manual" : null;
  if (!mode) throw bad("Registration mode must be manual or gateway.");
  const link = typeof b.checkoutUrl === "string" && b.checkoutUrl.trim() ? httpUrl(b.checkoutUrl.trim().slice(0, 500), "Payment link", true) : "";
  if (mode === "gateway" && !gatewayConfigured(c.env)) throw bad("A payment provider is not set up yet (PAYMENT_PROVIDER and its webhook signing secret), so gateway mode cannot be switched on. See SETUP.md.");
  if (mode === "gateway" && !link && !gateway(c.env)?.hasCheckout?.(c.env)) throw bad("Paste your payment link first, so buyers have somewhere to pay.");
  const sets = intIn(b.defaultMarketingSets, 1, 20, "Default marketing sets");
  const up = (k, v) => c.env.DB.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(k, String(v));
  await c.env.DB.batch([up("notify_email", notify), up("registration_mode", mode), up("default_marketing_sets", sets), up("checkout_url", link)]);
  return json({ ok: true, settings: await getSettings(c.env) });
});
R("GET", "/admin/emails", "admin", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT to_email,subject,template,status,error,created_at FROM email_log ORDER BY created_at DESC LIMIT 100").all();
  return json({ emails: results });
});

// first admin (one-time; requires SETUP_TOKEN secret; refuses once an admin exists)
R("POST", "/setup", "none", async (c) => {
  await rateLimit(c.env, `setup:${c.ip}`, 10, 3600);
  const setupToken = String(c.env.SETUP_TOKEN || "").trim();
  if (!setupToken) throw new HttpError(403, "SETUP_TOKEN is not set on the server yet. Add it as a Secret in Cloudflare (Worker > Settings > Variables and secrets), then try again.");
  if (await c.env.DB.prepare("SELECT 1 FROM users WHERE role='admin'").first()) throw new HttpError(403, "An admin account already exists. Please log in instead.");
  if (!safeEqual(String(c.body.token || "").trim(), setupToken)) throw new HttpError(403, "The setup token does not match your SETUP_TOKEN secret.");
  const em = email(c.body), pw = password(c.body), ts = nowIso();
  await c.env.DB.prepare("INSERT INTO users(id,seller_code,email,password_hash,role,status,full_name,email_verified_at,created_at,updated_at) VALUES(?,?,?,?,'admin','active',?,?,?,?)").bind(crypto.randomUUID(), "ADMIN-" + code(4), em, await hashPassword(pw), str(c.body, "fullName", { max: 120, label: "Name" }), ts, ts, ts).run();
  return json({ ok: true });
});

// payment webhooks: authoritative payment verification (signed). Browser redirects never activate anything.
R("POST", "/webhooks/:provider", "none", async (c) => {
  const gw = GATEWAYS[c.params.provider];
  if (!gw || !gw.configured(c.env)) throw new HttpError(404, "Not found");
  await rateLimit(c.env, `wh:${c.ip}`, 300, 60);
  let ev = null;
  try { ev = await gw.verifyWebhook(c.raw, c.request.headers, c.env); } catch { ev = null; }
  if (!ev) throw new HttpError(401, "Invalid signature");
  const ins = await c.env.DB.prepare("INSERT OR IGNORE INTO payment_events(provider,event_id,kind,user_id,outcome,received_at) VALUES(?,?,?,?,?,?)").bind(c.params.provider, ev.id, ev.kind, ev.userId || null, "received", nowIso()).run();
  if (!ins.meta.changes) return json({ ok: true, duplicate: true });
  const setOutcome = (o) => c.env.DB.prepare("UPDATE payment_events SET outcome=? WHERE provider=? AND event_id=?").bind(o, c.params.provider, ev.id).run();
  try {
    if (ev.kind === "other") { await setOutcome("ignored"); return json({ ok: true }); }
    const u = ev.userId ? await userById(c.env, String(ev.userId)) : null;
    if (!u || u.role !== "seller") { await setOutcome("unknown_registration"); return json({ ok: true }); }
    const settings = await getSettings(c.env), penv = paymentEnv(c.env);
    if (ev.kind === "refunded") {
      if (ev.test !== (penv === "test")) { await setOutcome("ignored_env_mismatch"); return json({ ok: true }); }
      await c.env.DB.prepare("UPDATE users SET payment_status='refunded', updated_at=? WHERE id=?").bind(nowIso(), u.id).run();
      await sendEmail(c.env, settings.notifyEmail, T.paymentFlag(c.env, u, "A payment was refunded at the provider. Review this account."), "admin_payment_flag");
      await setOutcome("refunded"); return json({ ok: true });
    }
    // paid
    if (ev.test && penv === "live") { await setOutcome("ignored_test_event_in_live"); return json({ ok: true }); }
    if (!ev.test && penv === "test") { await setOutcome("ignored_live_event_in_test"); return json({ ok: true }); }
    if (ev.currency !== "USD" || !(ev.amountCents >= settings.feeCents)) {
      await sendEmail(c.env, settings.notifyEmail, T.paymentFlag(c.env, u, `Payment amount or currency did not match the registration fee (got ${ev.amountCents} ${ev.currency}).`), "admin_payment_flag");
      await setOutcome("amount_mismatch"); return json({ ok: true });
    }
    if (ev.test && penv === "test" && c.env.ALLOW_TEST_ACTIVATION !== "true") {
      await c.env.DB.prepare("UPDATE users SET payment_status=CASE WHEN payment_status='verified' THEN payment_status ELSE 'test_paid' END, updated_at=? WHERE id=?").bind(nowIso(), u.id).run();
      await setOutcome("test_recorded_no_activation"); return json({ ok: true });
    }
    const ts = nowIso();
    await c.env.DB.prepare("UPDATE users SET payment_status='verified', payment_method=?, payment_reference=?, payment_verified_at=?, updated_at=? WHERE id=?").bind(c.params.provider, ev.id, ts, ts, u.id).run();
    const fresh = await userById(c.env, u.id);
    const activated = await tryGatewayActivation(c.env, fresh);
    if (!activated && fresh.status === "pending" && !fresh.email_verified_at && settings.registrationMode === "gateway") {
      await sendEmail(c.env, fresh.email, T.paymentReceived(c.env, fresh, `${siteUrl(c.env)}/login?verify=${await makeToken(c.env, fresh.id, "verify", 48)}`), "payment_received_verify");
    } else if (!activated) await sendEmail(c.env, settings.notifyEmail, T.paymentFlag(c.env, fresh, "Payment verified but the account was not auto-activated (registration checks or mode). Review it in admin."), "admin_payment_flag");
    await setOutcome(activated ? "activated" : "paid_pending_checks");
    return json({ ok: true });
  } catch (e) {
    await c.env.DB.prepare("DELETE FROM payment_events WHERE provider=? AND event_id=?").bind(c.params.provider, ev.id).run(); // let the provider retry
    console.error("webhook", e);
    throw new HttpError(500, "Processing failed");
  }
}, { raw: true });

// ---------- dispatcher ----------
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  try {
    if (!env.DB) throw new HttpError(500, "The service is not configured yet.");
    const path = url.pathname.replace(/^\/api/, "") || "/";
    let route = null, params = {};
    for (const r of routes) { if (r.method !== request.method) continue; const m = path.match(r.re); if (m) { route = r; params = m.groups || {}; break; } }
    if (!route) throw new HttpError(request.method === "OPTIONS" ? 405 : 404, "Not found");
    const c = { env, request, url, params, ip: clientIp(request), user: null, body: {} };
    if (route.opts.raw) c.raw = await request.text();
    else if (request.method !== "GET") {
      const origin = request.headers.get("origin");
      if (origin && origin !== url.origin) throw new HttpError(403, "Cross-site request blocked.");
      if (!/application\/json/i.test(request.headers.get("content-type") || "")) throw new HttpError(415, "JSON required.");
      const text = await request.text();
      if (text.length > 100000) throw new HttpError(413, "Request too large.");
      try { c.body = text ? JSON.parse(text) : {}; } catch { throw bad("Invalid request."); }
      if (!c.body || typeof c.body !== "object" || Array.isArray(c.body)) throw bad("Invalid request.");
    }
    if (route.auth !== "none") {
      c.user = await sessionUser(c);
      if (!c.user) throw new HttpError(401, "Please log in.");
      if (route.auth === "admin" && !(c.user.role === "admin" && c.user.status === "active")) throw new HttpError(403, "Not allowed.");
      if (route.auth === "seller" && !isActiveSeller(c.user)) throw new HttpError(403, "Your seller account is not active. Check your account status or contact support@mintrage.com.");
    }
    if (Math.random() < 0.01) context.waitUntil?.(env.DB.batch([
      env.DB.prepare("DELETE FROM sessions WHERE expires_at<?").bind(nowIso()),
      env.DB.prepare("DELETE FROM tokens WHERE expires_at<?").bind(nowIso()),
      env.DB.prepare("DELETE FROM rate_limits WHERE window_start<?").bind(Math.floor(Date.now() / 1000) - 86400),
    ]));
    return await route.handler(c);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error("api error", e);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
}
