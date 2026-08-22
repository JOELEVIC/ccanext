import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Vitest previously ran with no config, which was fine while every test was a
 * pure module imported by relative path. `graphql/identityGuards.test.ts`
 * executes the REAL schema — the actual typeDefs and the actual resolvers — so
 * the `@/*` alias that `tsconfig.json` declares has to resolve at runtime too.
 *
 * `include` is vitest's own default, restated so adding this file cannot quietly
 * change which tests are discovered.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
    // graphql-yoga builds the schema through @graphql-tools/schema. Without
    // this, that dependency resolves its own copy of `graphql` and the schema it
    // returns fails `instanceof GraphQLSchema` in the test's copy ("Duplicate
    // graphql modules cannot be used at the same time").
    dedupe: ["graphql"],
  },
  test: {
    include: ["**/*.{test,spec}.?(c|m)[jt]s?(x)"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**"],
    server: {
      deps: {
        // Force yoga and graphql-tools through the same module graph as the
        // test's own `import { graphql } from "graphql"`. Externalised, they
        // load graphql's CJS build while the test loads its ESM build, and the
        // schema then fails `instanceof GraphQLSchema` ("Duplicate graphql
        // modules cannot be used at the same time").
        inline: [/graphql-yoga/, /@graphql-tools/, /^graphql$/],
      },
    },
  },
});
