type AuthMail = {
  to: string;
  subject: string;
  text: string;
};

export async function sendAuthMail(message: AuthMail): Promise<void> {
  const endpoint = process.env.AUTH_MAIL_WEBHOOK_URL;
  const token = process.env.AUTH_MAIL_WEBHOOK_TOKEN;

  if (!endpoint) {
    throw new Error("AUTH_MAIL_DELIVERY_NOT_CONFIGURED");
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(message),
    signal: AbortSignal.timeout(10_000)
  });

  if (!response.ok) {
    throw new Error(`AUTH_MAIL_DELIVERY_FAILED:${response.status}`);
  }
}
