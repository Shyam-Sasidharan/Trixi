import { Injectable, Logger } from '@nestjs/common';

export interface TimerTickEvent {
  roomId: string;
  remainingSeconds: number;
  phase: string;
  seat?: number;
  deadlineTimestamp: number;
  turnId?: number;
}

interface ActiveTimer {
  interval: NodeJS.Timeout;
  remainingSeconds: number;
  phase: string;
  seat?: number;
  deadlineTimestamp: number;
  turnId?: number;
}

@Injectable()
export class RoomTimerService {
  private readonly logger = new Logger(RoomTimerService.name);
  private timers: Map<string, ActiveTimer> = new Map();

  /**
   * Starts or replaces a turn countdown timer for a specific room and seat using authoritative epoch timestamps.
   */
  public startTurnTimer(
    roomId: string,
    seat: number,
    durationSeconds: number,
    onTick: (event: TimerTickEvent) => void,
    onTimeout: (roomId: string, seat: number) => void,
    turnId?: number,
  ): number {
    this.stopTimer(roomId);

    const deadlineTimestamp = Date.now() + durationSeconds * 1000;
    let expired = false;

    // Initial tick
    onTick({
      roomId,
      remainingSeconds: durationSeconds,
      phase: 'TURN',
      seat,
      deadlineTimestamp,
      turnId,
    });

    const interval = setInterval(() => {
      const now = Date.now();
      const remainingSeconds = Math.max(0, Math.ceil((deadlineTimestamp - now) / 1000));

      if (now >= deadlineTimestamp || remainingSeconds <= 0) {
        if (!expired) {
          expired = true;
          this.stopTimer(roomId);
          try {
            onTimeout(roomId, seat);
          } catch (err: any) {
            this.logger.error(
              `Error in turn timeout callback for room ${roomId}: ${err.message}`,
              err.stack,
            );
          }
        }
      } else {
        const timerObj = this.timers.get(roomId);
        if (timerObj) {
          timerObj.remainingSeconds = remainingSeconds;
        }
        onTick({
          roomId,
          remainingSeconds,
          phase: 'TURN',
          seat,
          deadlineTimestamp,
          turnId,
        });
      }
    }, 1000);

    this.timers.set(roomId, {
      interval,
      remainingSeconds: durationSeconds,
      phase: 'TURN',
      seat,
      deadlineTimestamp,
      turnId,
    });

    return deadlineTimestamp;
  }

  /**
   * Starts an authoritative doubling phase timer (default 8 seconds).
   */
  public startDoublingTimer(
    roomId: string,
    durationSeconds: number,
    onTick: (event: TimerTickEvent) => void,
    onTimeout: (roomId: string) => void,
  ): number {
    this.stopTimer(roomId);

    const deadlineTimestamp = Date.now() + durationSeconds * 1000;
    let expired = false;

    onTick({
      roomId,
      remainingSeconds: durationSeconds,
      phase: 'DOUBLING',
      deadlineTimestamp,
    });

    const interval = setInterval(() => {
      const now = Date.now();
      const remainingSeconds = Math.max(0, Math.ceil((deadlineTimestamp - now) / 1000));

      if (now >= deadlineTimestamp || remainingSeconds <= 0) {
        if (!expired) {
          expired = true;
          this.stopTimer(roomId);
          try {
            onTimeout(roomId);
          } catch (err: any) {
            this.logger.error(
              `Error in doubling timeout callback for room ${roomId}: ${err.message}`,
              err.stack,
            );
          }
        }
      } else {
        const timerObj = this.timers.get(roomId);
        if (timerObj) {
          timerObj.remainingSeconds = remainingSeconds;
        }
        onTick({
          roomId,
          remainingSeconds,
          phase: 'DOUBLING',
          deadlineTimestamp,
        });
      }
    }, 1000);

    this.timers.set(roomId, {
      interval,
      remainingSeconds: durationSeconds,
      phase: 'DOUBLING',
      deadlineTimestamp,
    });

    return deadlineTimestamp;
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
    if (!timer) return null;
    const now = Date.now();
    return Math.max(0, Math.ceil((timer.deadlineTimestamp - now) / 1000));
  }

  /**
   * Gets active deadline timestamp if timer is running.
   */
  public getDeadlineTimestamp(roomId: string): number | null {
    const timer = this.timers.get(roomId);
    return timer ? timer.deadlineTimestamp : null;
  }

  /**
   * Cleans up all active intervals (e.g. on module destroy or test tear-down).
   */
  public stopAllTimers(): void {
    for (const [, timer] of this.timers.entries()) {
      clearInterval(timer.interval);
    }
    this.timers.clear();
  }
}
