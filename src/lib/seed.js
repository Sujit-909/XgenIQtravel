import { hashPassword, encrypt } from './crypto';
import { addDays, today, nowIso, setSetting, insert } from './util';
import { seedOperations } from './seed-ops';

export const DEMO_PASSWORD = 'Sujit@909';

const USERS = [
  // emp, name, email, phone, role, dept, designation, grade, manager emp, location, city, airport
  ['EMP003', 'Arvind Kapoor', 'arvind.kapoor@abccorp.com', '+91 9876500003', 'manager', 'IT', 'Department Head', 'L7', null, 'Bhubaneswar, Odisha, India', 'Bhubaneswar', 'BBI'],
  ['EMP002', 'Amit Singh', 'manager@xgeniq.com', '+91 9876500002', 'manager', 'IT', 'Manager', 'L5', 'EMP003', 'Bhubaneswar, Odisha, India', 'Bhubaneswar', 'BBI'],
  ['EMP004', 'Meera Iyer', 'meera.iyer@abccorp.com', '+91 9876500004', 'manager', 'Projects', 'Project / Budget Owner', 'L6', 'EMP003', 'Mumbai, Maharashtra, India', 'Mumbai', 'BOM'],
  ['EMP001', 'Rabindra Shau', 'sujit@xgeniq.com', '+91 9876543210', 'employee', 'IT', 'Senior Consultant', 'L3', 'EMP002', 'Bhubaneswar, Odisha, India', 'Bhubaneswar', 'BBI'],
  ['EMP020', 'Anita Desai', 'travel@xgeniq.com', '+91 9876500020', 'travel_desk', 'Travel Desk', 'Travel Desk Operator', 'L4', 'EMP003', 'Bhubaneswar, Odisha, India', 'Bhubaneswar', 'BBI'],
  ['EMP021', 'Karan Mehta', 'karan.mehta@abccorp.com', '+91 9876500021', 'finance', 'Finance', 'Finance Administrator', 'L5', 'EMP003', 'Mumbai, Maharashtra, India', 'Mumbai', 'BOM'],
  ['EMP022', 'Sujata Nair', 'admin@xgeniq.com', '+91 9876500022', 'admin', 'Administration', 'Travel Administrator', 'L5', 'EMP003', 'Bhubaneswar, Odisha, India', 'Bhubaneswar', 'BBI'],
  ['EMP005', 'Rahul Mehta', 'rahul.mehta@abccorp.com', '+91 9876500005', 'employee', 'IT', 'Consultant', 'L3', 'EMP002', 'Delhi, India', 'Delhi', 'DEL'],
  ['EMP006', 'Priya Singh', 'priya.singh@abccorp.com', '+91 9876500006', 'employee', 'HR', 'HR Business Partner', 'L3', 'EMP002', 'Delhi, India', 'Delhi', 'DEL'],
  ['EMP007', 'Neha Sinha', 'neha.sinha@abccorp.com', '+91 9876500007', 'employee', 'Finance', 'Analyst', 'L2', 'EMP002', 'Mumbai, Maharashtra, India', 'Mumbai', 'BOM'],
  ['EMP008', 'Suresh Patnaik', 'suresh.patnaik@abccorp.com', '+91 9876500008', 'employee', 'Projects', 'Site Engineer', 'L3', 'EMP002', 'Bhubaneswar, Odisha, India', 'Bhubaneswar', 'BBI'],
  ['EMP009', 'Kavita Rao', 'kavita.rao@abccorp.com', '+91 9876500009', 'employee', 'EHS', 'EHS Officer', 'L3', 'EMP002', 'Bengaluru, Karnataka, India', 'Bengaluru', 'BLR'],
  ['EMP010', 'Manoj Das', 'manoj.das@abccorp.com', '+91 9876500010', 'employee', 'Maintenance', 'Supervisor', 'L2', 'EMP002', 'Kolkata, West Bengal, India', 'Kolkata', 'CCU'],
  ['EMP011', 'Rohit Verma', 'rohit.verma@abccorp.com', '+91 9876500011', 'employee', 'IT', 'Developer', 'L2', 'EMP002', 'Hyderabad, Telangana, India', 'Hyderabad', 'HYD'],
  ['EMP012', 'Vikash Kumar', 'vikash.kumar@abccorp.com', '+91 9876500012', 'employee', 'Projects', 'IT Delivery Lead', 'L4', 'EMP002', 'Mumbai, Maharashtra, India', 'Mumbai', 'BOM'],
  ['EMP013', 'Sanjay Verma', 'sanjay.verma@abccorp.com', '+91 9876500013', 'employee', 'Maintenance', 'Technician', 'L2', 'EMP002', 'Chennai, Tamil Nadu, India', 'Chennai', 'MAA'],
];

