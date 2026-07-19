import type { MailDelivery } from './email-challenge-service.js';

export interface SmtpSession {
  open(input: {
    host: string;
    port: 465 | 587;
    mode: 'implicit_tls' | 'starttls';
  }): Promise<void>;
  authenticate(input: { username: string; password: string }): Promise<void>;
  send(input: { from: string; to: string; message: string }): Promise<void>;
  close(): Promise<void>;
}

export class SmtpMailDelivery implements MailDelivery {
  readonly #host: string;
  readonly #port: 465 | 587;
  readonly #username: string;
  readonly #password: string;
  readonly #fromAddress: string;
  readonly #fromName: string;
  readonly #createSession: () => SmtpSession;

  constructor(options: {
    host: string;
    port: number;
    username: string;
    password: string;
    fromAddress: string;
    fromName: string;
    createSession: () => SmtpSession;
  }) {
    if (options.port !== 465 && options.port !== 587) {
      throw new Error('SMTP port must be 465 or 587.');
    }
    for (const [label, value] of [
      ['host', options.host],
      ['username', options.username],
      ['from address', options.fromAddress],
      ['from name', options.fromName],
    ] as const) {
      assertHeaderSafe(value, label);
    }
    this.#host = options.host;
    this.#port = options.port;
    this.#username = options.username;
    this.#password = options.password;
    this.#fromAddress = options.fromAddress;
    this.#fromName = options.fromName;
    this.#createSession = options.createSession;
  }

  async sendVerificationCode(input: {
    recipient: string;
    code: string;
    expiresAt: Date;
  }): Promise<void> {
    assertHeaderSafe(input.recipient, 'recipient header');
    if (!/^\d{6}$/u.test(input.code)) {
      throw new Error('Verification code must contain six digits.');
    }
    const session = this.#createSession();
    let opened = false;
    try {
      await session.open({
        host: this.#host,
        port: this.#port,
        mode: this.#port === 465 ? 'implicit_tls' : 'starttls',
      });
      opened = true;
      await session.authenticate({
        username: this.#username,
        password: this.#password,
      });
      await session.send({
        from: this.#fromAddress,
        to: input.recipient,
        message: buildMessage({
          fromAddress: this.#fromAddress,
          fromName: this.#fromName,
          recipient: input.recipient,
          code: input.code,
          expiresAt: input.expiresAt,
        }),
      });
    } finally {
      if (opened) await session.close();
    }
  }
}

function buildMessage(input: {
  fromAddress: string;
  fromName: string;
  recipient: string;
  code: string;
  expiresAt: Date;
}): string {
  const body = [
    'Your DDL Tracker verification code is:',
    '',
    input.code,
    '',
    `This code expires at ${input.expiresAt.toISOString()}.`,
    'Do not share this code with anyone.',
  ].join('\r\n');
  return [
    `From: ${input.fromName} <${input.fromAddress}>`,
    `To: ${input.recipient}`,
    'Subject: DDL Tracker verification code',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    body,
  ].join('\r\n');
}

function assertHeaderSafe(value: string, label: string): void {
  if (value.length === 0 || /[\r\n]/u.test(value) || value.includes('\0')) {
    throw new Error(`${label} contains an unsafe header value.`);
  }
}
