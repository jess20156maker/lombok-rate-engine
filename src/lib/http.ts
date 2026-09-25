import { REQUEST_DELAY_MS } from "../config.js";

export const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let lastRequest = 0;

/** Wait out the politeness delay since the previous request. */
async function pace() {
  const { min, max } = REQUEST_DELAY_MS;
  const wait = min + Math.random() * (max - min) - (Date.now() - lastRequest);
  if (wait > 0) await sleep(wait);
  lastRequest = Date.now();
}

/** GET with pacing and backoff. Retries on 429/5xx and network errors. */
export async function get(url: string, headers: Record<string, string> = {}): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    await pace();
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, "Accept-Language": "en-US,en;q=0.9", ...headers },
      });
      if (res.ok) return await res.text();
      if (attempt >= 4 || (res.status < 500 && res.status !== 429)) {
        throw new Error(`HTTP ${res.status} for ${url.slice(0, 120)}`);
      }
    } catch (err) {
      if (attempt >= 4) throw err;
    }
    await sleep(2 ** attempt * 5000);
  }
}
