/**
 * DeshiPay — Instant Account Verification (Cloud Functions 2nd gen, Node 20)
 * Project : bot-telegram-refar   |   Region : asia-southeast1
 *
 * Functions
 *   1. createDeshiPayPayment   (callable)  — ইউজারের জন্য পেমেন্ট লিংক তৈরি করে
 *   2. confirmDeshiPayPayment  (callable)  — পেমেন্ট শেষে ফিরে এলে সার্ভার-সাইডে যাচাই করে অ্যাকাউন্ট ভেরিফাই করে
 *   3. deshipayWebhook         (HTTP)      — ইউজার ব্রাউজার বন্ধ করে দিলেও গেটওয়ে থেকে অটো ভেরিফাই
 *
 * নিরাপত্তা: API Key শুধু Firestore `private_config/deshipay` এ থাকে (এডমিন ছাড়া কেউ পড়তে পারে না)।
 * পেমেন্ট সবসময় DeshiPay-র verify API দিয়ে যাচাই হয়; ক্লায়েন্ট বা webhook-এর কথা বিশ্বাস করা হয় না।
 * একটি Transaction ID একবারের বেশি ব্যবহার করা যায় না (deshipay_transactions কালেকশন)।
 */

const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const crypto = require("crypto");

admin.initializeApp();
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const REGION = "asia-southeast1";
setGlobalOptions({ region: REGION, maxInstances: 10 });

const DEFAULT_BASE_URL = "https://paydeshipay.themedokan.com";
const DEFAULT_SITE_URL = "https://incomeplatformcom.netlify.app";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

