import { Injectable, Logger, Optional } from '@nestjs/common';
import type { GameGateway } from '../game-room/game.gateway.js';
import { GameRoomService, type ActiveGameRoom, type ActivePlayer } from '../game-room/services/game-room.service.js';
import { BotBrainService } from './bot-brain.service.js';
import { ALL_CONTRACTS } from '../game-engine/types/contract.types.js';
import { TrixContract } from '../game-engine/contracts/trix.contract.js';
import { TrickEngine } from '../game-engine/trick-engine.js';

@Injectable()
export class BotActionService {
  private readonly logger = new Logger(BotActionService.name);
  private gateway?: GameGateway;
  // Keyed by `${roomId}:${actionType}:${seat}:${identifier}`
  private pendingActionTimers: Map<string, NodeJS.Timeout> = new Map();
  private testMode: boolean = false;

  constructor(
    private readonly botBrainService: BotBrainService,
    @Optional()
    private readonly gameRoomService?: GameRoomService,
  ) {}

  public setGateway(gateway: GameGateway): void {
    this.gateway = gateway;
  }

  public setTestMode(enabled: boolean): void {
    this.testMode = enabled;
  }

  private getRoom(roomId: string, fallbackRoom?: ActiveGameRoom): ActiveGameRoom | undefined {
    if (this.gameRoomService) {
      const r = this.gameRoomService.getRoom(roomId);
      if (r) return r;
    }
    if (this.gateway?.gameRoomService) {
      const r = this.gateway.gameRoomService.getRoom(roomId);
      if (r) return r;
    }
    return fallbackRoom;
  }

  private getRoomService(): GameRoomService | undefined {
    return this.gameRoomService || this.gateway?.gameRoomService;
  }

  /**
   * Handles an authoritative bot turn for a given room and seat.
   * Dispatches contract selection, doubling, trick card play, or trix play/pass
   * with natural human-like jitter delay.
   */
  public handleBotTurn(roomId: string, seat: number): void {
    const room = this.getRoom(roomId);
    if (!room || room.status !== 'IN_PROGRESS' || !room.engine) {
      return;
    }

    const player = room.players[seat];
    if (!player || !player.isBot) {
      return;
    }

    const state = room.engine.getState();
    this.cleanStaleTimersForRoom(room.roomId, state.currentPhase, room.turnId);

    switch (state.currentPhase) {
      case 'KINGDOM_SELECTION':
        this.executeBotKingdomSelection(room, seat, player);
        break;

      case 'DOUBLING_PHASE':
        this.executeBotDoubling(room, seat, player);
        break;

      case 'TRICK_PLAY':
        this.executeBotTrickPlay(room, seat, player);
        break;

      case 'TRIX_PLAY':
        this.executeBotTrixPlay(room, seat, player);
        break;

      default:
        break;
    }
  }

  /**
   * Evaluates the current state of a room and triggers bot actions if it is a bot's turn.
   */
  public evaluateAndTrigger(room: ActiveGameRoom): void {
    if (!room || room.status !== 'IN_PROGRESS' || !room.engine) {
      return;
    }

    const state = room.engine.getState();
    this.cleanStaleTimersForRoom(room.roomId, state.currentPhase, room.turnId);

    switch (state.currentPhase) {
      case 'KINGDOM_SELECTION': {
        const ownerSeat = room.engine.getActiveKingdom().ownerSeat;
        if (room.players[ownerSeat]?.isBot) {
          this.handleBotTurn(room.roomId, ownerSeat);
        }
        break;
      }

      case 'DOUBLING_PHASE':
        this.handleDoublingPhase(room);
        break;

      case 'TRICK_PLAY':
      case 'TRIX_PLAY': {
        const turnSeat = state.currentTurnSeat;
        if (room.players[turnSeat]?.isBot) {
          this.handleBotTurn(room.roomId, turnSeat);
        }
        break;
      }

      default:
        break;
    }
  }

