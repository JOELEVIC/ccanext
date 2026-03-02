import { GraphQLScalarType, Kind } from "graphql";
import { userResolvers } from "./user.resolvers";
import { gameResolvers } from "./game.resolvers";
import { tournamentResolvers } from "./tournament.resolvers";
import { learningResolvers } from "./learning.resolvers";
import { schoolResolvers } from "./school.resolvers";

const dateTimeScalar = new GraphQLScalarType({
  name: "DateTime",
  description: "DateTime custom scalar type",
  serialize(value: unknown) {
    if (value instanceof Date) return value.toISOString();
    return value;
  },
  parseValue(value: unknown) {
    return new Date(value as string);
  },
  parseLiteral(ast) {
    if (ast.kind === Kind.STRING) return new Date(ast.value);
    return null;
  },
});

function redactDbUrl(url: string): string {
  try {
    return url.replace(/^([^:]+:\/\/[^:]+):([^@]+)@/, "$1:***@");
  } catch {
    return "[invalid]";
  }
}

function debugDbResolver() {
  const url = process.env.DATABASE_URL ?? "";
  let host = "";
  let user = "";
  try {
    const match = url.match(/^postgresql:\/\/([^:]+):[^@]+@([^/]+)/);
    if (match) {
      user = match[1];
      host = match[2];
    }
  } catch {
    // ignore
  }
  return {
    databaseUrlRedacted: url ? redactDbUrl(url) : "(not set)",
    host: host || "(parse failed)",
    user: user || "(parse failed)",
    isPooler: host.includes("pooler.supabase.com"),
    vercel: !!process.env.VERCEL,
  };
}

export const resolvers = {
  DateTime: dateTimeScalar,
  Query: {
    debugDb: debugDbResolver,
    ...userResolvers.Query,
    ...gameResolvers.Query,
    ...tournamentResolvers.Query,
    ...learningResolvers.Query,
    ...schoolResolvers.Query,
  },
  Mutation: {
    ...userResolvers.Mutation,
    ...gameResolvers.Mutation,
    ...tournamentResolvers.Mutation,
    ...learningResolvers.Mutation,
    ...schoolResolvers.Mutation,
  },
  User: userResolvers.User,
  Profile: userResolvers.Profile,
  Game: gameResolvers.Game,
  Tournament: tournamentResolvers.Tournament,
  TournamentParticipant: tournamentResolvers.TournamentParticipant,
  School: schoolResolvers.School,
};
