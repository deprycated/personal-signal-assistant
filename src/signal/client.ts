export class SignalClient {
  constructor(
    private readonly apiUrl: string,
    private readonly botNumber: string,
  ) {}

  async sendMessage(recipient: string, message: string): Promise<void> {
    const response = await fetch(`${this.apiUrl}/v2/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        number: this.botNumber,
        recipients: [recipient],
        message,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Signal send failed: HTTP ${response.status}${body ? `: ${body.slice(0, 300)}` : ""}`);
    }
  }
}
