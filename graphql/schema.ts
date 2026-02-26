import { createSchema } from "graphql-yoga";

const typeDefs = /* GraphQL */ `
  type Query {
    hello: String!
  }

  type Mutation {
    echo(message: String!): String!
  }

  type Subscription {
    countdown(from: Int!): Int!
  }
`;

const resolvers = {
  Query: {
    hello: () => "Hello from ccanext",
  },
  Mutation: {
    echo: (_: unknown, { message }: { message: string }) => message,
  },
  Subscription: {
    countdown: {
      subscribe: async function* (_: unknown, { from }: { from: number }) {
        for (let i = from; i >= 0; i--) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          yield { countdown: i };
        }
      },
    },
  },
};

export const schema = createSchema({
  typeDefs,
  resolvers,
});
