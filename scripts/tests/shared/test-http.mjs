import assert from "node:assert/strict";
import { fetchResource, fetchTimeout } from "../../shared/http.mjs";
import { fetchBaseItems } from "../../shared/repoe.mjs";

const json = (value, options) => new Response(JSON.stringify(value), options);
let attempts = 0;
const delays = [];
const statuses = [];
assert.deepEqual(await fetchResource("https://example.test", {
  fetchImpl: async (_url, options) => {
    assert.ok(options.signal instanceof AbortSignal);
    return ++attempts === 1 ? json({}, { status: 429, headers: { "Retry-After": "2" } }) : json({ ok: true });
  },
  sleep: async (ms) => delays.push(ms), onResponse: (response) => statuses.push(response.status),
}), { ok: true });
assert.equal(attempts, 2);
assert.deepEqual(delays, [2000]);
assert.deepEqual(statuses, [429, 200], "provenance receives the final response after recovery");
for (const status of [400, 401, 403, 404]) {
  attempts = 0;
  await assert.rejects(fetchResource("https://example.test", {
    fetchImpl: async () => { attempts++; return json({}, { status }); },
  }), new RegExp(`HTTP ${status}`));
  assert.equal(attempts, 1);
}
attempts = 0;
const backoff = [];
await assert.rejects(fetchResource("https://example.test", {
  fetchImpl: async () => { attempts++; return json({}, { status: 503 }); }, sleep: async (ms) => backoff.push(ms),
}), /HTTP 503/);
assert.equal(attempts, 3);
assert.deepEqual(backoff, [500, 1000]);
attempts = 0;
assert.equal(await fetchResource("https://example.test", {
  format: "text", fetchImpl: async () => {
    if (++attempts === 1) throw new TypeError("network failure");
    return new Response("recovered");
  }, sleep: async () => {},
}), "recovered");
attempts = 0;
assert.deepEqual(await fetchResource("https://example.test", {
  fetchImpl: async () => {
    if (++attempts === 1) return { ok: true, status: 200, json: async () => { throw new DOMException("body deadline", "TimeoutError"); } };
    return json({ recovered: true });
  }, sleep: async () => {},
}), { recovered: true });
const now = Date.parse("2026-10-19T12:00:00Z");
await fetchResource("https://example.test", {
  now: () => now, fetchImpl: async () => ++attempts === 3
    ? json({}, {status: 429, headers: {"Retry-After": "Mon, 19 Oct 2026 12:00:03 GMT"}}) : json({}),
  sleep: async (ms) => assert.equal(ms, 3000),
});
await assert.rejects(fetchResource("https://example.test", {
  fetchImpl: async () => json({}, {status: 429, headers: {"Retry-After": "120"}}),
  sleep: async () => assert.fail("never retry earlier than a long Retry-After"),
}), /HTTP 429/);
attempts = 0;
await assert.rejects(fetchResource("https://example.test", {
  fetchImpl: async () => { attempts++; return new Response("not JSON"); },
}), SyntaxError);
assert.equal(attempts, 1);
for (const invalid of ["invalid", -1, 0, 1000, Infinity, 120001]) assert.equal(fetchTimeout(invalid), 30000);
assert.equal(fetchTimeout(5000), 5000);
assert.equal(fetchTimeout(120000), 120000);

const originalFetch = globalThis.fetch;
try {
  let dictionaryAttempts = 0;
  globalThis.fetch = async () => {
    if (++dictionaryAttempts === 1) return json({}, { status: 503, headers: { "Retry-After": "0" } });
    return json({ "Metadata/Items/Test": { name: "Test" } }, { headers: { etag: '"dictionary-v1"', "last-modified": "Mon, 19 Oct 2026 11:00:00 GMT" } });
  };
  const result = await fetchBaseItems("https://example.test/items.json", { id: "repoe.test" });
  assert.equal(dictionaryAttempts, 2);
  assert.equal(result.baseItems["Metadata/Items/Test"].name, "Test");
  assert.equal(result.provenance.status, 200);
  assert.equal(result.provenance.etag, '"dictionary-v1"');
  assert.match(result.provenance.hash, /^sha256:/);
} finally { globalThis.fetch = originalFetch; }
console.log("HTTP retry, deadline configuration and provenance tests passed.");
