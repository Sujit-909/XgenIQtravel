// Pure formatting helpers (safe on server and client)
export const inr = (n, d = 0) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
export const num2 = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const fdate = (s) => { if (!s) return '-'; const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s)); return m ? `${Number(m[3])} ${M[Number(m[2]) - 1]} ${m[1]}` : String(s); };
export const fshort = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? `${Number(m[3])} ${M[Number(m[2]) - 1]}` : '-'; };
export const fdt = (s) => { if (!s) return '-'; const d = new Date(s); if (Number.isNaN(d.getTime())) return String(s); return `${fdate(d.toISOString())}, ${d.toISOString().slice(11, 16)}`; };
export const range = (a, b) => (a === b ? fdate(a) : `${fshort(a)} – ${fdate(b)}`);
export const nightsOf = (a, b) => Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 86400000));
export const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');

const T = {
  green: ['Approved', 'Valid', 'Active', 'Confirmed', 'Completed', 'Verified', 'Credited', 'Paid', 'Finance Approved', 'Posted', 'Matched', 'Compliant', 'Ready', 'Low', 'Default', 'Added', 'Linked', 'Done', 'Closed Won', 'On Track', 'Resolved', 'Healthy', 'Normal Priority', 'Preferred', 'Valid Visa', 'Yes'],
  blue: ['Submitted', 'Under Approval', 'Under Review', 'Booking In Progress', 'Manager Approved', 'In Progress', 'Payment Initiated', 'Processing', 'Requested', 'Supplier Confirmed', 'Normal', 'Payable', 'Ticketing Pending', 'Primary', 'Awaiting Agency Quote', 'Created', 'Expected', 'Demo provider', 'Offline extractor', 'Demo OTP mode'],
  orange: ['Pending', 'Pending for Review', 'Expiring Soon', 'Needs Review', 'Partially Credited', 'At Risk', 'Medium', 'Held', 'Exception Required', 'Awaiting Information', 'Traveller Info', 'Pending > 7 days', 'On Hold', 'Partially Matched', 'Amount Mismatch', 'Info Requested', 'Attention', 'Optional', 'Approval Pending', 'Returned for Correction', 'Visa Pending', 'Pending Verification'],
  red: ['Rejected', 'Expired', 'Failed', 'Cancelled', 'Out of Policy', 'High', 'Not Ready', 'Overdue', 'Overdue Refund', 'Breached', 'Missing Invoice', 'Error', 'Duplicate Charge', 'Missing', 'Returned', 'Failed / Issues', 'Not Configured', 'Not configured'],
  purple: ['Travel In Progress', 'Expenses Pending', 'Under Process', 'Booking in Progress', 'Changed', 'Claim In Progress', 'Event'],
};
const MAP = Object.fromEntries(Object.entries(T).flatMap(([tone, list]) => list.map((s) => [s.toLowerCase(), tone])));
export const toneOf = (s) => MAP[String(s || '').toLowerCase()] || 'gray';
