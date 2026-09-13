import test from 'node:test';
import assert from 'node:assert/strict';
import { boundFrozenInspectorCache, FROZEN_NETWORK_LIMITS } from './e2e/electron/helpers/frozen-inspector-cache.mjs';
function fixture(send = async (...args) => calls.push(args)) {
  const client = { send }, sessions = new Map([[client, {}]]);
  const manager = { _sessions: sessions, async addSession(next) { sessions.set(next, {}); await next.send('Network.enable'); } };
  const page = { _connection: { toImpl: () => ({ delegate: { _networkManager: manager } }) } };
  return { page, sessions, manager, client };
}
let calls;
test('bounds the existing Inspector owner and preserves Network events', async () => {
  calls = []; const f = fixture(); const result = await boundFrozenInspectorCache(f.page, '1.62.1');
  assert.deepEqual(calls, [['Network.disable'], ['Network.enable', FROZEN_NETWORK_LIMITS]]);
  assert.equal(result.evidence.responseBodyEvidence, false); result.verify();
  f.sessions.set({ send() {} }, {});
  assert.throws(() => result.verify(), /UNBOUNDED_SESSION/);
});
test('new owners are bounded before their first enable, while retired owners can leave', async () => {
  const sent = [], f = fixture(async () => {});
  const result = await boundFrozenInspectorCache(f.page, '1.62.1');
  const next = { send: async (...args) => sent.push(args) };
  await f.manager.addSession(next); f.sessions.delete(f.client); result.verify();
  assert.deepEqual(sent, [['Network.enable', FROZEN_NETWORK_LIMITS]]);
  await next.send('Network.enable', { maxTotalBufferSize: 100000000 });
  assert.deepEqual(sent.at(-1), ['Network.enable', FROZEN_NETWORK_LIMITS]);
  await next.send('Network.disable'); assert.throws(() => result.verify(), /UNBOUNDED_SESSION/);
  await next.send('Network.enable'); result.verify();
  f.manager.addSession = () => {}; assert.throws(() => result.verify(), /OWNER_CHANGED/);
});
test('failed new-owner initialization cannot be silently accepted', async () => {
  const f = fixture(async () => {}), result = await boundFrozenInspectorCache(f.page, '1.62.1');
  await assert.rejects(f.manager.addSession({ send: async () => { throw new Error('NEW_OWNER_REJECTED'); } }), /NEW_OWNER_REJECTED/);
  assert.throws(() => result.verify(), /UNBOUNDED_SESSION/);
});
test('a session arriving during initial cache flush is bound exactly once', async () => {
  const sent = [], next = { send: async (...args) => sent.push(args) };
  const f = fixture(async method => { if (method === 'Network.enable') await f.manager.addSession(next); });
  const result = await boundFrozenInspectorCache(f.page, '1.62.1');
  assert.equal(result.evidence.configuredSessions, 2); result.verify();
  assert.deepEqual(sent, [['Network.enable', FROZEN_NETWORK_LIMITS]]);
});
test('unknown versions, missing owners, empty sessions and failed commands cannot pass', async () => {
  await assert.rejects(boundFrozenInspectorCache(fixture().page, 'future'), /ADAPTER_VERSION/);
  await assert.rejects(boundFrozenInspectorCache({}, '1.62.1'), /ADAPTER_UNAVAILABLE/);
  const empty = fixture(); empty.sessions.clear();
  await assert.rejects(boundFrozenInspectorCache(empty.page, '1.62.1'), /EMPTY_SESSIONS/);
  await assert.rejects(boundFrozenInspectorCache(fixture(async () => { throw new Error('CDP_REJECTED'); }).page, '1.62.1'), /CDP_REJECTED/);
});