  /**
   * Handles contract selection when Kingdom Owner is a bot.
   */
  private executeBotKingdomSelection(
    room: ActiveGameRoom,
    seat: number,
    player: ActivePlayer,
  ): void {
    if (!room.engine) return;
    const kingdom = room.engine.getActiveKingdom();
    if (kingdom.ownerSeat !== seat) return;

    const actionKey = `${room.roomId}:selection:${seat}`;
    if (this.pendingActionTimers.has(actionKey)) {
      return;
    }

    const state = room.engine.getState();
    const hand = state.hands[seat] || [];
    const available = ALL_CONTRACTS.filter(
      (c) => !kingdom.consumedContracts.includes(c),
    );

    const chosenContracts = this.botBrainService.chooseContract(
      available,
      room.kingdomType,
      hand,
    );

    const delay = this.testMode
      ? 0
      : Math.floor(1000 + Math.random() * 500); // 1.0s - 1.5s natural human delay

    this.logger.log(
      `Bot ${player.displayName} (Seat ${seat}) selecting contracts [${chosenContracts.join(', ')}] in ${delay}ms`,
    );

    const timer = setTimeout(() => {
      this.pendingActionTimers.delete(actionKey);
      if (!this.gateway) return;

      const latestRoom = this.getRoom(room.roomId, room);
      if (!latestRoom || !latestRoom.engine || latestRoom.status !== 'IN_PROGRESS') return;
      if (latestRoom.engine.getState().currentPhase !== 'KINGDOM_SELECTION') return;

      const res = this.gateway.executeSelectContract(room.roomId, seat, chosenContracts);
      if (res && !res.success) {
        this.logger.warn(
          `Bot contract selection failed: ${res.message}. Falling back to first available contract...`,
        );
        if (available.length > 0) {
          this.gateway.executeSelectContract(room.roomId, seat, [available[0]]);
        }
      }
    }, delay);

    this.pendingActionTimers.set(actionKey, timer);
  }

  /**
   * Handles doubling declarations for a specific bot seat.
   */
  private executeBotDoubling(
    room: ActiveGameRoom,
    seat: number,
    player: ActivePlayer,
  ): void {
    if (!room.engine) return;
    const state = room.engine.getState();
    const hand = state.hands[seat] || [];
    const cardsToDouble = this.botBrainService.decideDoubling(
      hand,
      state.activeContracts,
    );

    if (cardsToDouble.length > 0) {
      for (const card of cardsToDouble) {
        const actionKey = `${room.roomId}:double:${seat}:${card.suit}_${card.rank}`;
        if (this.pendingActionTimers.has(actionKey)) {
          continue;
        }

        const delay = this.testMode
          ? 0
          : Math.floor(2000 + Math.random() * 2500); // 2.0s - 4.5s (within 8s window)

        this.logger.log(
          `Bot ${player.displayName} (Seat ${seat}) doubling ${card.rank} of ${card.suit} in ${delay}ms`,
        );

        const timer = setTimeout(() => {
          this.pendingActionTimers.delete(actionKey);
          if (!this.gateway) return;

          const latestRoom = this.getRoom(room.roomId, room);
          if (!latestRoom || !latestRoom.engine || latestRoom.status !== 'IN_PROGRESS') return;
          if (latestRoom.engine.getState().currentPhase !== 'DOUBLING_PHASE') return;

          const res = this.gateway.executeDeclareDouble(room.roomId, seat, card);
          if (res && !res.success) {
            this.logger.warn(`Bot ${player.displayName} (Seat ${seat}) declare double failed: ${res.message}`);
          }
        }, delay);

        this.pendingActionTimers.set(actionKey, timer);
      }
    }
  }

  /**
   * Evaluates doubling declarations for all bots in the room.
   */
  public handleDoublingPhase(room: ActiveGameRoom): void {
    for (let s = 0; s < 4; s++) {
      const player = room.players[s];
      if (player && player.isBot) {
        this.executeBotDoubling(room, s, player);
      }
    }
  }

