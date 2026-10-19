const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function fetchTimeout(value) {
  const timeout = Number(value);
  return Number.isFinite(timeout) && timeout >= 5000 && timeout <= 120000 ? timeout : 30000;
}

// Consume the body inside the deadline too. Retry only transient GET failures.
export async function fetchResource(url, { headers, timeoutMs, format = "json", retries = 2,
  fetchImpl = globalThis.fetch, sleep = wait, now = Date.now, onResponse } = {}) {
  for (let attempt = 0; ; attempt++) {
    let response;
    try {
      response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(fetchTimeout(timeoutMs)) });
      onResponse?.(response);
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      return await response[format]();
    } catch (error) {
      const transient = error instanceof TypeError || ["TimeoutError", "AbortError"].includes(error.name)
        || response?.status === 429 || response?.status >= 500;
      if (!transient || attempt >= retries) throw error;
      const retryAfter = response?.headers?.get("retry-after");
      const seconds = retryAfter == null ? NaN : Number(retryAfter);
      const requested = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - now();
      // Do not retry earlier than the server permits; abandon long waits.
      if (requested > 30000) throw error;
      const delay = Number.isFinite(requested) ? Math.max(0, requested) : 500 * 2 ** attempt;
      try { await response?.body?.cancel(); } catch { /* A failed body may already be locked or closed. */ }
      await sleep(delay);
    }
  }
}
