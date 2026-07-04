/**
 * JWT secret with NO fallback. A missing JWT_SECRET must crash the boot —
 * never silently sign tokens with a publicly-known default string (CWE-798),
 * which would let anyone forge a valid token for any user.
 *
 * env.validation.ts already rejects a missing JWT_SECRET at bootstrap; this
 * guard covers every other entry point (tests, scripts, misconfigured PaaS)
 * that might construct the auth module without going through validateEnv().
 */
export function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set — refusing to start');
  return secret;
}

export function jwtExpiresIn(): string {
  return process.env.JWT_EXPIRES_IN || '8h';
}
