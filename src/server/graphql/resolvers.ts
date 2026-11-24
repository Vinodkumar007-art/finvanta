import { GraphQLError, type DocumentNode, type ValidationContext } from "graphql";
import { and, desc, eq, gt, ilike, isNull, lt, or } from "drizzle-orm";
import { z } from "zod";
import { can } from "@/lib/ctx";
import { db } from "@/db";
import { blogComments, blogPosts } from "@/db/schema";
import type { Resolvers } from "@/generated/graphql";
import type { GraphQLContext, PostRow } from "./context";

const uuidSchema = z.string().uuid();
const firstSchema = z.number().int().min(1).max(50);
const commentsFirstSchema = z.number().int().min(1).max(10);
const createPostSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(20_000),
});
const updatePostSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  body: z.string().trim().min(1).max(20_000).optional(),
}).refine((value) => value.title !== undefined || value.body !== undefined, "At least one field must be provided.");
const cursorSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
});

function graphError(code: string, message: string, details?: unknown): GraphQLError {
  return new GraphQLError(message, {
    extensions: details === undefined ? { code } : { code, details },
  });
}

function validate<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message,
    }));
    throw graphError("VALIDATION_ERROR", "Input validation failed.", details);
  }
  return parsed.data;
}

function authenticated(context: GraphQLContext) {
  if (!context.app) throw graphError("UNAUTHENTICATED", "Sign in to use the blog API.");
  return context.app;
}

function encodeCursor(post: Pick<PostRow, "id" | "createdAt">): string {
  return Buffer.from(JSON.stringify({
    id: post.id,
    createdAt: post.createdAt.toISOString(),
  })).toString("base64url");
}

async function decodeCursor(value: string | null | undefined, titleFilter?: string) {
  if (!value) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw graphError("INVALID_CURSOR", "The pagination cursor is invalid.");
  }
  const parsed = cursorSchema.safeParse(decoded);
  if (!parsed.success) throw graphError("INVALID_CURSOR", "The pagination cursor is invalid.");

  const escapedTitle = titleFilter?.replace(/[\\%_]/g, "\\$&");
  const [record] = await db.select({
    id: blogPosts.id,
    createdAt: blogPosts.createdAt,
  }).from(blogPosts).where(and(
    eq(blogPosts.id, parsed.data.id),
    isNull(blogPosts.deletedAt),
    escapedTitle ? ilike(blogPosts.title, `%${escapedTitle}%`) : undefined,
  )).limit(1);
  if (!record || record.createdAt.toISOString() !== parsed.data.createdAt) {
    throw graphError("INVALID_CURSOR", "The pagination cursor is stale or no longer matches this result set.");
  }
  return record;
}

async function loadPostConnection(firstInput: number | null | undefined, after: string | null | undefined, title?: string) {
  const first = validate(firstSchema, firstInput ?? 20);
  const normalizedTitle = title === undefined
    ? undefined
    : validate(z.string().trim().min(1).max(200), title);
  const titleFilter = normalizedTitle === undefined
    ? undefined
    : `%${normalizedTitle.replace(/[\\%_]/g, "\\$&")}%`;
  const cursor = await decodeCursor(after, normalizedTitle);
  const baseCondition = isNull(blogPosts.deletedAt);
  const conditions = [
    baseCondition,
    titleFilter ? ilike(blogPosts.title, titleFilter) : undefined,
    cursor ? or(
      lt(blogPosts.createdAt, cursor.createdAt),
      and(eq(blogPosts.createdAt, cursor.createdAt), lt(blogPosts.id, cursor.id)),
    ) : undefined,
  ];
  const rows = await db.select().from(blogPosts)
    .where(and(...conditions))
    .orderBy(desc(blogPosts.createdAt), desc(blogPosts.id))
    .limit(first + 1);
  const hasNextPage = rows.length > first;
  const pageRows = rows.slice(0, first);
  let hasPreviousPage = false;
  if (cursor) {
    const [previous] = await db.select({ id: blogPosts.id }).from(blogPosts).where(and(
      baseCondition,
      titleFilter ? ilike(blogPosts.title, titleFilter) : undefined,
      or(
        gt(blogPosts.createdAt, cursor.createdAt),
        and(eq(blogPosts.createdAt, cursor.createdAt), gt(blogPosts.id, cursor.id)),
      ),
    )).limit(1);
    hasPreviousPage = Boolean(previous);
  }
  const edges = pageRows.map((node) => ({ node, cursor: encodeCursor(node) }));
  return {
    edges,
    pageInfo: {
      hasNextPage,
      hasPreviousPage,
      startCursor: edges[0]?.cursor ?? null,
      endCursor: edges.at(-1)?.cursor ?? null,
    },
  };
}

