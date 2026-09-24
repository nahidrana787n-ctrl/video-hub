// Minimal Firestore REST client for Cloudflare Workers.
// Uses the Firestore v1 REST API directly (no firebase-admin, which needs Node APIs).

const HOST = "https://firestore.googleapis.com/v1";

export function encodeValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encodeValue) } };
  if (typeof v === "object") {
    const fields = {};
    for (const [k, val] of Object.entries(v)) fields[k] = encodeValue(val);
    return { mapValue: { fields } };
  }
  throw new Error("Cannot encode Firestore value: " + String(v));
}

export function encodeFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) fields[k] = encodeValue(v);
  return fields;
}

export function decodeValue(v) {
  if (!v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return parseInt(v.integerValue, 10);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("nullValue" in v) return null;
  if ("mapValue" in v) return decodeFields(v.mapValue.fields || {});
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(decodeValue);
  return null;
}

export function decodeFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) out[k] = decodeValue(v);
  return out;
}

export function docIdFromName(name) {
  return name.split("/").pop();
}

export class Firestore {
  constructor(projectId, getToken) {
    this.projectId = projectId;
    this.getToken = getToken;
    this.base = `${HOST}/projects/${projectId}/databases/(default)/documents`;
    this.root = `projects/${projectId}/databases/(default)/documents`;
  }

  async req(path, opts = {}) {
    const token = await this.getToken();
    const res = await fetch(this.base + path, {
      ...opts,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(opts.headers || {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error((data && data.error && data.error.message) || `Firestore error ${res.status}`);
      err.status = res.status;
      err.notFound = res.status === 404;
      throw err;
    }
    return data;
  }

  /** Reads one document. Pass transactionId to read it as part of a transaction. */
  async getDoc(path, transactionId) {
    let url = "/" + path;
    if (transactionId) url += `?transaction=${encodeURIComponent(transactionId)}`;
    try {
      const doc = await this.req(url);
      return { exists: true, data: decodeFields(doc.fields), name: doc.name };
    } catch (e) {
      if (e.notFound) return { exists: false, data: null, name: null };
      throw e;
    }
  }

  async beginTransaction() {
    const res = await this.req(":beginTransaction", { method: "POST", body: "{}" });
    return res.transaction;
  }

  async rollback(transactionId) {
    try {
      await this.req(":rollback", { method: "POST", body: JSON.stringify({ transaction: transactionId }) });
    } catch (e) {
      // best effort; the transaction will simply expire server-side if this fails
    }
  }

  async commit(writes, transactionId) {
    const body = { writes };
    if (transactionId) body.transaction = transactionId;
    return this.req(":commit", { method: "POST", body: JSON.stringify(body) });
  }

  /**
   * Simple equality-only query (mirrors what index.js needed).
   * where: array of [fieldPath, "EQUAL", value]
   */
  async runQuery(collectionId, { where, limit } = {}, transactionId) {
    const structuredQuery = { from: [{ collectionId }] };
    if (limit) structuredQuery.limit = limit;
    if (where && where.length) {
      const filters = where.map(([field, op, value]) => ({
        fieldFilter: { field: { fieldPath: field }, op, value: encodeValue(value) },
      }));
      structuredQuery.where = filters.length === 1 ? filters[0] : { compositeFilter: { op: "AND", filters } };
    }
    const body = { structuredQuery };
    if (transactionId) body.transaction = transactionId;
    const res = await this.req(":runQuery", { method: "POST", body: JSON.stringify(body) });
    return (res || [])
      .filter((r) => r.document)
      .map((r) => ({ name: r.document.name, id: docIdFromName(r.document.name), data: decodeFields(r.document.fields) }));
  }
}

/** Build a Write that creates/overwrites a document (like Admin SDK .set()). */
export function writeSet(path, root, obj, { serverTimestampFields = [] } = {}) {
  const write = { update: { name: `${root}/${path}`, fields: encodeFields(obj) } };
  if (serverTimestampFields.length) {
    write.updateTransforms = serverTimestampFields.map((f) => ({ fieldPath: f, setToServerValue: "REQUEST_TIME" }));
  }
  return write;
}

/** Build a Write that patches only the given fields (like Admin SDK .update()). */
export function writeUpdate(path, root, obj = {}, { serverTimestampFields = [], incrementFields = {} } = {}) {
  const write = {
    update: { name: `${root}/${path}`, fields: encodeFields(obj) },
    updateMask: { fieldPaths: Object.keys(obj) },
  };
  const transforms = [];
  for (const f of serverTimestampFields) transforms.push({ fieldPath: f, setToServerValue: "REQUEST_TIME" });
  for (const [f, val] of Object.entries(incrementFields)) transforms.push({ fieldPath: f, increment: encodeValue(val) });
  if (transforms.length) write.updateTransforms = transforms;
  return write;
}
