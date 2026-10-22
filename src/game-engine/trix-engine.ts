import { Card, Suit } from './types/card.types.js';
import {
  ALL_CONTRACTS,
  ContractType,
  GameMode,
  KingdomType,
  NEGATIVE_CONTRACTS,
} from './types/contract.types.js';
import {
  CallOffResult,
  GamePhase,
  KingdomState,
  MatchState,
  Trick,
} from './types/engine.types.js';
import {
  createDeck,
  dealCards,
  findSevenOfHeartsOwner,
  getNextSeat,
  shuffleDeck,
} from './deck.js';
import { CallOffValidator } from './call-off.validator.js';
import { DoublingManager } from './doubling.js';
import { TrickEngine } from './trick-engine.js';
import { TrixContract } from './contracts/trix.contract.js';

export class TrixEngine {
  private state: MatchState;
  private rng: () => number;

  constructor(
    gameMode: GameMode = 'SOLO',
    kingdomType: KingdomType = 'FREE_MERCY',
    rng: () => number = Math.random,
  ) {
    this.rng = rng;
    this.state = this.initializeMatch(gameMode, kingdomType);
  }

  public getState(): Readonly<MatchState> {
    return this.state;
  }

  /**
   * Initializes a full 4-Kingdom match.
   */
  private initializeMatch(gameMode: GameMode, kingdomType: KingdomType): MatchState {
    const deck = shuffleDeck(createDeck(), this.rng);
    const hands = dealCards(deck);
    const firstOwnerSeat = findSevenOfHeartsOwner(hands);

    // Build the 4 kingdoms rotating counter-clockwise (to player's right)
    const kingdoms: KingdomState[] = [];
    let currentOwner = firstOwnerSeat;
    for (let i = 1; i <= 4; i++) {
      kingdoms.push({
        ownerSeat: currentOwner,
        kingdomNumber: i,
        consumedContracts: [],
      });
      currentOwner = getNextSeat(currentOwner);
    }

    return {
      gameMode,
      kingdomType,
      currentPhase: 'KINGDOM_SELECTION',
      currentKingdomIndex: 0,
      kingdoms,
      currentTurnSeat: firstOwnerSeat,
      activeContracts: [],
      hands,
      doubledCards: [],
      currentTrick: { leadSuit: null, cards: [] },
      trickHistory: [],
      trixColumns: TrixContract.createEmptyTrixColumns(),
      trixFinishingOrder: [],
      brokenSuits: new Set<Suit>(),
      scores: { 0: 0, 1: 0, 2: 0, 3: 0 },
      roundScores: [],
    };
  }

  /**
   * Re-deals the cards for the current deal.
   */
  public redeal(): void {
    const deck = shuffleDeck(createDeck(), this.rng);
    this.state.hands = dealCards(deck);
    this.state.doubledCards = [];
    this.state.currentTrick = { leadSuit: null, cards: [] };
    this.state.trickHistory = [];
    this.state.trixColumns = TrixContract.createEmptyTrixColumns();
    this.state.trixFinishingOrder = [];
    this.state.brokenSuits = new Set<Suit>();
  }

  public getActiveKingdom(): KingdomState {
    return this.state.kingdoms[this.state.currentKingdomIndex];
  }

