export interface BotPersonaStats {
  gamesPlayed: number;
  wins: number;
  losses: number;
  soloWins: number;
  teamWins: number;
  winRate: number;
}

export interface BotPersona {
  id: string;
  displayName: string;
  avatarUrl: string;
  level: number;
  xp: number;
  coins: number;
  stats: BotPersonaStats;
}

export const BOT_PERSONAS: BotPersona[] = [
  {
    id: 'b0700001-0001-4000-8000-000000000001',
    displayName: 'Tariq Al-Mansoor',
    avatarUrl: 'https://cdn.trixi.com/avatars/avatar_01.png',
    level: 18,
    xp: 14200,
    coins: 8450,
    stats: { gamesPlayed: 240, wins: 144, losses: 96, soloWins: 86, teamWins: 58, winRate: 60.0 },
  },
  {
    id: 'b0700001-0002-4000-8000-000000000002',
    displayName: 'Zaid Qasim',
    avatarUrl: 'https://cdn.trixi.com/avatars/avatar_02.png',
    level: 12,
    xp: 8900,
    coins: 4320,
    stats: { gamesPlayed: 110, wins: 58, losses: 52, soloWins: 32, teamWins: 26, winRate: 52.7 },
  },
  {
    id: 'b0700001-0003-4000-8000-000000000003',
    displayName: 'Layla Al-Hashimi',
    avatarUrl: 'https://cdn.trixi.com/avatars/avatar_03.png',
    level: 21,
    xp: 18400,
    coins: 13800,
    stats: { gamesPlayed: 360, wins: 220, losses: 140, soloWins: 130, teamWins: 90, winRate: 61.1 },
  },
  {
    id: 'b0700001-0004-4000-8000-000000000004',
    displayName: 'Noor Shammas',
    avatarUrl: 'https://cdn.trixi.com/avatars/avatar_04.png',
    level: 9,
    xp: 5400,
    coins: 2750,
    stats: { gamesPlayed: 75, wins: 38, losses: 37, soloWins: 22, teamWins: 16, winRate: 50.7 },
  },
  {
    id: 'b0700001-0005-4000-8000-000000000005',
    displayName: 'Omar Farooq',
    avatarUrl: 'https://cdn.trixi.com/avatars/avatar_05.png',
    level: 15,
    xp: 11600,
    coins: 6900,
    stats: { gamesPlayed: 180, wins: 104, losses: 76, soloWins: 60, teamWins: 44, winRate: 57.8 },
  },
  {
    id: 'b0700001-0006-4000-8000-000000000006',
    displayName: 'Farhan Zaidi',
    avatarUrl: 'https://cdn.trixi.com/avatars/avatar_06.png',
    level: 7,
    xp: 3800,
    coins: 2100,
    stats: { gamesPlayed: 52, wins: 25, losses: 27, soloWins: 14, teamWins: 11, winRate: 48.1 },
  },
  {
    id: 'b0700001-0007-4000-8000-000000000007',
    displayName: 'Ahmed Haddad',
    avatarUrl: 'https://cdn.trixi.com/avatars/avatar_07.png',
    level: 22,
    xp: 19800,
    coins: 14950,
    stats: { gamesPlayed: 395, wins: 242, losses: 153, soloWins: 142, teamWins: 100, winRate: 61.3 },
  },
  {
    id: 'b0700001-0008-4000-8000-000000000008',
    displayName: 'Sara Khoury',
    avatarUrl: 'https://cdn.trixi.com/avatars/avatar_08.png',
    level: 14,
    xp: 10500,
    coins: 5800,
    stats: { gamesPlayed: 160, wins: 88, losses: 72, soloWins: 52, teamWins: 36, winRate: 55.0 },
  },
  {
    id: 'b0700001-0009-4000-8000-000000000009',
    displayName: 'Rohan Mehta',
    avatarUrl: 'https://cdn.trixi.com/avatars/avatar_09.png',
    level: 11,
    xp: 7600,
    coins: 3950,
    stats: { gamesPlayed: 98, wins: 51, losses: 47, soloWins: 30, teamWins: 21, winRate: 52.0 },
  },
  {
    id: 'b0700001-0010-4000-8000-000000000010',
    displayName: 'Maya Al-Khatib',
    avatarUrl: 'https://cdn.trixi.com/avatars/avatar_10.png',
    level: 17,
    xp: 13800,
    coins: 7800,
    stats: { gamesPlayed: 215, wins: 126, losses: 89, soloWins: 76, teamWins: 50, winRate: 58.6 },
  },
  {
    id: 'b0700001-0011-4000-8000-000000000011',
    displayName: 'Karim Boustany',
    avatarUrl: 'https://cdn.trixi.com/avatars/avatar_11.png',
    level: 16,
    xp: 12400,
    coins: 7200,
    stats: { gamesPlayed: 195, wins: 115, losses: 80, soloWins: 68, teamWins: 47, winRate: 59.0 },
  },
  {
    id: 'b0700001-0012-4000-8000-000000000012',
    displayName: 'Youssef Nader',
    avatarUrl: 'https://cdn.trixi.com/avatars/avatar_12.png',
    level: 8,
    xp: 4500,
    coins: 2400,
    stats: { gamesPlayed: 64, wins: 31, losses: 33, soloWins: 18, teamWins: 13, winRate: 48.4 },
  },
  {
    id: 'b0700001-0013-4000-8000-000000000013',
    displayName: 'Zainab Al-Majid',
    avatarUrl: 'https://cdn.trixi.com/avatars/avatar_13.png',
    level: 20,
    xp: 17200,
    coins: 12300,
    stats: { gamesPlayed: 320, wins: 192, losses: 128, soloWins: 114, teamWins: 78, winRate: 60.0 },
  },
  {
    id: 'b0700001-0014-4000-8000-000000000014',
    displayName: 'Fatima Zahra',
    avatarUrl: 'https://cdn.trixi.com/avatars/avatar_14.png',
    level: 13,
    xp: 9800,
    coins: 5100,
    stats: { gamesPlayed: 140, wins: 76, losses: 64, soloWins: 44, teamWins: 32, winRate: 54.3 },
  },
  {
    id: 'b0700001-0015-4000-8000-000000000015',
    displayName: 'Huda Al-Suwaidi',
    avatarUrl: 'https://cdn.trixi.com/avatars/avatar_15.png',
    level: 19,
    xp: 15900,
    coins: 10400,
    stats: { gamesPlayed: 280, wins: 171, losses: 109, soloWins: 102, teamWins: 69, winRate: 61.1 },
  },
  {
    id: 'b0700001-0016-4000-8000-000000000016',
    displayName: 'Ali Reza',
    avatarUrl: 'https://cdn.trixi.com/avatars/avatar_16.png',
    level: 10,
    xp: 6800,
    coins: 3400,
    stats: { gamesPlayed: 88, wins: 46, losses: 42, soloWins: 27, teamWins: 19, winRate: 52.3 },
  },
  {
    id: 'b0700001-0017-4000-8000-000000000017',
    displayName: 'Faisal Bin Hamad',
    avatarUrl: 'https://cdn.trixi.com/avatars/avatar_17.png',
    level: 15,
    xp: 11400,
    coins: 6600,
    stats: { gamesPlayed: 172, wins: 98, losses: 74, soloWins: 56, teamWins: 42, winRate: 57.0 },
  },
  {
    id: 'b0700001-0018-4000-8000-000000000018',
    displayName: 'Mariam Al-Ghamdi',
    avatarUrl: 'https://cdn.trixi.com/avatars/avatar_18.png',
    level: 6,
    xp: 3100,
    coins: 1850,
    stats: { gamesPlayed: 44, wins: 21, losses: 23, soloWins: 12, teamWins: 9, winRate: 47.7 },
  },
  {
    id: 'b0700001-0019-4000-8000-000000000019',
    displayName: 'Khalid Al-Sabah',
    avatarUrl: 'https://cdn.trixi.com/avatars/avatar_19.png',
    level: 18,
    xp: 14800,
    coins: 9200,
    stats: { gamesPlayed: 255, wins: 153, losses: 102, soloWins: 91, teamWins: 62, winRate: 60.0 },
  },
  {
    id: 'b0700001-0020-4000-8000-000000000020',
    displayName: 'Reem Othman',
    avatarUrl: 'https://cdn.trixi.com/avatars/avatar_20.png',
    level: 12,
    xp: 8600,
    coins: 4600,
    stats: { gamesPlayed: 125, wins: 67, losses: 58, soloWins: 38, teamWins: 29, winRate: 53.6 },
  },
  {
    id: 'b0700001-0021-4000-8000-000000000021',
    displayName: 'Hamza Al-Shami',
    avatarUrl: 'https://cdn.trixi.com/avatars/avatar_21.png',
    level: 5,
    xp: 2400,
    coins: 1550,
    stats: { gamesPlayed: 36, wins: 17, losses: 19, soloWins: 10, teamWins: 7, winRate: 47.2 },
  },
  {
    id: 'b0700001-0022-4000-8000-000000000022',
    displayName: 'Mona Tawfiq',
    avatarUrl: 'https://cdn.trixi.com/avatars/avatar_22.png',
    level: 14,
    xp: 10200,
    coins: 5600,
    stats: { gamesPlayed: 150, wins: 83, losses: 67, soloWins: 49, teamWins: 34, winRate: 55.3 },
  },
  {
    id: 'b0700001-0023-4000-8000-000000000023',
    displayName: 'Bilal Kassem',
    avatarUrl: 'https://cdn.trixi.com/avatars/avatar_23.png',
    level: 17,
    xp: 13400,
    coins: 7900,
    stats: { gamesPlayed: 230, wins: 135, losses: 95, soloWins: 80, teamWins: 55, winRate: 58.7 },
  },
  {
    id: 'b0700001-0024-4000-8000-000000000024',
    displayName: 'Dana Salem',
    avatarUrl: 'https://cdn.trixi.com/avatars/avatar_24.png',
    level: 11,
    xp: 7400,
    coins: 3800,
    stats: { gamesPlayed: 92, wins: 47, losses: 45, soloWins: 27, teamWins: 20, winRate: 51.1 },
  },
  {
    id: 'b0700001-0025-4000-8000-000000000025',
    displayName: 'Samer Azzam',
    avatarUrl: 'https://cdn.trixi.com/avatars/avatar_25.png',
    level: 16,
    xp: 12800,
    coins: 7400,
    stats: { gamesPlayed: 205, wins: 121, losses: 84, soloWins: 72, teamWins: 49, winRate: 59.0 },
  },
  {
    id: 'b0700001-0026-4000-8000-000000000026',
    displayName: 'Salma El-Sayed',
    avatarUrl: 'https://cdn.trixi.com/avatars/avatar_26.png',
    level: 9,
    xp: 5900,
    coins: 2900,
    stats: { gamesPlayed: 80, wins: 41, losses: 39, soloWins: 24, teamWins: 17, winRate: 51.3 },
  },
  {
    id: 'b0700001-0027-4000-8000-000000000027',
    displayName: 'Mansoor Al-Harthi',
    avatarUrl: 'https://cdn.trixi.com/avatars/avatar_27.png',
    level: 21,
    xp: 18900,
    coins: 14200,
    stats: { gamesPlayed: 375, wins: 228, losses: 147, soloWins: 135, teamWins: 93, winRate: 60.8 },
  },
  {
    id: 'b0700001-0028-4000-8000-000000000028',
    displayName: 'Yara Kattan',
    avatarUrl: 'https://cdn.trixi.com/avatars/avatar_28.png',
    level: 13,
    xp: 9200,
    coins: 4800,
    stats: { gamesPlayed: 130, wins: 70, losses: 60, soloWins: 41, teamWins: 29, winRate: 53.8 },
  },
  {
    id: 'b0700001-0029-4000-8000-000000000029',
    displayName: 'Nasser Al-Mutawa',
    avatarUrl: 'https://cdn.trixi.com/avatars/avatar_29.png',
    level: 4,
    xp: 1800,
    coins: 1350,
    stats: { gamesPlayed: 28, wins: 13, losses: 15, soloWins: 8, teamWins: 5, winRate: 46.4 },
  },
  {
    id: 'b0700001-0030-4000-8000-000000000030',
    displayName: 'Rana Barakat',
    avatarUrl: 'https://cdn.trixi.com/avatars/avatar_30.png',
    level: 15,
    xp: 11900,
    coins: 6700,
    stats: { gamesPlayed: 185, wins: 106, losses: 79, soloWins: 62, teamWins: 44, winRate: 57.3 },
  },
  {
    id: 'b0700001-0031-4000-8000-000000000031',
    displayName: 'Tamer Younes',
    avatarUrl: 'https://cdn.trixi.com/avatars/avatar_31.png',
    level: 8,
    xp: 4900,
    coins: 2600,
    stats: { gamesPlayed: 70, wins: 34, losses: 36, soloWins: 20, teamWins: 14, winRate: 48.6 },
  },
  {
    id: 'b0700001-0032-4000-8000-000000000032',
    displayName: 'Lina Al-Hassan',
    avatarUrl: 'https://cdn.trixi.com/avatars/avatar_32.png',
    level: 19,
    xp: 16500,
    coins: 11200,
    stats: { gamesPlayed: 300, wins: 183, losses: 117, soloWins: 108, teamWins: 75, winRate: 61.0 },
  },
  {
    id: 'b0700001-0033-4000-8000-000000000033',
    displayName: 'Rashid Al-Dosari',
    avatarUrl: 'https://cdn.trixi.com/avatars/avatar_33.png',
    level: 10,
    xp: 6400,
    coins: 3200,
    stats: { gamesPlayed: 85, wins: 44, losses: 41, soloWins: 26, teamWins: 18, winRate: 51.8 },
  },
  {
    id: 'b0700001-0034-4000-8000-000000000034',
    displayName: 'Dina Malhas',
    avatarUrl: 'https://cdn.trixi.com/avatars/avatar_34.png',
    level: 12,
    xp: 8200,
    coins: 4400,
    stats: { gamesPlayed: 118, wins: 62, losses: 56, soloWins: 36, teamWins: 26, winRate: 52.5 },
  },
  {
    id: 'b0700001-0035-4000-8000-000000000035',
    displayName: 'Walid Jarrah',
    avatarUrl: 'https://cdn.trixi.com/avatars/avatar_35.png',
    level: 18,
    xp: 15200,
    coins: 9700,
    stats: { gamesPlayed: 265, wins: 160, losses: 105, soloWins: 95, teamWins: 65, winRate: 60.4 },
  },
  {
    id: 'b0700001-0036-4000-8000-000000000036',
    displayName: 'Rania Al-Sharif',
    avatarUrl: 'https://cdn.trixi.com/avatars/avatar_36.png',
    level: 7,
    xp: 4100,
    coins: 2200,
    stats: { gamesPlayed: 56, wins: 27, losses: 29, soloWins: 16, teamWins: 11, winRate: 48.2 },
  },
  {
    id: 'b0700001-0037-4000-8000-000000000037',
    displayName: 'Saud Al-Otaibi',
    avatarUrl: 'https://cdn.trixi.com/avatars/avatar_37.png',
    level: 20,
    xp: 17800,
    coins: 13100,
    stats: { gamesPlayed: 340, wins: 207, losses: 133, soloWins: 122, teamWins: 85, winRate: 60.9 },
  },
  {
    id: 'b0700001-0038-4000-8000-000000000038',
    displayName: 'Malak Bishara',
    avatarUrl: 'https://cdn.trixi.com/avatars/avatar_38.png',
    level: 3,
    xp: 1400,
    coins: 1250,
    stats: { gamesPlayed: 22, wins: 11, losses: 11, soloWins: 6, teamWins: 5, winRate: 50.0 },
  },
  {
    id: 'b0700001-0039-4000-8000-000000000039',
    displayName: 'Bader Al-Enazi',
    avatarUrl: 'https://cdn.trixi.com/avatars/avatar_39.png',
    level: 16,
    xp: 12600,
    coins: 7300,
    stats: { gamesPlayed: 210, wins: 124, losses: 86, soloWins: 73, teamWins: 51, winRate: 59.0 },
  },
  {
    id: 'b0700001-0040-4000-8000-000000000040',
    displayName: 'Yasmin Ghazal',
    avatarUrl: 'https://cdn.trixi.com/avatars/avatar_40.png',
    level: 14,
    xp: 10700,
    coins: 5900,
    stats: { gamesPlayed: 165, wins: 92, losses: 73, soloWins: 54, teamWins: 38, winRate: 55.8 },
  },
  {
    id: 'b0700001-0041-4000-8000-000000000041',
    displayName: 'Fahad Al-Ruwaili',
    avatarUrl: 'https://cdn.trixi.com/avatars/avatar_41.png',
    level: 11,
    xp: 7200,
    coins: 3700,
    stats: { gamesPlayed: 95, wins: 49, losses: 46, soloWins: 29, teamWins: 20, winRate: 51.6 },
  },
  {
    id: 'b0700001-0042-4000-8000-000000000042',
    displayName: 'Nadine Sfeir',
    avatarUrl: 'https://cdn.trixi.com/avatars/avatar_42.png',
    level: 9,
    xp: 5600,
    coins: 2800,
    stats: { gamesPlayed: 78, wins: 40, losses: 38, soloWins: 23, teamWins: 17, winRate: 51.3 },
  },
  {
    id: 'b0700001-0043-4000-8000-000000000043',
    displayName: 'Ibrahim Al-Nuaimi',
    avatarUrl: 'https://cdn.trixi.com/avatars/avatar_43.png',
    level: 17,
    xp: 13600,
    coins: 8100,
    stats: { gamesPlayed: 225, wins: 132, losses: 93, soloWins: 78, teamWins: 54, winRate: 58.7 },
  },
  {
    id: 'b0700001-0044-4000-8000-000000000044',
    displayName: 'Jana Al-Kuwari',
    avatarUrl: 'https://cdn.trixi.com/avatars/avatar_44.png',
    level: 6,
    xp: 3300,
    coins: 1950,
    stats: { gamesPlayed: 48, wins: 23, losses: 25, soloWins: 13, teamWins: 10, winRate: 47.9 },
  },
  {
    id: 'b0700001-0045-4000-8000-000000000045',
    displayName: 'Kareem Mostafa',
    avatarUrl: 'https://cdn.trixi.com/avatars/avatar_45.png',
    level: 13,
    xp: 9400,
    coins: 4900,
    stats: { gamesPlayed: 135, wins: 73, losses: 62, soloWins: 43, teamWins: 30, winRate: 54.1 },
  },
];

/**
 * Returns a slice of randomly shuffled unique bot personas, guaranteeing no duplicate IDs or displayNames.
 */
export function getRandomBotPersonas(count: number, excludeIds: string[] = []): BotPersona[] {
  const excludedSet = new Set(excludeIds.map((id) => id.toLowerCase()));

  const eligible = BOT_PERSONAS.filter(
    (persona) =>
      !excludedSet.has(persona.id.toLowerCase()) &&
      !excludedSet.has(persona.displayName.toLowerCase()),
  );

  // Fisher-Yates shuffle on a copy
  const shuffled = [...eligible];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  // If not enough eligible, fall back to shuffled whole list
  if (shuffled.length < count) {
    const allShuffled = [...BOT_PERSONAS];
    for (let i = allShuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [allShuffled[i], allShuffled[j]] = [allShuffled[j], allShuffled[i]];
    }
    return allShuffled.slice(0, count);
  }

  return shuffled.slice(0, count);
}
