import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { GameRoomService } from './game-room.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';

describe('GameRoomService', () => {
  let service: GameRoomService;

  beforeEach(async () => {
    const mockPrisma = {
      matchHistory: { create: () => Promise.resolve({ id: 'mock-id' }) },
      user: { update: () => Promise.resolve({}) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GameRoomService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<GameRoomService>(GameRoomService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
