export type FetchJsonOptions = RequestInit & {
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
};

export async function callWithRetry<T>(
  operation: () => Promise<T>,
  options: { timeoutMs?: number; retries?: number; retryDelayMs?: number } = {}
): Promise<T> {
  const timeoutMs = Number(options.timeoutMs ?? 5000);
  const retries = Number(options.retries ?? 3);
  const retryDelayMs = Number(options.retryDelayMs ?? 250);

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const result = await withTimeout(operation, timeoutMs);
      return result;
    } catch (error) {
      lastError = error;

      if (attempt >= retries) {
        break;
      }

      await delay(retryDelayMs * (attempt + 1));
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Request failed after retries.');
}

async function withTimeout<T>(operation: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: NodeJS.Timeout | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation(), timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
