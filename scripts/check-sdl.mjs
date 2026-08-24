/**
 * Parse the SDL and fail loudly if it is not valid GraphQL.
 *
 * `tsc` proves `graphql/typeDefs.ts` is a valid *TypeScript string*; it says
 * nothing about what is inside it. A stray brace or a field typed against a
 * type that does not exist compiles perfectly and then 500s the whole API on
 * the first request after deploy.
 *
 * `buildSchema` is the cheapest thing that catches both: it parses the
 * document and then validates that every reference resolves. It needs no
 * database, no env and no server, which is why CI can run it in a second.
 *
 * Read as text rather than imported so this stays a plain .mjs with no
 * TypeScript loader in the chain.
 */
import { readFileSync } from "node:fs";
import { buildSchema } from "graphql";

const source = readFileSync(new URL("../graphql/typeDefs.ts", import.meta.url), "utf8");

// The file is `export const typeDefs = \`#graphql … \`;` — take the template
// literal's body. Nothing else in the file is a backtick string.
const match = source.match(/export const typeDefs = `([\s\S]*)`;?\s*$/);
if (!match) {
  console.error("check-sdl: could not find the typeDefs template literal.");
  process.exit(1);
}

try {
  const schema = buildSchema(match[1]);
  const types = Object.keys(schema.getTypeMap()).filter((n) => !n.startsWith("__"));
  console.log(`SDL ok — ${types.length} types.`);
} catch (error) {
  console.error("SDL is not valid:\n" + (error instanceof Error ? error.message : error));
  process.exit(1);
}