  /**
   * Kingdom owner selects contract(s) for the current deal.
   */
  public selectContracts(contracts: ContractType[]): CallOffResult {
    if (this.state.currentPhase !== 'KINGDOM_SELECTION') {
      throw new Error(`Cannot select contracts during phase: ${this.state.currentPhase}`);
    }

    if (contracts.length === 0) {
      throw new Error('Must select at least one contract');
    }

    const kingdom = this.getActiveKingdom();

    // Verify contracts haven't been consumed in this kingdom already
    for (const c of contracts) {
      if (kingdom.consumedContracts.includes(c)) {
        throw new Error(`Contract ${c} has already been played in this Kingdom`);
      }
    }

    // Trix rule: must be played alone
    if (contracts.includes('TRIX') && contracts.length > 1) {
      throw new Error('Trix contract must be played alone and cannot be combined with other contracts');
    }

    // Crazy Complex mode validation:
    if (this.state.kingdomType === 'CRAZY_COMPLEX') {
      if (!contracts.includes('TRIX')) {
        // Must select all 4 negative contracts combined
        const hasAllFour = NEGATIVE_CONTRACTS.every((c) => contracts.includes(c));
        if (!hasAllFour || contracts.length !== 4) {
          throw new Error('Crazy Complex mode requires either Trix alone or all 4 negative contracts combined');
        }
      }
    }

    this.state.activeContracts = [...contracts];
    this.state.currentPhase = 'CALL_OFF_CHECK';

    // Automatic pre-deal call-off check:
    const callOffResult = this.checkCallOffs();
    if (callOffResult.isCalledOff) {
      // Re-deal and return to selection phase for this owner
      this.redeal();
      this.state.activeContracts = [];
      this.state.currentPhase = 'KINGDOM_SELECTION';
      return callOffResult;
    }

    // Determine next phase:
    const hasDoubling =
      contracts.includes('QUEENS') || contracts.includes('KING_OF_HEARTS');

    if (hasDoubling) {
      this.state.currentPhase = 'DOUBLING_PHASE';
    } else if (contracts.includes('TRIX')) {
      this.state.currentPhase = 'TRIX_PLAY';
      this.state.currentTurnSeat = kingdom.ownerSeat;
    } else {
      this.state.currentPhase = 'TRICK_PLAY';
      this.state.currentTurnSeat = kingdom.ownerSeat;
    }

    return { isCalledOff: false };
  }

  /**
   * Validates pre-deal call-off conditions for active contracts.
   */
  public checkCallOffs(): CallOffResult {
    if (this.state.activeContracts.includes('KING_OF_HEARTS')) {
      const kohResult = CallOffValidator.checkKingOfHeartsCallOff(this.state.hands);
      if (kohResult.isCalledOff) {
        return kohResult;
      }
    }

    if (this.state.activeContracts.includes('TRIX')) {
      const trixResult = CallOffValidator.checkTrixCallOff(this.state.hands);
      if (trixResult.isCalledOff) {
        return trixResult;
      }
    }

    return { isCalledOff: false };
  }

  /**
   * Allows a player to double an eligible card in their hand (Queen or K♥)
   */
  public doubleCard(seat: number, card: Card): void {
    if (this.state.currentPhase !== 'DOUBLING_PHASE') {
      throw new Error(`Cannot double card during phase: ${this.state.currentPhase}`);
    }

    const hand = this.state.hands[seat];
    const canDouble = DoublingManager.canPlayerDoubleCard(
      seat,
      card,
      hand,
      this.state.activeContracts,
    );

    if (!canDouble) {
      throw new Error(`Player at seat ${seat} cannot double ${card.rank} of ${card.suit}`);
    }

    // Mark card as doubled
    const cardInHand = hand.find((c) => c.suit === card.suit && c.rank === card.rank);
    if (cardInHand) {
      cardInHand.isDoubled = true;
      cardInHand.doubledBySeat = seat;
      this.state.doubledCards.push({ ...cardInHand });
    }
  }

  /**
   * Transitions from doubling phase to trick play.
   */
  public startTrickPlay(): void {
    if (this.state.currentPhase !== 'DOUBLING_PHASE') {
      throw new Error(`Cannot start trick play from phase: ${this.state.currentPhase}`);
    }

    const kingdom = this.getActiveKingdom();
    this.state.currentPhase = 'TRICK_PLAY';
    this.state.currentTurnSeat = kingdom.ownerSeat;
  }

