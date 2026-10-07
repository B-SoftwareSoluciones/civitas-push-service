import { Expo, type ExpoPushMessage } from 'expo-server-sdk';

import { config } from '../config';

export const expo = new Expo(
  config.expoAccessToken ? { accessToken: config.expoAccessToken } : {},
);

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export interface PushRecipient {
  deviceId: string;
  token: string;
}

export interface PushResult {
  sent: number;
  invalidTokens: string[];
}

export async function sendPush(
  recipients: PushRecipient[],
  payload: PushPayload,
): Promise<PushResult> {
  const valid = recipients.filter((recipient) => Expo.isExpoPushToken(recipient.token));
  const invalidTokens = recipients
    .filter((recipient) => !Expo.isExpoPushToken(recipient.token))
    .map((recipient) => recipient.token);

  if (valid.length === 0) return { sent: 0, invalidTokens };

  const messages: ExpoPushMessage[] = valid.map((recipient) => ({
    to: recipient.token,
    sound: 'default',
    title: payload.title,
    body: payload.body,
    data: payload.data ?? {},
  }));

  let sent = 0;
  const chunks = expo.chunkPushNotifications(messages);
  for (const chunk of chunks) {
    const tickets = await expo.sendPushNotificationsAsync(chunk);
    sent += tickets.filter((ticket) => ticket.status === 'ok').length;
  }

  return { sent, invalidTokens };
}
