# Mintrage setup guide (all free tiers)

Do the parts in order. Each part says what you should see when it worked.

## Part 1. Upload the files to GitHub
Your site runs as a Cloudflare **Worker with static assets** (not a Pages project). These steps fit that.
1. In your repo, delete the old files (old `config.js`, `script.js`, old HTML, old logo files, the three `open-sauce-sans-...woff2` fonts).
2. Upload every file from this delivery to the repo root, including `worker.js` and `wrangler.jsonc`.
3. Create the backend file with a folder path: **Add file > Create new file**, type `functions/api/[[path]].js` as the name (typing `/` makes folders), paste the contents of `[[path]].js`, commit.
4. Create a file named `.assetsignore` (**Add file > Create new file**, type `.assetsignore`) and paste the contents of `assetsignore.txt`. It keeps backend code and SQL files from being served as public web files.
5. Fonts: download these three and upload to the repo root with the same names:
   - https://cdn.jsdelivr.net/npm/@fontsource/poppins/files/poppins-latin-400-normal.woff2
   - https://cdn.jsdelivr.net/npm/@fontsource/poppins/files/poppins-latin-500-normal.woff2
   - https://cdn.jsdelivr.net/npm/@fontsource/poppins/files/poppins-latin-600-normal.woff2

## Part 2. Database (D1) and connecting it
1. Cloudflare > **Storage & databases > D1 > Create database**, name `mintrage`.
2. Open it > **Console**. Paste and run `schema-1.sql`, then `schema-2.sql`, `schema-3.sql`, `schema-4.sql`, one at a time. Overview should then show **12 tables**.
3. On the database Overview page, copy the **Database ID** (a long code with dashes).
4. In GitHub, open `wrangler.jsonc`, tap edit, and replace `PASTE-YOUR-D1-DATABASE-ID` with that ID. Also check that `"name"` matches your Worker's name shown in Cloudflare. Commit.
5. Cloudflare rebuilds. In the Worker's **Deployments** (or Builds) the latest build should say Success. If the build fails, open it and send me the last lines.

## Part 3. Secrets
Worker > **Settings > Variables and secrets > Add**. Choose type **Secret** for each one:

| Name | Value |
|---|---|
| SETUP_TOKEN | a long random string you invent (save it) |
| RESEND_API_KEY | from Part 4 (add it later if you have not got it yet) |

`SITE_URL` and `EMAIL_FROM` are already in `wrangler.jsonc`, so do not add them here. Add every later setting (PAYMENT_PROVIDER, PAYMENT_ENV, the Lemon Squeezy keys) as a **Secret** too. Plain text variables added in the dashboard get wiped on the next deploy; secrets do not.

## If a Cloudflare build fails or says "Skipped"
1. Worker > **Deployments**. Tap the red **Build** button of the newest failed row and read the last 15 lines of the log.
2. In GitHub, check that you have **only one** config file: `wrangler.jsonc`. If `wrangler.toml` is also there, delete it. Two configs confuse the build.
3. Check `wrangler.jsonc`: `"name"` matches the Worker name exactly (`mintrage`), the `database_id` is your real D1 ID (no PASTE text left), and every line ends the way the original did (commas between items).
4. Do not add settings by editing `wrangler.jsonc` unless asked. Add secrets in the dashboard instead.
5. After fixing, commit. Do not push empty commits repeatedly; each one queues another build.

## Part 4. Email sending (Resend, free tier)
Receiving at support@mintrage.com is already done with Cloudflare Email Routing. This part is for **sending**.
1. Sign up at resend.com. **Domains > Add domain** > `mintrage.com`.
2. Resend shows DNS records (SPF and DKIM). Add them in Cloudflare **DNS** (your domain > DNS > Records) exactly as shown, with the proxy turned off (grey cloud). Do not delete your existing MX or Email Routing records. If Resend wants an SPF record and you already have one on the same name, merge them into one record.
3. Click **Verify** in Resend. Wait until the domain says Verified.
4. **API Keys > Create** with sending access. Copy it into the `RESEND_API_KEY` secret (Part 3) and redeploy.
5. Check Resend's pricing page for the current free limits before you rely on it.

Until this is done the system does not pretend to send: Admin > Emails shows "not configured".

## Part 5. Create your admin account
1. Open https://mintrage.com/setup
2. Enter your SETUP_TOKEN, your name, your email and a strong password. Submit.
3. **Then delete `SETUP_TOKEN`** in Worker > Settings > Variables and secrets. (The page also refuses once an admin exists.)
4. Log in at https://mintrage.com/login. You land in the admin panel.

