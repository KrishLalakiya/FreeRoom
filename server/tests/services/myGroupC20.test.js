import { describe, it, expect } from 'vitest';

describe('My Group Schedule and Gaps (C20, PRD Section 2)', () => {
  // Pure logic helper mirroring the my-group filtering
  function filterClassesForGroup(classes, targetGroup) {
    const targetLetter = targetGroup.replace(/^Group\s*/i, '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();

    return classes.filter((cls) => {
      const groups = cls.groups || [];
      if (groups.length === 0) return true; // Whole-batch class

      return groups.some((g) => {
        const norm = g.replace(/^Group\s*/i, '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        return norm === targetLetter || norm.includes(targetLetter);
      });
    });
  }

  // Pure logic helper mirroring gap calculations
  function calculateGaps(activeClasses, minGapMinutes = 15) {
    const gaps = [];
    for (let i = 0; i < activeClasses.length - 1; i++) {
      const currentEnd = activeClasses[i].end_time;
      const nextStart = activeClasses[i + 1].start_time;

      if (currentEnd < nextStart) {
        const [cEndH, cEndM] = currentEnd.split(':').map(Number);
        const [nStartH, nStartM] = nextStart.split(':').map(Number);
        const durationMinutes = (nStartH * 60 + nStartM) - (cEndH * 60 + cEndM);

        if (durationMinutes >= minGapMinutes) {
          gaps.push({
            start: currentEnd,
            end: nextStart,
            duration_minutes: durationMinutes,
          });
        }
      }
    }
    return gaps;
  }

  const sampleClasses = [
    { id: 1, subject: 'MERN', start_time: '09:00', end_time: '10:45', groups: ['Group A'] },
    { id: 2, subject: 'CN', start_time: '09:00', end_time: '10:45', groups: ['Group B'] },
    { id: 3, subject: 'Adv Graph Algo', start_time: '11:15', end_time: '13:00', groups: [] }, // Whole batch
    { id: 4, subject: 'C++ Systems', start_time: '14:00', end_time: '15:30', groups: ['Group A', 'Group B'] }, // Combined
    { id: 5, subject: 'MERN Lab', start_time: '15:35', end_time: '17:00', groups: ['Group A'] }, // 5 min gap (should be ignored)
  ];

  it('filters classes correctly for Group A', () => {
    const groupAClasses = filterClassesForGroup(sampleClasses, 'Group A');
    expect(groupAClasses.map((c) => c.subject)).toEqual([
      'MERN',
      'Adv Graph Algo',
      'C++ Systems',
      'MERN Lab',
    ]);
  });

  it('filters classes correctly for Group B', () => {
    const groupBClasses = filterClassesForGroup(sampleClasses, 'Group B');
    expect(groupBClasses.map((c) => c.subject)).toEqual([
      'CN',
      'Adv Graph Algo',
      'C++ Systems',
    ]);
  });

  it('calculates breaks and gaps between classes for Group A', () => {
    const groupAClasses = filterClassesForGroup(sampleClasses, 'Group A');
    const gaps = calculateGaps(groupAClasses, 15);

    // Gaps expected:
    // 10:45 to 11:15 (30 mins)
    // 13:00 to 14:00 (60 mins)
    // 15:30 to 15:35 is 5 mins (below 15 min threshold -> ignored)
    expect(gaps).toEqual([
      { start: '10:45', end: '11:15', duration_minutes: 30 },
      { start: '13:00', end: '14:00', duration_minutes: 60 },
    ]);
  });

  it('returns no gaps when classes are contiguous or below threshold', () => {
    const contiguous = [
      { id: 10, start_time: '09:00', end_time: '10:00', groups: [] },
      { id: 11, start_time: '10:00', end_time: '11:00', groups: [] },
      { id: 12, start_time: '11:05', end_time: '12:00', groups: [] }, // 5 mins
    ];
    const gaps = calculateGaps(contiguous, 15);
    expect(gaps).toEqual([]);
  });

  it('excludes SSB from free study rooms for all batches (class-only room, no open seating)', () => {
    const freeRooms = [
      { id: 1, name: '1A' },
      { id: 2, name: '2A' },
      { id: 57, name: 'SSB' },
    ];
    function filterGapRoomsForStudy(rooms) {
      return rooms.filter((r) => (r.name || '').toUpperCase() !== 'SSB');
    }

    expect(filterGapRoomsForStudy(freeRooms).map((r) => r.name)).toEqual(['1A', '2A']);
  });
});