async function getConfig() {
  const [pcSnap, gsSnap] = await Promise.all([
    db.doc("private_config/deshipay").get(),
    db.doc("settings/general").get(),
  ]);
  const p = pcSnap.exists ? pcSnap.data() : {};
  const g = gsSnap.exists ? gsSnap.data() : {};

  const fee = Number(g.verifyFeeAmount);
  return {
    apiKey: String(p.apiKey || "").trim(),
    baseUrl: String(p.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    siteUrl: String(p.siteUrl || DEFAULT_SITE_URL).replace(/\/+$/, ""),
    webhookUrl:
      String(p.webhookUrl || "").trim() ||
      `https://${REGION}-${process.env.GCLOUD_PROJECT}.cloudfunctions.net/deshipayWebhook`,
    fee: Number.isFinite(fee) && fee > 0 ? fee : 15,
    autoEnabled: g.autoPaymentEnabled === true,
    referReward: Number(g.referReward) || 0,
  };
}

function requireApiKey(cfg) {
  if (!cfg.apiKey) {
    throw new HttpsError(
      "failed-precondition",
      "পেমেন্ট গেটওয়ে এখনো সেটআপ করা হয়নি। এডমিনের সাথে যোগাযোগ করুন।"
    );
  }
}

async function gatewayPost(cfg, path, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(cfg.baseUrl + path, {
      method: "POST",
      headers: {
        "API-KEY": cfg.apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch (e) {
      logger.error("Gateway returned non-JSON", { path, http: res.status, text: text.slice(0, 300) });
      throw new Error("Gateway returned invalid response");
    }
  } finally {
    clearTimeout(timer);
  }
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

function validTxId(id) {
  return typeof id === "string" && /^[A-Za-z0-9_-]{4,80}$/.test(id);
}

/* ------------------------------------------------------------------ */
/* Core: verify with gateway + finalize (idempotent)                   */
/* ------------------------------------------------------------------ */

async function processTransaction({ txId, callerUid, cfg }) {
  // 1) গেটওয়ে থেকে সরাসরি যাচাই
  let v;
  try {
    v = await gatewayPost(cfg, "/api/payment/verify", { transaction_id: txId });
  } catch (e) {
    logger.error("verify API failed", { txId, err: String(e) });
    throw new HttpsError("unavailable", "পেমেন্ট গেটওয়ের সাথে সংযোগ করা যায়নি, একটু পরে আবার চেষ্টা করুন।");
  }

  const gw = String(v && v.status).toUpperCase();
  if (gw === "PENDING") return { state: "pending" };
  if (gw !== "COMPLETED") {
    return { state: "failed", message: (v && v.message) || "পেমেন্ট সম্পন্ন হয়নি।" };
  }

  // 2) কোন intent-এর পেমেন্ট — metadata অথবা cus_email দিয়ে মিলানো
  const meta = asObject(v.metadata || v.meta_data) || {};
  let intentSnap = null;
  if (typeof meta.intentId === "string" && /^[a-f0-9]{20}$/.test(meta.intentId)) {
    const s = await db.doc(`payment_intents/${meta.intentId}`).get();
    if (s.exists) intentSnap = s;
  }
  if (!intentSnap && v.cus_email) {
    const q = await db
      .collection("payment_intents")
      .where("cusEmail", "==", String(v.cus_email).toLowerCase())
      .limit(1)
      .get();
    if (!q.empty) intentSnap = q.docs[0];
  }
  if (!intentSnap) {
    logger.warn("Completed payment did not match any intent", { txId });
    return { state: "failed", message: "এই পেমেন্টটি কোনো ভেরিফিকেশন রিকোয়েস্টের সাথে মেলেনি।" };
  }

  const intent = intentSnap.data();
  if (callerUid && intent.uid !== callerUid) {
    return { state: "failed", message: "এই পেমেন্টটি আপনার অ্যাকাউন্টের নয়।" };
  }

  // 3) অ্যামাউন্ট চেক
  const paid = Number(v.amount);
  if (!Number.isFinite(paid) || paid + 0.0001 < Number(intent.amount)) {
    logger.warn("Amount mismatch", { txId, paid, expected: intent.amount });
    return { state: "failed", message: "পেমেন্টের পরিমাণ নির্ধারিত ফি-এর চেয়ে কম।" };
  }

  // 4) একটি ট্রানজেকশনে — ক্লেইম + ভেরিফাই + রেফার রিওয়ার্ড (idempotent)
  const uid = intent.uid;
  const claimRef = db.doc(`deshipay_transactions/${txId}`);
  const userRef = db.doc(`users/${uid}`);
  const intentRef = intentSnap.ref;
  const method = String(v.payment_method || "deshipay");

  const result = await db.runTransaction(async (t) => {
    const [claim, userDoc, pendSnap, refSnap] = await Promise.all([
      t.get(claimRef),
      t.get(userRef),
      t.get(db.collection("verificationPayments").where("userId", "==", uid).where("status", "==", "pending")),
      t.get(db.collection("referrals").where("referredUid", "==", uid).where("status", "==", "inactive").limit(1)),
    ]);

    if (claim.exists) {
      // আগেই প্রসেস হয়েছে (webhook + ব্রাউজার একসাথে এলে এখানে আসে)
      return { state: claim.data().uid === uid ? "verified" : "failed", message: "এই ট্রানজেকশন আগেই ব্যবহৃত হয়েছে।" };
    }
    if (!userDoc.exists) return { state: "failed", message: "ইউজার পাওয়া যায়নি।" };

    const u = userDoc.data();
    const alreadyVerified = u.accountStatus === "verified";

    t.set(claimRef, {
      txId,
      uid,
      intentId: intentRef.id,
      amount: paid,
      method,
      note: alreadyVerified ? "user was already verified — payment may need refund" : "ok",
      createdAt: FieldValue.serverTimestamp(),
    });
    t.update(intentRef, {
      status: "paid",
      transactionId: txId,
      gatewayMethod: method,
      gatewayAmount: paid,
      paidAt: FieldValue.serverTimestamp(),
    });

    if (alreadyVerified) return { state: "verified" };

    // এডমিন প্যানেলের রেকর্ডের জন্য (Approved ট্যাবে দেখা যাবে)
    t.set(db.collection("verificationPayments").doc(), {
      userId: uid,
      userName: u.fullName || "User",
      method: `DeshiPay (${method})`,
      senderNumber: "AUTO",
      trxId: txId,
      amount: paid,
      status: "approved",
      auto: true,
      createdAt: FieldValue.serverTimestamp(),
      approvedAt: FieldValue.serverTimestamp(),
    });

    // আগে ম্যানুয়াল রিকোয়েস্ট পেন্ডিং থাকলে সেটি বন্ধ করে দেওয়া (ডাবল অ্যাপ্রুভ/রিওয়ার্ড এড়াতে)
    pendSnap.docs.forEach((d) => t.update(d.ref, { status: "superseded", supersededBy: txId }));

    t.update(userRef, {
      accountStatus: "verified",
      verifiedAt: FieldValue.serverTimestamp(),
      verifiedVia: "deshipay",
    });

    // রেফার রিওয়ার্ড — এডমিন Approve করলে যা হয় হুবহু তাই
    if (!refSnap.empty) {
      const refDoc = refSnap.docs[0];
      const referrer = refDoc.data().referrerUid || u.referredBy;
      const reward = cfg.referReward;
      t.update(refDoc.ref, { status: "active", rewardAmount: reward, rewardPaid: reward > 0 });
      if (referrer && reward > 0) {
        t.update(db.doc(`users/${referrer}`), { balance: FieldValue.increment(reward) });
      }
    }
    return { state: "verified" };
  });

  return result;
}

/* ------------------------------------------------------------------ */
/* 1) Create payment (callable)                                        */
/* ------------------------------------------------------------------ */

exports.createDeshiPayPayment = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "লগইন করুন।");
  const uid = request.auth.uid;

  const cfg = await getConfig();
  requireApiKey(cfg);
  if (!cfg.autoEnabled) {
    throw new HttpsError("failed-precondition", "ইনস্ট্যান্ট পেমেন্ট এখন বন্ধ আছে। ম্যানুয়াল অপশন ব্যবহার করুন।");
  }

  const userSnap = await db.doc(`users/${uid}`).get();
  if (!userSnap.exists) throw new HttpsError("not-found", "ইউজার পাওয়া যায়নি।");
  const user = userSnap.data();
  if (user.accountStatus === "verified") {
    throw new HttpsError("already-exists", "আপনার অ্যাকাউন্ট ইতিমধ্যে ভেরিফাই করা আছে।");
  }

  const intentId = crypto.randomBytes(10).toString("hex"); // 20 hex chars
  const cusEmail = `${intentId}@pay.incomeplatform.app`;
  const cusName = String(user.fullName || "User").trim().slice(0, 40) || "User";
  const amountStr = String(Number(cfg.fee));

  await db.doc(`payment_intents/${intentId}`).set({
    uid,
    purpose: "account_verify",
    amount: Number(cfg.fee),
    cusEmail,
    status: "created",
    createdAt: FieldValue.serverTimestamp(),
  });

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
      meta_data: metadata, // ডকুমেন্টেশনে দুই নামই আছে, দুটোই পাঠানো হচ্ছে
    });
  } catch (e) {
    await db.doc(`payment_intents/${intentId}`).update({ status: "failed", error: String(e).slice(0, 200) });
    throw new HttpsError("unavailable", "পেমেন্ট গেটওয়ের সাথে সংযোগ করা যায়নি, একটু পরে আবার চেষ্টা করুন।");
  }

  const ok = res && (res.status === true || String(res.status).toLowerCase() === "true");
  if (!ok || !res.payment_url) {
    await db.doc(`payment_intents/${intentId}`).update({
      status: "failed",
      error: String((res && res.message) || "no payment_url").slice(0, 200),
    });
    logger.error("create payment failed", { res });
    throw new HttpsError("internal", (res && res.message) || "পেমেন্ট লিংক তৈরি করা যায়নি।");
  }

  return { paymentUrl: res.payment_url };
});

