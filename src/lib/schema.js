// SQLite schema for GENIQ Travel Management.
// Dates are ISO strings (YYYY-MM-DD), timestamps are ISO date-times, JSON columns are TEXT.
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  emp_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('employee','manager','travel_desk','finance','admin')),
  title TEXT,
  department TEXT, designation TEXT, grade TEXT,
  manager_id INTEGER REFERENCES users(id),
  location TEXT, home_city TEXT, home_airport TEXT,
  dob TEXT, gender TEXT, nationality TEXT, blood_group TEXT, marital_status TEXT,
  allergies TEXT, medical_conditions TEXT, special_notes TEXT,
  company_code TEXT DEFAULT 'ABC01',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_json (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,            -- 'travel_preferences' | 'notification_settings'
  data TEXT NOT NULL,
  PRIMARY KEY (user_id, kind)
);

CREATE TABLE IF NOT EXISTS otps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  identifier TEXT NOT NULL, purpose TEXT NOT NULL,
  code_hash TEXT NOT NULL, expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0, used INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL,        -- Passport, Visa, PAN Card, Aadhaar Card, Driving License, Work Permit, Other
  title TEXT, doc_number TEXT, issue_date TEXT, expiry_date TEXT, country TEXT,
  verified INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS payment_methods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,            -- corporate_card | personal_card | upi
  brand TEXT, label TEXT, last4 TEXT, holder TEXT, valid_thru TEXT, handle TEXT,
  status TEXT NOT NULL DEFAULT 'Active', is_default INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS bank_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bank TEXT NOT NULL, account_type TEXT NOT NULL, holder TEXT NOT NULL,
  account_enc TEXT NOT NULL, last4 TEXT NOT NULL, ifsc TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, is_default INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS emergency_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, relationship TEXT, phone TEXT, email TEXT, is_primary INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS family_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, relationship TEXT, dob TEXT, gender TEXT, special_assistance TEXT
);
CREATE TABLE IF NOT EXISTS addresses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,            -- Current | Permanent | Office | Other
  line TEXT, city TEXT, state TEXT, pin TEXT, country TEXT, is_default INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS loyalty_programs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL,        -- airline | hotel | car | other
  provider TEXT NOT NULL, program TEXT NOT NULL, membership_no TEXT NOT NULL,
  tier TEXT, expiry_date TEXT, rank TEXT
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL,        -- expiry | approval | other
  severity TEXT NOT NULL DEFAULT 'info',
  title TEXT NOT NULL, body TEXT, link TEXT,
  ref_key TEXT, is_read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
  UNIQUE (user_id, ref_key)
);

CREATE TABLE IF NOT EXISTS master_data (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,            -- company | cost_center | project | sales_order | internal_order | department | city
  code TEXT NOT NULL, name TEXT NOT NULL, owner_id INTEGER REFERENCES users(id),
  meta TEXT, active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (kind, code)
);
CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, preferred INTEGER NOT NULL DEFAULT 0,
  sla_hours INTEGER NOT NULL DEFAULT 24, contact TEXT, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS policy_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_no TEXT UNIQUE NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL,
  applicable_to TEXT NOT NULL DEFAULT 'All Employees', description TEXT,
  status TEXT NOT NULL DEFAULT 'Active', effective_from TEXT, effective_to TEXT,
  conditions TEXT NOT NULL DEFAULT '{}', version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS policy_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id INTEGER, version INTEGER, effective_from TEXT, effective_to TEXT,
  changed_by TEXT, description TEXT, status TEXT, changed_at TEXT
);
CREATE TABLE IF NOT EXISTS approval_workflows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, trip_type TEXT NOT NULL UNIQUE, steps TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS trips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_no TEXT UNIQUE NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  traveller_id INTEGER NOT NULL REFERENCES users(id),
  created_for_type TEXT NOT NULL DEFAULT 'Self',     -- Self | Colleague | Agency
  purpose TEXT NOT NULL, title TEXT NOT NULL, purpose_text TEXT,
  travel_type TEXT NOT NULL,                         -- Domestic | International
  emergency INTEGER NOT NULL DEFAULT 0, emergency_justification TEXT,
  department TEXT, dest_country TEXT, dep_country TEXT, dep_city TEXT, dest_city TEXT,
  dep_date TEXT, ret_date TEXT,
  travel_mode TEXT, extra_reqs TEXT, extra_other TEXT,
  company_code TEXT, cost_object_type TEXT, cost_object TEXT,
  currency TEXT NOT NULL DEFAULT 'INR', est_budget REAL NOT NULL DEFAULT 0,
  advance_needed INTEGER NOT NULL DEFAULT 0, advance_amount REAL NOT NULL DEFAULT 0,
  comment TEXT,
  status TEXT NOT NULL DEFAULT 'Draft',
  submitted_at TEXT, approved_at TEXT, closed_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trips_traveller ON trips(traveller_id);
