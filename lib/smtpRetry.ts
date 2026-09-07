function responseCode(error: any) {
  const code = Number(error?.responseCode || 0);
  return Number.isFinite(code) ? code : 0;
}

export function isTransientSmtpError(error: any) {
  const code = responseCode(error);
  return code === 421 || code === 450 || code === 451 || code === 454;
}

export async function sendMailWithTransientRetry(
  transporter: { sendMail: (mail: any) => Promise<any> },
  mail: any,
  context: Record<string, any> = {},
) {
  // Retry only explicit SMTP 4xx responses. A 4xx response means Gmail did
  // not accept the message, so retrying is safe and will not duplicate a send.
  const delaysMs = [0, 900, 2500];
  let lastError: any = null;

  for (let attempt = 0; attempt < delaysMs.length; attempt += 1) {
    if (delaysMs[attempt] > 0) {
      await new Promise((resolve) => setTimeout(resolve, delaysMs[attempt]));
    }

    try {
      return await transporter.sendMail(mail);
    } catch (error: any) {
      lastError = error;
      const transient = isTransientSmtpError(error);
      const finalAttempt = attempt === delaysMs.length - 1;

      if (!transient || finalAttempt) throw error;

      console.warn('Temporary Gmail SMTP rejection; retrying', {
        ...context,
        attempt: attempt + 1,
        responseCode: responseCode(error),
        response: String(error?.response || '').slice(0, 300),
      });
    }
  }

  throw lastError || new Error('Email could not be sent.');
}

export function friendlySmtpError(error: any) {
  if (isTransientSmtpError(error)) {
    return {
      status: 503,
      message: 'Google temporarily rejected this email. Please wait a moment and press Send again.',
    };
  }

  return {
    status: 500,
    message: error?.message || 'Email could not be sent.',
  };
}
