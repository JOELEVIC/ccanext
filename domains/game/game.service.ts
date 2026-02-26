import type { PrismaClient } from "@prisma/client";
import { GameStatus, GameResult } from "@prisma/client";
import { GameRepository } from "./game.repository";
import type { CreateGameDTO, MakeMoveDTO, GameFilters } from "./game.types";
import {
  ValidationError,
  NotFoundError,
  AuthorizationError,
} from "@/utils/types";
import { UserService } from "../user/user.service";

export class GameService {
  private gameRepository: GameRepository;
  private userService: UserService;

  constructor(prisma: PrismaClient) {
    this.gameRepository = new GameRepository(prisma);
    this.userService = new UserService(prisma);
  }

  async createGame(data: CreateGameDTO) {
    const white = await this.userService.getUserById(data.whiteId);
    const black = await this.userService.getUserById(data.blackId);

    if (!white || !black) throw new ValidationError("Invalid player IDs");
    if (data.whiteId === data.blackId)
      throw new ValidationError("Players cannot play against themselves");

    const timeControlRegex = /^\d+\+\d+$/;
    if (!timeControlRegex.test(data.timeControl))
      throw new ValidationError(
        'Invalid time control format. Use format: "minutes+increment"'
      );

    return this.gameRepository.create(data);
  }

  async getGameById(id: string) {
    const game = await this.gameRepository.findById(id);
    if (!game) throw new NotFoundError("Game not found");
    return game;
  }

  async getGames(filters?: GameFilters) {
    return this.gameRepository.findMany(filters);
  }

  async getUserGames(userId: string, status?: GameStatus) {
    return this.gameRepository.findUserGames(userId, status);
  }

  async getActiveGames() {
    return this.gameRepository.findActiveGames();
  }

  async makeMove(data: MakeMoveDTO) {
    const game = await this.getGameById(data.gameId);

    if (game.status !== GameStatus.ACTIVE && game.status !== GameStatus.PENDING)
      throw new ValidationError("Game is not active");

    const moves = game.moves ? game.moves.split(" ").filter(Boolean) : [];
    const isWhiteTurn = moves.length % 2 === 0;

    if (isWhiteTurn && data.userId !== game.whiteId)
      throw new AuthorizationError("Not white's turn");
    if (!isWhiteTurn && data.userId !== game.blackId)
      throw new AuthorizationError("Not black's turn");

    const updatedMoves = game.moves ? `${game.moves} ${data.move}` : data.move;
    const newStatus =
      game.status === GameStatus.PENDING ? GameStatus.ACTIVE : game.status;

    return this.gameRepository.update(data.gameId, {
      moves: updatedMoves,
      status: newStatus,
    });
  }

  async resignGame(gameId: string, userId: string) {
    const game = await this.getGameById(gameId);

    if (game.status !== GameStatus.ACTIVE && game.status !== GameStatus.PENDING)
      throw new ValidationError("Game is not active");

    if (userId !== game.whiteId && userId !== game.blackId)
      throw new AuthorizationError("Only players can resign");

    const result =
      userId === game.whiteId ? GameResult.BLACK_WIN : GameResult.WHITE_WIN;

    const updatedGame = await this.gameRepository.update(gameId, {
      status: GameStatus.COMPLETED,
      result,
    });

    await this.updateRatingsAfterGame(updatedGame);

    return updatedGame;
  }

  async endGame(gameId: string, result: GameResult) {
    const game = await this.getGameById(gameId);

    if (game.status !== GameStatus.ACTIVE)
      throw new ValidationError("Game is not active");

    const updatedGame = await this.gameRepository.update(gameId, {
      status: GameStatus.COMPLETED,
      result,
    });

    await this.updateRatingsAfterGame(updatedGame);

    return updatedGame;
  }

  private async updateRatingsAfterGame(game: {
    result: GameResult | null;
    whiteId: string;
    blackId: string;
    white: { rating: number };
    black: { rating: number };
  }) {
    if (!game.result) return;

    const whiteScore =
      game.result === GameResult.WHITE_WIN
        ? 1
        : game.result === GameResult.DRAW
          ? 0.5
          : 0;
    const blackScore =
      game.result === GameResult.BLACK_WIN
        ? 1
        : game.result === GameResult.DRAW
          ? 0.5
          : 0;

    const whiteNewRating = this.userService.calculateEloRating(
      game.white.rating,
      game.black.rating,
      whiteScore
    );
    const blackNewRating = this.userService.calculateEloRating(
      game.black.rating,
      game.white.rating,
      blackScore
    );

    await Promise.all([
      this.userService.updateUserRating(game.whiteId, whiteNewRating),
      this.userService.updateUserRating(game.blackId, blackNewRating),
    ]);
  }
}
