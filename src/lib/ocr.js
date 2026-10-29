// Receipt data extraction.
//
// INTEGRATION POINT: this module contains a deterministic, offline extractor so the whole
// "upload receipts -> draft line items" flow works without any external service.
// Replace `extractFromReceipt` with a call to your OCR / AI provider (e.g. a document-AI API) that returns
// the same shape: { type, vendor, txn_date, amount, tax, currency, confidence }.
const TYPE_RULES = [
  [/flight|air|ticket|indigo|vistara|airline|boarding/i, 'Air Fare'], [/hotel|stay|marriott|novotel|hilton|taj|ibis|lodge|room/i, 'Hotel'],
  [/cab|uber|ola|taxi|ride/i, 'Cab Fare'], [/meal|food|dinner|lunch|restaurant|cafe|barbeque|bbq/i, 'Meals'], [/bus|volvo/i, 'Bus'], [/train|rail|irctc|rajdhani/i, 'Train Fare'],
  [/fuel|petrol|diesel/i, 'Fuel'], [/parking/i, 'Parking'], [/internet|wifi|sim/i, 'Internet'], [/conference|registration/i, 'Conference Fee'],
];
const VENDORS = ['IndiGo', 'Air India', 'Vistara', 'Marriott', 'Novotel', 'Hilton', 'Uber', 'Ola', 'Barbeque Nation', 'Volvo', 'IRCTC'];

export function extractFromReceipt({ name, buffer, defaultDate, defaultCurrency = 'INR' }) {
  const base = String(name).replace(/\.[^.]+$/, '');
  const type = (TYPE_RULES.find(([re]) => re.test(base)) || [null, 'Miscellaneous'])[1];
  const vendor = VENDORS.find((v) => new RegExp(v.split(' ')[0], 'i').test(base)) || base.replace(/[_-]+/g, ' ').replace(/\d+/g, '').trim().slice(0, 40) || 'Unknown vendor';
  let amount = 0; let tax = 0; let confidence = 0.35;
  let text = '';
  if (buffer && /\.(txt|csv)$/i.test(name)) text = buffer.toString('utf8');
  const fromText = /total[^\d]{0,12}([\d,]+(?:\.\d{1,2})?)/i.exec(text);
  const taxText = /(?:gst|tax)[^\d]{0,12}([\d,]+(?:\.\d{1,2})?)/i.exec(text);
  const fromName = /(?:^|[_\s-])(\d{2,7})(?:$|[_\s-])/.exec(base);
  if (fromText) { amount = Number(fromText[1].replace(/,/g, '')); confidence = 0.9; if (taxText) { tax = Number(taxText[1].replace(/,/g, '')); amount = Math.max(0, amount - tax); } }
  else if (fromName) { amount = Number(fromName[1]); confidence = 0.8; }
  const dateInText = /(\d{4}-\d{2}-\d{2})/.exec(text) || /(\d{4}-\d{2}-\d{2})/.exec(base);
  const known = type !== 'Miscellaneous';
  if (known && confidence < 0.8) confidence += 0.15;
  return { type, vendor, txn_date: dateInText ? dateInText[1] : defaultDate, amount, tax, currency: defaultCurrency, confidence: Math.min(0.95, Math.round(confidence * 100) / 100) };
}
