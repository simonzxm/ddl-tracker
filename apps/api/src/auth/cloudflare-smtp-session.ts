import { connect } from 'cloudflare:sockets';

type WorkerSocket = ReturnType<typeof connect>;

import type { SmtpSession } from './smtp-mail-delivery.js';

const encoder = new TextEncoder();

export class CloudflareSmtpSession implements SmtpSession {
  #socket: WorkerSocket | null = null;
  #reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  #writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  #buffer = '';

  async open(input: {
    host: string;
    port: 465 | 587;
    mode: 'implicit_tls' | 'starttls';
  }): Promise<void> {
    this.#socket = connect(
      { hostname: input.host, port: input.port },
      {
        secureTransport: input.mode === 'implicit_tls' ? 'on' : 'starttls',
        allowHalfOpen: false,
      },
    );
    this.#bindStreams();
    await this.#expect([220]);
    await this.#command('EHLO ddl-tracker.worker', [250]);
    if (input.mode === 'starttls') {
      await this.#command('STARTTLS', [220]);
      this.#releaseStreams();
      this.#socket = this.#requiredSocket().startTls();
      this.#buffer = '';
      this.#bindStreams();
      await this.#command('EHLO ddl-tracker.worker', [250]);
    }
  }

  async authenticate(input: {
    username: string;
    password: string;
  }): Promise<void> {
    await this.#command('AUTH LOGIN', [334]);
    await this.#command(base64(input.username), [334]);
    await this.#command(base64(input.password), [235]);
  }

  async send(input: {
    from: string;
    to: string;
    message: string;
  }): Promise<void> {
    await this.#command(`MAIL FROM:<${input.from}>`, [250]);
    await this.#command(`RCPT TO:<${input.to}>`, [250, 251]);
    await this.#command('DATA', [354]);
    const data = dotStuff(input.message);
    await this.#requiredWriter().write(
      encoder.encode(`${data}\r\n.\r\n`),
    );
    await this.#expect([250]);
  }

  async close(): Promise<void> {
    if (this.#socket === null) return;
    try {
      await this.#command('QUIT', [221]);
    } catch {
      // The provider may close immediately after accepting DATA.
    }
    this.#releaseStreams();
    try {
      await this.#socket.close();
    } finally {
      this.#socket = null;
      this.#buffer = '';
    }
  }

  async #command(line: string, expected: readonly number[]): Promise<void> {
    await this.#requiredWriter().write(encoder.encode(`${line}\r\n`));
    await this.#expect(expected);
  }

  async #expect(expected: readonly number[]): Promise<void> {
    const reply = await this.#readReply();
    if (!expected.includes(reply.code)) {
      throw new Error(`SMTP command failed with status ${String(reply.code)}.`);
    }
  }

  async #readReply(): Promise<{ code: number }> {
    let firstCode: number | null = null;
    for (;;) {
      const line = await this.#readLine();
      if (!/^\d{3}[ -]/u.test(line)) {
        throw new Error('SMTP provider returned a malformed reply.');
      }
      const code = Number(line.slice(0, 3));
      firstCode ??= code;
      if (code !== firstCode) {
        throw new Error('SMTP provider returned inconsistent reply codes.');
      }
      if (line[3] === ' ') return { code };
    }
  }

  async #readLine(): Promise<string> {
    for (;;) {
      const end = this.#buffer.indexOf('\r\n');
      if (end >= 0) {
        const line = this.#buffer.slice(0, end);
        this.#buffer = this.#buffer.slice(end + 2);
        return line;
      }
      const chunk = await this.#requiredReader().read();
      if (chunk.done) {
        throw new Error('SMTP provider closed the connection unexpectedly.');
      }
      this.#buffer += new TextDecoder().decode(chunk.value, { stream: true });
    }
  }

  #bindStreams(): void {
    const socket = this.#requiredSocket();
    this.#reader = socket.readable.getReader();
    this.#writer = socket.writable.getWriter();
  }

  #releaseStreams(): void {
    this.#reader?.releaseLock();
    this.#writer?.releaseLock();
    this.#reader = null;
    this.#writer = null;
  }

  #requiredSocket(): WorkerSocket {
    if (this.#socket === null) throw new Error('SMTP socket is not open.');
    return this.#socket;
  }

  #requiredReader(): ReadableStreamDefaultReader<Uint8Array> {
    if (this.#reader === null) throw new Error('SMTP reader is not available.');
    return this.#reader;
  }

  #requiredWriter(): WritableStreamDefaultWriter<Uint8Array> {
    if (this.#writer === null) throw new Error('SMTP writer is not available.');
    return this.#writer;
  }
}

function base64(value: string): string {
  const bytes = encoder.encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function dotStuff(message: string): string {
  return message
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n')
    .split('\n')
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join('\r\n');
}
