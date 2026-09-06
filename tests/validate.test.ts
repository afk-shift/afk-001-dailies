import { describe, expect, it } from 'vitest';
import { isValidEventShape, isValidSlugShape, validateSupercutShape } from '../netlify/functions/_shared/validate';

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    title: 'A session',
    sessionId: 'sess-1',
    project: 'dailies',
    startedAt: '2026-09-06T00:00:00.000Z',
    endedAt: '2026-09-06T00:01:00.000Z',
    stats: {},
    cast: [],
    chapters: [],
    files: [],
    events: [{ i: 0, t: '2026-09-06T00:00:00.000Z', kind: 'prompt', text: 'hi' }],
    ...overrides,
  };
}

describe('isValidEventShape', () => {
  it('accepts a minimal well-shaped event', () => {
    expect(isValidEventShape({ i: 0, t: '2026-09-06T00:00:00.000Z', kind: 'tool' })).toBe(true);
  });

  it.each(['prompt', 'reply', 'tool', 'commit', 'spawn', 'milestone'])('accepts every known kind: %s', (kind) => {
    expect(isValidEventShape({ i: 0, t: 't', kind })).toBe(true);
  });

  it('rejects a non-object', () => {
    expect(isValidEventShape('not an object')).toBe(false);
    expect(isValidEventShape(null)).toBe(false);
    expect(isValidEventShape([1, 2])).toBe(false);
  });

  it('rejects a non-numeric i', () => {
    expect(isValidEventShape({ i: '0', t: 't', kind: 'tool' })).toBe(false);
  });

  it('rejects a non-string t', () => {
    expect(isValidEventShape({ i: 0, t: 12345, kind: 'tool' })).toBe(false);
  });

  it('rejects an unknown kind', () => {
    expect(isValidEventShape({ i: 0, t: 't', kind: 'not-a-real-kind' })).toBe(false);
  });

  it('rejects a missing kind', () => {
    expect(isValidEventShape({ i: 0, t: 't' })).toBe(false);
  });
});

describe('validateSupercutShape', () => {
  it('accepts a well-formed body', () => {
    const result = validateSupercutShape(validBody());
    expect(result.ok).toBe(true);
  });

  it('rejects a non-object body', () => {
    const result = validateSupercutShape('nope');
    expect(result).toEqual({ ok: false, error: 'Body must be a JSON object' });
  });

  it('rejects the wrong version', () => {
    const result = validateSupercutShape(validBody({ version: 2 }));
    expect(result).toEqual({ ok: false, error: 'version must be 1' });
  });

  it('rejects a missing/non-string field', () => {
    const result = validateSupercutShape(validBody({ title: 42 }));
    expect(result).toEqual({ ok: false, error: 'title must be a string' });
  });

  it('rejects a non-array field', () => {
    const result = validateSupercutShape(validBody({ events: 'not an array' }));
    expect(result).toEqual({ ok: false, error: 'events must be an array' });
  });

  it('rejects a non-object stats', () => {
    const result = validateSupercutShape(validBody({ stats: 'nope' }));
    expect(result).toEqual({ ok: false, error: 'stats must be an object' });
  });

  it('rejects a body with a malformed event', () => {
    const result = validateSupercutShape(
      validBody({ events: [{ i: 0, t: 't', kind: 'prompt' }, { i: 'bad', t: 't', kind: 'tool' }] }),
    );
    expect(result).toEqual({ ok: false, error: 'events contains a malformed entry' });
  });

  it('rejects an event with an unknown kind', () => {
    const result = validateSupercutShape(validBody({ events: [{ i: 0, t: 't', kind: 'forged' }] }));
    expect(result).toEqual({ ok: false, error: 'events contains a malformed entry' });
  });

  it('caps events at MAX_EVENTS (5000) without erroring', () => {
    const events = Array.from({ length: 6000 }, (_, i) => ({ i, t: 't', kind: 'tool' }));
    const result = validateSupercutShape(validBody({ events }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.events).toHaveLength(5000);
    }
  });
});

describe('isValidSlugShape', () => {
  it('accepts a 10-character lowercase base32 (a-z2-7) slug', () => {
    expect(isValidSlugShape('abcdefghij')).toBe(true);
    expect(isValidSlugShape('a2b3c4d5e6')).toBe(true);
  });

  it('rejects a slug with digits 0, 1, 8, or 9 (outside the base32 alphabet)', () => {
    expect(isValidSlugShape('abcdefghi0')).toBe(false);
    expect(isValidSlugShape('abcdefghi1')).toBe(false);
    expect(isValidSlugShape('abcdefghi8')).toBe(false);
    expect(isValidSlugShape('abcdefghi9')).toBe(false);
  });

  it('rejects an uppercase slug', () => {
    expect(isValidSlugShape('ABCDEFGHIJ')).toBe(false);
  });

  it('rejects the wrong length (too short or too long)', () => {
    expect(isValidSlugShape('abcdefghi')).toBe(false); // 9 chars
    expect(isValidSlugShape('abcdefghijk')).toBe(false); // 11 chars
  });

  it('rejects a non-string value', () => {
    expect(isValidSlugShape(12345)).toBe(false);
    expect(isValidSlugShape(null)).toBe(false);
    expect(isValidSlugShape(undefined)).toBe(false);
  });

  it('rejects a slug with non-alphanumeric characters', () => {
    expect(isValidSlugShape('abcdefgh-j')).toBe(false);
    expect(isValidSlugShape('../../etc/passwd')).toBe(false);
  });
});