## Part 6. Test before you launch
1. Register with a second email address of yours. Because payment is not switched on yet, the page says online checkout is unavailable, and you get a confirmation email.
2. Admin > Sellers > open the test seller > **Email instructions**, then **Record payment as verified**, then **Activate**.
3. Log in as the test seller in a private window. Place an order.
4. Admin > Orders > open it > send instructions > mark payment verified > set In production > Deliver with any https link.
5. Check the seller sees the link. Then suspend the test seller and confirm ordering stops.

## Part 7. Payment (Lemon Squeezy, payment-link method)
You do not need Lemon Squeezy API keys. You paste the product's checkout link into the admin portal, and the system adds the buyer's email and ID to it.

What Lemon Squeezy sells: the annual **seller membership**, delivered instantly. Service orders are NOT sold there.

**A. The product (Lemon Squeezy dashboard, in Test mode first)**
1. Make sure the product is **published** (not a draft) and has its files attached (Seller Agreement PDF, first marketing set).
2. Product > **Confirmation modal**: set the button link (redirect after purchase) to `https://mintrage.com/login?paid=1`.
3. Product > **Email receipt**: use the thank-you note and the button text we agreed.
4. Open the product's **Share** option and copy the buy link. It looks like `https://yourstore.lemonsqueezy.com/buy/xxxxxxxx`.

**B. The webhook (this is what verifies payments)**
1. Lemon Squeezy > Settings > **Webhooks** > add one (create it while in Test mode).
2. URL: `https://mintrage.com/api/webhooks/lemonsqueezy`
3. Signing secret: invent one (letters and numbers, 20 or more characters) and keep it.
4. Events: tick `order_created` and `order_refunded`. Save.

**C. Cloudflare secrets** (Worker > Settings > Variables and secrets, type **Secret**)
| Name | Value |
|---|---|
| PAYMENT_PROVIDER | lemonsqueezy |
| PAYMENT_ENV | test |
| LEMONSQUEEZY_WEBHOOK_SECRET | the signing secret from B3 |
| ALLOW_TEST_ACTIVATION | true (testing only, delete it before going live) |

**D. The admin portal**
1. Admin > **Settings**.
2. Paste the buy link into **Registration payment link**.
3. Set **Registration mode** to **Gateway**. Save. (It refuses if the secrets or link are missing, and tells you which.)
4. Check the **System status** box: Checkout method should say "payment link".

**E. Test it**
1. In a private browser window, register with a different email address.
2. You should land on the Lemon Squeezy checkout straight away. Pay with the test card `4242 4242 4242 4242`, any future date, any 3-digit code.
3. You return to the login page with a "payment received" note. Open the confirmation email and click the link.
4. Log in. The portal should be open (Active).
5. If something fails, Admin > Settings > System status > **Last checkout error** shows the real reason.

**F. Go live**
1. Switch Lemon Squeezy to live. Publish the live product, copy its buy link, and create the live webhook (it has its own signing secret).
2. Update the secrets: `LEMONSQUEEZY_WEBHOOK_SECRET` (live secret), `PAYMENT_ENV` = live. **Delete `ALLOW_TEST_ACTIVATION`.**
3. Admin > Settings: paste the live buy link. Save.
4. Do one real US$25 test yourself if you can, then refund it in Lemon Squeezy.

Not tested against your real account until you run E. Do not tell anyone it works before then.

## Everyday use
- **Activate or suspend a seller:** Admin > Sellers > open the seller.
- **Process an order:** Admin > Orders. The buttons run in order: send payment instructions, verify payment, set status, deliver.
- **Change prices or services:** Admin > Catalogue. Old orders keep the price they were submitted at.
- **Marketing materials:** Admin > Resources. Add https links (for example a restricted Drive folder). New sellers get set 1. You can unlock more sets per seller.
- **Change the notification email or registration mode:** Admin > Settings.

## Honest limits
- Free-tier limits apply (D1, Pages Functions, Resend). Check each provider's current limits.
- The admin login has no two-factor sign-in yet. Use a long unique password.
- Deliverable and marketing links are stored as links. Anyone holding a link can open it, so use restricted-sharing links where you can.
- Orders are paid for by you and the seller outside the gateway (bank or mobile payment). The system never marks an order paid without your action.