const LEGACY_DEMO_ACCOUNTS = [
  { emp: 'EMP001', role: 'employee', oldEmail: 'rabindra.shau@abccorp.com', email: 'sujit@xgeniq.com' },
  { emp: 'EMP002', role: 'manager', oldEmail: 'amit.singh@abccorp.com', email: 'manager@xgeniq.com' },
  { emp: 'EMP020', role: 'travel_desk', oldEmail: 'anita.desai@abccorp.com', email: 'travel@xgeniq.com' },
  { emp: 'EMP022', role: 'admin', oldEmail: 'sujata.nair@abccorp.com', email: 'admin@xgeniq.com' },
];

export function migrateDemoAccounts(db) {
  db.tx(() => {
    for (const account of LEGACY_DEMO_ACCOUNTS) {
      const user = db.get('SELECT id, password_hash FROM users WHERE emp_id=? AND role=? AND lower(email)=lower(?)', account.emp, account.role, account.oldEmail);
      if (!user) continue;

      const conflict = db.get('SELECT id FROM users WHERE lower(email)=lower(?) AND id<>?', account.email, user.id);
      if (conflict) throw new Error(`Cannot migrate demo account ${account.oldEmail}: ${account.email} is already in use`);

      db.run('UPDATE users SET email=?, password_hash=? WHERE id=?', account.email, hashPassword(DEMO_PASSWORD), user.id);
    }
  });
}

