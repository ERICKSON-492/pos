// Illustrative rates — confirm current KRA rates per tax category before
// relying on this for real invoices. Rates change; don't hardcode blindly
// in production without a periodic review process.
const RATES: Record<string, number> = {
  A: 0, // Exempt
  B: 0.16, // Standard rate
  C: 0, // Zero-rated
  D: 0, // Non-VAT
  E: 0.08, // Example reduced rate
};

export function calcLineTax(unitPrice: number, qty: number, taxCategory: string) {
  const gross = unitPrice * qty;
  const rate = RATES[taxCategory] ?? 0;
  // Assumes price is tax-inclusive, standard for Kenyan retail POS displays.
  const taxAmount = gross - gross / (1 + rate);
  return { lineTotal: gross, taxAmount: Number(taxAmount.toFixed(2)) };
}
