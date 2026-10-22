export interface RoundScoreBreakdown {
  queens: number;
  kingOfHearts: number;
  diamonds: number;
  hands: number;
  trix: number;
  doublingBonus: number;
  doublingPenalty: number;
  total: number;
}

export type ScoreSheet = Record<number, number>;
export type DetailedScoreSheet = Record<number, RoundScoreBreakdown>;
