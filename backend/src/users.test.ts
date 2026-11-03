import { describe, expect, it, vi } from 'vitest';
vi.mock('./db.js', () => ({ pool: { execute: vi.fn(), getConnection: vi.fn() } }));
import { profileSchema } from './users.js';

describe('profile update boundary', () => {
  it('rejects attempts to change identity or privileges', () => {
    for (const field of ['id', 'user_id', 'role', 'status', 'email', 'avatar_url']) {
      expect(profileSchema.safeParse({ name: 'Learner', bio: '', [field]: 'admin' }).success).toBe(false);
    }
  });
  it('normalizes user text and rejects empty or oversized fields', () => {
    expect(profileSchema.parse({ name: '  Nguyễn An  ', bio: ' Học mỗi ngày ' })).toEqual({ name: 'Nguyễn An', bio: 'Học mỗi ngày' });
    expect(profileSchema.safeParse({ name: ' ', bio: '' }).success).toBe(false);
    expect(profileSchema.safeParse({ name: 'An', bio: 'a'.repeat(501) }).success).toBe(false);
  });
});