  /**
   * Handles trick play when the current turn seat is a bot.
   */
  private executeBotTrickPlay(
    room: ActiveGameRoom,
    seat: number,
    player: ActivePlayer,
  ): void {
    if (!room.engine) return;
    const state = room.engine.getState();
    if (state.currentTurnSeat !== seat) return;

    const hand = state.hands[seat] || [];
    if (hand.length === 0) return;

    const actionKey = `${room.roomId}:trick:${seat}:${room.turnId}`;
    if (this.pendingActionTimers.has(actionKey)) {
      return;
    }

    const chosenCard = this.botBrainService.pickBestCard(
      hand,
      state,
      seat,
    );

    const legalCount = hand.filter(
      (c) =>
        TrickEngine.validatePlay(
          hand,
          c,
          state.currentTrick,
          state.brokenSuits,
          state.activeContracts,
          state.kingdomType,
        ).valid,
    ).length;

    const isFast = legalCount <= 1;
    const delay = this.testMode
      ? 0
      : isFast
        ? Math.floor(800 + Math.random() * 400) // 800ms - 1200ms
        : Math.floor(1000 + Math.random() * 500); // 1000ms - 1500ms

    this.logger.log(
      `Bot ${player.displayName} (Seat ${seat}) playing trick card ${chosenCard.rank}${chosenCard.suit} in ${delay}ms`,
    );

    const timer = setTimeout(() => {
      this.pendingActionTimers.delete(actionKey);
      if (!this.gateway) return;

      const latestRoom = this.getRoom(room.roomId, room);
      if (!latestRoom || !latestRoom.engine || latestRoom.status !== 'IN_PROGRESS') return;
      const latestState = latestRoom.engine.getState();
      if (latestState.currentPhase !== 'TRICK_PLAY' || latestState.currentTurnSeat !== seat) {
        return;
      }

      const res = this.gateway.executePlayCard(room.roomId, seat, chosenCard);

      if (res && !res.success) {
        this.logger.warn(
          `Bot ${player.displayName} (Seat ${seat}) executePlayCard failed with code ${res.code}: ${res.message}.`,
        );

        if (res.code === 'ACTION_IN_PROGRESS') {
          const retryTimer = setTimeout(() => {
            this.pendingActionTimers.delete(actionKey);
            if (!this.gateway) return;
            const retryRes = this.gateway.executePlayCard(room.roomId, seat, chosenCard);
            if (retryRes && !retryRes.success) {
              this.fallbackPlay(latestRoom, seat, player.displayName);
            }
          }, 100);
          this.pendingActionTimers.set(actionKey, retryTimer);
          return;
        }

        this.fallbackPlay(latestRoom, seat, player.displayName);
      }
    }, delay);

    this.pendingActionTimers.set(actionKey, timer);
  }

  /**
   * Handles Trix card play or pass when the current turn seat is a bot.
   */
  private executeBotTrixPlay(
    room: ActiveGameRoom,
    seat: number,
    player: ActivePlayer,
  ): void {
    if (!room.engine) return;
    const state = room.engine.getState();
    if (state.currentTurnSeat !== seat) return;

    const hand = state.hands[seat] || [];
    const actionKey = `${room.roomId}:trix:${seat}:${room.turnId}`;
    if (this.pendingActionTimers.has(actionKey)) {
      return;
    }

    const playable = TrixContract.getPlayableCards(hand, state.trixColumns);

    if (playable.length > 0) {
      const chosenCard = this.botBrainService.pickBestCard(
        hand,
        state,
        seat,
      );

      const isFast = playable.length === 1;
      const delay = this.testMode
        ? 0
        : isFast
          ? Math.floor(1200 + Math.random() * 600) // 1200ms - 1800ms
          : Math.floor(1400 + Math.random() * 600); // 1400ms - 2000ms

      this.logger.log(
        `Bot ${player.displayName} (Seat ${seat}) playing Trix card ${chosenCard.rank}${chosenCard.suit} in ${delay}ms`,
      );

      const timer = setTimeout(() => {
        this.pendingActionTimers.delete(actionKey);
        if (!this.gateway) return;

        const latestRoom = this.getRoom(room.roomId, room);
        if (!latestRoom || !latestRoom.engine || latestRoom.status !== 'IN_PROGRESS') return;
        const latestState = latestRoom.engine.getState();
        if (latestState.currentPhase !== 'TRIX_PLAY' || latestState.currentTurnSeat !== seat) {
          return;
        }

        if (hand.length === 2) {
          this.scheduleOneCardAnnouncement(room.roomId, seat, player.displayName);
        }

        const res = this.gateway.executePlayCard(room.roomId, seat, chosenCard);

        if (res && !res.success) {
          this.logger.warn(
            `Bot ${player.displayName} (Seat ${seat}) Trix play failed: ${res.message}. Attempting fallback...`,
          );
          if (res.code === 'ACTION_IN_PROGRESS') {
            const retryTimer = setTimeout(() => {
              this.pendingActionTimers.delete(actionKey);
              if (!this.gateway) return;
              const retryRes = this.gateway.executePlayCard(room.roomId, seat, chosenCard);
              if (retryRes && !retryRes.success) {
                this.fallbackTrix(latestRoom, seat, player.displayName);
              }
            }, 100);
            this.pendingActionTimers.set(actionKey, retryTimer);
            return;
          }
          this.fallbackTrix(latestRoom, seat, player.displayName);
        }
      }, delay);

      this.pendingActionTimers.set(actionKey, timer);
    } else {
      // Must pass turn
      const delay = this.testMode ? 0 : Math.floor(800 + Math.random() * 400);

      this.logger.log(
        `Bot ${player.displayName} (Seat ${seat}) passing Trix turn in ${delay}ms`,
      );

      const timer = setTimeout(() => {
        this.pendingActionTimers.delete(actionKey);
        if (!this.gateway) return;

        const latestRoom = this.getRoom(room.roomId, room);
        if (!latestRoom || !latestRoom.engine || latestRoom.status !== 'IN_PROGRESS') return;
        const latestState = latestRoom.engine.getState();
        if (latestState.currentPhase !== 'TRIX_PLAY' || latestState.currentTurnSeat !== seat) {
          return;
        }

        const res = this.gateway.executePassTrix(room.roomId, seat);
        if (res && !res.success) {
          this.logger.error(`Bot ${player.displayName} (Seat ${seat}) Trix pass failed: ${res.message}`);
        }
      }, delay);

      this.pendingActionTimers.set(actionKey, timer);
    }
  }

