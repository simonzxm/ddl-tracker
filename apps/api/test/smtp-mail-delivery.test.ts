import { describe, expect, it, vi } from 'vitest';

import {
  SmtpMailDelivery,
  type SmtpSession,
} from '../src/auth/smtp-mail-delivery.js';

function session(): SmtpSession {
  return {
    open: vi.fn(async () => undefined),
    authenticate: vi.fn(async () => undefined),
    send: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };
}

describe('SmtpMailDelivery', () => {
  it('sends one transaction-only verification message over an allowed TLS port', async () => {
    const smtp = session();
    const delivery = new SmtpMailDelivery({
      host: 'smtp.example.edu',
      port: 465,
      username: 'mailer@example.edu',
      password: 'secret',
      fromAddress: 'mailer@example.edu',
      fromName: 'DDL Tracker',
      createSession: () => smtp,
    });

    await delivery.sendVerificationCode({
      recipient: 'student@example.edu',
      code: '123456',
      expiresAt: new Date('2026-07-19T12:10:00.000Z'),
    });

    expect(smtp.open).toHaveBeenCalledWith({
      host: 'smtp.example.edu',
      port: 465,
      mode: 'implicit_tls',
    });
    expect(smtp.authenticate).toHaveBeenCalledWith({
      username: 'mailer@example.edu',
      password: 'secret',
    });
    expect(smtp.send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'mailer@example.edu',
        to: 'student@example.edu',
        message: expect.stringContaining('123456'),
      }),
    );
    expect(smtp.close).toHaveBeenCalledOnce();
  });

  it('uses STARTTLS on port 587', async () => {
    const smtp = session();
    const delivery = new SmtpMailDelivery({
      host: 'smtp.example.edu',
      port: 587,
      username: 'mailer@example.edu',
      password: 'secret',
      fromAddress: 'mailer@example.edu',
      fromName: 'DDL Tracker',
      createSession: () => smtp,
    });
    await delivery.sendVerificationCode({
      recipient: 'student@example.edu',
      code: '123456',
      expiresAt: new Date('2026-07-19T12:10:00.000Z'),
    });
    expect(smtp.open).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'starttls' }),
    );
  });

  it('rejects port 25 and header injection before opening a socket', async () => {
    expect(
      () =>
        new SmtpMailDelivery({
          host: 'smtp.example.edu',
          port: 25,
          username: 'mailer@example.edu',
          password: 'secret',
          fromAddress: 'mailer@example.edu',
          fromName: 'DDL Tracker',
          createSession: session,
        }),
    ).toThrow('465 or 587');

    const smtp = session();
    const delivery = new SmtpMailDelivery({
      host: 'smtp.example.edu',
      port: 465,
      username: 'mailer@example.edu',
      password: 'secret',
      fromAddress: 'mailer@example.edu',
      fromName: 'DDL Tracker',
      createSession: () => smtp,
    });
    await expect(
      delivery.sendVerificationCode({
        recipient: 'student@example.edu\r\nBcc: attacker@example.com',
        code: '123456',
        expiresAt: new Date('2026-07-19T12:10:00.000Z'),
      }),
    ).rejects.toThrow('header');
    expect(smtp.open).not.toHaveBeenCalled();
  });

  it('always closes the session after a provider failure', async () => {
    const smtp = session();
    vi.mocked(smtp.send).mockRejectedValueOnce(new Error('provider detail'));
    const delivery = new SmtpMailDelivery({
      host: 'smtp.example.edu',
      port: 465,
      username: 'mailer@example.edu',
      password: 'secret',
      fromAddress: 'mailer@example.edu',
      fromName: 'DDL Tracker',
      createSession: () => smtp,
    });
    await expect(
      delivery.sendVerificationCode({
        recipient: 'student@example.edu',
        code: '123456',
        expiresAt: new Date('2026-07-19T12:10:00.000Z'),
      }),
    ).rejects.toThrow('provider detail');
    expect(smtp.close).toHaveBeenCalledOnce();
  });
});
