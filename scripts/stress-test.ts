import { io, Socket } from 'socket.io-client';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

interface BotClient {
  id: string;
  email: string;
  displayName: string;
  token?: string;
  socket?: Socket;
  seat?: number;
  myHand?: any[];
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function registerOrLogin(email: string, displayName: string): Promise<string> {
  const password = 'StressPassword123!';

  // Attempt registration
  try {
    const regRes = await fetch(`${BASE_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, displayName }),
    });

    if (regRes.ok) {
      const data = await regRes.json();
      return data.tokens?.accessToken || data.accessToken;
    }
  } catch (err: any) {
    console.warn(`Registration attempt failed for ${email}: ${err.message}`);
  }

  // Fallback to login
  const loginRes = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!loginRes.ok) {
    const errText = await loginRes.text();
    throw new Error(`Login failed for ${email}: ${errText}`);
  }

  const data = await loginRes.json();
  return data.tokens?.accessToken || data.accessToken;
}

async function runStressTest() {
  console.log('===============================================================');
  console.log('   TRIXI MULTIPLAYER LOAD SIMULATOR & ANTI-CHEAT AUDITOR       ');
  console.log('===============================================================');
  console.log(`Target Backend: ${BASE_URL}`);

  const runId = Math.floor(Math.random() * 10000);
  const bots: BotClient[] = [
    { id: '1', email: `bot1_${runId}@stress.trix`, displayName: `StressBot_1_${runId}` },
    { id: '2', email: `bot2_${runId}@stress.trix`, displayName: `StressBot_2_${runId}` },
    { id: '3', email: `bot3_${runId}@stress.trix`, displayName: `StressBot_3_${runId}` },
    { id: '4', email: `bot4_${runId}@stress.trix`, displayName: `StressBot_4_${runId}` },
  ];

  console.log('\n[Phase 1] Authenticating 4 Concurrent Player Accounts...');
  for (const bot of bots) {
    bot.token = await registerOrLogin(bot.email, bot.displayName);
    console.log(` -> Authenticated: ${bot.displayName} (JWT: ${bot.token.slice(0, 16)}...)`);
  }

  console.log('\n[Phase 2] Establishing WebSocket Sockets with JWT Handshakes...');
  const latestStates: Record<number, any> = {};

  for (const bot of bots) {
    bot.socket = io(BASE_URL, {
      auth: { token: bot.token },
      transports: ['websocket'],
    });

    bot.socket.on('game_state', (state: any) => {
      const seat = state.mySeat;
      latestStates[seat] = state;
      bot.seat = seat;
      bot.myHand = state.myHand;
    });

    await new Promise<void>((resolve, reject) => {
      bot.socket!.on('connect', () => {
        console.log(` -> Socket Connected: ${bot.displayName} [SocketID: ${bot.socket!.id}]`);
        resolve();
      });
      bot.socket!.on('connect_error', (err) => reject(err));
    });
  }

  console.log('\n[Phase 3] Player 1 Creating Private Room (SOLO, TurnTime: 10s)...');
  const host = bots[0];

  const roomResponse = await new Promise<any>((resolve) => {
    host.socket!.emit(
      'create_room',
      {
        name: `Stress Arena ${runId}`,
        gameMode: 'SOLO',
        kingdomType: 'FREE_MERCY',
        turnTime: 10,
        isPrivate: true,
      },
      (res: any) => resolve(res),
    );
  });

  const { roomId, roomCode } = roomResponse;
  console.log(` -> Room Created: [ID: ${roomId}, Code: ${roomCode}]`);
  host.seat = 0;

  console.log('\n[Phase 4] Players 2, 3, and 4 Joining Room...');
  let playersReadyCount = 0;
  const matchStartedPromise = new Promise<void>((resolve) => {
    for (const bot of bots) {
      bot.socket!.on('match_started', () => {
        playersReadyCount++;
        if (playersReadyCount === 4) resolve();
      });
    }
  });

  for (let i = 1; i < bots.length; i++) {
    const bot = bots[i];
    const joinRes = await new Promise<any>((resolve) => {
      bot.socket!.emit('join_room', { roomIdOrCode: roomCode }, (res: any) => resolve(res));
    });
    bot.seat = joinRes.seat;
    console.log(` -> ${bot.displayName} joined Seat ${bot.seat}`);
  }

  await matchStartedPromise;
  console.log(' -> All 4 players joined! Match automatically started by server.');

  console.log('\n[Phase 5] Verifying Anti-Cheat Zero-Trust Card Sanitization...');

  // Wait for initial game_state to be broadcasted
  await sleep(600);

  let antiCheatPassed = true;
  for (const bot of bots) {
    const state = latestStates[bot.seat!];
    if (!state) {
      throw new Error(`Bot at seat ${bot.seat} did not receive game_state`);
    }

    // 1. Verify player received their 13 cards
    if (state.myHand.length !== 13) {
      console.error(`❌ Seat ${bot.seat} did not receive 13 cards. Count: ${state.myHand.length}`);
      antiCheatPassed = false;
    }

    // 2. Verify all opponents have cards completely stripped
    for (const opp of state.opponents) {
      if ((opp as any).cards || (opp as any).hand) {
        console.error(`❌ SECURITY LEAK: Opponent Seat ${opp.seat} has exposed card array to Seat ${bot.seat}!`);
        antiCheatPassed = false;
      }
      if (opp.remainingCardCount !== 13) {
        console.error(`❌ Expected opponent ${opp.seat} remainingCardCount to be 13, got ${opp.remainingCardCount}`);
        antiCheatPassed = false;
      }
    }
  }

  if (antiCheatPassed) {
    console.log(' -> [PASSED] Anti-Cheat Zero-Trust Verification: 100% of opponents hidden cards stripped across all 4 seats.');
  } else {
    throw new Error('Anti-Cheat verification failed!');
  }

  console.log('\n[Phase 6] Kingdom Owner Selecting Contract [HANDS]...');
  const ownerSeat = latestStates[0].kingdomOwnerSeat;
  const ownerBot = bots.find((b) => b.seat === ownerSeat)!;
  console.log(` -> Active Kingdom Owner is ${ownerBot.displayName} (Seat ${ownerSeat})`);

  const selectRes = await new Promise<any>((resolve) => {
    ownerBot.socket!.emit(
      'select_contract',
      { roomId, contracts: ['HANDS'] },
      (res: any) => resolve(res),
    );
  });
  console.log(` -> Contract chosen: HANDS (Phase: ${selectRes.phase})`);

  await sleep(500);

  console.log('\n[Phase 7] Executing Automated 4-Card Trick Play...');
  const trickCompletedPromise = new Promise<any>((resolve) => {
    for (const bot of bots) {
      bot.socket!.on('trick_completed', (data: any) => {
        resolve(data);
      });
    }
  });

  // Automated play loop for the trick
  for (let cardCount = 0; cardCount < 4; cardCount++) {
    const currentState = latestStates[0];
    const currentTurnSeat = currentState.currentTurnSeat;
    const turnBot = bots.find((b) => b.seat === currentTurnSeat)!;
    const botState = latestStates[turnBot.seat!];

    // Pick legal card in hand (follow suit if current trick has lead card)
    let cardToPlay = botState.myHand[0];
    if (currentState.currentTrick && currentState.currentTrick.length > 0) {
      const leadSuit = currentState.currentTrick[0].card.suit;
      const followingCard = botState.myHand.find((c: any) => c.suit === leadSuit);
      if (followingCard) {
        cardToPlay = followingCard;
      }
    }
    console.log(` -> Turn: Seat ${currentTurnSeat} (${turnBot.displayName}) playing ${cardToPlay.rank} of ${cardToPlay.suit}`);

    const playRes = await new Promise<any>((resolve) => {
      turnBot.socket!.emit(
        'play_card',
        { roomId, card: cardToPlay, turnId: currentState.turnId, actionId: `action-${cardCount}-${runId}` },
        (res: any) => resolve(res),
      );
    });

    if (!playRes.success) {
      console.error(`Play failed: ${playRes.message}`);
      throw new Error(`Card play rejected for seat ${currentTurnSeat}`);
    }

    await sleep(400);
  }

  const trickResult = await trickCompletedPromise;
  console.log(` -> Trick 1 Complete! Winner: Seat ${trickResult.trickWinnerSeat ?? trickResult.winnerSeat}`);

  console.log('\n[Phase 8] Teardown & Graceful Socket Cleanup...');
  for (const bot of bots) {
    bot.socket!.disconnect();
  }

  console.log('\n===============================================================');
  console.log('   STRESS & LOAD TEST SUMMARY: SUCCESS (ALL ASSERTIONS PASSED) ');
  console.log('   - 4 Concurrent Bot Handshakes:   OK                          ');
  console.log('   - Matchmaking & Seating:        OK                          ');
  console.log('   - Zero-Trust Card Masking:      VERIFIED (ZERO LEAKS)       ');
  console.log('   - Contract & Trick Engine:      OK                          ');
  console.log('===============================================================\n');
}

runStressTest().catch((err) => {
  console.error('\n❌ STRESS TEST FAILED:', err);
  process.exit(1);
});
