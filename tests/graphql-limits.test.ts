import { buildASTSchema, parse, validate } from "graphql";
import { describe, expect, it } from "vitest";
import { makeQueryComplexityRule, makeQueryDepthRule } from "../src/server/graphql/resolvers";
import { typeDefs } from "../src/server/graphql/schema";

const schema = buildASTSchema(typeDefs);

describe("GraphQL query guards", () => {
  it("rejects deeply nested association traversal", () => {
    const document = parse(`
      {
        posts {
          edges {
            node {
              author {
                posts {
                  author {
                    posts {
                      author {
                        posts {
                          author {
                            posts { id }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `);

    const errors = validate(schema, document, [makeQueryDepthRule()]);
    expect(errors[0]?.extensions.code).toBe("QUERY_DEPTH_LIMIT");
  });

  it("rejects batches of expensive list fields", () => {
    const selections = Array.from({ length: 60 }, (_, index) =>
      `post${index}: posts(first: 50) { edges { node { id } } }`,
    ).join("\n");
    const errors = validate(schema, parse(`{ ${selections} }`), [makeQueryComplexityRule()]);

    expect(errors[0]?.extensions.code).toBe("QUERY_COMPLEXITY_LIMIT");
  });
});
