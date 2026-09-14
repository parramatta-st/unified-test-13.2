/** Keep both the response and JSON read bounded; an unconfirmed write may be retried by request ID. */
export async function timeClockRequest(url: string, init: RequestInit = {}, timeoutMs = 30_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const json = await response.json();
    return { response, json };
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error('The server took too long to confirm. Please retry; duplicate requests are protected.');
    }
    if (error instanceof SyntaxError) {
      throw new Error('The server returned an unreadable response. Please retry; duplicate requests are protected.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