function assertCanMutate(context: GraphQLContext, authorId: string) {
  const app = authenticated(context);
  if (app.user.id !== authorId && !can(app.role, "admin")) {
    throw graphError("FORBIDDEN", "Only the post author or an administrator may change this post.");
  }
  return app;
}

export const resolvers: Resolvers<GraphQLContext> = {
  Query: {
    posts: (_parent, { first, after }, context) => {
      authenticated(context);
      return loadPostConnection(first, after);
    },
    searchPosts: (_parent, { title, first, after }, context) => {
      authenticated(context);
      return loadPostConnection(first, after, title);
    },
    post: async (_parent, { id }, context) => {
      authenticated(context);
      const postId = validate(uuidSchema, id);
      const [post] = await db.select().from(blogPosts).where(and(
        eq(blogPosts.id, postId),
        isNull(blogPosts.deletedAt),
      )).limit(1);
      return post ?? null;
    },
  },
  Mutation: {
    createPost: async (_parent, { input }, context) => {
      const app = authenticated(context);
      const data = validate(createPostSchema, input);
      const [post] = await db.insert(blogPosts).values({
        authorId: app.user.id,
        title: data.title,
        body: data.body,
      }).returning();
      return post;
    },
    updatePost: async (_parent, { id, input }, context) => {
      const app = authenticated(context);
      const postId = validate(uuidSchema, id);
      const data = validate(updatePostSchema, input);
      return db.transaction(async (tx) => {
        const [existing] = await tx.select().from(blogPosts).where(and(
          eq(blogPosts.id, postId),
          isNull(blogPosts.deletedAt),
        )).for("update").limit(1);
        if (!existing) throw graphError("NOT_FOUND", "Post not found.");
        assertCanMutate(context, existing.authorId);
        const [updated] = await tx.update(blogPosts).set({
          ...data,
          updatedAt: new Date(),
        }).where(eq(blogPosts.id, existing.id)).returning();
        if (!updated) throw graphError("NOT_FOUND", "Post not found.");
        return updated;
      });
    },
    deletePost: async (_parent, { id }, context) => {
      authenticated(context);
      const postId = validate(uuidSchema, id);
      return db.transaction(async (tx) => {
        const [existing] = await tx.select().from(blogPosts).where(and(
          eq(blogPosts.id, postId),
          isNull(blogPosts.deletedAt),
        )).for("update").limit(1);
        if (!existing) throw graphError("NOT_FOUND", "Post not found.");
        assertCanMutate(context, existing.authorId);
        const deletedAt = new Date();
        await tx.update(blogComments).set({ deletedAt }).where(and(
          eq(blogComments.postId, existing.id),
          isNull(blogComments.deletedAt),
        ));
        await tx.update(blogPosts).set({ deletedAt, updatedAt: deletedAt })
          .where(eq(blogPosts.id, existing.id));
        return true;
      });
    },
  },
  User: {
    posts: (parent, { first }, context) => {
      authenticated(context);
      return context.loaders.postsByAuthor.load({
        userId: parent.id,
        first: validate(firstSchema, first ?? 10),
      });
    },
  },
  Post: {
    author: async (parent, _args, context) => {
      authenticated(context);
      const user = await context.loaders.userById.load(parent.authorId);
      if (!user) throw graphError("NOT_FOUND", "Post author not found.");
      return user;
    },
    comments: (parent, { first }, context) => {
      authenticated(context);
      return context.loaders.commentsByPost.load({
        postId: parent.id,
        first: validate(commentsFirstSchema, first ?? 10),
      });
    },
    createdAt: (parent) => parent.createdAt.toISOString(),
    updatedAt: (parent) => parent.updatedAt.toISOString(),
  },
  Comment: {
    author: async (parent, _args, context) => {
      authenticated(context);
      const user = await context.loaders.userById.load(parent.authorId);
      if (!user) throw graphError("NOT_FOUND", "Comment author not found.");
      return user;
    },
    post: async (parent, _args, context) => {
      authenticated(context);
      const post = await context.loaders.postById.load(parent.postId);
      if (!post) throw graphError("NOT_FOUND", "Comment post not found.");
      return post;
    },
    createdAt: (parent) => parent.createdAt.toISOString(),
  },
};

