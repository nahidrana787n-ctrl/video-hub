/**
 * DeshiPay — Instant Account Verification, ported to a Cloudflare Worker
 * (card-free replacement for Firebase Cloud Functions 2nd gen / Blaze plan).
 *
 * Firestore itself stays on Firebase (free Spark plan). This Worker only
 * replaces the *compute* layer, talking to Firestore over its REST API
 * with a service-account access token.
 *
 * Routes:
 *   POST /createDeshiPayPayment   (needs Authorization: Bearer <Firebase ID token>)
 *   POST /confirmDeshiPayPayment  (needs Authorization: Bearer <Firebase ID token>)
 *   POST /deshipayWebhook         (public — called by the DeshiPay gateway)
 */

import { Firestore, writeSet, writeUpdate } from "./firestore.js";
import { getAccessToken } from "./googleAuth.js";
import { verifyFirebaseIdToken } from "./verifyIdToken.js";

const DEFAULT_BASE_URL = "https://paydeshipay.themedokan.com";
const DEFAULT_SITE_URL = "https://incomeplatformcom.netlify.app";

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

function corsPreflight() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

function validTxId(id) {
  return typeof id === "string" && /^[A-Za-z0-9_-]{4,80}$/.test(id);
}

function randomHex(n) {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function asObject(v) {
  if (!v) return null;
  if (typeof v === "object") return v;
  try {
    return JSON.parse(v);
  } catch (e) {
    return null;
  }
}

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/* ------------------------------------------------------------------ */
/* Config + gateway call                                               */
/* ------------------------------------------------------------------ */

async function getConfig(fs, env) {
  const [pc, gs] = await Promise.all([fs.getDoc("private_config/deshipay"), fs.getDoc("settings/general")]);
  const p = pc.data || {};
  const g = gs.data || {};
  const fee = Number(g.verifyFeeAmount);
  return {
    apiKey: String(p.apiKey || "").trim(),
    baseUrl: String(p.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    siteUrl: String(p.siteUrl || DEFAULT_SITE_URL).replace(/\/+$/, ""),
    webhookUrl: String(p.webhookUrl || "").trim() || `${env.WORKER_BASE_URL}/deshipayWebhook`,
    fee: Number.isFinite(fee) && fee > 0 ? fee : 15,
    autoEnabled: g.autoPaymentEnabled === true,
    referReward: Number(g.referReward) || 0,
  };
}

async function gatewayPost(cfg, path, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(cfg.baseUrl + path, {
      method: "POST",
      headers: { "API-KEY": cfg.apiKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new Error("Gateway returned invalid response");
    }
  } finally {
    clearTimeout(timer);
  }
}

/* Pull the payment URL out of whatever shape the gateway answers with. */
function pickPaymentUrl(r) {
  if (!r || typeof r !== "object") return null;
  const d = r.data && typeof r.data === "object" ? r.data : {};
  const candidates = [
    r.payment_url, r.payment_link, r.paymentUrl, r.paymentLink, r.url, r.link,
    d.payment_url, d.payment_link, d.paymentUrl, d.paymentLink, d.url, d.link,
  ];
  return candidates.find((x) => typeof x === "string" && /^https?:\/\//i.test(x)) || null;
}

/* ------------------------------------------------------------------ */
/* Core: verify with gateway + finalize (idempotent)                   */
/* ------------------------------------------------------------------ */

async function processTransaction(fs, cfg, txId, callerUid) {
  let v;
  try {
    v = await gatewayPost(cfg, "/api/payment/verify", { transaction_id: txId });
  } catch (e) {
    throw new ApiError(503, "পেমেন্ট গেটওয়ের সাথে সংযোগ করা যায়নি, একটু পরে আবার চেষ্টা করুন।");
  }

  const gw = String(v && v.status).toUpperCase();
  if (gw === "PENDING") return { state: "pending" };
  if (gw !== "COMPLETED") return { state: "failed", message: (v && v.message) || "পেমেন্ট সম্পন্ন হয়নি।" };

  const meta = asObject(v.metadata || v.meta_data) || {};
  let intent = null;
  let intentId = null;

  if (typeof meta.intentId === "string" && /^[a-f0-9]{20}$/.test(meta.intentId)) {
    const s = await fs.getDoc(`payment_intents/${meta.intentId}`);
    if (s.exists) {
      intent = s.data;
      intentId = meta.intentId;
    }
  }
  if (!intent && v.cus_email) {
    const rows = await fs.runQuery("payment_intents", {
      where: [["cusEmail", "EQUAL", String(v.cus_email).toLowerCase()]],
      limit: 1,
    });
    if (rows.length) {
      intent = rows[0].data;
      intentId = rows[0].id;
    }
  }
  if (!intent) return { state: "failed", message: "এই পেমেন্টটি কোনো ভেরিফিকেশন রিকোয়েস্টের সাথে মেলেনি।" };
  if (callerUid && intent.uid !== callerUid) return { state: "failed", message: "এই পেমেন্টটি আপনার অ্যাকাউন্টের নয়।" };

  const paid = Number(v.amount);
  if (!Number.isFinite(paid) || paid + 0.0001 < Number(intent.amount)) {
    return { state: "failed", message: "পেমেন্টের পরিমাণ নির্ধারিত ফি-এর চেয়ে কম।" };
  }

  const uid = intent.uid;
  const method = String(v.payment_method || "deshipay");
  const root = fs.root;

  const txnId = await fs.beginTransaction();
  try {
    const [claim, userDoc, pending, referrals] = await Promise.all([
      fs.getDoc(`deshipay_transactions/${txId}`, txnId),
      fs.getDoc(`users/${uid}`, txnId),
      fs.runQuery(
        "verificationPayments",
        { where: [["userId", "EQUAL", uid], ["status", "EQUAL", "pending"]] },
        txnId
      ),
      fs.runQuery(
        "referrals",
        { where: [["referredUid", "EQUAL", uid], ["status", "EQUAL", "inactive"]], limit: 1 },
        txnId
      ),
    ]);

    if (claim.exists) {
      await fs.rollback(txnId);
      return {
        state: claim.data.uid === uid ? "verified" : "failed",
        message: "এই ট্রানজেকশন আগেই ব্যবহৃত হয়েছে।",
      };
    }
    if (!userDoc.exists) {
      await fs.rollback(txnId);
      return { state: "failed", message: "ইউজার পাওয়া যায়নি।" };
    }

    const u = userDoc.data;
    const alreadyVerified = u.accountStatus === "verified";
    const writes = [];

    writes.push(
      writeSet(
        `deshipay_transactions/${txId}`,
        root,
        {
          txId,
          uid,
          intentId,
          amount: paid,
          method,
          note: alreadyVerified ? "user was already verified — payment may need refund" : "ok",
        },
        { serverTimestampFields: ["createdAt"] }
      )
    );

    writes.push(
      writeUpdate(
        `payment_intents/${intentId}`,
        root,
        { status: "paid", transactionId: txId, gatewayMethod: method, gatewayAmount: paid },
        { serverTimestampFields: ["paidAt"] }
      )
    );

    if (!alreadyVerified) {
      const payId = randomHex(14);
      writes.push(
        writeSet(
          `verificationPayments/${payId}`,
          root,
          {
            userId: uid,
            userName: u.fullName || "User",
            method: `DeshiPay (${method})`,
            senderNumber: "AUTO",
            trxId: txId,
            amount: paid,
            status: "approved",
            auto: true,
          },
          { serverTimestampFields: ["createdAt", "approvedAt"] }
        )
      );

      for (const d of pending) {
        writes.push(writeUpdate(`verificationPayments/${d.id}`, root, { status: "superseded", supersededBy: txId }));
      }

      writes.push(
        writeUpdate(
          `users/${uid}`,
          root,
          { accountStatus: "verified", verifiedVia: "deshipay" },
          { serverTimestampFields: ["verifiedAt"] }
        )
      );

      if (referrals.length) {
        const ref = referrals[0];
        const referrer = ref.data.referrerUid || u.referredBy;
        const reward = cfg.referReward;
        writes.push(writeUpdate(`referrals/${ref.id}`, root, { status: "active", rewardAmount: reward, rewardPaid: reward > 0 }));
        if (referrer && reward > 0) {
          writes.push(writeUpdate(`users/${referrer}`, root, {}, { incrementFields: { balance: reward } }));
        }
      }
    }

    await fs.commit(writes, txnId);
    return { state: "verified" };
  } catch (e) {
    await fs.rollback(txnId);
    throw e;
  }
}

/* ------------------------------------------------------------------ */
/* Auth                                                                 */
/* ------------------------------------------------------------------ */

async function requireAuth(request, env) {
  const authz = request.headers.get("Authorization") || "";
  const m = authz.match(/^Bearer (.+)$/);
  if (!m) throw new ApiError(401, "লগইন করুন।");
  try {
    const { uid } = await verifyFirebaseIdToken(m[1], env.FIREBASE_PROJECT_ID);
    return uid;
  } catch (e) {
    throw new ApiError(401, "লগইন সেশন সঠিক নয়, আবার লগইন করুন।");
  }
}

/* ------------------------------------------------------------------ */
/* Route handlers                                                       */
/* ------------------------------------------------------------------ */

async function handleCreate(request, env, fs) {
  const uid = await requireAuth(request, env);
  const cfg = await getConfig(fs, env);
  if (!cfg.apiKey) throw new ApiError(412, "পেমেন্ট গেটওয়ে এখনো সেটআপ করা হয়নি। এডমিনের সাথে যোগাযোগ করুন।");
  if (!cfg.autoEnabled) throw new ApiError(412, "ইনস্ট্যান্ট পেমেন্ট এখন বন্ধ আছে। ম্যানুয়াল অপশন ব্যবহার করুন।");

  const userSnap = await fs.getDoc(`users/${uid}`);
  if (!userSnap.exists) throw new ApiError(404, "ইউজার পাওয়া যায়নি।");
  const user = userSnap.data;
  if (user.accountStatus === "verified") throw new ApiError(409, "আপনার অ্যাকাউন্ট ইতিমধ্যে ভেরিফাই করা আছে।");

  const intentId = randomHex(10); // 20 hex chars
  const cusEmail = `${intentId}@pay.incomeplatform.app`;
  const cusName = String(user.fullName || "User").trim().slice(0, 40) || "User";
  const amountStr = String(Number(cfg.fee));

  await fs.commit([
    writeSet(
      `payment_intents/${intentId}`,
      fs.root,
      { uid, purpose: "account_verify", amount: Number(cfg.fee), cusEmail, status: "created" },
      { serverTimestampFields: ["createdAt"] }
    ),
  ]);

  const metadata = { intentId, uid, purpose: "account_verify" };

  let res;
  try {
    res = await gatewayPost(cfg, "/api/payment/create", {
      cus_name: cusName,
      cus_email: cusEmail,
      amount: amountStr,
      success_url: `${cfg.siteUrl}/?dp=success`,
      cancel_url: `${cfg.siteUrl}/?dp=cancel`,
      webhook_url: cfg.webhookUrl,
      metadata,
      meta_data: metadata,
    });
  } catch (e) {
    await fs.commit([writeUpdate(`payment_intents/${intentId}`, fs.root, { status: "failed", error: String(e).slice(0, 200) })]);
    throw new ApiError(503, "পেমেন্ট গেটওয়ের সাথে সংযোগ করা যায়নি, একটু পরে আবার চেষ্টা করুন।");
  }

  // Accept any success shape: a real payment URL is what matters, unless the gateway says it failed.
  const payUrl = pickPaymentUrl(res);
  const st = String(res && res.status).toLowerCase();
  const explicitFail = ["false", "error", "failed", "fail", "0"].includes(st);

  if (!payUrl || explicitFail) {
    let raw = "";
    try {
      raw = JSON.stringify(res).slice(0, 300);
    } catch (e) {}
    console.error("DeshiPay create failed. Gateway said:", raw);
    await fs.commit([
      writeUpdate(`payment_intents/${intentId}`, fs.root, {
        status: "failed",
        error: String((res && res.message) || "no payment_url").slice(0, 200),
      }),
    ]);
    // TEMP DEBUG: gateway reply is appended so we can see why it was rejected. Remove " [gw: ...]" once fixed.
    throw new ApiError(500, String((res && res.message) || "পেমেন্ট লিংক তৈরি করা যায়নি।") + " [gw: " + raw.slice(0, 220) + "]");
  }

  return json({ paymentUrl: payUrl });
}

async function handleConfirm(request, env, fs) {
  const uid = await requireAuth(request, env);
  const body = await request.json().catch(() => ({}));
  const txId = body.transactionId;
  if (!validTxId(txId)) throw new ApiError(400, "ট্রানজেকশন আইডি সঠিক নয়।");

  const cfg = await getConfig(fs, env);
  if (!cfg.apiKey) throw new ApiError(412, "পেমেন্ট গেটওয়ে এখনো সেটআপ করা হয়নি। এডমিনের সাথে যোগাযোগ করুন।");

  const out = await processTransaction(fs, cfg, txId, uid);
  return json(out);
}

async function handleWebhook(request, env, fs) {
  const body = await request.json().catch(() => ({}));
  const url = new URL(request.url);
  const txId =
    body.transaction_id ||
    body.transactionId ||
    body.trxID ||
    url.searchParams.get("transaction_id") ||
    url.searchParams.get("transactionId");

  if (!validTxId(txId)) return json({ ok: true, ignored: true });

  const cfg = await getConfig(fs, env);
  if (!cfg.apiKey) return json({ ok: false }, 500);

  const out = await processTransaction(fs, cfg, txId, null);
  return json({ ok: true, state: out.state });
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return corsPreflight();

    const url = new URL(request.url);
    const fs = new Firestore(env.FIREBASE_PROJECT_ID, () => getAccessToken(env));

    try {
      if (url.pathname === "/createDeshiPayPayment" && request.method === "POST") {
        return await handleCreate(request, env, fs);
      }
      if (url.pathname === "/confirmDeshiPayPayment" && request.method === "POST") {
        return await handleConfirm(request, env, fs);
      }
      if (url.pathname === "/deshipayWebhook") {
        return await handleWebhook(request, env, fs);
      }
      return json({ error: "Not found" }, 404);
    } catch (e) {
      console.error(e);
      if (e instanceof ApiError) return json({ error: e.message }, e.status);
      return json({ error: e.message || "Internal error" }, 500);
    }
  },
};
