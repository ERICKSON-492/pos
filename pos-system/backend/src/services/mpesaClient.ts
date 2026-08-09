/**
 * Safaricom M-Pesa Daraja API client — STK Push (Lipa Na M-Pesa Online).
 * Sandbox docs: https://developer.safaricom.co.ke
 */
import axios from "axios";

const isSandbox = (process.env.MPESA_ENV ?? "sandbox") === "sandbox";
const BASE_URL = isSandbox
  ? "https://sandbox.safaricom.co.ke"
  : "https://api.safaricom.co.ke";

let cachedToken: { token: string; expiresAt: number } | null = null;

export async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 5000) {
    return cachedToken.token;
  }
  const key = process.env.MPESA_CONSUMER_KEY;
  const secret = process.env.MPESA_CONSUMER_SECRET;
  const auth = Buffer.from(`${key}:${secret}`).toString("base64");

  const { data } = await axios.get(
    `${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,
    { headers: { Authorization: `Basic ${auth}` } }
  );

  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + Number(data.expires_in) * 1000,
  };
  return cachedToken.token;
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    d.getFullYear().toString() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

export interface StkPushInput {
  phoneNumber: string; // format 2547XXXXXXXX
  amount: number;
  accountReference: string; // e.g. sale ID
  transactionDesc: string;
}

export async function initiateStkPush(input: StkPushInput) {
  const token = await getAccessToken();
  const shortcode = process.env.MPESA_SHORTCODE!;
  const passkey = process.env.MPESA_PASSKEY!;
  const ts = timestamp();
  const password = Buffer.from(`${shortcode}${passkey}${ts}`).toString("base64");

  const { data } = await axios.post(
    `${BASE_URL}/mpesa/stkpush/v1/processrequest`,
    {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: ts,
      TransactionType: "CustomerPayBillOnline",
      Amount: Math.ceil(input.amount),
      PartyA: input.phoneNumber,
      PartyB: shortcode,
      PhoneNumber: input.phoneNumber,
      CallBackURL: process.env.MPESA_CALLBACK_URL,
      AccountReference: input.accountReference,
      TransactionDesc: input.transactionDesc,
    },
    { headers: { Authorization: `Bearer ${token}` } }
  );

  // Contains MerchantRequestID, CheckoutRequestID — store CheckoutRequestID
  // against the Payment row so the callback can be matched back to it.
  return data;
}

/**
 * Shape of the async callback Safaricom POSTs to MPESA_CALLBACK_URL once
 * the customer completes (or cancels/fails) the STK push on their phone.
 */
export interface StkCallbackPayload {
  Body: {
    stkCallback: {
      MerchantRequestID: string;
      CheckoutRequestID: string;
      ResultCode: number;
      ResultDesc: string;
      CallbackMetadata?: {
        Item: { Name: string; Value: string | number }[];
      };
    };
  };
}

export function parseStkCallback(payload: StkCallbackPayload) {
  const cb = payload.Body.stkCallback;
  const success = cb.ResultCode === 0;
  let mpesaReceiptNumber: string | undefined;
  let amount: number | undefined;

  if (success && cb.CallbackMetadata) {
    for (const item of cb.CallbackMetadata.Item) {
      if (item.Name === "MpesaReceiptNumber") mpesaReceiptNumber = String(item.Value);
      if (item.Name === "Amount") amount = Number(item.Value);
    }
  }

  return {
    checkoutRequestId: cb.CheckoutRequestID,
    success,
    resultDesc: cb.ResultDesc,
    mpesaReceiptNumber,
    amount,
  };
}
