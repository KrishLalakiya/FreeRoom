/**
 * In-memory availability cache for FreeRoom (C10, PRD section 2/4/6).
 *
 * Caches computed availability results for free-now, free-window, and room timelines.
 * Default TTL is 60 seconds (PRD: "Computed free-room results cached for 30 to 60 seconds").
 * Invalided whenever a schedule change occurs:
 * - Term create / edit / delete (C3)
 * - Timetable import (C4)
 * - Closure create / merge / delete (C6, C8, C11)
 * - No-class day create / delete (C12)
 * - Class cancellation / schedule exception create
 * - One-off event create / delete
 */

const DEFAULT_TTL_MS = 60 * 1000;

export class AvailabilityCache {
  constructor() {
    this.store = new Map();
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key, value, ttlMs = DEFAULT_TTL_MS) {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }

  delete(key) {
    return this.store.delete(key);
  }

  clear() {
    this.store.clear();
  }

  size() {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
      }
    }
    return this.store.size;
  }

  invalidateMatching(pattern) {
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
    for (const key of this.store.keys()) {
      if (regex.test(key)) {
        this.store.delete(key);
      }
    }
  }

  invalidateRoom(roomId) {
    // Invalidate room's specific timeline and any aggregate free lists
    this.invalidateMatching(`timeline:${roomId}:`);
    this.invalidateMatching(/^free_/);
  }

  invalidateBuilding(buildingId) {
    this.invalidateMatching(new RegExp(`:(building_${buildingId}|${buildingId}):`));
    this.invalidateMatching(`^free_[^:]+:${buildingId}:`);
  }
}

export const availabilityCache = new AvailabilityCache();

export function clearAvailabilityCache(options = {}) {
  // PRD v9 Item 2 & Batch 6: Clear every cached key on a schedule change.
  // Writes are rare; partial invalidation missed next_day_tt:, all_rooms_avail:, my_group:, batches_and_groups:.
  availabilityCache.clear();
}
