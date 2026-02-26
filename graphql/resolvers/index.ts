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

export const resolvers = {
  DateTime: dateTimeScalar,
  Query: {
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
