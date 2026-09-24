import { decodeProtectedHeader, importX509, jwtVerify } from "jose";

const CERTS_URL =
  "https://www.googleapis.com/robot/v1/metadata/x509/[email protected]";

let certCache = { certs: null, exp: 0 };

async function getCerts() {
  const now = Date.now();
  if (certCache.certs && certCache.exp > now) return certCache.certs;

  const res = await fetch(CERTS_URL);
  const certs = await res.json();
  const cacheControl = res.headers.get("cache-control") || "";
  const m = cacheControl.match(/max-age=(\d+)/);
  const maxAgeMs = m ? parseInt(m[1], 10) * 1000 : 60 * 60 * 1000;

  certCache = { certs, exp: now + maxAgeMs };
  return certs;
}

/** Verifies a Firebase Auth ID token and returns { uid, claims }. Throws on any failure. */
export async function verifyFirebaseIdToken(idToken, projectId) {
  const { kid } = decodeProtectedHeader(idToken);
  if (!kid) throw new Error("Token has no kid");

  const certs = await getCerts();
  const pem = certs[kid];
  if (!pem) throw new Error("Unknown signing key (kid not found)");

  const key = await importX509(pem, "RS256");
  const { payload } = await jwtVerify(idToken, key, {
    algorithms: ["RS256"],
    issuer: `https://securetoken.google.com/${projectId}`,
    audience: projectId,
  });

  if (!payload.sub) throw new Error("Token has no subject (uid)");
  return { uid: payload.sub, claims: payload };
}
