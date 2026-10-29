import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { getReport } from './expenses';

// pdf-lib's standard fonts only support WinAnsi - replace anything else so generation never throws.
const safe = (s) => String(s ?? '').replace(/₹/g, 'INR ').replace(/[^\x20-\x7E\u00A0-\u00FF]/g, '?');
const money = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const BLUE = rgb(0.1, 0.25, 0.65); const LIGHT = rgb(0.9, 0.94, 1); const GREY = rgb(0.35, 0.4, 0.5);

export async function buildReportPdf(db, user, id) {
  const d = getReport(db, user, id);
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica); const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 595; const H = 842; const M = 36;
  let page; let y; let pageNo = 0;
  const newPage = () => {
    page = doc.addPage([W, H]); pageNo += 1; y = H - M;
    page.drawRectangle({ x: M, y: y - 26, width: 120, height: 26, color: LIGHT, borderColor: BLUE, borderWidth: 0.7 });
    page.drawText('XGENIQ', { x: M + 8, y: y - 17, size: 11, font: bold, color: BLUE });
    page.drawText('DIGITAL SOLUTIONS', { x: M + 58, y: y - 17, size: 6, font, color: GREY });
    page.drawText(`${safe(d.report.report_no)}  |  Page ${pageNo}`, { x: W - M - 120, y: y - 17, size: 8, font, color: GREY });
    y -= 44;
  };
  const need = (h) => { if (y - h < M + 20) newPage(); };
  const text = (t, x, size = 8.5, f = font, color = rgb(0.1, 0.1, 0.15), maxW) => {
    let s = safe(t); if (maxW) while (f.widthOfTextAtSize(s, size) > maxW && s.length > 2) s = `${s.slice(0, -2)}…`.replace('…', '.');
    page.drawText(s, { x, y, size, font: f, color });
  };
  const heading = (t) => { need(30); y -= 6; text(t, M, 11, bold, BLUE); y -= 5; page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.8, color: BLUE }); y -= 13; };
  const kv = (rows, cols = 2) => {
    const cw = (W - 2 * M) / cols;
    for (let i = 0; i < rows.length; i += cols) {
      need(16);
      for (let c = 0; c < cols && rows[i + c]; c++) { const [k, v] = rows[i + c]; text(`${k}:`, M + c * cw, 8, bold, GREY); text(v, M + c * cw + 78, 8.5, font, undefined, cw - 82); }
      y -= 14;
    }
  };
  const table = (head, rows, widths, align = []) => {
    const total = widths.reduce((a, b) => a + b, 0); const scale = (W - 2 * M) / total; const w = widths.map((x) => x * scale);
    const row = (cells, isHead, shade) => {
      need(18);
      if (isHead || shade) page.drawRectangle({ x: M, y: y - 5, width: W - 2 * M, height: 16, color: LIGHT });
      let x = M;
      cells.forEach((c, i) => {
        const t = safe(c); const f = isHead ? bold : font; const tw = f.widthOfTextAtSize(t, 7.5);
        const px = align[i] === 'r' ? x + w[i] - 4 - Math.min(tw, w[i] - 8) : x + 4;
        text(t, px, 7.5, f, undefined, w[i] - 8); x += w[i];
      });
      y -= 16;
    };
    row(head, true); rows.forEach((r, i) => row(r, false, r.__total || false && i));
  };

  newPage();
  page.drawText('OVERALL EXPENSE REPORT', { x: M, y, size: 18, font: bold, color: BLUE }); y -= 16;
  text('Business Travel Expense Claim - Generated from all expense line items', M, 9, font, GREY); y -= 8;
  const r = d.report; const c = d.calc;
  heading('1. Report and Trip Details');
  kv([['Report No', r.report_no], ['Status', r.status], ['Title', r.title], ['Category', r.category], ['Purpose', r.purpose], ['Trip', d.trip?.trip_no || '-'], ['Trip Category', r.trip_category || '-'], ['Company Code', r.company_code],
    ['Travel Dates', `${r.start_date || '-'} to ${r.end_date || '-'}`], ['Destination', [r.dest_city, r.dest_country].filter(Boolean).join(', ') || '-'], ['Created By', `${d.owner.name} (${d.owner.emp_id})`], ['Department', d.owner.department || '-'],
    ['Cost Object Type', r.cost_object_type || '-'], ['Submitted', r.submitted_at ? r.submitted_at.slice(0, 10) : 'Not submitted']]);
  heading('2. Financial Summary');
  table(['Items', 'Amount excl. tax', 'Total tax', 'Gross claim', 'Travel advance', 'Est. reimbursement'],
    [[c.count, money(c.excl), money(c.tax), money(c.gross), money(c.advance), money(c.estimatedReimbursement)]], [1, 2, 2, 2, 2, 2.4], ['r', 'r', 'r', 'r', 'r', 'r']);
  y -= 2; text(`Company-paid: ${money(c.company)}   Personal / non-reimbursable: ${money(c.personal)}   Advance recoverable from employee: ${money(c.advanceRecoverable)}`, M, 7.5, font, GREY); y -= 12;
  heading('3. Expense Items');
  table(['#', 'Type', 'Date', 'Vendor', 'Payment', 'Excl. tax', 'Tax', 'Total', 'Receipt'],
    [...d.items.map((i, n) => [n + 1, i.type, i.hotel_dates || (i.type === 'Hotel' && i.from_date ? `${i.from_date.slice(5)}..${i.to_date.slice(5)}` : i.txn_date), i.vendor, i.personal ? 'Personal' : i.payment_type, money(i.amount * i.fx_rate), money(i.tax * i.fx_rate), money(i.total), i.receipt_file_id ? (i.status === 'Needs Review' ? 'Needs review' : 'Attached') : 'Missing']),
      ['', 'TOTAL', '', '', '', money(c.excl), money(c.tax), money(c.gross), `${c.count - c.needsReview}/${c.count}`]],
    [0.5, 1.4, 1.6, 2, 1.5, 1.5, 1.2, 1.5, 1.3], ['l', 'l', 'l', 'l', 'l', 'r', 'r', 'r', 'l']);
  heading('4. Cost Allocation Summary');
  table(['Cost Object Type', 'Cost Object', 'Allocation %', 'Allocated amount'],
    d.costObjects.map((o) => [o.type, o.cost_object, `${o.percentage}%`, money((c.gross * o.percentage) / 100)]), [2, 3.5, 1.5, 2], ['l', 'l', 'r', 'r']);
  heading('5. Travel Allowance, Receipts and Policy Checks');
  kv([['Travel Allowance', r.travel_allowance ? 'Yes' : 'No'], ['Receipts Attached', `${d.policyChecks.receiptsAttached} of ${d.policyChecks.receiptsTotal}`], ['Receipt Compliance', `${d.policyChecks.verified} of ${d.policyChecks.receiptsTotal} verified`], ['Policy Checks', `${d.policyChecks.needsReview} item(s) need review`]]);
  heading('6. Comments and Declaration');
  text(`Overall report comment: ${r.comment || '-'}`, M, 8.5); y -= 13;
  text('Employee declaration: I certify that these expenses were incurred for official business and that the information provided is accurate.', M, 8, font, undefined, W - 2 * M); y -= 22;
  need(90);
  page.drawRectangle({ x: M, y: y - 70, width: W - 2 * M, height: 78, borderColor: BLUE, borderWidth: 0.7 });
  const col = (W - 2 * M) / 3;
  ['Employee', 'Approver', 'Finance Use Only'].forEach((t, i) => { page.drawText(t, { x: M + 8 + i * col, y: y - 6, size: 9, font: bold, color: BLUE }); });
  const lines = [['Signature: ______________', 'Date: __________________'], ['Decision: ______________', 'Signature: ____________', 'Date: __________________'], ['Reviewed by: ___________', 'Processed by: __________', 'Payment date: __________', 'Reference: ______________']];
  lines.forEach((ls, i) => ls.forEach((l, j) => page.drawText(l, { x: M + 8 + i * col, y: y - 24 - j * 13, size: 7.5, font, color: GREY })));
  return doc.save();
}