  /**
   * Plays a card into the current trick during TRICK_PLAY.
   */
  public playTrickCard(seat: number, card: Card): {
    trickCompleted: boolean;
    trickWinner?: number;
    contractEnded?: boolean;
    scores?: Record<number, number>;
  } {
    if (this.state.currentPhase !== 'TRICK_PLAY') {
      throw new Error(`Cannot play trick card during phase: ${this.state.currentPhase}`);
    }

    if (this.state.currentTurnSeat !== seat) {
      throw new Error(`Not seat ${seat}'s turn to play; current turn belongs to seat ${this.state.currentTurnSeat}`);
    }

    const hand = this.state.hands[seat];
    const validation = TrickEngine.validatePlay(
      hand,
      card,
      this.state.currentTrick,
      this.state.brokenSuits,
      this.state.activeContracts,
      this.state.kingdomType,
    );

    if (!validation.valid) {
      throw new Error(validation.reason || 'Illegal card play');
    }

    // Check if doubled card was played
    const isDoubled = this.state.doubledCards.find(
      (dc) => dc.suit === card.suit && dc.rank === card.rank,
    );
    const cardToPlay: Card = {
      ...card,
      isDoubled: !!isDoubled,
      doubledBySeat: isDoubled?.doubledBySeat,
    };

    // Remove card from hand
    this.state.hands[seat] = hand.filter(
      (c) => !(c.suit === card.suit && c.rank === card.rank),
    );

    // Track broken suits
    this.state.brokenSuits.add(card.suit);

    // If leading, set lead suit
    if (this.state.currentTrick.cards.length === 0) {
      this.state.currentTrick.leadSuit = card.suit;
    }

    this.state.currentTrick.cards.push({ seat, card: cardToPlay });

    // If trick is incomplete, pass turn counter-clockwise
    if (this.state.currentTrick.cards.length < 4) {
      this.state.currentTurnSeat = getNextSeat(seat);
      return { trickCompleted: false };
    }

    // Trick is complete with 4 cards!
    const { winnerSeat, winningCard } = TrickEngine.determineWinner(this.state.currentTrick);
    this.state.currentTrick.winnerSeat = winnerSeat;
    this.state.currentTrick.winningCard = winningCard;

    const completedTrick: Trick = { ...this.state.currentTrick };
    this.state.trickHistory.push({ seat: winnerSeat, trick: completedTrick });

    // Winner leads next trick
    this.state.currentTurnSeat = winnerSeat;
    this.state.currentTrick = { leadSuit: null, cards: [] };

    // Check if round finished (13 tricks completed)
    if (this.state.trickHistory.length === 13) {
      return this.finalizeNegativeContract();
    }

    return {
      trickCompleted: true,
      trickWinner: winnerSeat,
      contractEnded: false,
    };
  }

  /**
   * Finalizes score calculation for negative contracts after 13 tricks.
   */
  private finalizeNegativeContract(): {
    trickCompleted: boolean;
    contractEnded: boolean;
    scores: Record<number, number>;
  } {
    const result = TrickEngine.calculateNegativeScores(
      this.state.trickHistory,
      this.state.activeContracts,
      this.state.gameMode,
      this.state.kingdomType,
    );

    if (result.isSweepRollback) {
      // 13-Diamond Sweep triggered!
      // In Free Mercy single diamond: only diamond was zeroed.
      // Re-deal and return to selection phase for this kingdom!
      this.redeal();
      this.state.currentPhase = 'KINGDOM_SELECTION';
      return {
        trickCompleted: true,
        contractEnded: true,
        scores: result.scores,
      };
    }

    // Apply scores
    for (let s = 0; s < 4; s++) {
      this.state.scores[s] += result.scores[s];
    }
    this.state.roundScores.push(result.scores);

    // Mark active contracts as consumed
    const kingdom = this.getActiveKingdom();
    kingdom.consumedContracts.push(...this.state.activeContracts);

    this.checkKingdomOrMatchEnd();

    return {
      trickCompleted: true,
      contractEnded: true,
      scores: result.scores,
    };
  }

