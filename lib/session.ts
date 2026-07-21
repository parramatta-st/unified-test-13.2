/**
 * Signed session tokens for the portal.
 *
 * WHY THIS EXISTS
 * ---------------
 * Older versions authenticated requests by checking a plain `st_auth=1`
 * cookie plus plain `st_tutor` / `st_campus` cookies. Cookies are fully
 * client-controlled, so anyone could hand-craft `st_auth=1; st_tutor=<admin>`
 * and gain tutor or even admin access without the password.
 *
 * This module issues an HMAC-SHA256 signed token instead. The token embeds
 * the tutor name, campus key, and an expiry. It cannot be forged without the
 * server secret, and API routes / middleware read the tutor + campus FROM the
 * verified token (never from loose cookies).
 *
 * It intentionally uses only the Web Crypto API (`crypto.subtle`) so the same
 * code runs in BOTH the Edge middleware runtime and Node.js API routes.
 *
 * SECRET
 * ------
 * Uses SESSION_SECRET when set, otherwise derives from TUTOR_PASSWORD, so
 * existing deployments need no new environment variables. Changing either
 * value simply signs everyone out.
 */

export type SessionPayload = {
  tutor: string;
  campus: string;
  exp: number; // ms since epoch
};

export const SESSION_COOKIE = 'st_sess';
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

const VERSION = 'v1';
const encoder = new TextEncoder();

function secretMaterial(): string {
  const explicit = String(process.env.SESSION_SECRET || '').trim();
  if (explicit) return `st-portal-session:${explicit}`;
  const password = String(process.env.TUTOR_PASSWORD || '').trim();
  if (password) return `st-portal-session:${password}`;
  return '';
}

export function sessionConfigured() {
  return !!secretMaterial();
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64UrlToBytes(value: string): Uint8Array | null {
  try {
    const padded =
      value.replace(/-/g, '+').replace(/_/g, '/') +
      '='.repeat((4 - (value.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

async function importHmacKey(usages: KeyUsage[]) {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secretMaterial()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    usages,
  );
}

export async function createSessionToken(
  input: { tutor: string; campus: string },
  maxAgeSeconds = SESSION_MAX_AGE_SECONDS,
): Promise<string> {
  if (!sessionConfigured()) {
    throw new Error(
      'Login sessions are not configured. Set TUTOR_PASSWORD (or SESSION_SECRET) on the server.',
    );
  }
  const payload: SessionPayload = {
    tutor: String(input.tutor || '').trim(),
    campus: String(input.campus || '').trim(),
    exp: Date.now() + maxAgeSeconds * 1000,
  };
  const encodedPayload = bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
  const key = await importHmacKey(['sign']);
  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, encoder.encode(`${VERSION}.${encodedPayload}`)),
  );
  return `${VERSION}.${encodedPayload}.${bytesToBase64Url(signature)}`;
}

/**
 * Verifies a token and returns its payload, or null when the token is
 * missing, tampered with, malformed, or expired. `crypto.subtle.verify`
 * performs a constant-time signature comparison.
 */
export async function verifySessionToken(
  token: string | undefined | null,
): Promise<SessionPayload | null> {
  if (!token || !sessionConfigured()) return null;
  const parts = String(token).split('.');
  if (parts.length !== 3 || parts[0] !== VERSION) return null;

  const signatureBytes = base64UrlToBytes(parts[2]);
  if (!signatureBytes) return null;

  let valid = false;
  try {
    const key = await importHmacKey(['verify']);
    valid = await crypto.subtle.verify(
      'HMAC',
      key,
      signatureBytes as unknown as BufferSource,
      encoder.encode(`${parts[0]}.${parts[1]}`),
    );
  } catch {
    return null;
  }
  if (!valid) return null;

  const payloadBytes = base64UrlToBytes(parts[1]);
  if (!payloadBytes) return null;

  let parsed: any = null;
  try {
    parsed = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return null;
  }

  const tutor = String(parsed?.tutor || '').trim();
  const campus = String(parsed?.campus || '').trim();
  const exp = Number(parsed?.exp || 0);
  if (!tutor || !Number.isFinite(exp) || exp <= Date.now()) return null;

  return { tutor, campus, exp };
}
