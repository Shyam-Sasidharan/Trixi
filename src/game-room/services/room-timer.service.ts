import { Injectable, Logger } from '@nestjs/common';

export interface TimerTickEvent {
  roomId: string;
  remainingSeconds: number;
  phase: string;
  seat?: number;
}

interface ActiveTimer {
  interval: NodeJS.Timeout;
  remainingSeconds: number;
  phase: string;
  seat?: number;
}

@Injectable()
export class RoomTimerService {
  private readonly logger = new Logger(RoomTimerService.name);
  private timers: Map<string, ActiveTimer> = new Map();

  /**
   * Starts or replaces a turn countdown timer for a specific room and seat.
   */
  public startTurnTimer(
    roomId: string,
    seat: number,
    durationSeconds: number,
    onTick: (event: TimerTickEvent) => void,
    onTimeout: (roomId: string, seat: number) => void,
  ): void {
    this.stopTimer(roomId);

    let remaining = durationSeconds;
    // Initial tick
    onTick({
      roomId,
      remainingSeconds: remaining,
      phase: 'TURN',
      seat,
    });

    const interval = setInterval(() => {
      remaining -= 1;

      if (remaining <= 0) {
        this.stopTimer(roomId);
        try {
          onTimeout(roomId, seat);
        } catch (err: any) {
          this.logger.error(`Error in turn timeout callback for room ${roomId}: ${err.message}`, err.stack);
        }
      } else {
        onTick({
          roomId,
          remainingSeconds: remaining,
          phase: 'TURN',
          seat,
        });
      }
    }, 1000);

    this.timers.set(roomId, {
      interval,
      remainingSeconds: remaining,
      phase: 'TURN',
      seat,
    });
  }

  /**
   * Starts a doubling phase timer (default 8 seconds).
   */
  public startDoublingTimer(
    roomId: string,
    durationSeconds: number,
    onTick: (event: TimerTickEvent) => void,
    onTimeout: (roomId: string) => void,
  ): void {
    this.stopTimer(roomId);

    let remaining = durationSeconds;
    onTick({
      roomId,
      remainingSeconds: remaining,
      phase: 'DOUBLING',
    });

    const interval = setInterval(() => {
      remaining -= 1;

      if (remaining <= 0) {
        this.stopTimer(roomId);
        try {
          onTimeout(roomId);
        } catch (err: any) {
          this.logger.error(`Error in doubling timeout callback for room ${roomId}: ${err.message}`, err.stack);
        }
      } else {
        onTick({
          roomId,
          remainingSeconds: remaining,
          phase: 'DOUBLING',
        });
      }
    }, 1000);

    this.timers.set(roomId, {
      interval,
      remainingSeconds: remaining,
      phase: 'DOUBLING',
    });
  }

  /**
   * Stops any running timer for the room.
   */
  public stopTimer(roomId: string): void {
    const timer = this.timers.get(roomId);
    if (timer) {
      clearInterval(timer.interval);
      this.timers.delete(roomId);
    }
  }

  /**
   * Gets remaining seconds if timer is active.
   */
  public getRemainingSeconds(roomId: string): number | null {
    const timer = this.timers.get(roomId);
    return timer ? timer.remainingSeconds : null;
  }

  /**
   * Cleans up all active intervals (e.g. on module destroy or test tear-down).
   */
  public stopAllTimers(): void {
    for (const [roomId, timer] of this.timers.entries()) {
      clearInterval(timer.interval);
    }
    this.timers.clear();
  }
}
