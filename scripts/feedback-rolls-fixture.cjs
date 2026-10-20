// Loaded ONLY by the isolated browser test's child process. Never a production dependency.
if (process.env.STP_FEEDBACK_FIXTURE_ORIGIN) {
  const original = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url || String(input));
    if (['sheets.googleapis.com', 'oauth2.googleapis.com'].includes(url.hostname)) return original(process.env.STP_FEEDBACK_FIXTURE_ORIGIN + url.pathname + url.search, init);
    if (['127.0.0.1', 'localhost'].includes(url.hostname)) return original(input, init);
    throw new Error('External requests are disabled in the Daily Rolls browser fixture');
  };
}
