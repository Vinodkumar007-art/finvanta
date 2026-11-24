import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import dotenv from "dotenv";
import { and, desc, eq, isNull, lt, or } from "drizzle-orm";
import { createAdapter } from "@socket.io/redis-adapter";
import { jwtVerify } from "jose";
import { createClient } from "redis";
import { Server as SocketServer, type Socket } from "socket.io";
import { encodeChatCursor, MAX_CHAT_MESSAGE_LENGTH, parseChatCursor, sanitizeChatMessage } from "../services/chat-message";

dotenv.config({ path: ".env.local" });

interface ChatMessageDto {
  id: string;
  roomId: string;
  userId: string;
  clientMessageId: string;
  content: string;
  createdAt: string;
}

interface ChatFailure {
  ok: false;
  code: string;
  error: string;
  retryAfterSeconds?: number;
}

interface ChatSuccess {
  ok: true;
}

interface HistorySuccess extends ChatSuccess {
  messages: ChatMessageDto[];
  nextCursor: string | null;
}

interface JoinSuccess extends ChatSuccess {
  messages: ChatMessageDto[];
  nextCursor: string | null;
  onlineUserIds: string[];
}

interface ClientToServerEvents {
  "room:join": (input: { roomId: string }, acknowledge: (result: JoinSuccess | ChatFailure) => void) => void;
  "room:leave": (input: { roomId: string }, acknowledge: (result: ChatSuccess | ChatFailure) => void) => void;
  "history:fetch": (input: { roomId: string; cursor?: string }, acknowledge: (result: HistorySuccess | ChatFailure) => void) => void;
  "message:send": (
    input: { roomId: string; clientMessageId: string; content: string },
    acknowledge: (result: ({ ok: true; message: ChatMessageDto; duplicate?: boolean }) | ChatFailure) => void,
  ) => void;
  "room:typing": (input: { roomId: string; typing: boolean }) => void;
}

interface ServerToClientEvents {
  "room:member-joined": (payload: { userId: string; name: string }) => void;
  "room:member-left": (payload: { userId: string }) => void;
  "room:presence": (payload: { roomId: string; onlineUserIds: string[] }) => void;
  "room:typing": (payload: { userId: string; name: string; typing: boolean }) => void;
  "message:new": (message: ChatMessageDto) => void;
}

interface InterServerEvents {}

