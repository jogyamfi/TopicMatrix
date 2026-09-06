// Minimum length + a bundled common-password deny list (SEC-3). This is a small, deliberately
// generic sample of extremely common passwords (leaked-password-list "classics", not any
// particular copyrighted compilation) — enough to reject the obvious cases without shipping a
// large third-party wordlist dependency.
export const MIN_PASSWORD_LENGTH = 12;

export const COMMON_PASSWORDS: ReadonlySet<string> = new Set(
  [
    'password',
    'password123',
    'password1234',
    '123456789012',
    '1234567890123',
    'qwertyuiop123',
    'letmein123456',
    'welcome123456',
    'admin12345678',
    'iloveyou12345',
    'sunshine12345',
    'princess12345',
    'football12345',
    'baseball12345',
    'dragon12345678',
    'monkey12345678',
    'trustno1123456',
    'superman123456',
    'batman12345678',
    'starwars123456',
    'whatever123456',
    'changeme123456',
    'passw0rd123456',
    'p@ssword123456',
    'abcdefghijkl',
    'abc123abc123',
    'qwertyqwerty',
    '111111111111',
    '000000000000',
    'aaaaaaaaaaaa',
    'zxcvbnmzxcvbnm',
    'letmein1234567',
    'password!2345',
    'iloveyoubaby1',
    'welcometotheteam',
  ].map((p) => p.toLowerCase()),
);

/** Throws-via-caller pattern: returns a validation message, or null if the password is acceptable. */
export function validatePassword(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters long`;
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return 'Password is too common; choose a different one';
  }
  return null;
}
