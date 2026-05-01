// Password hashing helpers. One place for the algorithm choice so if we ever
// need to rotate (e.g. Bun ships a newer default), only this file changes.
//
// Bun.password.hash defaults to argon2id with sensible parameters and returns
// a PHC-format string that already contains the salt - we don't store salts
// separately.

export async function hashPassword(plain) {
  return Bun.password.hash(plain);
}

export async function verifyPassword(plain, hash) {
  if (!hash) return false;
  try {
    return await Bun.password.verify(plain, hash);
  } catch {
    // Malformed hash or unsupported algorithm - treat as no match.
    return false;
  }
}
