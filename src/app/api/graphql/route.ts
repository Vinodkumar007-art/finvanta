import { createSchema, createYoga, type Plugin } from "graphql-yoga";
import { getCtx } from "@/lib/ctx";
import { json, sameOrigin } from "@/lib/http";
import { createLoaders, type GraphQLContext } from "@/server/graphql/context";
import { resolvers, makeQueryComplexityRule, makeQueryDepthRule } from "@/server/graphql/resolvers";
import { typeDefs } from "@/server/graphql/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const queryLimits: Plugin<GraphQLContext> = {
  onValidate({ addValidationRule }) {
    addValidationRule(makeQueryDepthRule());
    addValidationRule(makeQueryComplexityRule());
  },
};

const yoga = createYoga({
  schema: createSchema<GraphQLContext>({ typeDefs, resolvers }),
  graphqlEndpoint: "/api/graphql",
  landingPage: false,
  graphiql: process.env.NODE_ENV !== "production",
  maskedErrors: true,
  plugins: [queryLimits],
  context: async (): Promise<GraphQLContext> => ({
    app: await getCtx(),
    loaders: createLoaders(),
  }),
});

export async function GET(request: Request) {
  return yoga.handle({ request });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ errors: [{ message: "Cross-origin request blocked." }] }, 403);
  return yoga.handle({ request });
}
