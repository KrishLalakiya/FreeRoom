import { describe, it, expect, beforeEach } from 'vitest';
import { AvailabilityCache, clearAvailabilityCache, availabilityCache } from '../../src/services/cache.js';

describe('AvailabilityCache (C10, PRD Section 6)', () => {
  let cache;

  beforeEach(() => {
    cache = new AvailabilityCache();
    availabilityCache.clear();
  });

  it('stores and retrieves cached entries', () => {
    cache.set('key1', { rooms: ['1A', '1B'] });
    expect(cache.get('key1')).toEqual({ rooms: ['1A', '1B'] });
    expect(cache.size()).toBe(1);
  });

  it('returns null for missing keys', () => {
    expect(cache.get('nonexistent')).toBeNull();
  });

  it('expires entries after TTL', () => {
    const originalNow = Date.now;
    let mockTime = 1000000;
    Date.now = () => mockTime;

    try {
      cache.set('key1', 'value1', 5000); // 5 sec TTL
      expect(cache.get('key1')).toBe('value1');

      // Advance clock past TTL
      mockTime += 6000;
      expect(cache.get('key1')).toBeNull();
      expect(cache.size()).toBe(0);
    } finally {
      Date.now = originalNow;
    }
  });

  it('deletes specific keys', () => {
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.delete('a')).toBe(true);
    expect(cache.get('a')).toBeNull();
    expect(cache.get('b')).toBe(2);
  });

  it('clears all entries', () => {
    cache.set('k1', 'v1');
    cache.set('k2', 'v2');
    expect(cache.size()).toBe(2);
    cache.clear();
    expect(cache.size()).toBe(0);
    expect(cache.get('k1')).toBeNull();
  });

  it('invalidates matching keys with pattern', () => {
    cache.set('timeline:1:2026-10-26', { room: 1 });
    cache.set('timeline:2:2026-10-26', { room: 2 });
    cache.set('free_now:1:all:60:2026-10-26:123', { count: 5 });

    cache.invalidateMatching(/^timeline:1:/);
    expect(cache.get('timeline:1:2026-10-26')).toBeNull();
    expect(cache.get('timeline:2:2026-10-26')).toBeTruthy();
    expect(cache.get('free_now:1:all:60:2026-10-26:123')).toBeTruthy();
  });

  it('invalidates room timeline and free queries when a room changes (C10)', () => {
    cache.set('timeline:10:2026-10-26', { room: 10 });
    cache.set('timeline:11:2026-10-26', { room: 11 });
    cache.set('free_now:1:all:60:2026-10-26:100', { count: 3 });
    cache.set('free_window:1:2026-10-26:09:00:10:00:all:any', { count: 4 });

    cache.invalidateRoom(10);

    // Room 10 timeline cleared
    expect(cache.get('timeline:10:2026-10-26')).toBeNull();
    // Other room timeline preserved
    expect(cache.get('timeline:11:2026-10-26')).toEqual({ room: 11 });
    // Aggregated free lists cleared because room 10 could affect them
    expect(cache.get('free_now:1:all:60:2026-10-26:100')).toBeNull();
    expect(cache.get('free_window:1:2026-10-26:09:00:10:00:all:any')).toBeNull();
  });

  it('clearAvailabilityCache clears all cached keys on any schedule change (PRD v9)', () => {
    availabilityCache.set('timeline:5:2026-10-26', { id: 5 });
    availabilityCache.set('timeline:6:2026-10-26', { id: 6 });
    availabilityCache.set('free_now:1:all:60', { rooms: [] });
    availabilityCache.set('next_day_tt:1:2026-10-27:all', { classes: [] });
    availabilityCache.set('all_rooms_avail:1:2026-10-26', { rooms: [] });
    availabilityCache.set('my_group:1:2028:Group A:2026-10-26', { classes: [] });
    availabilityCache.set('batches_and_groups:2026-10-26', { batches: [] });

    // Any schedule change clears the entire cache
    clearAvailabilityCache({ roomId: 5 });
    expect(availabilityCache.get('timeline:5:2026-10-26')).toBeNull();
    expect(availabilityCache.get('timeline:6:2026-10-26')).toBeNull();
    expect(availabilityCache.get('free_now:1:all:60')).toBeNull();
    expect(availabilityCache.get('next_day_tt:1:2026-10-27:all')).toBeNull();
    expect(availabilityCache.get('all_rooms_avail:1:2026-10-26')).toBeNull();
    expect(availabilityCache.get('my_group:1:2028:Group A:2026-10-26')).toBeNull();
    expect(availabilityCache.get('batches_and_groups:2026-10-26')).toBeNull();
    expect(availabilityCache.size()).toBe(0);
  });
});