export function seedDatabase(db) {
  db.tx(() => {
    const pwd = hashPassword(DEMO_PASSWORD);
    const t0 = nowIso();
    const ids = {};
    for (const [emp, name, email, phone, role, dept, desig, grade, , loc, city, ap] of USERS) {
      ids[emp] = insert(db, 'users', {
        emp_id: emp, name, email, phone, password_hash: pwd, role, department: dept, designation: desig, title: desig, grade,
        location: loc, home_city: city, home_airport: ap, nationality: 'Indian', gender: 'Male', created_at: t0,
        dob: emp === 'EMP001' ? '1987-06-20' : '1988-01-15', blood_group: emp === 'EMP001' ? 'B+' : 'O+', marital_status: 'Married',
        allergies: 'None', medical_conditions: 'None', special_notes: '-',
      });
    }
    for (const u of USERS) if (u[8]) db.run('UPDATE users SET manager_id=? WHERE emp_id=?', ids[u[8]], u[0]);
    db.run("UPDATE users SET gender='Female' WHERE emp_id IN ('EMP004','EMP006','EMP007','EMP009','EMP020','EMP022')");

    // ----- settings -----
    setSetting(db, 'threshold_amount', 100000);
    setSetting(db, 'max_advance', 50000);
    setSetting(db, 'price_tolerance_pct', 10);
    setSetting(db, 'intl_approver_id', ids.EMP021);
    setSetting(db, 'emergency_approver_id', ids.EMP003);
    setSetting(db, 'refund_overdue_days', 15);

    // ----- master data -----
    insert(db, 'master_data', { kind: 'company', code: 'ABC01', name: 'ABC Corp Pvt. Ltd.', meta: { currency: 'INR' } });
    for (const d of ['IT', 'Operations', 'HR', 'Finance', 'Projects', 'Procurement', 'EHS', 'Maintenance', 'Administration', 'Travel Desk'])
      insert(db, 'master_data', { kind: 'department', code: d.toUpperCase().slice(0, 4), name: d, owner_id: ids.EMP003 });
    const co = (kind, code, name, owner, budget) => insert(db, 'master_data', { kind, code, name, owner_id: ids[owner], meta: { budget } });
    co('cost_center', 'CC1001', 'Marketing Dept', 'EMP004', 2500000); co('cost_center', 'CC2001', 'IT Dept', 'EMP003', 4000000);
    co('cost_center', 'CC3001', 'Operations Dept', 'EMP004', 3000000); co('cost_center', 'CC4001', 'HR Dept', 'EMP004', 1200000);
    co('project', 'PRJ1001', 'Digital Transformation', 'EMP004', 3500000); co('project', 'PRJ1002', 'Client Project', 'EMP004', 2000000);
    co('project', 'PRJ1023', 'Projects - Singapore', 'EMP004', 2500000);
    co('sales_order', 'SO70001', 'Sales Order 70001 - Acme', 'EMP004', 800000); co('sales_order', 'SO70002', 'Sales Order 70002 - Globex', 'EMP004', 600000);
    co('internal_order', 'IO5001', 'Annual Conference', 'EMP004', 500000);
    const cities = [['Mumbai', 'Metro', 'India'], ['Delhi', 'Metro', 'India'], ['Bengaluru', 'Metro', 'India'], ['Kolkata', 'Metro', 'India'], ['Chennai', 'Metro', 'India'], ['Hyderabad', 'Metro', 'India'],
      ['Bhubaneswar', 'Tier 2', 'India'], ['Pune', 'Tier 2', 'India'], ['Goa', 'Tier 2', 'India'], ['Jaipur', 'Tier 2', 'India'],
      ['Singapore', 'International', 'Singapore'], ['Dubai', 'International', 'UAE'], ['London', 'International', 'United Kingdom']];
    cities.forEach(([n, tier, country], i) => insert(db, 'master_data', { kind: 'city', code: `C${String(i + 1).padStart(3, '0')}`, name: n, meta: { tier, country } }));

    // ----- suppliers -----
    const sup = [['IndiGo', 'airline', 1, 24], ['Air India', 'airline', 1, 24], ['Vistara', 'airline', 1, 24], ['SpiceJet', 'airline', 0, 24], ['Singapore Airlines', 'airline', 1, 24],
      ['Emirates', 'airline', 0, 24], ['Qatar Airways', 'airline', 0, 24], ['British Airways', 'airline', 0, 24],
      ['Marriott Hotels', 'hotel', 1, 24], ['Hilton Hotels', 'hotel', 0, 24], ['IHG Hotels', 'hotel', 0, 24], ['Taj Hotels', 'hotel', 0, 24],
      ['ABC Travels Pvt. Ltd.', 'agency', 1, 24], ['ComfortDelGro', 'ground', 1, 12], ['Ola', 'ground', 0, 12], ['Uber', 'ground', 0, 12], ['VisaPoint Services', 'visa', 1, 72]];
    for (const [name, kind, pref, sla] of sup) insert(db, 'suppliers', { name, kind, preferred: pref, sla_hours: sla, contact: '+91 800 123 4567' });

    // ----- policy -----
    const R = (no, name, type, to, from, cond, desc, status = 'Active') => {
      const id = insert(db, 'policy_rules', { rule_no: no, name, type, applicable_to: to, description: desc, status, effective_from: from, effective_to: '2027-12-31', conditions: cond });
      insert(db, 'policy_versions', { rule_id: id, version: 1, effective_from: from, effective_to: '2027-12-31', changed_by: 'System', description: 'Initial version', status: 'Active', changed_at: t0 });
    };
    R('PR001', 'Domestic Economy Flight', 'Flight', 'All Employees', '2024-01-01', { travelType: 'Domestic', cabin: ['Economy'], maxFare: 15000, maxDurationMin: 360 }, 'Defines travel class, fare limits and preferred airlines for domestic travel.');
    R('PR002', 'International Business Flight', 'Flight', 'Grade L5 and above', '2024-01-01', { travelType: 'International', cabin: ['Business'], grades: ['L5', 'L6', 'L7'], maxFare: 150000, maxDurationMin: 1200 }, 'Business class for senior grades on international sectors.');
    R('PR003', 'Hotel - Metro Cities', 'Hotel', 'All Employees', '2024-01-01', { tier: 'Metro', maxPerNight: 12000 }, 'Nightly hotel limit in metro cities.');
    R('PR004', 'Hotel - Non Metro Cities', 'Hotel', 'All Employees', '2024-01-01', { tier: 'Tier 2', maxPerNight: 7000 }, 'Nightly hotel limit in non-metro cities.');
    R('PR005', 'Advance Booking Window', 'General', 'All Employees', '2024-01-01', { advanceDays: 7 }, 'Minimum days between booking and departure.');
    R('PR006', 'Preferred Airlines', 'Supplier', 'All Employees', '2024-01-01', { preferred: ['IndiGo', 'Air India', 'Vistara', 'Singapore Airlines'] }, 'Preferred airline list.');
    R('PR007', 'Project Travel Approval', 'Approval', 'Project Cost Object', '2024-01-01', { workflow: 'project' }, 'Trips charged to a project need project / budget owner approval.');
    R('PR008', 'International Travel Approval', 'Approval', 'All Employees', '2024-01-01', { workflow: 'international' }, 'International trips need department head and finance approval.');
    R('PR009', 'International Economy Flight - Singapore', 'Flight', 'All Employees', '2024-01-01', { travelType: 'International', countries: ['Singapore'], cabin: ['Economy', 'Premium Economy'], maxFare: 40000, maxDurationMin: 480 }, 'Rule INT-FLT-001 / INT-FLT-003: fare limit ₹40,000 and 8 hour maximum duration.');
    R('PR010', 'International Economy Flight - Default', 'Flight', 'All Employees', '2024-01-01', { travelType: 'International', cabin: ['Economy', 'Premium Economy'], maxFare: 60000, maxDurationMin: 960 }, 'Default limits for other international destinations.');
    R('PR011', 'Hotel - International', 'Hotel', 'All Employees', '2024-01-01', { tier: 'International', maxPerNight: 12500 }, 'Nightly hotel limit for international cities.');
    R('PR012', 'Rail & Bus Class', 'Rail', 'All Employees', '2024-01-01', { class: 'AC 2 Tier' }, 'Class entitlement for rail and bus journeys.', 'Inactive');
    const wf = (name, type, steps) => insert(db, 'approval_workflows', { name, trip_type: type, steps });
    wf('Standard domestic trip within budget', 'standard', ['Reporting Manager']);
    wf('Trip charged to a project', 'project', ['Reporting Manager', 'Project / Budget Owner']);
    wf('Estimated cost above threshold', 'threshold', ['Reporting Manager', 'Budget Owner', 'Department Head']);
    wf('International travel', 'international', ['Reporting Manager', 'Department Head', 'Finance / International Travel Approver']);
    wf('Emergency travel', 'emergency', ['Emergency Approver (post-travel review)']);
    insert(db, 'policy_versions', { rule_id: 1, version: 3, effective_from: '2024-01-01', effective_to: '2027-12-31', changed_by: 'Sujata Nair', description: 'Updated fare limit and added new supplier', status: 'Active', changed_at: t0 });

    seedProfiles(db, ids);
    seedOperations(db, ids);
  });
}

