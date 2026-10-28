/**
 * FreeRoom PRD v8: Room Chaining for Gaps Engine
 *
 * Implements deterministic priority-based room chaining for student gaps:
 * Level 1: Same room for the whole gap
 * Level 2: Any one room for the whole gap
 * Level 3: Chain starting from the current room
 * Level 4: Chain by the longest free stretch
 * Level 5: Fallback (single longest free stretch per room, not fully covered)
 *
 * Buffer: 0 minutes (BUFFER_MINUTES)
 * Distance between rooms: counted as equally far
 * Room SSB: class-only; never used as a study / free room
 */

/**
 * Convert "HH:MM" or "HH:MM:SS" string to integer minutes since midnight.
 */
export function timeToMinutes(timeStr) {
  if (!timeStr) return 0;
  const parts = String(timeStr).trim().split(':').map(Number);
  return (parts[0] || 0) * 60 + (parts[1] || 0);
}

/**
 * Convert integer minutes since midnight to "HH:MM" string.
 */
export function minutesToTime(mins) {
  const m = Math.max(0, Math.floor(mins));
  const h = Math.floor(m / 60) % 24;
  const min = m % 60;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/**
 * Format minutes to 12-hour display string (e.g. 870 -> "2:30 pm").
 */
export function minutesTo12Hour(mins) {
  const m = Math.max(0, Math.floor(mins));
  let h = Math.floor(m / 60) % 24;
  const min = m % 60;
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${String(min).padStart(2, '0')} ${ampm}`;
}

/**
 * Check if a room is continuously free from startMin to endMin.
 */
export function isRoomFreeOverInterval(roomIntervals, startMin, endMin) {
  if (!roomIntervals || roomIntervals.length === 0) return false;
  return roomIntervals.some((iv) => iv.start <= startMin && iv.end >= endMin);
}

/**
 * Find the end of the continuous free stretch for a room starting at startMin.
 * Returns the minute when the free stretch ends, or startMin if room is not free at startMin.
 */
export function getRoomFreeUntil(roomIntervals, startMin) {
  if (!roomIntervals) return startMin;
  const iv = roomIntervals.find((interval) => interval.start <= startMin && interval.end > startMin);
  return iv ? iv.end : startMin;
}

/**
 * Find the longest continuous free stretch for a room within a window [windowStart, windowEnd].
 * Returns { start, end, duration } in minutes.
 */
export function getLongestFreeStretchInWindow(roomIntervals, windowStart, windowEnd) {
  if (!roomIntervals || roomIntervals.length === 0) return null;
  let maxStretch = null;

  for (const iv of roomIntervals) {
    const s = Math.max(iv.start, windowStart);
    const e = Math.min(iv.end, windowEnd);
    if (e > s) {
      const dur = e - s;
      if (!maxStretch || dur > maxStretch.duration) {
        maxStretch = { start: s, end: e, duration: dur };
      }
    }
  }

  return maxStretch;
}

/**
 * Main Room Chaining Algorithm for a gap.
 *
 * @param {Object} params
 * @param {string} params.gapStart - e.g. "13:45"
 * @param {string} params.gapEnd - e.g. "16:00"
 * @param {string|null} params.currentRoom - e.g. "1B" (where last class ended)
 * @param {string|null} params.nextClassRoom - e.g. "2B" (where next class starts)
 * @param {Array<Object>} params.rooms - Array of room objects with { id, name, floor, capacity, free_intervals: [{ start: mins, end: mins }] }
 * @param {Object} [params.options]
 * @param {number} [params.options.minFreeMinutes=15] - X: minimum free time threshold
 * @param {number} [params.options.bufferMinutes=0] - Buffer time
 * @param {boolean} [params.options.chainEnabled=true] - Whether room chaining (levels 3 & 4) is enabled
 * @param {number} [params.options.buildingClosingMinutes=1320] - 22:00
 */
export function calculateGapPlan({
  gapStart,
  gapEnd,
  currentRoom = null,
  nextClassRoom = null,
  rooms = [],
  options = {},
}) {
  const X = typeof options.minFreeMinutes === 'number' ? options.minFreeMinutes : 15;
  const buffer = typeof options.bufferMinutes === 'number' ? options.bufferMinutes : 0;
  const chainEnabled = options.chainEnabled !== false;
  const closingMin = typeof options.buildingClosingMinutes === 'number' ? options.buildingClosingMinutes : 1320; // 22:00

  const gStart = timeToMinutes(gapStart);
  let gEnd = timeToMinutes(gapEnd);

  // Cap gap at building closing (22:00) per Acceptance Case 6
  if (gEnd > closingMin) {
    gEnd = closingMin;
  }

  const gapDuration = gEnd - gStart;

  // Acceptance Case 4: Gap of zero or below threshold X
  if (gapDuration < X) {
    return {
      level: 0,
      rule: 'gap_below_threshold',
      is_covered: false,
      message: `Gap duration (${gapDuration} mins) is below the minimum recommendation threshold of ${X} minutes.`,
      chain: [],
    };
  }

  // Filter out class-only rooms like SSB
  const candidateRooms = rooms.filter((r) => (r.name || '').toUpperCase() !== 'SSB');

  // Map candidate rooms with normalized intervals in minutes
  const roomsData = candidateRooms.map((r) => {
    const rawIntervals = r.free_intervals || [];
    const intervals = rawIntervals.map((iv) => {
      const s = typeof iv.start === 'number' ? iv.start : timeToMinutes(iv.start);
      const e = typeof iv.end === 'number' ? iv.end : timeToMinutes(iv.end);
      return { start: s, end: e };
    });
    return {
      ...r,
      intervals,
    };
  });

  const currRoomName = currentRoom ? String(currentRoom).trim() : null;
  const nextRoomName = nextClassRoom ? String(nextClassRoom).trim() : null;

  const currRoomObj = currRoomName ? roomsData.find((r) => r.name.toUpperCase() === currRoomName.toUpperCase()) : null;
  const nextRoomObj = nextRoomName ? roomsData.find((r) => r.name.toUpperCase() === nextRoomName.toUpperCase()) : null;

  // ──────────────────────────────────────────────────────────
  // LEVEL 1: Same room for the whole gap
  // ──────────────────────────────────────────────────────────
  if (currRoomObj && isRoomFreeOverInterval(currRoomObj.intervals, gStart, gEnd)) {
    return {
      level: 1,
      rule: 'same_room_whole_gap',
      is_covered: true,
      description: `Stay in Room ${currRoomObj.name} for the whole gap`,
      summary: `Room ${currRoomObj.name}`,
      chain: [
        {
          room_name: currRoomObj.name,
          floor: currRoomObj.floor,
          start: minutesToTime(gStart),
          end: minutesToTime(gEnd),
          start_12h: minutesTo12Hour(gStart),
          end_12h: minutesTo12Hour(gEnd),
          duration_minutes: gapDuration,
          is_current_room: true,
          is_next_room: currRoomObj.name.toUpperCase() === (nextRoomName || '').toUpperCase(),
        },
      ],
    };
  }

  // ──────────────────────────────────────────────────────────
  // LEVEL 3: Chain starting from the current room
  // (Section 4 constraint: "Stay in the current room while it stays free for at least X minutes from now.
  // Do not suggest a switch just because another room is free.")
  // Acceptance Case 2: 1B free 1:45 to 2:30, 2B free 1:45 to 4:00 -> Rule 3 applies: Stay in 1B until 2:30, then move to 2B.
  // ──────────────────────────────────────────────────────────
  if (chainEnabled && currRoomObj) {
    const currFreeUntil = getRoomFreeUntil(currRoomObj.intervals, gStart);
    const currStretch = currFreeUntil - gStart;

    if (currStretch >= X && currFreeUntil < gEnd) {
      const switchPoint = currFreeUntil;
      const remainingDuration = gEnd - switchPoint;

      if (remainingDuration >= X) {
        // Step A: Prefer moving to nextClassRoom if it covers the rest of the gap
        let secondRoom = null;
        if (nextRoomObj && isRoomFreeOverInterval(nextRoomObj.intervals, switchPoint, gEnd)) {
          secondRoom = nextRoomObj;
        } else {
          // Step B: Any other room free from switchPoint to gEnd
          const otherQualifying = roomsData.filter(
            (r) => r.name.toUpperCase() !== currRoomObj.name.toUpperCase() &&
                   isRoomFreeOverInterval(r.intervals, switchPoint, gEnd)
          );

          if (otherQualifying.length > 0) {
            // Pick the one with the most free time after gap start, then alphabetical
            otherQualifying.sort((a, b) => {
              const freeA = getRoomFreeUntil(a.intervals, switchPoint);
              const freeB = getRoomFreeUntil(b.intervals, switchPoint);
              if (freeB !== freeA) return freeB - freeA;
              return a.name.localeCompare(b.name);
            });
            secondRoom = otherQualifying[0];
          }
        }

        if (secondRoom) {
          return {
            level: 3,
            rule: 'chain_from_current_room',
            is_covered: true,
            description: `Stay in Room ${currRoomObj.name} until ${minutesTo12Hour(switchPoint)}, then move to Room ${secondRoom.name}`,
            summary: `Room ${currRoomObj.name} → Room ${secondRoom.name}`,
            chain: [
              {
                room_name: currRoomObj.name,
                floor: currRoomObj.floor,
                start: minutesToTime(gStart),
                end: minutesToTime(switchPoint),
                start_12h: minutesTo12Hour(gStart),
                end_12h: minutesTo12Hour(switchPoint),
                duration_minutes: switchPoint - gStart,
                is_current_room: true,
                is_next_room: false,
              },
              {
                room_name: secondRoom.name,
                floor: secondRoom.floor,
                start: minutesToTime(switchPoint),
                end: minutesToTime(gEnd),
                start_12h: minutesTo12Hour(switchPoint),
                end_12h: minutesTo12Hour(gEnd),
                duration_minutes: gEnd - switchPoint,
                is_current_room: false,
                is_next_room: secondRoom.name.toUpperCase() === (nextRoomName || '').toUpperCase(),
              },
            ],
          };
        }
      }
    }
  }

  // ──────────────────────────────────────────────────────────
  // LEVEL 2: Any one room for the whole gap
  // ──────────────────────────────────────────────────────────
  const wholeGapQualifying = roomsData.filter((r) => isRoomFreeOverInterval(r.intervals, gStart, gEnd));

  if (wholeGapQualifying.length > 0) {
    // If several qualify:
    // 1. Pick the one with the most free time after gap starts
    // 2. Tie break: prefer nextClassRoom if qualified, then alphabetical
    wholeGapQualifying.sort((a, b) => {
      const freeUntilA = getRoomFreeUntil(a.intervals, gStart);
      const freeUntilB = getRoomFreeUntil(b.intervals, gStart);
      if (freeUntilB !== freeUntilA) return freeUntilB - freeUntilA;

      const isNextA = nextRoomName && a.name.toUpperCase() === nextRoomName.toUpperCase();
      const isNextB = nextRoomName && b.name.toUpperCase() === nextRoomName.toUpperCase();
      if (isNextA && !isNextB) return -1;
      if (!isNextA && isNextB) return 1;

      return a.name.localeCompare(b.name);
    });

    const bestSingle = wholeGapQualifying[0];
    return {
      level: 2,
      rule: 'single_room_whole_gap',
      is_covered: true,
      description: `Use Room ${bestSingle.name} for the whole gap`,
      summary: `Room ${bestSingle.name}`,
      chain: [
        {
          room_name: bestSingle.name,
          floor: bestSingle.floor,
          start: minutesToTime(gStart),
          end: minutesToTime(gEnd),
          start_12h: minutesTo12Hour(gStart),
          end_12h: minutesTo12Hour(gEnd),
          duration_minutes: gapDuration,
          is_current_room: false,
          is_next_room: bestSingle.name.toUpperCase() === (nextRoomName || '').toUpperCase(),
        },
      ],
    };
  }

  // ──────────────────────────────────────────────────────────
  // LEVEL 4: Chain by the longest free stretch
  // (Greedy chain: switch to the free room whose next busy block starts latest.
  // Move to next class room when it is free from switch point to the end).
  // ──────────────────────────────────────────────────────────
  if (chainEnabled) {
    // Potential starting rooms:
    // Prioritize currentRoom, then nextClassRoom, then other rooms free at gStart for >= X mins
    const startCandidates = [];

    if (currRoomObj && getRoomFreeUntil(currRoomObj.intervals, gStart) - gStart >= X) {
      startCandidates.push(currRoomObj);
    }
    if (nextRoomObj && getRoomFreeUntil(nextRoomObj.intervals, gStart) - gStart >= X &&
        (!currRoomObj || nextRoomObj.name.toUpperCase() !== currRoomObj.name.toUpperCase())) {
      startCandidates.push(nextRoomObj);
    }

    const otherStarts = roomsData
      .filter((r) => !startCandidates.some((sc) => sc.name.toUpperCase() === r.name.toUpperCase()) &&
                     getRoomFreeUntil(r.intervals, gStart) - gStart >= X)
      .sort((a, b) => {
        const freeA = getRoomFreeUntil(a.intervals, gStart);
        const freeB = getRoomFreeUntil(b.intervals, gStart);
        if (freeB !== freeA) return freeB - freeA;
        return a.name.localeCompare(b.name);
      });

    startCandidates.push(...otherStarts);

    for (const startRoom of startCandidates) {
      const chainSteps = [];
      let currentR = startRoom;
      let curT = gStart;
      let chainCovered = false;
      const visitedRooms = new Set();

      while (curT < gEnd) {
        const freeUntil = getRoomFreeUntil(currentR.intervals, curT);
        const nextSwitch = Math.min(freeUntil, gEnd);
        const stepDuration = nextSwitch - curT;

        if (stepDuration < X) {
          // Cannot use room for less than X minutes
          break;
        }

        chainSteps.push({
          room_name: currentR.name,
          floor: currentR.floor,
          start: minutesToTime(curT),
          end: minutesToTime(nextSwitch),
          start_12h: minutesTo12Hour(curT),
          end_12h: minutesTo12Hour(nextSwitch),
          duration_minutes: stepDuration,
          is_current_room: chainSteps.length === 0 && currRoomName && currentR.name.toUpperCase() === currRoomName.toUpperCase(),
          is_next_room: nextRoomName && currentR.name.toUpperCase() === nextRoomName.toUpperCase(),
        });

        visitedRooms.add(currentR.name.toUpperCase());

        if (nextSwitch >= gEnd) {
          chainCovered = true;
          break;
        }

        curT = nextSwitch;
        const remaining = gEnd - curT;
        if (remaining < X) {
          break;
        }

        // Find candidate for next room at curT:
        // Must be free at curT for >= X mins, cannot be currentR
        const availableNext = roomsData.filter(
          (r) => r.name.toUpperCase() !== currentR.name.toUpperCase() &&
                 getRoomFreeUntil(r.intervals, curT) - curT >= X
        );

        if (availableNext.length === 0) {
          break;
        }

        // Acceptance Case 5 / Section 4: Move to next class room when it covers rest of gap
        let chosenNext = null;
        if (nextRoomObj && isRoomFreeOverInterval(nextRoomObj.intervals, curT, gEnd)) {
          chosenNext = nextRoomObj;
        } else {
          // Rule 4: "switch to the free room whose next busy block starts latest."
          availableNext.sort((a, b) => {
            const freeA = getRoomFreeUntil(a.intervals, curT);
            const freeB = getRoomFreeUntil(b.intervals, curT);
            if (freeB !== freeA) return freeB - freeA; // Latest busy block first
            return a.name.localeCompare(b.name);
          });
          chosenNext = availableNext[0];
        }

        currentR = chosenNext;
      }

      if (chainCovered && chainSteps.length > 0) {
        const descParts = chainSteps.map((s, idx) => {
          if (idx === 0) return `Start in Room ${s.room_name} until ${s.end_12h}`;
          if (idx === chainSteps.length - 1) return `move to Room ${s.room_name} until ${s.end_12h}`;
          return `then Room ${s.room_name} until ${s.end_12h}`;
        });

        return {
          level: 4,
          rule: 'chain_longest_stretch',
          is_covered: true,
          description: descParts.join(', '),
          summary: chainSteps.map((s) => `Room ${s.room_name}`).join(' → '),
          chain: chainSteps,
        };
      }
    }
  }

  // ──────────────────────────────────────────────────────────
  // LEVEL 5: Fallback (Gap not fully covered)
  // "Show the single longest free stretch for each room and say that the gap is not fully covered."
  // ──────────────────────────────────────────────────────────
  const longestStretches = [];

  for (const r of roomsData) {
    const longest = getLongestFreeStretchInWindow(r.intervals, gStart, gEnd);
    if (longest && longest.duration >= X) {
      longestStretches.push({
        room_name: r.name,
        floor: r.floor,
        capacity: r.capacity,
        start: minutesToTime(longest.start),
        end: minutesToTime(longest.end),
        start_12h: minutesTo12Hour(longest.start),
        end_12h: minutesTo12Hour(longest.end),
        duration_minutes: longest.duration,
      });
    }
  }

  longestStretches.sort((a, b) => {
    if (b.duration_minutes !== a.duration_minutes) {
      return b.duration_minutes - a.duration_minutes;
    }
    return a.room_name.localeCompare(b.room_name);
  });

  return {
    level: 5,
    rule: 'fallback_not_covered',
    is_covered: false,
    message: 'Gap is not fully covered',
    description: 'No room or chain covers the whole gap. Longest free stretches available:',
    longest_stretches: longestStretches,
    chain: [],
  };
}

