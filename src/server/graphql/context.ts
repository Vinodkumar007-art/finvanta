import DataLoader from "dataloader";
import { and, inArray, isNull, sql } from "drizzle-orm";
import type { Ctx } from "@/lib/ctx";
import { db } from "@/db";
import { blogComments, blogPosts, users } from "@/db/schema";

export type UserRow = Pick<Ctx["user"], "id" | "name" | "email">;
export type PostRow = typeof blogPosts.$inferSelect;
export type CommentRow = typeof blogComments.$inferSelect;
export type CommentLoadKey = { postId: string; first: number };
export type UserPostsLoadKey = { userId: string; first: number };

export interface GraphQLContext {
  app: Ctx | null;
  loaders: {
    userById: DataLoader<string, UserRow | null>;
    postById: DataLoader<string, PostRow | null>;
    commentsByPost: DataLoader<CommentLoadKey, CommentRow[], string>;
    postsByAuthor: DataLoader<UserPostsLoadKey, PostRow[], string>;
  };
}

export function createLoaders(): GraphQLContext["loaders"] {
  const userById = new DataLoader<string, UserRow | null>(async (ids) => {
    const uniqueIds = [...new Set(ids)];
    const rows = await db.select({
      id: users.id,
      name: users.name,
      email: users.email,
    }).from(users).where(and(inArray(users.id, uniqueIds), isNull(users.deletedAt)));
    const byId = new Map(rows.map((row) => [row.id, row]));
    return ids.map((id) => byId.get(id) ?? null);
  });

  const postById = new DataLoader<string, PostRow | null>(async (ids) => {
    const rows = await db.select().from(blogPosts).where(and(
      inArray(blogPosts.id, [...new Set(ids)]),
      isNull(blogPosts.deletedAt),
    ));
    const byId = new Map(rows.map((row) => [row.id, row]));
    return ids.map((id) => byId.get(id) ?? null);
  });

  const commentsByPost = new DataLoader<CommentLoadKey, CommentRow[], string>(async (keys) => {
    const ids = [...new Set(keys.map((key) => key.postId))];
    const maxFirst = Math.max(...keys.map((key) => key.first));
    const placeholders = sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
    const result = await db.execute<CommentRow & { postId: string }>(sql`
      SELECT id, post_id AS "postId", author_id AS "authorId", body,
             created_at AS "createdAt", deleted_at AS "deletedAt"
      FROM (
        SELECT id, post_id, author_id, body, created_at, deleted_at,
               row_number() OVER (PARTITION BY post_id ORDER BY created_at DESC, id DESC) AS row_num
        FROM blog_comments
        WHERE post_id IN (${placeholders}) AND deleted_at IS NULL
      ) ranked
      WHERE row_num <= ${maxFirst}
      ORDER BY "postId", "createdAt" DESC, id DESC
    `);
    const byPostId = new Map<string, CommentRow[]>();
    for (const row of result.rows) {
      const current = byPostId.get(row.postId) ?? [];
      current.push({
        id: row.id,
        postId: row.postId,
        authorId: row.authorId,
        body: row.body,
        createdAt: row.createdAt,
        deletedAt: row.deletedAt,
      });
      byPostId.set(row.postId, current);
    }
    return keys.map((key) => (byPostId.get(key.postId) ?? []).slice(0, key.first));
  }, { cacheKeyFn: (key) => `${key.postId}:${key.first}` });

  const postsByAuthor = new DataLoader<UserPostsLoadKey, PostRow[], string>(async (keys) => {
    const authorIds = [...new Set(keys.map((key) => key.userId))];
    const maxFirst = Math.max(...keys.map((key) => key.first));
    const placeholders = sql.join(authorIds.map((id) => sql`${id}::uuid`), sql`, `);
    const result = await db.execute<PostRow>(sql`
      SELECT id, author_id AS "authorId", title, body, created_at AS "createdAt",
             updated_at AS "updatedAt", deleted_at AS "deletedAt"
      FROM (
        SELECT id, author_id, title, body, created_at, updated_at, deleted_at,
               row_number() OVER (PARTITION BY author_id ORDER BY created_at DESC, id DESC) AS row_num
        FROM blog_posts
        WHERE author_id IN (${placeholders}) AND deleted_at IS NULL
      ) ranked
      WHERE row_num <= ${maxFirst}
      ORDER BY "authorId", "createdAt" DESC, id DESC
    `);
    const rows = result.rows;
    const byAuthor = new Map<string, PostRow[]>();
    for (const row of rows) {
      const current = byAuthor.get(row.authorId) ?? [];
      current.push(row);
      byAuthor.set(row.authorId, current);
    }
    return keys.map((key) => (byAuthor.get(key.userId) ?? []).slice(0, key.first));
  }, { cacheKeyFn: (key) => `${key.userId}:${key.first}` });

  return { userById, postById, commentsByPost, postsByAuthor };
}