function seedProfiles(db, ids) {
  const t = today();
  const me = ids.EMP001;
  const docs = [
    ['Passport', 'International Travel', 'Z1234567', '2020-01-01', '2030-09-20', 1],
    ['PAN Card', 'Tax Identification', 'ABCDE1234F', null, null, 1],
    ['Aadhaar Card', 'Identity Proof', 'XXXX XXXX 1234', null, null, 1],
    ['Driving License', 'Personal Identification', 'OD02 20150012345', '2015-06-15', '2030-06-15', 1],
    ['Visa', 'USA Business Visa', 'VISA789456', '2023-11-25', addDays(t, 4), 1],
    ['Work Permit', 'Work Permit', 'WP123456', '2021-11-10', addDays(t, -14), 0],
  ];
  for (const [type, title, no, iss, exp, ver] of docs)
    insert(db, 'documents', { user_id: me, doc_type: type, title, doc_number: no, issue_date: iss, expiry_date: exp, country: type === 'Visa' ? 'United States' : 'India', verified: ver, created_at: nowIso() });
  // Passports for the rest of the team (team compliance screen)
  const offsets = { EMP002: 480, EMP003: 800, EMP004: 540, EMP005: 40, EMP006: 61, EMP007: 2, EMP008: -13, EMP009: 25, EMP010: 0, EMP011: 66, EMP012: 800, EMP013: 150 };
  Object.entries(offsets).forEach(([emp, off], i) => {
    insert(db, 'documents', { user_id: ids[emp], doc_type: 'Passport', title: 'International Travel', doc_number: `${'ABCDEFGHJK'[i % 10]}${1234567 + i * 1111}`, issue_date: '2019-01-10', expiry_date: addDays(t, off), country: 'India', verified: 1, created_at: nowIso() });
    if (i % 3 === 0) insert(db, 'documents', { user_id: ids[emp], doc_type: 'Visa', title: 'Schengen Visa', doc_number: `VS${77000 + i}`, issue_date: '2025-02-01', expiry_date: addDays(t, 120 + i * 20), country: 'Germany', verified: 1, created_at: nowIso() });
  });

  const pm = (kind, brand, label, last4, valid, extra = {}) => insert(db, 'payment_methods', { user_id: me, kind, brand, label, last4, holder: 'Rabindra Shau', valid_thru: valid, ...extra });
  pm('corporate_card', 'VISA', 'HDFC Corporate Card', '1234', '12/27', { is_default: 1, status: 'Default' });
  pm('personal_card', 'Mastercard', 'ICICI Personal Card', '5678', '08/26'); pm('personal_card', 'Amex', 'Amex Card', '9012', '05/28');
  pm('upi', 'UPI', 'UPI (Google Pay)', null, null, { handle: 'rabindra.shau@okhdfcbank' });
  const ba = (bank, type, no, ifsc, verified, active, def) => insert(db, 'bank_accounts', { user_id: me, bank, account_type: type, holder: 'Rabindra Shau', account_enc: encrypt(no), last4: no.slice(-4), ifsc, verified, active, is_default: def });
  ba('HDFC Bank', 'Savings Account', '50100123451234', 'HDFC0001234', 1, 1, 1); ba('ICICI Bank', 'Current Account', '000405015678', 'ICIC0005678', 1, 1, 0); ba('SBI Bank', 'Savings Account', '30012345679012', 'SBIN0009012', 1, 0, 0);
  insert(db, 'emergency_contacts', { user_id: me, name: 'Priyanka Shau', relationship: 'Spouse', phone: '+91 9876543210', email: 'priyanka.shau@gmail.com', is_primary: 1 });
  insert(db, 'emergency_contacts', { user_id: me, name: 'Ramesh Shau', relationship: 'Father', phone: '+91 8765432109', email: 'ramesh.shau@gmail.com', is_primary: 0 });
  insert(db, 'family_members', { user_id: me, name: 'Aarav Shau', relationship: 'Child', dob: '2018-03-15', gender: 'Male', special_assistance: 'None' });
  const ad = (kind, line, city, state, pin, def) => insert(db, 'addresses', { user_id: me, kind, line, city, state, pin, country: 'India', is_default: def });
  ad('Current', 'Plot No. 123, Lane 2, Patia, Bhubaneswar, Odisha 751024, India', 'Bhubaneswar', 'Odisha', '751024', 1);
  ad('Permanent', 'Village Nuapada, PO Nuapada, Cuttack, Odisha 754001, India', 'Cuttack', 'Odisha', '754001', 0);
  ad('Office', 'ABC Corp Pvt. Ltd., IT Tower, 5th Floor, Infocity, Bhubaneswar 751024, Odisha, India', 'Bhubaneswar', 'Odisha', '751024', 0);
  ad('Other', 'Flat No. 402, Green Valley Apartments, Khandagiri, Bhubaneswar 751030, Odisha, India', 'Bhubaneswar', 'Odisha', '751030', 0);
  const lp = (cat, prov, prog, no, tier, exp, rank) => insert(db, 'loyalty_programs', { user_id: me, category: cat, provider: prov, program: prog, membership_no: no, tier, expiry_date: exp, rank });
  lp('airline', 'IndiGo', '6E Rewards', '6E123456789', '6E Silver', addDays(t, 200), 'Primary Airline'); lp('airline', 'Air India', 'Maharaja Club', 'AI987654321', 'Silver', addDays(t, 30), 'Secondary Airline');
  lp('airline', 'Emirates', 'Emirates Skywards', 'EK123456789', 'Blue', addDays(t, -60), null);
  lp('hotel', 'Marriott Hotels', 'Marriott Bonvoy', 'MB12345678', 'Gold Elite', addDays(t, 150), 'Primary Hotel'); lp('hotel', 'Hilton Hotels', 'Hilton Honors', 'HH87654321', 'Silver', addDays(t, 330), 'Secondary Hotel');
  lp('car', 'Hertz', 'Hertz Gold Plus Rewards', 'HZ1234567', 'Gold', addDays(t, 400), null); lp('other', 'Priority Pass', 'Priority Pass', 'PP12345678', 'Standard', addDays(t, 365), null);
  db.run('INSERT INTO user_json(user_id,kind,data) VALUES(?,?,?)', me, 'travel_preferences', JSON.stringify({
    class: 'Economy', seat: 'Window', meal: 'Vegetarian', airlines: ['IndiGo', 'Air India', 'Vistara'], hotelCategory: '3 Star / Business', roomType: 'Non-smoking room',
    groundTransport: 'Company Cab', useLoyalty: true, special: ['Wheelchair assistance'], otherSpecial: '',
  }));
  db.run('INSERT INTO user_json(user_id,kind,data) VALUES(?,?,?)', me, 'notification_settings', JSON.stringify({
    expiry: { Passport: { on: true, days: 60 }, Visa: { on: true, days: 60 }, 'Driving License': { on: true, days: 30 }, 'Work Permit': { on: true, days: 30 }, 'Other Documents': { on: true, days: 30 } },
    channels: { inApp: true, email: true, push: true, whatsapp: true, teams: true },
  }));
}
