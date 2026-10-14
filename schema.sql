-- Mintrage database schema (Cloudflare D1 / SQLite). Run once in the D1 console.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  seller_code TEXT UNIQUE,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'seller' CHECK (role IN ('seller','admin')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','suspended','rejected')),
  full_name TEXT NOT NULL,
  country_residence TEXT,
  country_business TEXT,
  business_page TEXT,
  agreement_version TEXT,
  agreement_accepted_at TEXT,
  terms_accepted_at TEXT,
  privacy_accepted_at TEXT,
  email_verified_at TEXT,
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','test_paid','verified','refunded')),
  payment_method TEXT,
  payment_reference TEXT,
  payment_verified_at TEXT,
  payment_verified_by TEXT,
  instructions_sent_at TEXT,
  activated_at TEXT,
  last_activation_at TEXT,
  expires_at TEXT,
  marketing_sets INTEGER NOT NULL DEFAULT 1,
  admin_notes TEXT,
  reject_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('verify','reset')),
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE IF NOT EXISTS rate_limits (
  k TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  name TEXT PRIMARY KEY,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  specs TEXT NOT NULL DEFAULT '',
  base_price_cents INTEGER NOT NULL CHECK (base_price_cents > 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  delivery_min_days INTEGER NOT NULL,
  delivery_max_days INTEGER NOT NULL,
  revisions INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  order_code TEXT NOT NULL UNIQUE,
  seller_id TEXT NOT NULL REFERENCES users(id),
  service_id TEXT NOT NULL,
  service_name TEXT NOT NULL,
  base_price_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  delivery_min_days INTEGER NOT NULL,
  delivery_max_days INTEGER NOT NULL,
  revisions_allowed INTEGER,
  revisions_used INTEGER NOT NULL DEFAULT 0,
  requirements TEXT NOT NULL,
  links TEXT NOT NULL DEFAULT '',
  seller_reference TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending_payment' CHECK (status IN ('pending_payment','needs_information','payment_verified','in_production','quality_check','delivered','revision_requested','completed','on_hold','cancelled')),
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','verified','refunded')),
  payment_reference TEXT,
  payment_verified_at TEXT,
  payment_verified_by TEXT,
  internal_notes TEXT NOT NULL DEFAULT '',
  deliverable_url TEXT,
  deliverable_note TEXT,
  delivered_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_seller ON orders(seller_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

CREATE TABLE IF NOT EXISTS order_events (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  actor_id TEXT,
  type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  note TEXT,
  is_public INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_order ON order_events(order_id);

CREATE TABLE IF NOT EXISTS resources (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL,
  set_no INTEGER NOT NULL DEFAULT 1,
  service_id TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS email_log (
  id TEXT PRIMARY KEY,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  template TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sent','failed','not_configured')),
  provider_id TEXT,
  error TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payment_events (
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  kind TEXT,
  user_id TEXT,
  outcome TEXT,
  received_at TEXT NOT NULL,
  PRIMARY KEY (provider, event_id)
);

INSERT OR IGNORE INTO settings(key,value) VALUES
  ('registration_mode','manual'),
  ('notify_email','mintrage.commerce@gmail.com'),
  ('default_marketing_sets','1'),
  ('registration_fee_cents','2500'),
  ('registration_validity_months','12');
INSERT OR IGNORE INTO categories(name,sort_order) VALUES ('Design',0);
INSERT OR IGNORE INTO categories(name,sort_order) VALUES ('Web',1);
INSERT OR IGNORE INTO categories(name,sort_order) VALUES ('Video',2);
INSERT OR IGNORE INTO categories(name,sort_order) VALUES ('Documents',3);
INSERT OR IGNORE INTO services(id,name,category,scope,description,specs,base_price_cents,currency,delivery_min_days,delivery_max_days,revisions,active,sort_order,updated_at) VALUES ('logo-design','Logo Design','Design','','','',5000,'USD',7,15,3,1,0,'2026-10-13T00:00:00.000Z');
INSERT OR IGNORE INTO services(id,name,category,scope,description,specs,base_price_cents,currency,delivery_min_days,delivery_max_days,revisions,active,sort_order,updated_at) VALUES ('social-media-design','Social Media Design','Design','','','',12000,'USD',15,20,3,1,1,'2026-10-13T00:00:00.000Z');
INSERT OR IGNORE INTO services(id,name,category,scope,description,specs,base_price_cents,currency,delivery_min_days,delivery_max_days,revisions,active,sort_order,updated_at) VALUES ('flyer-brochure-design','Flyer & Brochure Design','Design','','','',5000,'USD',10,20,3,1,2,'2026-10-13T00:00:00.000Z');
INSERT OR IGNORE INTO services(id,name,category,scope,description,specs,base_price_cents,currency,delivery_min_days,delivery_max_days,revisions,active,sort_order,updated_at) VALUES ('website-design-development','Website Design and Development','Web','','','',20000,'USD',20,30,NULL,1,3,'2026-10-13T00:00:00.000Z');
INSERT OR IGNORE INTO services(id,name,category,scope,description,specs,base_price_cents,currency,delivery_min_days,delivery_max_days,revisions,active,sort_order,updated_at) VALUES ('presentation-design','Presentation Design','Design','','','',8000,'USD',15,20,3,1,4,'2026-10-13T00:00:00.000Z');
INSERT OR IGNORE INTO services(id,name,category,scope,description,specs,base_price_cents,currency,delivery_min_days,delivery_max_days,revisions,active,sort_order,updated_at) VALUES ('pitch-deck-design','Pitch Deck Design','Design','','','',8000,'USD',15,20,3,1,5,'2026-10-13T00:00:00.000Z');
INSERT OR IGNORE INTO services(id,name,category,scope,description,specs,base_price_cents,currency,delivery_min_days,delivery_max_days,revisions,active,sort_order,updated_at) VALUES ('cv-design-writing','CV Design and Writing','Documents','','','',5000,'USD',12,15,2,1,6,'2026-10-13T00:00:00.000Z');
INSERT OR IGNORE INTO services(id,name,category,scope,description,specs,base_price_cents,currency,delivery_min_days,delivery_max_days,revisions,active,sort_order,updated_at) VALUES ('reels-editing','Reels Editing','Video','Up to 5 reels','','',6000,'USD',12,20,3,1,7,'2026-10-13T00:00:00.000Z');
INSERT OR IGNORE INTO services(id,name,category,scope,description,specs,base_price_cents,currency,delivery_min_days,delivery_max_days,revisions,active,sort_order,updated_at) VALUES ('youtube-video-editing','YouTube Video Editing','Video','Up to 120 minutes in length','','',8000,'USD',12,20,3,1,8,'2026-10-13T00:00:00.000Z');
INSERT OR IGNORE INTO services(id,name,category,scope,description,specs,base_price_cents,currency,delivery_min_days,delivery_max_days,revisions,active,sort_order,updated_at) VALUES ('company-profile','Company Profile','Documents','','','',8000,'USD',12,15,3,1,9,'2026-10-13T00:00:00.000Z');
INSERT OR IGNORE INTO services(id,name,category,scope,description,specs,base_price_cents,currency,delivery_min_days,delivery_max_days,revisions,active,sort_order,updated_at) VALUES ('business-proposal','Business Proposal','Documents','','','',10000,'USD',15,20,3,1,10,'2026-10-13T00:00:00.000Z');
