import { describe, it, expect } from 'vitest';
import {
  calculateGapPlan,
  timeToMinutes,
  minutesToTime,
  minutesTo12Hour,
} from '../../src/services/roomChainingEngine.js';

describe('FreeRoom PRD v8: Room Chaining for Gaps Engine', () => {
  describe('Helper utilities', () => {
    it('converts time strings to minutes and back', () => {
      expect(timeToMinutes('00:00')).toBe(0);
      expect(timeToMinutes('01:30')).toBe(90);
      expect(timeToMinutes('13:45')).toBe(825);
      expect(timeToMinutes('22:00')).toBe(1320);

      expect(minutesToTime(825)).toBe('13:45');
      expect(minutesToTime(1320)).toBe('22:00');

      expect(minutesTo12Hour(825)).toBe('1:45 pm');
      expect(minutesTo12Hour(540)).toBe('9:00 am');
      expect(minutesTo12Hour(1320)).toBe('10:00 pm');
    });
  });

  describe('PRD v8 Acceptance Cases', () => {
    // ──────────────────────────────────────────────────────────
    // Acceptance Case 1
    // Ends in 2B, next class in 1B at 2:30, next class at 4:00 in 2B.
    // 2B is free from 1:45 to 4:00. Rule 1 applies, so suggestion is 2B for whole gap.
    // ──────────────────────────────────────────────────────────
    it('Case 1: Rule 1 - Same room for whole gap', () => {
      const rooms = [
        {
          id: 6,
          name: '2B',
          floor: '2nd',
          free_intervals: [{ start: '13:45', end: '16:00' }],
        },
        {
          id: 3,
          name: '1B',
          floor: '1st',
          free_intervals: [{ start: '14:30', end: '16:00' }],
        },
      ];

      const plan = calculateGapPlan({
        gapStart: '13:45',
        gapEnd: '16:00',
        currentRoom: '2B',
        nextClassRoom: '2B',
        rooms,
        options: { minFreeMinutes: 15 },
      });

      expect(plan.level).toBe(1);
      expect(plan.rule).toBe('same_room_whole_gap');
      expect(plan.is_covered).toBe(true);
      expect(plan.chain).toHaveLength(1);
      expect(plan.chain[0].room_name).toBe('2B');
      expect(plan.chain[0].start).toBe('13:45');
      expect(plan.chain[0].end).toBe('16:00');
    });

    // ──────────────────────────────────────────────────────────
    // Acceptance Case 2
    // Ends in 1B, 1B free 1:45 to 2:30, next class in 1B at 2:30,
    // next class at 4:00 in 2B, 2B free 1:45 to 4:00.
    // Rule 3 applies. Stay in 1B until 2:30, then move to 2B.
    // ──────────────────────────────────────────────────────────
    it('Case 2: Rule 3 - Chain starting from current room', () => {
      const rooms = [
        {
          id: 3,
          name: '1B',
          floor: '1st',
          // 1B free 1:45 to 2:30 (825 to 870)
          free_intervals: [{ start: '13:45', end: '14:30' }],
        },
        {
          id: 6,
          name: '2B',
          floor: '2nd',
          // 2B free 1:45 to 4:00 (825 to 960)
          free_intervals: [{ start: '13:45', end: '16:00' }],
        },
      ];

      const plan = calculateGapPlan({
        gapStart: '13:45',
        gapEnd: '16:00',
        currentRoom: '1B',
        nextClassRoom: '2B',
        rooms,
        options: { minFreeMinutes: 15 },
      });

      expect(plan.level).toBe(3);
      expect(plan.rule).toBe('chain_from_current_room');
      expect(plan.is_covered).toBe(true);
      expect(plan.chain).toHaveLength(2);

      // Step 1: Stay in 1B until 2:30 (14:30)
      expect(plan.chain[0].room_name).toBe('1B');
      expect(plan.chain[0].start).toBe('13:45');
      expect(plan.chain[0].end).toBe('14:30');
      expect(plan.chain[0].is_current_room).toBe(true);

      // Step 2: Move to 2B until 4:00 (16:00)
      expect(plan.chain[1].room_name).toBe('2B');
      expect(plan.chain[1].start).toBe('14:30');
      expect(plan.chain[1].end).toBe('16:00');
      expect(plan.chain[1].is_next_room).toBe(true);
    });

    // ──────────────────────────────────────────────────────────
    // Acceptance Case 3
    // Gap with no single room and no chain option.
    // Rule 5 applies. Show longest free stretch per room and say gap not fully covered.
    // ──────────────────────────────────────────────────────────
    it('Case 3: Rule 5 - Fallback when gap is not fully covered', () => {
      const rooms = [
        {
          id: 2,
          name: '1A',
          floor: '1st',
          // Free 13:45 to 14:15 (30 mins)
          free_intervals: [{ start: '13:45', end: '14:15' }],
        },
        {
          id: 4,
          name: '2A',
          floor: '2nd',
          // Free 14:30 to 15:00 (30 mins)
          free_intervals: [{ start: '14:30', end: '15:00' }],
        },
      ];

      const plan = calculateGapPlan({
        gapStart: '13:45',
        gapEnd: '16:00',
        currentRoom: '1A',
        nextClassRoom: '2A',
        rooms,
        options: { minFreeMinutes: 15 },
      });

      expect(plan.level).toBe(5);
      expect(plan.rule).toBe('fallback_not_covered');
      expect(plan.is_covered).toBe(false);
      expect(plan.message).toContain('not fully covered');
      expect(plan.longest_stretches.length).toBeGreaterThan(0);
      expect(plan.longest_stretches[0].duration_minutes).toBe(30);
    });

    // ──────────────────────────────────────────────────────────
    // Acceptance Case 4
    // Room free for 8 minutes, X = 15. Not suggested.
    // ──────────────────────────────────────────────────────────
    it('Case 4: Room free for 8 minutes with X = 15 is below threshold and ignored', () => {
      const rooms = [
        {
          id: 1,
          name: 'C',
          floor: 'Ground',
          // Free 13:45 to 13:53 (8 minutes)
          free_intervals: [{ start: '13:45', end: '13:53' }],
        },
      ];

      const plan = calculateGapPlan({
        gapStart: '13:45',
        gapEnd: '14:30',
        currentRoom: 'C',
        nextClassRoom: '1A',
        rooms,
        options: { minFreeMinutes: 15 },
      });

      // Level 5 fallback should not even include the 8-minute room
      expect(plan.level).toBe(5);
      expect(plan.longest_stretches).toHaveLength(0);
    });

    // ──────────────────────────────────────────────────────────
    // Acceptance Case 5
    // Two rooms free from the same moment. Rule 4 picks the one
    // whose next busy block starts latest.
    // ──────────────────────────────────────────────────────────
    it('Case 5: Rule 4 - Picks room whose next busy block starts latest', () => {
      const rooms = [
        {
          id: 3,
          name: '1B',
          floor: '1st',
          // Starts gap, free until 14:15 (30 mins)
          free_intervals: [{ start: '13:45', end: '14:15' }],
        },
        {
          id: 4,
          name: '2A',
          floor: '2nd',
          // Free from 14:15 to 15:00 (45 mins)
          free_intervals: [{ start: '14:15', end: '15:00' }],
        },
        {
          id: 5,
          name: '2C',
          floor: '2nd',
          // Free from 14:15 to 16:00 (105 mins) - starts latest busy block!
          free_intervals: [{ start: '14:15', end: '16:00' }],
        },
      ];

      const plan = calculateGapPlan({
        gapStart: '13:45',
        gapEnd: '16:00',
        currentRoom: '1B',
        nextClassRoom: '2C',
        rooms,
        options: { minFreeMinutes: 15 },
      });

      expect(plan.is_covered).toBe(true);
      // Level 4 (or 3) should pick 2C over 2A because 2C is free until 16:00
      expect(plan.chain).toHaveLength(2);
      expect(plan.chain[0].room_name).toBe('1B');
      expect(plan.chain[1].room_name).toBe('2C');
    });

    // ──────────────────────────────────────────────────────────
    // Acceptance Case 6
    // Gap runs past 22:00. The gap ends at 22:00. Rules apply up to building closing.
    // ──────────────────────────────────────────────────────────
    it('Case 6: Caps gap at 22:00 (1320 mins) building closing', () => {
      const rooms = [
        {
          id: 1,
          name: 'C',
          floor: 'Ground',
          free_intervals: [{ start: '21:00', end: '23:00' }],
        },
      ];

      const plan = calculateGapPlan({
        gapStart: '21:00',
        gapEnd: '23:00',
        currentRoom: 'C',
        nextClassRoom: null,
        rooms,
        options: { minFreeMinutes: 15, buildingClosingMinutes: 1320 },
      });

      expect(plan.is_covered).toBe(true);
      expect(plan.chain[0].end).toBe('22:00');
      expect(plan.chain[0].duration_minutes).toBe(60);
    });
  });

  describe('Additional Edge Cases & Rules', () => {
    it('Rule 2: Selects single room for whole gap when current room is not free', () => {
      const rooms = [
        {
          id: 2,
          name: '1A',
          floor: '1st',
          // Current room is busy at 13:45 (free only much later)
          free_intervals: [{ start: '15:30', end: '16:00' }],
        },
        {
          id: 4,
          name: '2A',
          floor: '2nd',
          // Free for the entire gap 13:45 to 16:00
          free_intervals: [{ start: '13:45', end: '16:00' }],
        },
      ];

      const plan = calculateGapPlan({
        gapStart: '13:45',
        gapEnd: '16:00',
        currentRoom: '1A',
        nextClassRoom: '1B',
        rooms,
        options: { minFreeMinutes: 15 },
      });

      expect(plan.level).toBe(2);
      expect(plan.rule).toBe('single_room_whole_gap');
      expect(plan.is_covered).toBe(true);
      expect(plan.chain[0].room_name).toBe('2A');
    });

    it('SSB Classroom is strictly excluded from all gap plans and chains', () => {
      const rooms = [
        {
          id: 57,
          name: 'SSB',
          floor: 'Ground',
          free_intervals: [{ start: '13:45', end: '16:00' }],
        },
        {
          id: 1,
          name: 'C',
          floor: 'Ground',
          free_intervals: [{ start: '13:45', end: '14:15' }],
        },
      ];

      const plan = calculateGapPlan({
        gapStart: '13:45',
        gapEnd: '16:00',
        currentRoom: 'SSB',
        nextClassRoom: 'C',
        rooms,
        options: { minFreeMinutes: 15 },
      });

      // SSB should never be suggested, even if free for whole gap
      expect(plan.chain.some((s) => s.room_name === 'SSB')).toBe(false);
      if (plan.longest_stretches) {
        expect(plan.longest_stretches.some((s) => s.room_name === 'SSB')).toBe(false);
      }
    });

    it('Disabling chain (chainEnabled: false) skips levels 3 and 4', () => {
      const rooms = [
        {
          id: 3,
          name: '1B',
          floor: '1st',
          free_intervals: [{ start: '13:45', end: '14:30' }],
        },
        {
          id: 6,
          name: '2B',
          floor: '2nd',
          free_intervals: [{ start: '14:30', end: '16:00' }],
        },
      ];

      const plan = calculateGapPlan({
        gapStart: '13:45',
        gapEnd: '16:00',
        currentRoom: '1B',
        nextClassRoom: '2B',
        rooms,
        options: { minFreeMinutes: 15, chainEnabled: false },
      });

      // Chain levels 3 & 4 are disabled, so fallback level 5 is returned
      expect(plan.level).toBe(5);
      expect(plan.is_covered).toBe(false);
    });
  });
});

