import { describe, expect, it } from 'vitest';
import { deepRedact, redactSecrets } from '../src/lib/parse/redact';

// All secret-shaped values below are fake/synthetic — none are real
// credentials.

describe('redactSecrets — new patterns', () => {
  it('masks the user:pass portion of a URL with embedded credentials', () => {
    expect(redactSecrets('postgres://fakeuser:fakepass@localhost:5432/mydb')).toBe(
      'postgres://[redacted]@localhost:5432/mydb',
    );
  });

  it('masks a PASSWORD assignment', () => {
    expect(redactSecrets('DB_PASSWORD=fakehunter2')).toBe('DB_PASSWORD=[redacted]');
  });

  it('masks a bare PWD assignment', () => {
    expect(redactSecrets('PWD=fakepwdvalue123')).toBe('PWD=[redacted]');
  });

  it('masks a PASSWD assignment with a colon separator', () => {
    expect(redactSecrets('PASSWD: fakepasswdvalue')).toBe('PASSWD: [redacted]');
  });

  it('masks a DATABASE_URL assignment (including any embedded credentials in its value)', () => {
    expect(redactSecrets('DATABASE_URL=postgres://fakeuser:fakepass@localhost/db')).toBe(
      'DATABASE_URL=[redacted]',
    );
  });

  it('masks a quoted CONNECTION_STRING value, keeping the quotes', () => {
    expect(redactSecrets('CONNECTION_STRING="Server=fake;Password=fakepass;"')).toBe(
      'CONNECTION_STRING="[redacted]"',
    );
  });

  it('masks an Authorization: Basic header, keeping the scheme', () => {
    expect(redactSecrets('Authorization: Basic ZmFrZXVzZXI6ZmFrZXBhc3M=')).toBe(
      'Authorization: Basic [redacted]',
    );
  });

  it('masks a bare Basic <b64> token', () => {
    expect(redactSecrets('curl -H "Basic ZmFrZS10b2tlbg=="')).toBe('curl -H "Basic [redacted]"');
  });

  it('masks a PEM private key block', () => {
    const pem = [
      '-----BEGIN RSA PRIVATE KEY-----',
      'ZmFrZWZha2VmYWtlZmFrZWZha2VmYWtlZmFrZWZha2VmYWtl',
      'ZmFrZWZha2VmYWtlZmFrZWZha2VmYWtlZmFrZWZha2VmYWtl',
      '-----END RSA PRIVATE KEY-----',
    ].join('\n');
    expect(redactSecrets(`before\n${pem}\nafter`)).toBe('before\n[redacted private key]\nafter');
  });

  it('masks a JWT (three dot-separated base64url segments)', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJmYWtlIn0.fakefakefakefakefakefakefakefakefake';
    expect(redactSecrets(`token=${jwt}`)).not.toContain('fakefakefake');
    expect(redactSecrets(`Authorization: Bearer ${jwt}`)).toBe('Authorization: Bearer [redacted]');
  });

  it('masks an npm token', () => {
    expect(redactSecrets('npm_FAKE0123456789FAKE0123456789FAKE')).toBe('[redacted]');
  });

  it('masks a Slack xapp- token', () => {
    expect(redactSecrets('xapp-1-FAKE012345-fakefakefakefakefakefakefake')).toBe('[redacted]');
  });

  it('masks a Stripe sk_live_ key', () => {
    expect(redactSecrets('sk_live_FAKE0123456789fake')).toBe('[redacted]');
  });

  it('masks a Stripe sk_test_ key', () => {
    expect(redactSecrets('sk_test_FAKE0123456789fake')).toBe('[redacted]');
  });

  it('masks a Stripe rk_live_ key', () => {
    expect(redactSecrets('rk_live_FAKE0123456789fake')).toBe('[redacted]');
  });

  it('masks a Google API key', () => {
    expect(redactSecrets('AIzaFAKE0123456789FAKE0123456789fake')).toBe('[redacted]');
  });

  it('masks a Netlify nfd_ deploy token', () => {
    expect(redactSecrets('nfd_FAKE0123456789FAKE0123456789FAKE')).toBe('[redacted]');
  });

  it('masks generic key= and token= query params in a URL, leaving other params alone', () => {
    expect(redactSecrets('https://example.com/api?key=FAKEKEY123&token=FAKETOKEN456&foo=bar')).toBe(
      'https://example.com/api?key=[redacted]&token=[redacted]&foo=bar',
    );
  });

  it('leaves ordinary text untouched', () => {
    expect(redactSecrets('nothing sensitive here')).toBe('nothing sensitive here');
  });
});

describe('deepRedact', () => {
  it('returns the redacted value and a count of redactions applied', () => {
    const { value, count } = deepRedact({
      a: 'key is sk-ant-api03-FAKEFAKE here',
      b: ['DB_PASSWORD=fakevalue', 'nothing to see here'],
      c: { nested: 'npm_FAKE0123456789FAKE0123456789FAKE' },
    });

    expect(count).toBe(3);
    expect(value).toEqual({
      a: 'key is [redacted] here',
      b: ['DB_PASSWORD=[redacted]', 'nothing to see here'],
      c: { nested: '[redacted]' },
    });
  });

  it('reports zero redactions for clean input', () => {
    const { value, count } = deepRedact({ a: 'clean', b: [1, 2, null] });
    expect(count).toBe(0);
    expect(value).toEqual({ a: 'clean', b: [1, 2, null] });
  });
});
