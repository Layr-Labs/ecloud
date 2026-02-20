import axios, { AxiosRequestConfig, AxiosResponse } from "axios";

const MAX_RETRIES = 5;
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRetryDelay(res: AxiosResponse, attempt: number): number {
  const backoff = Math.min(INITIAL_BACKOFF_MS * Math.pow(2, attempt), MAX_BACKOFF_MS);
  const retryAfter = res.headers["retry-after"];
  if (retryAfter) {
    const seconds = parseInt(retryAfter, 10);
    if (!isNaN(seconds) && seconds > 0) {
      return Math.min(seconds * 1000, MAX_BACKOFF_MS);
    }
  }
  return backoff;
}

export async function requestWithRetry(config: AxiosRequestConfig): Promise<AxiosResponse> {
  let lastResponse: AxiosResponse | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await axios({ ...config, validateStatus: () => true });
    lastResponse = res;

    if (res.status !== 429) {
      return res;
    }

    if (attempt < MAX_RETRIES) {
      const delay = getRetryDelay(res, attempt);
      await sleep(delay);
    }
  }

  return lastResponse!;
}