  /**
   * Plays a card into the Trix columns during TRIX_PLAY.
   */
  public playTrixCard(seat: number, card: Card): {
    finishedOrder: number[];
    isContractOver: boolean;
    scores?: Record<number, number>;
  } {
    if (this.state.currentPhase !== 'TRIX_PLAY') {
      throw new Error(`Cannot play Trix card during phase: ${this.state.currentPhase}`);
    }

    if (this.state.currentTurnSeat !== seat) {
      throw new Error(`Not seat ${seat}'s turn; current turn belongs to seat ${this.state.currentTurnSeat}`);
    }

    const hand = this.state.hands[seat];
    const validation = TrixContract.validatePlay(card, hand, this.state.trixColumns);
    if (!validation.valid) {
      throw new Error(validation.reason || 'Illegal Trix card play');
    }

    // Apply card to columns
    this.state.trixColumns = TrixContract.applyCardPlay(card, this.state.trixColumns);

    // Remove from hand
    this.state.hands[seat] = hand.filter(
      (c) => !(c.suit === card.suit && c.rank === card.rank),
    );

    // Check if player just emptied their hand
    if (this.state.hands[seat].length === 0) {
      if (!this.state.trixFinishingOrder.includes(seat)) {
        this.state.trixFinishingOrder.push(seat);
      }
    }

    // If 3 players have emptied their hands, the 4th is automatically placed last
    if (this.state.trixFinishingOrder.length === 3) {
      for (let s = 0; s < 4; s++) {
        if (!this.state.trixFinishingOrder.includes(s)) {
          this.state.trixFinishingOrder.push(s);
          break;
        }
      }
    }

    // Check if Trix contract has completed (all 4 seats placed)
    if (this.state.trixFinishingOrder.length === 4) {
      const trixScores = TrixContract.calculateTrixScores(this.state.trixFinishingOrder);
      for (let s = 0; s < 4; s++) {
        this.state.scores[s] += trixScores[s];
      }
      this.state.roundScores.push(trixScores);

      const kingdom = this.getActiveKingdom();
      kingdom.consumedContracts.push('TRIX');

      this.checkKingdomOrMatchEnd();

      return {
        finishedOrder: this.state.trixFinishingOrder,
        isContractOver: true,
        scores: trixScores,
      };
    }

    // Advance turn to next active player counter-clockwise
    this.advanceTrixTurn(seat);

    return {
      finishedOrder: this.state.trixFinishingOrder,
      isContractOver: false,
    };
  }

  /**
   * Passes turn in Trix (strictly validated: forbidden if playable cards exist).
   */
  public passTrixTurn(seat: number): void {
    if (this.state.currentPhase !== 'TRIX_PLAY') {
      throw new Error(`Cannot pass during phase: ${this.state.currentPhase}`);
    }

    if (this.state.currentTurnSeat !== seat) {
      throw new Error(`Not seat ${seat}'s turn`);
    }

    const hand = this.state.hands[seat];
    const passValidation = TrixContract.validatePass(hand, this.state.trixColumns);
    if (!passValidation.canPass) {
      throw new Error(passValidation.reason);
    }

    this.advanceTrixTurn(seat);
  }

  private advanceTrixTurn(currentSeat: number): void {
    let next = getNextSeat(currentSeat);
    let attempts = 0;

    // Skip players who have already finished all their cards
    while (this.state.trixFinishingOrder.includes(next) && attempts < 4) {
      next = getNextSeat(next);
      attempts++;
    }

    this.state.currentTurnSeat = next;
  }

  /**
   * Checks whether the current Kingdom or the full Match is complete.
   */
  private checkKingdomOrMatchEnd(): void {
    const kingdom = this.getActiveKingdom();

    // A kingdom is complete when all 5 contracts have been consumed
    const isKingdomComplete = ALL_CONTRACTS.every((c) =>
      kingdom.consumedContracts.includes(c),
    );

    if (isKingdomComplete) {
      if (this.state.currentKingdomIndex === 3) {
        // All 4 Kingdoms finished! Game Over!
        this.state.currentPhase = 'GAME_OVER';
      } else {
        // Advance to next Kingdom
        this.state.currentKingdomIndex += 1;
        const nextKingdom = this.getActiveKingdom();
        this.state.currentPhase = 'KINGDOM_SELECTION';
        this.state.currentTurnSeat = nextKingdom.ownerSeat;
        this.redeal();
      }
    } else {
      // Continue in current kingdom with remaining contracts
      this.state.currentPhase = 'KINGDOM_SELECTION';
      this.state.currentTurnSeat = kingdom.ownerSeat;
      this.redeal();
    }
  }
}
