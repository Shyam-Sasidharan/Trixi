import { Injectable, Logger, Optional } from '@nestjs/common';
import type { GameGateway } from '../game-room/game.gateway.js';
import { GameRoomService, type ActiveGameRoom } from '../game-room/services/game-room.service.js';
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

  private getRoom(roomId: string, fallbackRoom: ActiveGameRoom): ActiveGameRoom {
    if (this.gameRoomService) {
      return this.gameRoomService.getRoom(roomId) ?? fallbackRoom;
    }
    if (this.gateway?.gameRoomService) {
      return this.gateway.gameRoomService.getRoom(roomId) ?? fallbackRoom;
    }
    return fallbackRoom;
  }

  private getRoomService(): GameRoomService | undefined {
    return this.gameRoomService || this.gateway?.gameRoomService;
  }

  /**
   * Evaluates the current state of a room and triggers bot actions if it is a bot's turn.
   */
  public evaluateAndTrigger(room: ActiveGameRoom): void {
    if (!room || room.status !== 'IN_PROGRESS' || !room.engine) {
      return;
    }

    const state = room.engine.getState();

    // Clean up stale timers from previous phases or completed turns
    this.cleanStaleTimersForRoom(room.roomId, state.currentPhase, room.turnId);

    switch (state.currentPhase) {
      case 'KINGDOM_SELECTION':
        this.handleKingdomSelectionPhase(room);
        break;

      case 'DOUBLING_PHASE':
        this.handleDoublingPhase(room);
        break;

      case 'TRICK_PLAY':
        this.handleTrickPlayPhase(room);
        break;

      case 'TRIX_PLAY':
        this.handleTrixPlayPhase(room);
        break;

      default:
        break;
    }
  }

  /**
   * Handles contract selection when Kingdom Owner is a bot.
   */
  private handleKingdomSelectionPhase(room: ActiveGameRoom): void {
    if (!room.engine) return;
    const kingdom = room.engine.getActiveKingdom();
    const ownerSeat = kingdom.ownerSeat;
    const player = room.players[ownerSeat];

    if (!player || !player.isBot) {
      return;
    }

    const actionKey = `${room.roomId}:selection:${ownerSeat}`;
    if (this.pendingActionTimers.has(actionKey)) {
      return;
    }

    const state = room.engine.getState();
    const hand = state.hands[ownerSeat] || [];
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
      : Math.floor(1500 + Math.random() * 1500); // 1.5s - 3.0s

    this.logger.log(
      `Bot ${player.displayName} (Seat ${ownerSeat}) selecting contracts [${chosenContracts.join(', ')}] in ${delay}ms`,
    );

    const timer = setTimeout(() => {
      this.pendingActionTimers.delete(actionKey);
      if (!this.gateway) return;

      const latestRoom = this.getRoom(room.roomId, room);
      if (!latestRoom || !latestRoom.engine || latestRoom.status !== 'IN_PROGRESS') return;
      if (latestRoom.engine.getState().currentPhase !== 'KINGDOM_SELECTION') return;

      const res = this.gateway.executeSelectContract(room.roomId, ownerSeat, chosenContracts);
      if (res && !res.success) {
        this.logger.warn(
          `Bot contract selection failed: ${res.message}. Falling back to first available contract...`,
        );
        if (available.length > 0) {
          this.gateway.executeSelectContract(room.roomId, ownerSeat, [available[0]]);
        }
      }
    }, delay);

    this.pendingActionTimers.set(actionKey, timer);
  }

  /**
   * Handles doubling declarations for any bot holding eligible Queens or K♥.
   */
  private handleDoublingPhase(room: ActiveGameRoom): void {
    if (!room.engine) return;
    const state = room.engine.getState();

    for (let s = 0; s < 4; s++) {
      const player = room.players[s];
      if (!player || !player.isBot) continue;

      const hand = state.hands[s] || [];
      const cardsToDouble = this.botBrainService.decideDoubling(
        hand,
        state.activeContracts,
      );

      if (cardsToDouble.length > 0) {
        for (const card of cardsToDouble) {
          const actionKey = `${room.roomId}:double:${s}:${card.suit}_${card.rank}`;
          if (this.pendingActionTimers.has(actionKey)) {
            continue;
          }

          const delay = this.testMode
            ? 0
            : Math.floor(2000 + Math.random() * 3000); // 2.0s - 5.0s

          this.logger.log(
            `Bot ${player.displayName} (Seat ${s}) doubling ${card.rank} of ${card.suit} in ${delay}ms`,
          );

          const timer = setTimeout(() => {
            this.pendingActionTimers.delete(actionKey);
            if (!this.gateway) return;

            const latestRoom = this.getRoom(room.roomId, room);
            if (!latestRoom || !latestRoom.engine || latestRoom.status !== 'IN_PROGRESS') return;
            if (latestRoom.engine.getState().currentPhase !== 'DOUBLING_PHASE') return;

            const res = this.gateway.executeDeclareDouble(room.roomId, s, card);
            if (res && !res.success) {
              this.logger.warn(`Bot ${player.displayName} (Seat ${s}) declare double failed: ${res.message}`);
            }
          }, delay);

          this.pendingActionTimers.set(actionKey, timer);
        }
      }
    }
  }

  /**
   * Handles trick play when the current turn seat is a bot.
   */
  private handleTrickPlayPhase(room: ActiveGameRoom): void {
    if (!room.engine) return;
    const state = room.engine.getState();
    const currentSeat = state.currentTurnSeat;
    const player = room.players[currentSeat];

    if (!player || !player.isBot) {
      return;
    }

    const hand = state.hands[currentSeat] || [];
    if (hand.length === 0) return;

    const actionKey = `${room.roomId}:trick:${currentSeat}:${room.turnId}`;
    if (this.pendingActionTimers.has(actionKey)) {
      return;
    }

    const chosenCard = this.botBrainService.decideCardToPlay(
      hand,
      state,
      currentSeat,
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
        ? Math.floor(1200 + Math.random() * 1000)
        : Math.floor(2500 + Math.random() * 1700);

    this.logger.log(
      `Bot ${player.displayName} (Seat ${currentSeat}) playing trick card ${chosenCard.rank}${chosenCard.suit} in ${delay}ms`,
    );

    const timer = setTimeout(() => {
      this.pendingActionTimers.delete(actionKey);
      if (!this.gateway) return;

      const latestRoom = this.getRoom(room.roomId, room);
      if (!latestRoom || !latestRoom.engine || latestRoom.status !== 'IN_PROGRESS') return;
      const latestState = latestRoom.engine.getState();
      if (latestState.currentPhase !== 'TRICK_PLAY' || latestState.currentTurnSeat !== currentSeat) {
        return;
      }

      const res = this.gateway.executePlayCard(room.roomId, currentSeat, chosenCard);

      if (res && !res.success) {
        this.logger.warn(
          `Bot ${player.displayName} (Seat ${currentSeat}) executePlayCard failed with code ${res.code}: ${res.message}.`,
        );

        if (res.code === 'ACTION_IN_PROGRESS') {
          const retryTimer = setTimeout(() => {
            this.pendingActionTimers.delete(actionKey);
            if (!this.gateway) return;
            const retryRes = this.gateway.executePlayCard(room.roomId, currentSeat, chosenCard);
            if (retryRes && !retryRes.success) {
              this.fallbackPlay(latestRoom, currentSeat, player.displayName);
            }
          }, 100);
          this.pendingActionTimers.set(actionKey, retryTimer);
          return;
        }

        this.fallbackPlay(latestRoom, currentSeat, player.displayName);
      }
    }, delay);

    this.pendingActionTimers.set(actionKey, timer);
  }

  /**
   * Handles Trix card play or pass when the current turn seat is a bot.
   */
  private handleTrixPlayPhase(room: ActiveGameRoom): void {
    if (!room.engine) return;
    const state = room.engine.getState();
    const currentSeat = state.currentTurnSeat;
    const player = room.players[currentSeat];

    if (!player || !player.isBot) {
      return;
    }

    const hand = state.hands[currentSeat] || [];
    const actionKey = `${room.roomId}:trix:${currentSeat}:${room.turnId}`;
    if (this.pendingActionTimers.has(actionKey)) {
      return;
    }

    const playable = TrixContract.getPlayableCards(hand, state.trixColumns);

    if (playable.length > 0) {
      const chosenCard = this.botBrainService.decideCardToPlay(
        hand,
        state,
        currentSeat,
      );

      const isFast = playable.length === 1;
      const delay = this.testMode
        ? 0
        : isFast
          ? Math.floor(1200 + Math.random() * 1000)
          : Math.floor(2500 + Math.random() * 1700);

      this.logger.log(
        `Bot ${player.displayName} (Seat ${currentSeat}) playing Trix card ${chosenCard.rank}${chosenCard.suit} in ${delay}ms`,
      );

      const timer = setTimeout(() => {
        this.pendingActionTimers.delete(actionKey);
        if (!this.gateway) return;

        const latestRoom = this.getRoom(room.roomId, room);
        if (!latestRoom || !latestRoom.engine || latestRoom.status !== 'IN_PROGRESS') return;
        const latestState = latestRoom.engine.getState();
        if (latestState.currentPhase !== 'TRIX_PLAY' || latestState.currentTurnSeat !== currentSeat) {
          return;
        }

        if (hand.length === 2) {
          this.scheduleOneCardAnnouncement(room.roomId, currentSeat, player.displayName);
        }

        const res = this.gateway.executePlayCard(room.roomId, currentSeat, chosenCard);

        if (res && !res.success) {
          this.logger.warn(
            `Bot ${player.displayName} (Seat ${currentSeat}) Trix play failed: ${res.message}. Attempting fallback...`,
          );
          if (res.code === 'ACTION_IN_PROGRESS') {
            const retryTimer = setTimeout(() => {
              this.pendingActionTimers.delete(actionKey);
              if (!this.gateway) return;
              const retryRes = this.gateway.executePlayCard(room.roomId, currentSeat, chosenCard);
              if (retryRes && !retryRes.success) {
                this.fallbackTrix(latestRoom, currentSeat, player.displayName);
              }
            }, 100);
            this.pendingActionTimers.set(actionKey, retryTimer);
            return;
          }
          this.fallbackTrix(latestRoom, currentSeat, player.displayName);
        }
      }, delay);

      this.pendingActionTimers.set(actionKey, timer);
    } else {
      // Must pass turn
      const delay = this.testMode ? 0 : Math.floor(1200 + Math.random() * 1000);

      this.logger.log(
        `Bot ${player.displayName} (Seat ${currentSeat}) passing Trix turn in ${delay}ms`,
      );

      const timer = setTimeout(() => {
        this.pendingActionTimers.delete(actionKey);
        if (!this.gateway) return;

        const latestRoom = this.getRoom(room.roomId, room);
        if (!latestRoom || !latestRoom.engine || latestRoom.status !== 'IN_PROGRESS') return;
        const latestState = latestRoom.engine.getState();
        if (latestState.currentPhase !== 'TRIX_PLAY' || latestState.currentTurnSeat !== currentSeat) {
          return;
        }

        const res = this.gateway.executePassTrix(room.roomId, currentSeat);
        if (res && !res.success) {
          this.logger.error(`Bot ${player.displayName} (Seat ${currentSeat}) Trix pass failed: ${res.message}`);
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