CREATE INDEX IF NOT EXISTS idx_trips_status ON trips(status);

CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL, entity_id INTEGER NOT NULL,
  name TEXT NOT NULL, mime TEXT, size INTEGER, path TEXT, sha256 TEXT,
  uploaded_by INTEGER, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_files_entity ON files(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,     -- trip | expense | booking
  entity_id INTEGER NOT NULL,
  level INTEGER NOT NULL, label TEXT NOT NULL, note TEXT,
  approver_id INTEGER REFERENCES users(id), approver_role TEXT,
  status TEXT NOT NULL DEFAULT 'Waiting',   -- Waiting | Pending | Approved | Rejected | Info Requested
  comment TEXT, acted_at TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_approvals_entity ON approvals(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_approvals_approver ON approvals(approver_id, status);

CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  srv_no TEXT UNIQUE NOT NULL,
  trip_id INTEGER NOT NULL REFERENCES trips(id),
  type TEXT NOT NULL,            -- flight | hotel | ground | visa | other
  channel TEXT NOT NULL,         -- portal | agency
  status TEXT NOT NULL DEFAULT 'Draft',
  desk_stage TEXT, details TEXT NOT NULL DEFAULT '{}', comment TEXT,
  provider TEXT, owner_id INTEGER REFERENCES users(id),
  priority TEXT NOT NULL DEFAULT 'Medium', sla_hours INTEGER NOT NULL DEFAULT 24,
  booking_id INTEGER, change_of_booking INTEGER,
  created_by INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_services_trip ON services(trip_id);
CREATE TABLE IF NOT EXISTS service_quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  supplier TEXT NOT NULL, reference TEXT, amount REAL NOT NULL, details TEXT, valid_till TEXT,
  sent INTEGER NOT NULL DEFAULT 0, accepted INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL, entity_id INTEGER NOT NULL,
  user_id INTEGER, author TEXT, org TEXT, body TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_entity ON comments(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_no TEXT UNIQUE NOT NULL,
  trip_id INTEGER REFERENCES trips(id), service_id INTEGER,
  traveller_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,            -- flight | hotel | bus | train | cab | other
  supplier TEXT, supplier_ref TEXT, ticket_no TEXT,
  title TEXT, route TEXT, detail TEXT, details TEXT NOT NULL DEFAULT '{}',
  booking_date TEXT, travel_date TEXT, end_date TEXT,
  amount REAL NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'INR',
  status TEXT NOT NULL DEFAULT 'Held',
  claim_status TEXT NOT NULL DEFAULT 'Not Claimed',
  policy_status TEXT, policy_note TEXT, justification TEXT,
  cancelled_at TEXT, cancel_reason TEXT, created_by INTEGER, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bookings_trip ON bookings(trip_id);

CREATE TABLE IF NOT EXISTS refunds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER UNIQUE NOT NULL REFERENCES bookings(id),
  status TEXT NOT NULL DEFAULT 'Expected',
  original_amount REAL NOT NULL, expected_refund REAL NOT NULL DEFAULT 0,
  penalty REAL NOT NULL DEFAULT 0, agency_fee REAL NOT NULL DEFAULT 0, tax_component REAL NOT NULL DEFAULT 0,
  actual_refund REAL NOT NULL DEFAULT 0,
  cancel_date TEXT, policy_deadline TEXT, expected_credit_date TEXT, credit_date TEXT,
  payment_ref TEXT, txn_id TEXT, bank_ref TEXT, channel TEXT,
  owner_id INTEGER REFERENCES users(id), reason TEXT, escalated INTEGER NOT NULL DEFAULT 0,
  sla_days INTEGER NOT NULL DEFAULT 7, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER REFERENCES bookings(id),
  supplier TEXT, invoice_no TEXT, invoice_date TEXT,
  invoiced_amount REAL, tax_amount REAL DEFAULT 0, paid_amount REAL DEFAULT 0,
  payment_method TEXT, card_last4 TEXT, payment_ref TEXT, payment_date TEXT,
  erp_system TEXT, erp_doc_no TEXT, erp_status TEXT DEFAULT 'Not Posted', erp_posted_at TEXT, erp_error TEXT,
  resolved INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS expense_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_no TEXT UNIQUE NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  trip_id INTEGER REFERENCES trips(id),
  title TEXT NOT NULL, purpose TEXT, category TEXT NOT NULL DEFAULT 'Travel',  -- Travel | Non Travel | Event
  trip_category TEXT, receipts_mandatory INTEGER NOT NULL DEFAULT 1,
  start_date TEXT, end_date TEXT, dest_country TEXT, dest_city TEXT,
  company_code TEXT, cost_object_type TEXT, travel_allowance INTEGER NOT NULL DEFAULT 0,
  advance REAL NOT NULL DEFAULT 0, comment TEXT, declaration INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Draft', return_reason TEXT,
  submitted_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS report_cost_objects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES expense_reports(id) ON DELETE CASCADE,
  cost_object TEXT NOT NULL, type TEXT NOT NULL, percentage REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS expense_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES expense_reports(id) ON DELETE CASCADE,
  type TEXT NOT NULL, vendor TEXT, city TEXT, txn_date TEXT, from_date TEXT, to_date TEXT, nights INTEGER,
  payment_type TEXT NOT NULL DEFAULT 'Employee Paid',
  amount REAL NOT NULL DEFAULT 0, tax REAL NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'INR',
  fx_rate REAL NOT NULL DEFAULT 1, fx_source TEXT,
  personal INTEGER NOT NULL DEFAULT 0, comment TEXT,
  status TEXT NOT NULL DEFAULT 'Valid', confidence REAL, source TEXT NOT NULL DEFAULT 'manual',
  receipt_file_id INTEGER, receipt_hash TEXT, flags TEXT,
  allocation_basis TEXT NOT NULL DEFAULT 'Percentage', allocation TEXT NOT NULL DEFAULT '[]',
  itemization TEXT NOT NULL DEFAULT '[]', booking_id INTEGER, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_items_report ON expense_items(report_id);
CREATE TABLE IF NOT EXISTS reimbursements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER UNIQUE NOT NULL REFERENCES expense_reports(id),
  status TEXT NOT NULL DEFAULT 'Not Payable',
  approved_amount REAL NOT NULL DEFAULT 0, payable_amount REAL NOT NULL DEFAULT 0, deductions REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'INR', payment_ref TEXT, channel TEXT,
  attempted_at TEXT, paid_at TEXT, failure_reason TEXT, history TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL, actor_id INTEGER, actor_name TEXT,
  action TEXT NOT NULL, entity_type TEXT, entity_id INTEGER, detail TEXT
);
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is immutable'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is immutable'); END;

CREATE TABLE IF NOT EXISTS assistant_state (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, state TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS assistant_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL
);
`;
