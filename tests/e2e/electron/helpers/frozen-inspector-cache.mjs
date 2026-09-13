import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export const FROZEN_NETWORK_LIMITS = Object.freeze({
  maxTotalBufferSize: 65536, maxResourceBufferSize: 8192, maxPostDataSize: 1024,
});

// Playwright has no public option for its own Inspector response-body cache.
// This version-pinned test-only adapter preserves Network events, but not bodies.
// Never substitute a new CDP session: it would leave the owner's cache intact.
export async function boundFrozenInspectorCache(page, version = require('playwright-core/package.json').version) {
  assert.equal(version, '1.62.1', 'FROZEN_INSPECTOR_ADAPTER_VERSION');
  assert.equal(typeof page?._connection?.toImpl, 'function', 'FROZEN_INSPECTOR_ADAPTER_UNAVAILABLE');
  const manager = page._connection.toImpl(page)?.delegate?._networkManager;
  assert.ok(manager?._sessions instanceof Map, 'FROZEN_INSPECTOR_SESSION_MAP');
  assert.equal(typeof manager.addSession, 'function', 'FROZEN_INSPECTOR_SESSION_OWNER');
  assert.ok(manager._sessions.size > 0, 'FROZEN_INSPECTOR_EMPTY_SESSIONS');
  const records = new WeakMap();
  const evidence = { adapterVersion: version, sessionCount: manager._sessions.size,
    configuredSessions: 0, limits: FROZEN_NETWORK_LIMITS, networkEvents: true, responseBodyEvidence: false };
  function bind(client) {
    assert.equal(typeof client.send, 'function', 'FROZEN_INSPECTOR_SESSION_SEND');
    assert.ok(!records.has(client), 'FROZEN_INSPECTOR_DUPLICATE_SESSION');
    const originalSend = client.send, record = { enabled: false, send: null };
    record.send = function (...args) {
      if (args[0] === 'Network.disable') record.enabled = false;
      if (args[0] !== 'Network.enable') return originalSend.apply(this, args);
      record.enabled = false;
      args[1] = { ...args[1], ...FROZEN_NETWORK_LIMITS };
      return originalSend.apply(this, args).then(value => { record.enabled = true; return value; });
    };
    client.send = record.send;
    records.set(client, record); evidence.configuredSessions += 1;
  }
  const originalAddSession = manager.addSession;
  // Sandbox/OOP iframe replacement legitimately changes the owner set. Bind a
  // new owner before Playwright's very first Network.enable, never after load.
  const addSession = function (client, ...args) {
    bind(client);
    return originalAddSession.call(this, client, ...args);
  };
  manager.addSession = addSession;
  for (const client of [...manager._sessions.keys()]) {
    bind(client);
    await client.send('Network.disable');
    await client.send('Network.enable');
  }
  return {
    evidence,
    verify() {
      assert.equal(manager.addSession, addSession, 'FROZEN_INSPECTOR_OWNER_CHANGED');
      assert.ok(manager._sessions.size > 0, 'FROZEN_INSPECTOR_EMPTY_SESSIONS');
      for (const client of manager._sessions.keys()) {
        const record = records.get(client);
        assert.ok(record?.enabled && client.send === record.send, 'FROZEN_INSPECTOR_UNBOUNDED_SESSION');
      }
    },
  };
}
