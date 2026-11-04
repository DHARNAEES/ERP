import { randomBytes, scryptSync, timingSafeEqual, createHmac } from 'node:crypto';

// Passwords: scrypt with a per-user random salt, stored as "salt:hash" (hex).
export function hashPassword(password) {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${scryptSync(password, salt, 64).toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [saltHex, hashHex] = String(stored ?? '').split(':');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(actual, expected);
}

// Sessions: a small signed token (HMAC-SHA256) carrying the user id and an expiry.
// Set JWT_SECRET in production so sessions survive restarts; otherwise a random
// secret is generated per process (fine for local dev: you just log in again).
const SECRET = process.env.JWT_SECRET ?? randomBytes(32).toString('hex');
export const TOKEN_TTL_MS = 8 * 60 * 60 * 1000;

const b64 = (buf) => Buffer.from(buf).toString('base64url');
const sign = (body) => createHmac('sha256', SECRET).update(body).digest('base64url');

export function signToken(userId) {
  const body = b64(JSON.stringify({ uid: userId, exp: Date.now() + TOKEN_TTL_MS }));
  return `${body}.${sign(body)}`;
}

export function verifyToken(token) {
  const [body, sig] = String(token ?? '').split('.');
  if (!body || !sig) return null;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const { uid, exp } = JSON.parse(Buffer.from(body, 'base64url').toString());
    return Number.isInteger(uid) && exp > Date.now() ? uid : null;
  } catch {
    return null;
  }
}
