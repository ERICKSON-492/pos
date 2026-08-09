/**
 * KRA eTIMS (VSCU) client.
 *
 * IMPORTANT: Endpoint paths, exact payload field names, and auth flow below
 * follow the general shape of KRA's published OSCU/VSCU specification and
 * the sandbox conventions documented by KRA-certified integrators. KRA
 * distributes the authoritative Postman collection and PDF spec directly to
 * developers who register on the eTIMS portal (https://etims.kra.go.ke) —
 * treat that as the source of truth and adjust the paths/fields here to
 * match it exactly before you go anywhere near production. Do not submit
 * real invoices against production until you've done that comparison.
 *
 * Flow implemented here:
 *  1. authenticate()      -> get bearer token
 *  2. initializeDevice()  -> one-time: registers this VSCU instance, returns cmcKey
 *  3. submitInvoice()     -> sends a sale as a signed tax invoice
 *  4. fetchUnspscCodes()  -> daily sync job pulls product classification codes
 */

import axios from "axios";

const BASE_URL = process.env.ETIMS_BASE_URL || "https://etims-api-sbx.kra.go.ke";

interface EtimsAuthToken {
  token: string;
  expiresAt: number; // epoch ms
}

let cachedToken: EtimsAuthToken | null = null;

export async function authenticate(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 5000) {
    return cachedToken.token;
  }

  const { data } = await axios.post(`${BASE_URL}/v1/token/generate`, {
    username: process.env.ETIMS_USERNAME,
    password: process.env.ETIMS_PASSWORD,
  });

  // Adjust field names (data.access_token vs data.token, etc.) to match
  // whatever KRA's sandbox actually returns — verify against the Postman
  // collection before trusting this in production.
  cachedToken = {
    token: data.access_token ?? data.token,
    expiresAt: Date.now() + (data.expires_in ? data.expires_in * 1000 : 55 * 60 * 1000),
  };
  return cachedToken.token;
}

/**
 * One-time device registration for this VSCU instance. Run manually once
 * per business/branch, store the returned unitId + cmcKey in your .env
 * (or Business table), then never call this again for that device.
 */
export async function initializeDevice() {
  const token = await authenticate();
  const { data } = await axios.post(
    `${BASE_URL}/v1/device/initialize`,
    {
      pin: process.env.ETIMS_BUSINESS_PIN,
      branchId: "00",
    },
    { headers: { Authorization: `Bearer ${token}` } }
  );
  // Expect something like { unitId, cmcKey }. Persist both — cmcKey is
  // required on every subsequent request header per KRA's spec.
  return data;
}

export interface InvoiceLineInput {
  name: string;
  qty: number;
  unitPrice: number;
  taxCategory: "A" | "B" | "C" | "D" | "E";
  taxAmount: number;
  lineTotal: number;
  unspscCode?: string;
}

export interface SubmitInvoiceInput {
  invoiceNumber: number; // sequential integer, NOT a string prefix like "INV001"
  customerPin?: string;
  lines: InvoiceLineInput[];
  subtotal: number;
  taxTotal: number;
  total: number;
}

export interface SubmitInvoiceResult {
  success: boolean;
  kraInvoiceNo?: string;
  qrCodeUrl?: string;
  signature?: string;
  rawResponse: unknown;
  error?: string;
}

/**
 * Builds the 15 mandatory tax fields (taxblAmtA..E, taxRtA..E, taxAmtA..E)
 * that KRA requires on every invoice payload, even for categories with
 * zero amounts.
 */
function buildTaxFields(lines: InvoiceLineInput[]) {
  const categories = ["A", "B", "C", "D", "E"] as const;
  const fields: Record<string, number> = {};

  for (const cat of categories) {
    const catLines = lines.filter((l) => l.taxCategory === cat);
    fields[`taxblAmt${cat}`] = catLines.reduce((s, l) => s + l.lineTotal - l.taxAmount, 0);
    fields[`taxAmt${cat}`] = catLines.reduce((s, l) => s + l.taxAmount, 0);
    // Rates are illustrative — confirm current rates per category with KRA.
    fields[`taxRt${cat}`] = cat === "B" ? 16 : cat === "E" ? 8 : 0;
  }
  return fields;
}

export async function submitInvoice(input: SubmitInvoiceInput): Promise<SubmitInvoiceResult> {
  try {
    const token = await authenticate();
    const taxFields = buildTaxFields(input.lines);

    const payload = {
      invcNo: input.invoiceNumber,
      custPin: input.customerPin ?? null,
      totItemCnt: input.lines.length,
      totTaxblAmt: input.subtotal,
      totTaxAmt: input.taxTotal,
      totAmt: input.total,
      ...taxFields,
      itemList: input.lines.map((l, idx) => ({
        itemSeq: idx + 1,
        itemNm: l.name,
        qty: l.qty,
        prc: l.unitPrice,
        splyAmt: l.lineTotal,
        taxTyCd: l.taxCategory,
        taxAmt: l.taxAmount,
        unspscCd: l.unspscCode ?? "",
      })),
    };

    const { data } = await axios.post(`${BASE_URL}/v1/invoice/submit`, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        "cmc-key": process.env.ETIMS_CMC_KEY,
        "unit-id": process.env.ETIMS_UNIT_ID,
      },
    });

    return {
      success: true,
      kraInvoiceNo: data.invoiceNo ?? data.kraInvoiceNo,
      qrCodeUrl: data.qrCode ?? data.qrCodeUrl,
      signature: data.signature,
      rawResponse: data,
    };
  } catch (err: any) {
    return {
      success: false,
      rawResponse: err?.response?.data ?? null,
      error: err?.message ?? "Unknown eTIMS submission error",
    };
  }
}

/** Daily job: pull UNSPSC classification codes needed for product registration. */
export async function fetchUnspscCodes() {
  const token = await authenticate();
  const { data } = await axios.get(`${BASE_URL}/v1/codes/unspsc`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return data;
}
