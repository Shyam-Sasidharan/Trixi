export type ContractType =
  | 'QUEENS'
  | 'KING_OF_HEARTS'
  | 'DIAMONDS'
  | 'HANDS'
  | 'TRIX';

export type KingdomType = 'FREE_MERCY' | 'CRAZY_COMPLEX';

export type GameMode = 'SOLO' | 'TEAM';

export const NEGATIVE_CONTRACTS: readonly ContractType[] = [
  'QUEENS',
  'KING_OF_HEARTS',
  'DIAMONDS',
  'HANDS',
] as const;

export const ALL_CONTRACTS: readonly ContractType[] = [
  'QUEENS',
  'KING_OF_HEARTS',
  'DIAMONDS',
  'HANDS',
  'TRIX',
] as const;
