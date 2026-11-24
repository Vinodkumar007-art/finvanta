export const MAX_CHAT_MESSAGE_LENGTH = 4000;

export function sanitizeChatMessage(value: string): string | null {
  const content = value
    .normalize("NFC")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/[<>]/g, "")
    .trim();
  return content.length > 0 && content.length <= MAX_CHAT_MESSAGE_LENGTH ? content : null;
}

export function parseChatCursor(cursor: string): { createdAt: Date; id: string } | null {
  const [timestamp, id, ...extra] = cursor.split("~");
  if (!timestamp || !id || extra.length || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return null;
  const createdAt = new Date(timestamp);
  return Number.isNaN(createdAt.getTime()) ? null : { createdAt, id };
}

export function encodeChatCursor(createdAt: Date, id: string): string {
  return `${createdAt.toISOString()}~${id}`;
}
