// Pure calculation helpers (no database access) shared by services, seed data and tests.
import { round2 } from './util';

// Exchange rates to INR. In production, load these from the treasury / ERP rate table.
export const FX_RATES = { INR: 1, USD: 83.5, EUR: 90.2, SGD: 62.0, AED: 22.7, GBP: 105.4 };
export const FX_SOURCE = 'Company treasury rate table';

export const itemTotal = (i) => round2((Number(i.amount || 0) + Number(i.tax || 0)) * Number(i.fx_rate || 1));
export const itemExcl = (i) => round2(Number(i.amount || 0) * Number(i.fx_rate || 1));
export const itemTax = (i) => round2(Number(i.tax || 0) * Number(i.fx_rate || 1));

export function calcReport(items, advance = 0) {
  const sum = (f) => round2(items.reduce((s, i) => s + f(i), 0));
  const gross = sum(itemTotal);
  const company = sum((i) => (i.payment_type !== 'Employee Paid' ? itemTotal(i) : 0));
  const personal = sum((i) => (i.payment_type === 'Employee Paid' && i.personal ? itemTotal(i) : 0));
  const reimbursable = round2(gross - company - personal);
  return {
    count: items.length, excl: sum(itemExcl), tax: sum(itemTax), gross, company, personal, reimbursable,
    advance: Number(advance || 0),
    estimatedReimbursement: Math.max(0, round2(reimbursable - Number(advance || 0))),
    advanceRecoverable: Math.max(0, round2(Number(advance || 0) - reimbursable)),
    needsReview: items.filter((i) => i.status === 'Needs Review').length,
  };
}

// Validate a cost allocation table. Returns an error string or null.
export function validateAllocation(rows, basis, total) {
  if (!Array.isArray(rows) || rows.length === 0) return 'At least one cost object is required';
  const seen = new Set();
  for (const r of rows) {
    if (!r.costObject) return 'Select a cost object for every allocation row';
    if (seen.has(r.costObject)) return `Cost object ${r.costObject} is selected more than once`;
    seen.add(r.costObject);
  }
  if (basis === 'Amount') {
    const s = round2(rows.reduce((a, r) => a + Number(r.amount || 0), 0));
    if (Math.abs(s - round2(total)) > 0.01) return `Allocated amounts (${s}) must equal the item total (${round2(total)})`;
  } else {
    const s = round2(rows.reduce((a, r) => a + Number(r.percentage || 0), 0));
    if (Math.abs(s - 100) > 0.01) return `Allocation percentages must total 100% (currently ${s}%)`;
    if (rows.some((r) => Number(r.percentage) <= 0)) return 'Each allocation percentage must be greater than zero';
  }
  return null;
}

export function allocate(rows, basis, total) {
  return rows.map((r) => ({
    costObjectType: r.costObjectType, costObject: r.costObject,
    percentage: basis === 'Amount' ? round2((Number(r.amount) / (total || 1)) * 100) : Number(r.percentage),
    amount: basis === 'Amount' ? Number(r.amount) : round2((Number(r.percentage) / 100) * total),
  }));
}
