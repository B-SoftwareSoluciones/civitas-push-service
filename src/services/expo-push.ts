import { Expo, type ExpoPushMessage } from 'expo-server-sdk';

import { config } from '../config';

export const expo = new Expo(
  config.expoAccessToken ? { accessToken: config.expoAccessToken } : {},
);

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  priority?: 'default' | 'normal' | 'high';
  channelId?: string;
}

export interface PushRecipient {
  deviceId: string;
  token: string;
}

export interface PushResult {
  sent: number;
  invalidTokens: string[];
  error?: string;
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
    ...(payload.priority ? { priority: payload.priority } : {}),
    ...(payload.channelId ? { channelId: payload.channelId } : {}),
  }));

  let sent = 0;
  const chunks = expo.chunkPushNotifications(messages);
  try {
    for (const chunk of chunks) {
      const tickets = await expo.sendPushNotificationsAsync(chunk);
      sent += tickets.filter((ticket) => ticket.status === 'ok').length;
    }
  } catch (error) {
    const code = (error as { code?: string }).code;
    const message = error instanceof Error ? error.message : String(error);
    console.error('[expo-push] fallo al enviar push:', code ?? message);
    return {
      sent,
      invalidTokens,
      error: code === 'AUTHENTICATION_ERROR' ? 'invalid_expo_access_token' : 'push_upstream_error',
    };
  }

  return { sent, invalidTokens };
}