/* ------------------------------------------------------------------ */
/* 2) Confirm payment (callable) — ইউজার পেমেন্ট শেষে ফিরে এলে        */
/* ------------------------------------------------------------------ */

exports.confirmDeshiPayPayment = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "লগইন করুন।");
  const txId = request.data && request.data.transactionId;
  if (!validTxId(txId)) throw new HttpsError("invalid-argument", "ট্রানজেকশন আইডি সঠিক নয়।");

  const cfg = await getConfig();
  requireApiKey(cfg);
  return processTransaction({ txId, callerUid: request.auth.uid, cfg });
});

/* ------------------------------------------------------------------ */
/* 3) Webhook (HTTP) — গেটওয়ে নিজে থেকে কল করে                        */
/* ------------------------------------------------------------------ */

exports.deshipayWebhook = onRequest(async (req, res) => {
  try {
    const body = asObject(req.body) || {};
    const txId =
      body.transaction_id || body.transactionId || body.trxID ||
      req.query.transaction_id || req.query.transactionId;

    if (!validTxId(txId)) {
      // পেলোডে ট্রানজেকশন আইডি না থাকলে কিছু করার নেই — ২০০ দিয়ে ফেরত
      logger.info("Webhook without transaction id", { keys: Object.keys(body) });
      res.status(200).json({ ok: true, ignored: true });
      return;
    }

    const cfg = await getConfig();
    requireApiKey(cfg);
    const out = await processTransaction({ txId, callerUid: null, cfg });
    res.status(200).json({ ok: true, state: out.state });
  } catch (e) {
    logger.error("Webhook error", { err: String(e) });
    res.status(500).json({ ok: false });
  }
});
