import test from 'node:test';
import assert from 'node:assert/strict';
import { requestedUserIdForOwnedRoute } from '../controllers/walletController';

const request = (authenticatedUserId?: string, requestedUserId = 'target-user', role: 'user' | 'admin' | 'super_admin' = 'user') => ({
  user: authenticatedUserId ? { id: authenticatedUserId, role } : undefined,
  params: { userId: requestedUserId },
}) as any;

test('wallet user route allows a user to act on their own wallet', () => {
  const result = requestedUserIdForOwnedRoute(request('user-1', 'user-1'));
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.userId, 'user-1');
});

test('wallet user route rejects cross-user access for normal users', () => {
  const result = requestedUserIdForOwnedRoute(request('user-1', 'user-2'));
  assert.deepEqual(result, { ok: false, status: 403, message: 'Forbidden' });
});

test('wallet user route allows admin roles to act on another user', () => {
  const admin = requestedUserIdForOwnedRoute(request('admin-1', 'user-2', 'admin'));
  const superAdmin = requestedUserIdForOwnedRoute(request('admin-1', 'user-2', 'super_admin'));

  assert.equal(admin.ok, true);
  assert.equal(superAdmin.ok, true);
  if (admin.ok) assert.equal(admin.userId, 'user-2');
  if (superAdmin.ok) assert.equal(superAdmin.userId, 'user-2');
});

test('wallet user route rejects unauthenticated access', () => {
  const result = requestedUserIdForOwnedRoute(request(undefined, 'user-2'));
  assert.deepEqual(result, { ok: false, status: 401, message: 'Authentication required' });
});
