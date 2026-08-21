import { GraphQLScalarType, Kind } from "graphql";
import { userResolvers } from "./user.resolvers";
import { gameResolvers } from "./game.resolvers";
import { tournamentResolvers } from "./tournament.resolvers";
import { learningResolvers } from "./learning.resolvers";
import { schoolResolvers } from "./school.resolvers";
import { chessProResolvers } from "./chessPro.resolvers";
import { engineResolvers } from "./engine.resolvers";
import { challengeResolvers } from "./challenge.resolvers";
import { placementResolvers } from "./placement.resolvers";
import { adminResolvers } from "./admin.resolvers";
import { activityResolvers } from "./activity.resolvers";
import { tournamentRoundResolvers } from "./tournamentRound.resolvers";
import { clubResolvers } from "./club.resolvers";
import { seasonResolvers } from "./season.resolvers";
import { fixtureResolvers } from "./fixture.resolvers";
import { enquiryResolvers } from "./enquiry.resolvers";

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
    ...chessProResolvers.Query,
    ...engineResolvers.Query,
    ...challengeResolvers.Query,
    ...placementResolvers.Query,
    ...adminResolvers.Query,
    ...activityResolvers.Query,
    ...tournamentRoundResolvers.Query,
    ...clubResolvers.Query,
    ...seasonResolvers.Query,
    ...fixtureResolvers.Query,
    ...enquiryResolvers.Query,
  },
  Mutation: {
    ...userResolvers.Mutation,
    ...gameResolvers.Mutation,
    ...tournamentResolvers.Mutation,
    ...learningResolvers.Mutation,
    ...schoolResolvers.Mutation,
    ...challengeResolvers.Mutation,
    ...placementResolvers.Mutation,
    ...adminResolvers.Mutation,
    ...activityResolvers.Mutation,
    ...tournamentRoundResolvers.Mutation,
    ...enquiryResolvers.Mutation,
  },
  Activity: activityResolvers.Activity,
  User: userResolvers.User,
  Profile: userResolvers.Profile,
  UserVariantRating: userResolvers.UserVariantRating,
  Game: gameResolvers.Game,
  Tournament: tournamentResolvers.Tournament,
  TournamentParticipant: tournamentResolvers.TournamentParticipant,
  School: schoolResolvers.School,
  // Club / season / competition (BUILD_PLAN §6). There is deliberately no
  // `joinCode` resolver on Club, and every person these types expose is a
  // `PublicPlayer` produced by toPublicPlayer() (§4.3).
  Club: clubResolvers.Club,
  ClubHonour: clubResolvers.ClubHonour,
  Season: seasonResolvers.Season,
};