  private fallbackPlay(room: ActiveGameRoom, seat: number, displayName: string): void {
    if (!this.gateway) return;
    const roomService = this.getRoomService();
    const fallbackCard = roomService?.getFallbackCardToPlay(room, seat);
    if (fallbackCard) {
      this.logger.log(
        `Bot ${displayName} (Seat ${seat}) executing fallback legal trick card: ${fallbackCard.rank}${fallbackCard.suit}`,
      );
      const actionId = `bot_${room.roomId}_${seat}_fallback_${Date.now()}`;
      this.gateway.executePlayCard(room.roomId, seat, fallbackCard, {
        actionId,
        isAutoPlay: true,
      });
    }
  }

  private fallbackTrix(room: ActiveGameRoom, seat: number, displayName: string): void {
    if (!this.gateway) return;
    const roomService = this.getRoomService();
    const fallbackCard = roomService?.getFallbackCardToPlay(room, seat);
    if (fallbackCard) {
      this.logger.log(
        `Bot ${displayName} (Seat ${seat}) executing fallback Trix card: ${fallbackCard.rank}${fallbackCard.suit}`,
      );
      const actionId = `bot_${room.roomId}_${seat}_fallback_${Date.now()}`;
      this.gateway.executePlayCard(room.roomId, seat, fallbackCard, {
        actionId,
        isAutoPlay: true,
      });
    } else {
      this.logger.log(`Bot ${displayName} (Seat ${seat}) falling back to pass in Trix`);
      const actionId = `bot_${room.roomId}_${seat}_fallback_pass_${Date.now()}`;
      this.gateway.executePassTrix(room.roomId, seat, { actionId });
    }
  }

  /**
   * Cleans up stale timers for a room (e.g. timers from previous phases or past turnIds).
   */
  private cleanStaleTimersForRoom(
    roomId: string,
    currentPhase: string,
    currentTurnId?: number,
  ): void {
    const prefix = `${roomId}:`;
    for (const [key, timer] of this.pendingActionTimers.entries()) {
      if (!key.startsWith(prefix)) continue;

      const parts = key.split(':');
      const actionType = parts[1];

      // If in TRICK_PLAY or TRIX_PLAY, clear any old selection or doubling timers
      if (currentPhase === 'TRICK_PLAY' || currentPhase === 'TRIX_PLAY') {
        if (actionType === 'selection' || actionType === 'double') {
          clearTimeout(timer);
          this.pendingActionTimers.delete(key);
          continue;
        }
      }

      // If actionType is trick or trix, and turnId doesn't match, clear it
      if (actionType === 'trick' || actionType === 'trix') {
        const actionTurnId = parts[3] ? parseInt(parts[3], 10) : undefined;
        if (currentTurnId !== undefined && actionTurnId !== undefined && actionTurnId !== currentTurnId) {
          clearTimeout(timer);
          this.pendingActionTimers.delete(key);
        }
      }
    }
  }

  /**
   * Emits the "one_card_announcement" event after a 1.2-second delay when a bot has 1 card left.
   */
  private scheduleOneCardAnnouncement(
    roomId: string,
    seat: number,
    displayName: string,
  ): void {
    const delay = this.testMode ? 0 : 1200;
    const actionKey = `${roomId}:one_card:${seat}`;
    const timer = setTimeout(() => {
      this.pendingActionTimers.delete(actionKey);
      if (this.gateway && this.gateway.server) {
        this.gateway.server.to(roomId).emit('one_card_announcement', {
          roomId,
          seat,
          displayName,
          remainingCards: 1,
        });
      }
    }, delay);

    this.pendingActionTimers.set(actionKey, timer);
  }

  /**
   * Cancels all pending actions for a room.
   */
  public cancelPendingActions(roomId: string): void {
    const prefix = `${roomId}:`;
    for (const [key, timer] of this.pendingActionTimers.entries()) {
      if (key.startsWith(prefix)) {
        clearTimeout(timer);
        this.pendingActionTimers.delete(key);
      }
    }
  }
}