export const MAX_QUERY_DEPTH = 8;
export const MAX_QUERY_COMPLEXITY = 5_000;

export function makeQueryDepthRule() {
  return (context: ValidationContext) => {
    const fragments = new Map(
      context.getDocument().definitions
        .filter((definition): definition is import("graphql").FragmentDefinitionNode => definition.kind === "FragmentDefinition")
        .map((definition) => [definition.name.value, definition]),
    );
    const calculateDepth = (
      selectionSet: import("graphql").SelectionSetNode,
      depth: number,
      activeFragments: Set<string>,
    ): number => {
      let maxDepth = depth;
      for (const selection of selectionSet.selections) {
        if (selection.kind === "Field") {
          const nextDepth = selection.selectionSet ? depth + 1 : depth;
          maxDepth = Math.max(maxDepth, nextDepth);
          if (nextDepth > MAX_QUERY_DEPTH) continue;
          if (selection.selectionSet) {
            maxDepth = Math.max(maxDepth, calculateDepth(selection.selectionSet, nextDepth, activeFragments));
          }
        } else if (selection.kind === "InlineFragment") {
          maxDepth = Math.max(maxDepth, calculateDepth(selection.selectionSet, depth, activeFragments));
        } else {
          const name = selection.name.value;
          const fragment = fragments.get(name);
          if (fragment && !activeFragments.has(name)) {
            const nextFragments = new Set(activeFragments);
            nextFragments.add(name);
            maxDepth = Math.max(maxDepth, calculateDepth(fragment.selectionSet, depth, nextFragments));
          }
        }
      }
      return maxDepth;
    };

    return {
      Document: (node: DocumentNode) => {
        for (const definition of node.definitions) {
          if (definition.kind !== "OperationDefinition") continue;
          if (calculateDepth(definition.selectionSet, 0, new Set()) > MAX_QUERY_DEPTH) {
            context.reportError(graphError(
              "QUERY_DEPTH_LIMIT",
              `Query depth must not exceed ${MAX_QUERY_DEPTH}.`,
              undefined,
            ));
            return;
          }
        }
      },
    };
  };
}

export function makeQueryComplexityRule() {
  return (context: ValidationContext) => {
    const fragments = new Map(
      context.getDocument().definitions
        .filter((definition): definition is import("graphql").FragmentDefinitionNode => definition.kind === "FragmentDefinition")
        .map((definition) => [definition.name.value, definition]),
    );
    const calculateCost = (
      selectionSet: import("graphql").SelectionSetNode,
      depth: number,
      activeFragments: Set<string>,
    ): number => {
      let total = 0;
      for (const selection of selectionSet.selections) {
        if (selection.kind === "Field") {
          const nextDepth = selection.selectionSet ? depth + 1 : depth;
          const childCost = selection.selectionSet && nextDepth <= MAX_QUERY_DEPTH
            ? calculateCost(selection.selectionSet, nextDepth, activeFragments)
            : 0;
          const multiplier = selection.name.value === "comments"
            ? 10
            : selection.name.value === "posts" || selection.name.value === "searchPosts"
              ? 50
              : 1;
          total += multiplier * (1 + childCost);
        } else if (selection.kind === "InlineFragment") {
          total += calculateCost(selection.selectionSet, depth, activeFragments);
        } else {
          const name = selection.name.value;
          const fragment = fragments.get(name);
          if (fragment && !activeFragments.has(name)) {
            const nextFragments = new Set(activeFragments);
            nextFragments.add(name);
            total += calculateCost(fragment.selectionSet, depth, nextFragments);
          }
        }
        if (total > MAX_QUERY_COMPLEXITY) return total;
      }
      return total;
    };

    return {
      Document: (node: DocumentNode) => {
        for (const definition of node.definitions) {
          if (definition.kind !== "OperationDefinition") continue;
          const complexity = calculateCost(definition.selectionSet, 0, new Set());
          if (complexity > MAX_QUERY_COMPLEXITY) {
            context.reportError(graphError(
              "QUERY_COMPLEXITY_LIMIT",
              `Query complexity ${complexity} exceeds the limit of ${MAX_QUERY_COMPLEXITY}.`,
            ));
            return;
          }
        }
      },
    };
  };
}

