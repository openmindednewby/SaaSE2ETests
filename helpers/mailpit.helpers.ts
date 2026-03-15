/**
 * Mailpit API Helpers
 *
 * Provides utility functions for interacting with the Mailpit REST API
 * during E2E tests. Used for verifying transactional email delivery
 * (OTP codes, welcome emails, password resets, etc.).
 *
 * Mailpit captures all SMTP emails in dev and exposes them via REST API.
 * Web UI: http://localhost:5020
 * API:    http://localhost:5020/api/v1/
 */

import { setTimeout as delay } from 'timers/promises';
import axios, { type AxiosInstance } from 'axios';

const MAILPIT_URL = process.env.MAILPIT_URL || 'http://localhost:5020';
const API_TIMEOUT_MS = 10000;

/** Address object from Mailpit API */
interface MailpitAddress {
  Name: string;
  Address: string;
}

/** Message summary from Mailpit list endpoint */
interface MailpitMessageSummary {
  ID: string;
  MessageID: string;
  From: MailpitAddress;
  To: MailpitAddress[];
  Subject: string;
  Created: string;
  Size: number;
  Attachments: number;
}

/** Full message from Mailpit message endpoint */
interface MailpitMessage {
  ID: string;
  MessageID: string;
  From: MailpitAddress;
  To: MailpitAddress[];
  Subject: string;
  Created: string;
  Text: string;
  HTML: string;
  Size: number;
  Attachments: unknown[];
}

/** Response from Mailpit messages list endpoint */
interface MailpitMessagesResponse {
  total: number;
  unread: number;
  count: number;
  messages: MailpitMessageSummary[];
}

function createMailpitClient(): AxiosInstance {
  return axios.create({
    baseURL: MAILPIT_URL,
    timeout: API_TIMEOUT_MS,
  });
}

/**
 * Delete all messages in Mailpit inbox.
 * Call this before a test to ensure a clean state.
 */
export async function clearMailpit(): Promise<void> {
  const client = createMailpitClient();
  await client.delete('/api/v1/messages');
}

/**
 * Get all messages from Mailpit inbox.
 */
export async function getMessages(): Promise<MailpitMessageSummary[]> {
  const client = createMailpitClient();
  const response = await client.get<MailpitMessagesResponse>('/api/v1/messages');
  return response.data.messages ?? [];
}

/**
 * Get a single message by ID (includes full HTML and text body).
 */
export async function getMessage(id: string): Promise<MailpitMessage> {
  const client = createMailpitClient();
  const response = await client.get<MailpitMessage>(`/api/v1/message/${id}`);
  return response.data;
}

/**
 * Wait for an email to arrive for a specific recipient.
 * Polls Mailpit until the email appears or timeout is reached.
 *
 * @param recipientEmail - Email address to look for
 * @param timeoutMs - Max time to wait (default 15s)
 * @param pollIntervalMs - Polling interval (default 500ms)
 * @returns The matching message summary, or null if not found
 */
export async function waitForEmail(
  recipientEmail: string,
  timeoutMs = 15000,
  pollIntervalMs = 500,
): Promise<MailpitMessageSummary | null> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const messages = await getMessages();
    const match = messages.find((m) =>
      m.To.some((to) => to.Address.toLowerCase() === recipientEmail.toLowerCase()),
    );
    if (match) {
      return match;
    }
    await delay(pollIntervalMs);
  }

  return null;
}

/**
 * Wait for an email and return its full content (HTML + text body).
 */
export async function waitForEmailContent(
  recipientEmail: string,
  timeoutMs = 15000,
): Promise<MailpitMessage | null> {
  const summary = await waitForEmail(recipientEmail, timeoutMs);
  if (!summary) {
    return null;
  }
  return getMessage(summary.ID);
}

/**
 * Check if Mailpit is reachable.
 */
export async function isMailpitHealthy(): Promise<boolean> {
  try {
    const client = createMailpitClient();
    await client.get('/livez');
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the Mailpit Web UI URL for manual inspection.
 */
export function getMailpitUrl(): string {
  return MAILPIT_URL;
}
