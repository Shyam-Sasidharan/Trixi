import { forwardRef, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { GameGateway } from '../game-room/game.gateway.js';
import { GameRoomService, ActiveGameRoom } from '../game-room/services/game-room.service.js';
import { BotBrainService } from './bot-brain.service.js';
import { ALL_CONTRACTS, ContractType } from '../game-engine/types/contract.types.js';
import { TrixContract } from '../game-engine/contracts/trix.contract.js';
import { TrickEngine } from '../game-engine/trick-engine.js';

@Injectable()
export class BotActionService {
  private readonly logger = new Logger(BotActionService.name);
  private gateway?: GameGateway;
  private pendingActionTimers: Map<string, NodeJS.Timeout[]> = new Map();
  private testMode: boolean = false;

  constructor(
    private readonly botBrainService: BotBrainService,
    @Inject(forwardRef(() => GameRoomService))
    private readonly gameRoomService: GameRoomService,
    @Optional()
    @Inject(forwardRef(() => GameGateway))
    gateway?: GameGateway,
  ) {
    this.gateway = gateway;
  }

  public setGateway(gateway: GameGateway): void {
    this.gateway = gateway;
  }

  public setTestMode(enabled: boolean): void {
    this.testMode = enabled;
  }

  /**
   * Evaluates the current state of a room and triggers bot actions if it is a bot's turn.
   */
  public evaluateAndTrigger(room: ActiveGameRoom): void {
    if (!room || room.status !== 'IN_PROGRESS' || !room.engine) {
      return;
    }

    const state = room.engine.getState();

    // Clear previous pending actions for this room to prevent duplicate turns
    this.cancelPendingActions(room.roomId);

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
      if (this.gateway) {
        this.gateway.executeSelectContract(room.roomId, ownerSeat, chosenContracts);
      }
    }, delay);

    this.registerTimer(room.roomId, timer);
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
          const delay = this.testMode
            ? 0
            : Math.floor(2000 + Math.random() * 3000); // 2.0s - 5.0s

          this.logger.log(
            `Bot ${player.displayName} (Seat ${s}) doubling ${card.rank} of ${card.suit} in ${delay}ms`,
          );

          const timer = setTimeout(() => {
            if (this.gateway) {
              this.gateway.executeDeclareDouble(room.roomId, s, card);
            }
          }, delay);

          this.registerTimer(room.roomId, timer);
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

    const chosenCard = this.botBrainService.decideCardToPlay(
      hand,
      state,
      currentSeat,
    );

    // Calculate human jitter delay
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

    // Fast play (forced follow-suit or single legal card): 1200ms – 2200ms
    // Normal play (decision-making): 2500ms – 4200ms
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
      if (this.gateway) {
        this.gateway.executePlayCard(room.roomId, currentSeat, chosenCard);
      }
    }, delay);

    this.registerTimer(room.roomId, timer);
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
        if (this.gateway) {
          // If remaining cards drop to exactly 1 after this move, schedule "one_card_announcement"
          if (hand.length === 2) {
            this.scheduleOneCardAnnouncement(room.roomId, currentSeat, player.displayName);
          }

          this.gateway.executePlayCard(room.roomId, currentSeat, chosenCard);
        }
      }, delay);

      this.registerTimer(room.roomId, timer);
    } else {
      // Must pass turn
      const delay = this.testMode ? 0 : Math.floor(1200 + Math.random() * 1000);

      this.logger.log(
        `Bot ${player.displayName} (Seat ${currentSeat}) passing Trix turn in ${delay}ms`,
      );

      const timer = setTimeout(() => {
        if (this.gateway) {
          this.gateway.executePassTrix(room.roomId, currentSeat);
        }
      }, delay);

      this.registerTimer(room.roomId, timer);
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
    const timer = setTimeout(() => {
      if (this.gateway && this.gateway.server) {
        this.gateway.server.to(roomId).emit('one_card_announcement', {
          roomId,
          seat,
          displayName,
          remainingCards: 1,
        });
      }
    }, delay);

    this.registerTimer(roomId, timer);
  }

  /**
   * Cancels any pending setTimeout actions for a room.
   */
  public cancelPendingActions(roomId: string): void {
    const timers = this.pendingActionTimers.get(roomId);
    if (timers) {
      for (const t of timers) {
        clearTimeout(t);
      }
      this.pendingActionTimers.delete(roomId);
    }
  }

  private registerTimer(roomId: string, timer: NodeJS.Timeout): void {
    if (!this.pendingActionTimers.has(roomId)) {
      this.pendingActionTimers.set(roomId, []);
    }
    this.pendingActionTimers.get(roomId)!.push(timer);
  }
}