interface ChatSocketData {
  userId: string;
  orgId: string;
  name: string;
  tokenExpiresAt: number;
  roomIds: Set<string>;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const presenceTtlMs = 45_000;
const presenceRefreshMs = 20_000;
const slidingWindowScript = `
  local now = tonumber(ARGV[1])
  local cutoff = now - 10000
  redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, cutoff)
  local count = redis.call('ZCARD', KEYS[1])
  if count >= 10 then
    local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
    return {0, tonumber(oldest[2]) + 10000 - now}
  end
  redis.call('ZADD', KEYS[1], now, ARGV[2])
  redis.call('PEXPIRE', KEYS[1], 20000)
  return {1, 0}
`;

function failure(code: string, error: string): ChatFailure {
  return { ok: false, code, error };
}

function serializeMessage(message: {
  id: string;
  roomId: string;
  userId: string;
  clientMessageId: string;
  content: string;
  createdAt: Date;
}): ChatMessageDto {
  return { ...message, createdAt: message.createdAt.toISOString() };
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  const redisUrl = process.env.REDIS_URL;
  const secret = process.env.CHAT_JWT_SECRET;
  const origin = process.env.CHAT_ORIGIN ?? process.env.APP_URL;
  if (!databaseUrl || !redisUrl || !secret || secret.length < 32 || !origin) {
    throw new Error("DATABASE_URL, REDIS_URL, CHAT_JWT_SECRET (32+ characters), and CHAT_ORIGIN are required.");
  }

  const { db, pool } = await import("../db");
  const { chatMessages, chatRoomMembers, chatRooms } = await import("../db/schema");
  const redisPub = createClient({ url: redisUrl });
  const redisSub = redisPub.duplicate();
  redisPub.on("error", (error) => console.error("[finvanta-chat] Redis publisher error", error));
  redisSub.on("error", (error) => console.error("[finvanta-chat] Redis subscriber error", error));
  await Promise.all([redisPub.connect(), redisSub.connect()]);

  const httpServer = createServer();
  const io = new SocketServer<ClientToServerEvents, ServerToClientEvents, InterServerEvents, ChatSocketData>(httpServer, {
    cors: { origin, credentials: true, methods: ["GET", "POST"] },
    maxHttpBufferSize: 16 * 1024,
    pingInterval: 25_000,
    pingTimeout: 20_000,
  });
  io.adapter(createAdapter(redisPub, redisSub));
  const jwtKey = new TextEncoder().encode(secret);

  io.use(async (socket, next) => {
    try {
      const token: unknown = socket.handshake.auth.token;
      if (typeof token !== "string") throw new Error("Missing token");
      const { payload } = await jwtVerify(token, jwtKey, { issuer: "finvanta", audience: "finvanta-chat" });
      if (typeof payload.sub !== "string" || typeof payload.orgId !== "string" || typeof payload.name !== "string" || typeof payload.exp !== "number") throw new Error("Invalid claims");
      socket.data.userId = payload.sub;
      socket.data.orgId = payload.orgId;
      socket.data.name = payload.name.slice(0, 80);
      socket.data.tokenExpiresAt = payload.exp * 1000;
      socket.data.roomIds = new Set();
      next();
    } catch {
      next(new Error("UNAUTHORIZED"));
    }
  });

  const isRoomMember = async (roomId: string, socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, ChatSocketData>) => {
    const [membership] = await db.select({ id: chatRoomMembers.id })
      .from(chatRoomMembers)
      .innerJoin(chatRooms, eq(chatRooms.id, chatRoomMembers.roomId))
      .where(and(
        eq(chatRoomMembers.roomId, roomId),
        eq(chatRoomMembers.userId, socket.data.userId),
        eq(chatRooms.orgId, socket.data.orgId),
        isNull(chatRooms.deletedAt),
      ))
      .limit(1);
    return Boolean(membership);
  };

  const currentPresence = async (roomId: string): Promise<string[]> => {
    const key = `chat:presence:${roomId}`;
    const now = Date.now();
    await redisPub.zRemRangeByScore(key, 0, now);
    const members = await redisPub.zRangeByScore(key, now + 1, "+inf");
    return [...new Set(members.map((member) => member.slice(0, member.indexOf("|"))))];
  };

  const refreshPresence = async (roomId: string, socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, ChatSocketData>) => {
    const key = `chat:presence:${roomId}`;
    const member = `${socket.data.userId}|${socket.id}`;
    await redisPub.zAdd(key, { score: Date.now() + presenceTtlMs, value: member });
    await redisPub.pExpire(key, presenceTtlMs * 2);
    io.to(roomId).emit("room:presence", { roomId, onlineUserIds: await currentPresence(roomId) });
  };

  const removePresence = async (roomId: string, socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, ChatSocketData>) => {
    const key = `chat:presence:${roomId}`;
    await redisPub.zRem(key, `${socket.data.userId}|${socket.id}`);
    const onlineUserIds = await currentPresence(roomId);
    io.to(roomId).emit("room:presence", { roomId, onlineUserIds });
    if (!onlineUserIds.length) await redisPub.del(key);
  };

  const loadHistory = async (roomId: string, cursor?: string): Promise<HistorySuccess | ChatFailure> => {
    let before: { createdAt: Date; id: string } | null = null;
    if (cursor) {
      before = parseChatCursor(cursor);
      if (!before) return failure("INVALID_CURSOR", "The history cursor is invalid.");
    }
    const filters = [eq(chatMessages.roomId, roomId)];
    if (before) filters.push(or(
      lt(chatMessages.createdAt, before.createdAt),
      and(eq(chatMessages.createdAt, before.createdAt), lt(chatMessages.id, before.id)),
    )!);
    const rows = await db.select().from(chatMessages)
      .where(and(...filters))
      .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
      .limit(51);
    const hasMore = rows.length > 50;
    const messages = rows.slice(0, 50).reverse().map(serializeMessage);
    const oldest = messages[0];
    return {
      ok: true,
      messages,
      nextCursor: hasMore && oldest ? encodeChatCursor(new Date(oldest.createdAt), oldest.id) : null,
    };
  };

  const allowMessage = async (userId: string): Promise<{ ok: true } | { ok: false; retryAfterSeconds: number }> => {
    const key = `chat:rate:${userId}`;
    const result: unknown = await redisPub.eval(slidingWindowScript, {
      keys: [key],
      arguments: [String(Date.now()), randomUUID()],
    });
    if (!Array.isArray(result)) throw new Error("Redis returned an invalid rate-limit response.");
    const allowed = Number(result[0]) === 1;
    return allowed
      ? { ok: true }
      : { ok: false, retryAfterSeconds: Math.max(1, Math.ceil(Number(result[1]) / 1000)) };
  };

  io.on("connection", (socket) => {
    const presenceInterval = setInterval(() => {
      if (Date.now() >= socket.data.tokenExpiresAt) {
        socket.disconnect(true);
        return;
      }
      for (const roomId of socket.data.roomIds) {
        void refreshPresence(roomId, socket).catch((error: unknown) => console.error("[finvanta-chat] presence refresh failed", error));
      }
    }, presenceRefreshMs);
    const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const stopTyping = (roomId: string) => {
      const timer = typingTimers.get(roomId);
      if (timer !== undefined) clearTimeout(timer);
      typingTimers.delete(roomId);
      socket.to(roomId).emit("room:typing", { userId: socket.data.userId, name: socket.data.name, typing: false });
    };

    socket.on("room:join", (input, acknowledge) => {
      void (async () => {
        if (!uuidPattern.test(input.roomId) || !(await isRoomMember(input.roomId, socket))) {
          acknowledge(failure("FORBIDDEN", "You are not a member of this room."));
          return;
        }
        await socket.join(input.roomId);
        socket.data.roomIds.add(input.roomId);
        await refreshPresence(input.roomId, socket);
        socket.to(input.roomId).emit("room:member-joined", { userId: socket.data.userId, name: socket.data.name });
        const history = await loadHistory(input.roomId);
        if (!history.ok) {
          acknowledge(history);
          return;
        }
        acknowledge({ ...history, onlineUserIds: await currentPresence(input.roomId) });
      })().catch((error: unknown) => {
        console.error("[finvanta-chat] room join failed", error);
        acknowledge(failure("UNAVAILABLE", "The room could not be joined."));
      });
    });

    socket.on("room:leave", (input, acknowledge) => {
      void (async () => {
        if (!socket.data.roomIds.has(input.roomId)) {
          acknowledge({ ok: true });
          return;
        }
        socket.data.roomIds.delete(input.roomId);
        stopTyping(input.roomId);
        await socket.leave(input.roomId);
        await removePresence(input.roomId, socket);
        socket.to(input.roomId).emit("room:member-left", { userId: socket.data.userId });
        acknowledge({ ok: true });
      })().catch((error: unknown) => {
        console.error("[finvanta-chat] room leave failed", error);
        acknowledge(failure("UNAVAILABLE", "The room could not be left."));
      });
    });

    socket.on("history:fetch", (input, acknowledge) => {
      void (async () => {
        if (!socket.data.roomIds.has(input.roomId) || !(await isRoomMember(input.roomId, socket))) {
          acknowledge(failure("FORBIDDEN", "You are not a member of this room."));
          return;
        }
        acknowledge(await loadHistory(input.roomId, input.cursor));
      })().catch((error: unknown) => {
        console.error("[finvanta-chat] history fetch failed", error);
        acknowledge(failure("UNAVAILABLE", "Message history could not be loaded."));
      });
    });

    socket.on("message:send", (input, acknowledge) => {
      void (async () => {
        if (!socket.data.roomIds.has(input.roomId) || !(await isRoomMember(input.roomId, socket))) {
          acknowledge(failure("FORBIDDEN", "You are not a member of this room."));
          return;
        }
        if (!uuidPattern.test(input.clientMessageId)) {
          acknowledge(failure("INVALID_MESSAGE_ID", "A valid client message ID is required."));
          return;
        }
        if (typeof input.content !== "string" || input.content.length > MAX_CHAT_MESSAGE_LENGTH) {
          acknowledge(failure("MESSAGE_TOO_LARGE", `Messages are limited to ${MAX_CHAT_MESSAGE_LENGTH} characters.`));
          return;
        }
        const content = sanitizeChatMessage(input.content);
        if (!content) {
          acknowledge(failure("EMPTY_MESSAGE", "Enter a message without markup or control characters."));
          return;
        }
        const allowed = await allowMessage(socket.data.userId);
        if (!allowed.ok) {
          acknowledge({
            ...failure("THROTTLED", "Message rate limit reached. Try again shortly."),
            retryAfterSeconds: allowed.retryAfterSeconds,
          });
          return;
        }

        const [inserted] = await db.insert(chatMessages).values({
          roomId: input.roomId,
          userId: socket.data.userId,
          clientMessageId: input.clientMessageId,
          content,
        }).onConflictDoNothing().returning();
        if (!inserted) {
          const [existing] = await db.select().from(chatMessages).where(and(
            eq(chatMessages.roomId, input.roomId),
            eq(chatMessages.userId, socket.data.userId),
            eq(chatMessages.clientMessageId, input.clientMessageId),
          )).limit(1);
          if (!existing) throw new Error("The message idempotency record could not be read.");
          acknowledge({ ok: true, message: serializeMessage(existing), duplicate: true });
          return;
        }

        const message = serializeMessage(inserted);
        io.to(input.roomId).emit("message:new", message);
        acknowledge({ ok: true, message });
      })().catch((error: unknown) => {
        console.error("[finvanta-chat] message send failed", error);
        acknowledge(failure("UNAVAILABLE", "The message could not be sent."));
      });
    });

    socket.on("room:typing", (input) => {
      if (!input || typeof input.roomId !== "string" || !uuidPattern.test(input.roomId) || !socket.data.roomIds.has(input.roomId) || typeof input.typing !== "boolean") return;
      const previous = typingTimers.get(input.roomId);
      if (previous !== undefined) clearTimeout(previous);
      typingTimers.delete(input.roomId);
      socket.to(input.roomId).emit("room:typing", {
        userId: socket.data.userId,
        name: socket.data.name,
        typing: input.typing,
      });
      if (input.typing) {
        typingTimers.set(input.roomId, setTimeout(() => {
          typingTimers.delete(input.roomId);
          socket.to(input.roomId).emit("room:typing", {
            userId: socket.data.userId,
            name: socket.data.name,
            typing: false,
          });
        }, 5000));
      }
    });

    socket.on("disconnect", () => {
      clearInterval(presenceInterval);
      for (const roomId of typingTimers.keys()) stopTyping(roomId);
      for (const roomId of socket.data.roomIds) {
        void removePresence(roomId, socket).then(() => {
          socket.to(roomId).emit("room:member-left", { userId: socket.data.userId });
        }).catch((error: unknown) => console.error("[finvanta-chat] disconnect cleanup failed", error));
      }
    });
  });

  const port = Number(process.env.CHAT_PORT ?? "4001");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("CHAT_PORT must be a valid TCP port.");
  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, () => {
      httpServer.off("error", reject);
      resolve();
    });
  });
  console.log(`[finvanta-chat] listening on port ${port}`);

  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    void (async () => {
      await new Promise<void>((resolve) => io.close(() => resolve()));
      await Promise.all([redisPub.quit(), redisSub.quit(), pool.end()]);
    })().catch((error: unknown) => {
      console.error("[finvanta-chat] graceful shutdown failed", error);
      process.exitCode = 1;
    });
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

void main().catch((error: unknown) => {
  console.error("[finvanta-chat] startup failed", error);
  process.exitCode = 1;
});
