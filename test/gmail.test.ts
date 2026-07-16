import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../config.ts';
import { createDraft, sendMail, type ComposedEmail } from '../mail/gmail.ts';

const email: ComposedEmail = { to: 'test@example.com', subject: 'Test', text: 'Test' };

test('MAIL_DRY_RUN=true: createDraft/sendMail resolve without credentials or network', async () => {
  const prev = { dry: config.mailDryRun, user: config.gmailUser, pass: config.gmailAppPassword };
  config.mailDryRun = true;
  config.gmailUser = undefined;
  config.gmailAppPassword = undefined;
  try {
    await assert.doesNotReject(createDraft(email));
    await assert.doesNotReject(sendMail(email));
  } finally {
    config.mailDryRun = prev.dry;
    config.gmailUser = prev.user;
    config.gmailAppPassword = prev.pass;
  }
});
