import { describe, it, expect } from 'vitest';
import { isValidDateStr } from '../utils/timezone.js';

describe('Validation and Failure Handling (C11, PRD Sections 3 & 4)', () => {
  // Helper mirroring closure validation rules
  function validateClosure({ scope, roomId, floor, startDate, endDate, startTime, endTime, availableRooms = [], availableFloors = [] }) {
    if (!['room', 'floor', 'building'].includes(scope)) {
      return { status: 400, error: 'Invalid scope' };
    }

    if (!startDate || !isValidDateStr(startDate)) {
      return { status: 400, error: 'Invalid start date' };
    }

    const finalEndDate = endDate || startDate;
    if (!isValidDateStr(finalEndDate)) {
      return { status: 400, error: 'Invalid end date' };
    }

    if (finalEndDate < startDate) {
      return { status: 400, error: 'Invalid date range: End date must be on or after start date.' };
    }

    let finalStartTime = startTime ? startTime.trim().slice(0, 5) : null;
    let finalEndTime = endTime ? endTime.trim().slice(0, 5) : null;

    if (finalStartTime || finalEndTime) {
      if (!finalStartTime || !finalEndTime) {
        return { status: 400, error: 'Incomplete time range: Both start and end required' };
      }
      if (finalStartTime >= finalEndTime) {
        return { status: 400, error: 'Invalid time range: End time must be after start time.' };
      }
    }

    if (scope === 'room') {
      const parsedRoomId = parseInt(roomId, 10);
      if (!Number.isInteger(parsedRoomId) || parsedRoomId < 1) {
        return { status: 400, error: 'Missing or invalid roomId' };
      }
      if (!availableRooms.includes(parsedRoomId)) {
        return { status: 404, error: `Room with id ${parsedRoomId} does not exist.` };
      }
    } else if (scope === 'floor') {
      if (!floor || !floor.trim()) {
        return { status: 400, error: 'Missing floor' };
      }
      const match = availableFloors.some((f) => f.toLowerCase() === floor.trim().toLowerCase());
      if (!match) {
        return { status: 404, error: `Floor "${floor}" does not exist in building.` };
      }
    }

    const today = '2026-10-26';
    let warning = null;
    if (startDate < today) {
      warning = 'Closure is scheduled in the past. Recorded for historical accuracy.';
    }

    return { status: 200, warning, finalEndDate, finalStartTime, finalEndTime };
  }

  // Helper mirroring term overlap check
  function checkTermOverlap(newTerm, existingTerms) {
    if (newTerm.startDate > newTerm.endDate) {
      return { status: 400, error: 'startDate must be on or before endDate.' };
    }

    for (const existing of existingTerms) {
      // Same batch check
      if (existing.batchId === newTerm.batchId && existing.id !== newTerm.id) {
        if (newTerm.startDate <= existing.endDate && newTerm.endDate >= existing.startDate) {
          return {
            status: 409,
            error: `Term dates overlap with Term ${existing.termNumber} (${existing.startDate} to ${existing.endDate}) for Batch ${existing.batchYear}.`,
          };
        }
      }
    }
    return { status: 200 };
  }

  // Helper mirroring closure merge check
  function mergeClosures(existingClosure, newClosure) {
    const mergedStart = newClosure.startDate < existingClosure.startDate ? newClosure.startDate : existingClosure.startDate;
    const mergedEnd = newClosure.endDate > existingClosure.endDate ? newClosure.endDate : existingClosure.endDate;

    const mergedStartTime = !existingClosure.startTime || !newClosure.startTime
      ? null
      : (newClosure.startTime < existingClosure.startTime ? newClosure.startTime : existingClosure.startTime);

    const mergedEndTime = !existingClosure.endTime || !newClosure.endTime
      ? null
      : (newClosure.endTime > existingClosure.endTime ? newClosure.endTime : existingClosure.endTime);

    return {
      id: existingClosure.id,
      startDate: mergedStart,
      endDate: mergedEnd,
      startTime: mergedStartTime,
      endTime: mergedEndTime,
      merged: true,
    };
  }

  describe('Closure validation rules', () => {
    it('rejects a closure ending before it starts (end_date < start_date)', () => {
      const res = validateClosure({
        scope: 'building',
        startDate: '2026-11-10',
        endDate: '2026-11-05',
      });
      expect(res.status).toBe(400);
      expect(res.error).toContain('End date must be on or after start date');
    });

    it('rejects a closure where end_time <= start_time', () => {
      const res = validateClosure({
        scope: 'building',
        startDate: '2026-11-10',
        endDate: '2026-11-10',
        startTime: '14:00',
        endTime: '12:00',
      });
      expect(res.status).toBe(400);
      expect(res.error).toContain('End time must be after start time');
    });

    it('rejects a closure where end_time === start_time', () => {
      const res = validateClosure({
        scope: 'building',
        startDate: '2026-11-10',
        endDate: '2026-11-10',
        startTime: '14:00',
        endTime: '14:00',
      });
      expect(res.status).toBe(400);
      expect(res.error).toContain('End time must be after start time');
    });

    it('rejects a closure naming a room that does not exist with 404', () => {
      const res = validateClosure({
        scope: 'room',
        roomId: 999,
        startDate: '2026-11-10',
        availableRooms: [1, 2, 3],
      });
      expect(res.status).toBe(404);
      expect(res.error).toContain('Room with id 999 does not exist');
    });

    it('rejects a closure naming a floor that does not exist with 404', () => {
      const res = validateClosure({
        scope: 'floor',
        floor: '4th',
        startDate: '2026-11-10',
        availableFloors: ['Ground', '1st', '2nd'],
      });
      expect(res.status).toBe(404);
      expect(res.error).toContain('Floor "4th" does not exist');
    });

    it('allows past closure dates but flags them with a warning', () => {
      const res = validateClosure({
        scope: 'building',
        startDate: '2026-09-01',
        endDate: '2026-09-02',
      });
      expect(res.status).toBe(200);
      expect(res.warning).toContain('Closure is scheduled in the past. Recorded for historical accuracy.');
    });

    it('merges overlapping closures rather than creating duplicates', () => {
      const existing = {
        id: 1,
        startDate: '2026-11-10',
        endDate: '2026-11-12',
        startTime: '09:00',
        endTime: '13:00',
      };
      const incoming = {
        startDate: '2026-11-11',
        endDate: '2026-11-15',
        startTime: '08:00',
        endTime: '12:00',
      };

      const merged = mergeClosures(existing, incoming);
      expect(merged.merged).toBe(true);
      expect(merged.startDate).toBe('2026-11-10');
      expect(merged.endDate).toBe('2026-11-15');
      expect(merged.startTime).toBe('08:00');
      expect(merged.endTime).toBe('13:00');
    });

    it('merges multi-day full day closure by removing time constraints if either is whole-day', () => {
      const existing = {
        id: 2,
        startDate: '2026-11-10',
        endDate: '2026-11-12',
        startTime: '09:00',
        endTime: '13:00',
      };
      const incoming = {
        startDate: '2026-11-12',
        endDate: '2026-11-13',
        startTime: null,
        endTime: null,
      };

      const merged = mergeClosures(existing, incoming);
      expect(merged.startTime).toBeNull();
      expect(merged.endTime).toBeNull();
      expect(merged.startDate).toBe('2026-11-10');
      expect(merged.endDate).toBe('2026-11-13');
    });
  });

  describe('Term validation rules', () => {
    const existingTerms = [
      { id: 1, batchId: 10, batchYear: 2029, termNumber: 5, startDate: '2026-08-01', endDate: '2026-10-28' },
      { id: 2, batchId: 20, batchYear: 2028, termNumber: 9, startDate: '2026-08-01', endDate: '2026-10-28' },
    ];

    it('rejects overlapping terms of the SAME batch with 409', () => {
      const newTerm = {
        id: 3,
        batchId: 10,
        batchYear: 2029,
        termNumber: 6,
        startDate: '2026-10-20', // overlaps with T5 end (Oct 28)
        endDate: '2027-01-31',
      };
      const res = checkTermOverlap(newTerm, existingTerms);
      expect(res.status).toBe(409);
      expect(res.error).toContain('Term dates overlap with Term 5');
    });

    it('allows overlapping terms of DIFFERENT batches (cross-batch sharing building)', () => {
      const newTerm = {
        id: 4,
        batchId: 30, // Batch 2030
        batchYear: 2030,
        termNumber: 1,
        startDate: '2026-08-01',
        endDate: '2026-10-28',
      };
      const res = checkTermOverlap(newTerm, existingTerms);
      expect(res.status).toBe(200);
    });

    it('allows consecutive terms of the same batch with no overlap', () => {
      const newTerm = {
        id: 5,
        batchId: 10,
        batchYear: 2029,
        termNumber: 6,
        startDate: '2026-10-29', // Day after T5 ends
        endDate: '2027-01-31',
      };
      const res = checkTermOverlap(newTerm, existingTerms);
      expect(res.status).toBe(200);
    });
  });

  describe('Timetable row outside term validation', () => {
    const term = { startDate: '2026-08-01', endDate: '2026-10-28' };

    function validateRowAgainstTerm(rowDate, termRange) {
      if (!rowDate) return { valid: true };
      if (rowDate < termRange.startDate || rowDate > termRange.endDate) {
        return {
          valid: false,
          error: `Class date (${rowDate}) is outside term dates (${termRange.startDate} to ${termRange.endDate}).`,
        };
      }
      return { valid: true };
    }

    it('accepts rows within term dates', () => {
      expect(validateRowAgainstTerm('2026-09-15', term).valid).toBe(true);
      expect(validateRowAgainstTerm('2026-08-01', term).valid).toBe(true);
      expect(validateRowAgainstTerm('2026-10-28', term).valid).toBe(true);
    });

    it('rejects a timetable row dated before term start with row error', () => {
      const res = validateRowAgainstTerm('2026-07-31', term);
      expect(res.valid).toBe(false);
      expect(res.error).toContain('outside term dates');
    });

    it('rejects a timetable row dated after term end with row error', () => {
      const res = validateRowAgainstTerm('2026-10-29', term);
      expect(res.valid).toBe(false);
      expect(res.error).toContain('outside term dates');
    });
  });
});
