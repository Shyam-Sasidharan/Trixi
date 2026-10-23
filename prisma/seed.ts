import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding Trix database with test players...');

  const passwordHash = await bcrypt.hash('password123', 10);

  const testPlayers = [
    { email: 'player1@trix.com', displayName: 'TrixMaster', level: 5, coins: 2500, xp: 850 },
    { email: 'player2@trix.com', displayName: 'CardShark', level: 3, coins: 1500, xp: 400 },
    { email: 'player3@trix.com', displayName: 'QueenSlayer', level: 4, coins: 1800, xp: 620 },
    { email: 'player4@trix.com', displayName: 'TrixLegend', level: 6, coins: 3200, xp: 1200 },
  ];

  for (const p of testPlayers) {
    const existing = await prisma.user.findUnique({ where: { email: p.email } });
    if (!existing) {
      await prisma.user.create({
        data: {
          email: p.email,
          passwordHash,
          displayName: p.displayName,
          level: p.level,
          coins: p.coins,
          xp: p.xp,
          settings: {
            create: {
              appTheme: 'DARK',
              cardTheme: 'CLASSIC',
              tableTheme: 'GREEN_FELT',
              soundEnabled: true,
              musicEnabled: true,
            },
          },
          stats: {
            create: {
              gamesPlayed: 10,
              wins: 7,
              losses: 3,
              soloWins: 4,
              teamWins: 3,
              totalQueensCaptured: 8,
              totalHeartsCaptured: 3,
              trixFirstPlaceCount: 3,
            },
          },
        },
      });
      console.log(` -> Created player: ${p.displayName} (${p.email})`);
    } else {
      console.log(` -> Player already exists: ${p.email}`);
    }
  }

  console.log('✅ Seeding complete! Password for all players: password123');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
