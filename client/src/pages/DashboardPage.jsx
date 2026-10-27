import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { roomsAPI } from '../services/api';
import Navbar from '../components/Navbar';
import RoomCard from '../components/RoomCard';
import DatePicker, { getTodayStr, getTomorrowStr } from '../components/DatePicker';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';

/* ── Format Time Helpers ───────────────────────────────────── */
function formatTime12(t) {
  if (!t) return '';
  const [h, m] = t.split(':');
  const hr = parseInt(h, 10);
  const ampm = hr >= 12 ? 'pm' : 'am';
  const hr12 = hr % 12 || 12;
  return `${hr12}:${m} ${ampm}`;
}

function formatDurationHoursMinutes(minutes) {
  if (minutes == null || isNaN(minutes)) return '';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h > 0 && m > 0) return `${h} h ${m} m`;
  if (h > 0) return `${h} h`;
  return `${m} m`;
}

function getUntilAndLeft(room) {
  const isClosed = room.status === 'closed';
  if (isClosed) {
    return { until: 'Closed for exams', left: 'Closed for exams', isUrgent: false };
  }

  const mockStr = typeof window !== 'undefined' && (window.__MOCK_TIME__ || localStorage.getItem('freeroom_mock_time'));
  const now = mockStr ? new Date(mockStr) : new Date();
  const hr = now.getHours();
  if (hr >= 22 || hr < 6) {
    return { until: 'until 6:00 am', left: 'opens 6:00 am', isUrgent: false };
  }

  const freeMin = room.free_duration ?? room.free_for_minutes;
  let until = 'until 10:00 pm';
  if (room.free_until) {
    const d = new Date(room.free_until);
    if (!isNaN(d.getTime())) {
      until = `until ${d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })}`;
    }
  }

  let left = '';
  let isUrgent = false;
  if (freeMin != null && !isNaN(freeMin)) {
    left = `${formatDurationHoursMinutes(freeMin)} left`;
    isUrgent = freeMin > 0 && freeMin <= 50;
  }

  return { until, left, isUrgent };
}

function formatLocalDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/* Day chips helper: Current week Mon–Sat */
function getCurrentWeekDays() {
  const mockStr = typeof window !== 'undefined' && (window.__MOCK_TIME__ || localStorage.getItem('freeroom_mock_time'));
  const today = mockStr ? new Date(mockStr) : new Date();
  const dow = today.getDay(); // 0=Sun
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((dow + 6) % 7));

  const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const dateStr = formatLocalDateStr(d);
    return {
      dateStr,
      dayName: names[i],
      dayNum: d.getDate(),
      label: d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' }),
    };
  });
}

/* =========================================================
   SCREEN 1: FREE NOW
   ========================================================= */
function FreeNowScreen() {
  const navigate = useNavigate();
  const weekDays = getCurrentWeekDays();

  const [rooms, setRooms] = useState([]);
  const [closedRooms, setClosedRooms] = useState([]);
  const [nextDayData, setNextDayData] = useState(null);
  const [isAfterHours, setIsAfterHours] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingNextDay, setLoadingNextDay] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [durationKey, setDurationKey] = useState('30m');
  const [floor, setFloor] = useState('all');
  const [viewMode, setViewMode] = useState('rooms'); // 'rooms' | 'classes'
  const [selectedGroup, setSelectedGroup] = useState('All');
  const [mockTime, setMockTimeState] = useState(
    typeof window !== 'undefined' ? localStorage.getItem('freeroom_mock_time') : null
  );

  useEffect(() => {
    window.setMockTime = (timeStr = '21:00') => {
      const d = new Date();
      if (typeof timeStr === 'string') {
        const isPm = timeStr.toLowerCase().includes('pm');
        const clean = timeStr.replace(/[^0-9:]/g, '');
        const [hStr, mStr] = clean.split(':');
        let hr = parseInt(hStr || '21', 10);
        if (isPm && hr < 12) hr += 12;
        if (!isPm && timeStr.toLowerCase().includes('am') && hr === 12) hr = 0;
        const min = parseInt(mStr || '0', 10);
        d.setHours(hr, min, 0, 0);
      } else if (timeStr instanceof Date) {
        d.setTime(timeStr.getTime());
      }
      const iso = d.toISOString();
      localStorage.setItem('freeroom_mock_time', iso);
      console.log(`%c[FreeRoom] 🕒 Mock time set to ${d.toLocaleTimeString()} (${iso}). Reloading page...`, 'color: #059669; font-weight: bold; font-size: 13px;');
      window.location.reload();
    };

    window.resetTime = () => {
      localStorage.removeItem('freeroom_mock_time');
      console.log('%c[FreeRoom] 🔄 Mock time reset. Using real live time. Reloading page...', 'color: #059669; font-weight: bold; font-size: 13px;');
      window.location.reload();
    };
  }, []);

  const DURATION_MAP = { any: 0, '30m': 30, '1h': 60, '2h': 120 };

  const fetchRooms = useCallback(async () => {
    setLoading(true);
    try {
      const minDuration = DURATION_MAP[durationKey] || 30;
      const params = { buildingId: 1, minDuration };
      if (floor !== 'all') params.floor = floor;
      const res = await roomsAPI.getFreeNow(params);
      setRooms(res.data.rooms || []);
      setClosedRooms(res.data.closed_rooms || []);
      setNextDayData(res.data.next_day || null);
      setIsAfterHours(!!res.data.is_after_last_class);
      const mockStr = window.__MOCK_TIME__ || localStorage.getItem('freeroom_mock_time');
      setLastUpdated(mockStr ? new Date(mockStr) : new Date());
    } catch {
      toast.error('Failed to load live availability');
    } finally {
      setLoading(false);
    }
  }, [durationKey, floor]);

  useEffect(() => {
    fetchRooms();
  }, [fetchRooms]);

  useEffect(() => {
    const id = setInterval(fetchRooms, 60000);
    return () => clearInterval(id);
  }, [fetchRooms]);

  const handleSelectDay = async (dateStr) => {
    setLoadingNextDay(true);
    try {
      const res = await roomsAPI.getNextTimetable({ date: dateStr, buildingId: 1 });
      setNextDayData(res.data);
    } catch {
      toast.error('Failed to load timetable for selected day');
    } finally {
      setLoadingNextDay(false);
    }
  };

  const allRooms = [...rooms, ...closedRooms];
  const count = rooms.length;
  const updatedStr = lastUpdated
    ? lastUpdated.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })
    : '4:43 pm';

  // Filter next day classes by group
  const filteredClasses = (nextDayData?.classes || []).filter((c) => {
    if (selectedGroup === 'All') return true;
    const g = c.group_name || '';
    return (
      g === selectedGroup ||
      g.includes(selectedGroup.replace('Group ', '')) ||
      g === 'All'
    );
  });

  const shouldShowNextDay = (isAfterHours || allRooms.length === 0) && !!nextDayData;

  return (
    <section id="screen-freenow" className="screen active">
      {mockTime && (
        <div style={{
          background: 'rgba(245, 158, 11, 0.1)',
          border: '1px solid rgba(245, 158, 11, 0.35)',
          borderRadius: 'var(--radius-card)',
          padding: '10px 16px',
          marginBottom: '20px',
          fontSize: '13px',
          color: '#b45309',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '8px',
        }}>
          <span>
            🧪 Simulating time: <strong>{new Date(mockTime).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })}</strong>
          </span>
          <button
            onClick={() => {
              localStorage.removeItem('freeroom_mock_time');
              window.location.reload();
            }}
            style={{
              background: '#b45309',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              padding: '4px 10px',
              fontSize: '12px',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            Reset to live time
          </button>
        </div>
      )}

      <div className="freenow-header">
        <div>
          <h1 className="page-title">{shouldShowNextDay ? 'Next Day Timetable' : 'Free now'}</h1>
          <p className="page-subtitle" id="freenow-subtitle">
            {shouldShowNextDay ? (
              <>
                Schedule for <strong>{nextDayData?.day_name}, {nextDayData?.formatted_date}</strong> · Campus opens {formatTime12(nextDayData?.opening_time) || '6:00 am'}
              </>
            ) : (
              <>
                {count} {count === 1 ? 'room' : 'rooms'} · updated {updatedStr}
              </>
            )}
          </p>
        </div>

        {!shouldShowNextDay && (
          <div className="filter-group-wrapper">
            <span className="mobile-filter-label">Free for at least</span>
            <div className="pill-row" role="group" aria-label="Minimum free duration">
              <button
                className={`filter-pill${durationKey === 'any' ? ' active' : ''}`}
                onClick={() => setDurationKey('any')}
              >
                Any
              </button>
              <button
                className={`filter-pill${durationKey === '30m' ? ' active' : ''}`}
                onClick={() => setDurationKey('30m')}
              >
                30 min
              </button>
              <button
                className={`filter-pill${durationKey === '1h' ? ' active' : ''}`}
                onClick={() => setDurationKey('1h')}
              >
                1 hr
              </button>
              <button
                className={`filter-pill${durationKey === '2h' ? ' active' : ''}`}
                onClick={() => setDurationKey('2h')}
              >
                2 hr
              </button>
            </div>
          </div>
        )}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-secondary)' }}>
          Checking classroom availability…
        </div>
      ) : shouldShowNextDay ? (
        /* ── NEXT DAY TIMETABLE VIEW (AFTER LAST CLASS / AFTER HOURS) ── */
        <div className="fade-in">
          {/* Banner with Toggle and Day Picker */}
          <div
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-card)',
              padding: '20px 22px',
              marginBottom: '20px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '14px', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '12px',
                  background: 'var(--bg-subtle)',
                  border: '1px solid var(--border-control)',
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: '20px',
                  flexShrink: 0,
                }}>
                  🌙
                </div>
                <div>
                  <div style={{ fontSize: '17px', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
                    {isAfterHours ? 'All classes finished for today' : 'No classrooms free right now'}
                  </div>
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                    Campus operating hours are {formatTime12(nextDayData?.opening_time) || '6:00 am'} – {formatTime12(nextDayData?.closing_time) || '10:00 pm'}
                  </div>
                </div>
              </div>

              {/* View Toggle */}
              <div className="pill-row">
                <button
                  className={`filter-pill${viewMode === 'rooms' ? ' active' : ''}`}
                  onClick={() => setViewMode('rooms')}
                >
                  🏫 Room Availability
                </button>
                <button
                  className={`filter-pill${viewMode === 'classes' ? ' active' : ''}`}
                  onClick={() => setViewMode('classes')}
                >
                  📅 Class Schedule
                </button>
              </div>
            </div>

            {/* Day Selector Pills */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              flexWrap: 'wrap',
              paddingTop: '12px',
              borderTop: '1px solid var(--border-subtle)',
            }}>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 500, marginRight: '4px' }}>
                Browse Day:
              </span>
              {weekDays.map((d) => (
                <button
                  key={d.dateStr}
                  className={`filter-pill${nextDayData?.date === d.dateStr ? ' active' : ''}`}
                  style={{ padding: '4px 12px', fontSize: '12px' }}
                  onClick={() => handleSelectDay(d.dateStr)}
                  disabled={loadingNextDay}
                >
                  {d.dayName} {d.dayNum}
                </button>
              ))}
            </div>
          </div>

          {loadingNextDay ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-secondary)' }}>
              Loading schedule…
            </div>
          ) : viewMode === 'rooms' ? (
            /* Mode 1: Next Day Room Cards */
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
                <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  Classrooms opening at {formatTime12(nextDayData?.opening_time) || '6:00 am'} on {nextDayData?.day_name}
                </div>
                <span style={{ fontSize: '13px', color: 'var(--green-text)', fontWeight: 600 }}>
                  {nextDayData?.rooms?.filter((r) => r.status === 'free').length || 0} classrooms free morning
                </span>
              </div>

              <div className="rooms-grid" id="freenow-nextday-grid">
                {nextDayData?.rooms?.map((room) => (
                  <RoomCard
                    key={room.id}
                    room={room}
                    onClick={(r) => navigate(`/find?mode=room&room=${encodeURIComponent(r.name || r.id)}`)}
                  />
                ))}
              </div>
            </div>
          ) : (
            /* Mode 2: Complete Class Timetable */
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
                <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  Classes scheduled for {nextDayData?.day_name}, {nextDayData?.formatted_date}
                </div>

                {/* Group Filter */}
                <div className="pill-row">
                  {['All', 'Group A', 'Group B', 'Group C', 'Group D'].map((grp) => (
                    <button
                      key={grp}
                      className={`filter-pill${selectedGroup === grp ? ' active' : ''}`}
                      style={{ padding: '4px 12px', fontSize: '12px' }}
                      onClick={() => setSelectedGroup(grp)}
                    >
                      {grp}
                    </button>
                  ))}
                </div>
              </div>

              {filteredClasses.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '48px 16px', background: 'var(--bg-card)', borderRadius: 'var(--radius-card)', border: '1px solid var(--border-subtle)' }}>
                  <div style={{ fontSize: '16px', fontWeight: 700, marginBottom: '4px' }}>
                    {nextDayData?.is_no_class_day
                      ? `Holiday · ${nextDayData.no_class_reason}`
                      : `No classes scheduled${selectedGroup !== 'All' ? ` for ${selectedGroup}` : ''}`}
                  </div>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
                    All campus classrooms are free for open study.
                  </p>
                </div>
              ) : (
                <div className="timeline-list">
                  {filteredClasses.map((cls, idx) => (
                    <div key={idx} className="class-card">
                      <div>
                        <div className="class-time-row">
                          <span>{formatTime12(cls.start_time)} – {formatTime12(cls.end_time)}</span>
                          <span className="room-card-floor">{cls.group_name || 'All'}</span>
                        </div>
                        <div className="class-title">{cls.course_name}</div>
                        <div className="class-loc">
                          {cls.teacher ? `${cls.teacher} · ` : ''}Room {cls.room_name} ({cls.floor} Floor)
                        </div>
                      </div>
                      <button
                        className="room-pill-badge"
                        onClick={() => navigate(`/find?mode=room&room=${encodeURIComponent(cls.room_name || cls.room_id)}`)}
                        title={`View schedule for Room ${cls.room_name}`}
                      >
                        Room {cls.room_name} →
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ) : allRooms.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 16px', background: 'var(--bg-card)', borderRadius: 'var(--radius-card)', border: '1px solid var(--border-subtle)' }}>
          <h3 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '6px' }}>No classrooms free right now</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '13.5px' }}>Try switching the filter to a shorter minimum duration or checking another time.</p>
        </div>
      ) : (
        <div className="rooms-grid" id="freenow-grid">
          {allRooms.map((room) => (
            <RoomCard
              key={room.id}
              room={room}
              onClick={(r) => navigate(`/find?mode=room&room=${encodeURIComponent(r.name || r.id)}`)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/* =========================================================
   SCREEN 2: FIND A ROOM (PRD v4: Free rooms & By room modes)
   ========================================================= */
const ROOM_LIST = ['C', '1A', '1B', '2A', '2B', '2C'];

const ROOM_META = {
  'C': { floor: 'Ground', seats: 200, submeta: null },
  '1A': { floor: '1st', seats: 200, submeta: null },
  '1B': { floor: '1st', seats: 200, submeta: null },
  '2A': { floor: '2nd', seats: 200, submeta: null },
  '2B': { floor: '2nd', seats: 200, submeta: null },
  '2B1': { floor: '2nd', seats: 100, submeta: null },
  '2B2': { floor: '2nd', seats: 100, submeta: null },
  '2C': { floor: '2nd', seats: 200, submeta: null },
};

const TIME_OPTIONS = [
  { value: '06:00', label: '6:00 am' },
  { value: '07:00', label: '7:00 am' },
  { value: '08:00', label: '8:00 am' },
  { value: '08:30', label: '8:30 am' },
  { value: '09:00', label: '9:00 am' },
  { value: '09:30', label: '9:30 am' },
  { value: '10:00', label: '10:00 am' },
  { value: '10:30', label: '10:30 am' },
  { value: '11:00', label: '11:00 am' },
  { value: '11:30', label: '11:30 am' },
  { value: '12:00', label: '12:00 pm' },
  { value: '12:30', label: '12:30 pm' },
  { value: '13:00', label: '1:00 pm' },
  { value: '13:30', label: '1:30 pm' },
  { value: '14:00', label: '2:00 pm' },
  { value: '14:30', label: '2:30 pm' },
  { value: '15:00', label: '3:00 pm' },
  { value: '15:30', label: '3:30 pm' },
  { value: '16:00', label: '4:00 pm' },
  { value: '16:30', label: '4:30 pm' },
  { value: '17:00', label: '5:00 pm' },
  { value: '17:30', label: '5:30 pm' },
  { value: '18:00', label: '6:00 pm' },
  { value: '18:30', label: '6:30 pm' },
  { value: '19:00', label: '7:00 pm' },
  { value: '19:30', label: '7:30 pm' },
  { value: '20:00', label: '8:00 pm' },
  { value: '20:30', label: '8:30 pm' },
  { value: '21:00', label: '9:00 pm' },
  { value: '22:00', label: '10:00 pm' },
];

function formatTimeFromDate(d) {
  if (!d || isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();
}

function FindRoomScreen() {
  const { user, updateSettings } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const tomorrowStr = getTomorrowStr();

  // Mode: 'free' | 'room'
  const mode = searchParams.get('mode') === 'room' ? 'room' : 'free';
  const paramRoom = searchParams.get('room');

  // Shared date across both modes (defaults to tomorrow)
  const [date, setDate] = useState(() => {
    return searchParams.get('date') || localStorage.getItem('freeroom_find_date') || tomorrowStr;
  });

  // Free rooms mode: From / To / Floor
  const [fromTime, setFromTime] = useState(() => {
    return searchParams.get('from') || localStorage.getItem('freeroom_find_from') || '06:00';
  });
  const [toTime, setToTime] = useState(() => {
    return searchParams.get('to') || localStorage.getItem('freeroom_find_to') || '22:00';
  });
  const [floor, setFloor] = useState(() => {
    return searchParams.get('floor') || localStorage.getItem('freeroom_find_floor') || 'all';
  });

  // Free rooms results
  const [rooms, setRooms] = useState([]);
  const [closedRooms, setClosedRooms] = useState([]);
  const [searchReason, setSearchReason] = useState(null);
  const [loadingFree, setLoadingFree] = useState(false);

  // By room mode: selected room & timeline
  const [selectedRoom, setSelectedRoom] = useState(() => {
    return paramRoom && ROOM_LIST.includes(paramRoom) ? paramRoom : 'C';
  });
  const [timelineData, setTimelineData] = useState(null);
  const [loadingTimeline, setLoadingTimeline] = useState(false);

  // Sync selectedRoom if param changes
  useEffect(() => {
    if (paramRoom && ROOM_LIST.includes(paramRoom)) {
      setSelectedRoom(paramRoom);
    }
  }, [paramRoom]);

  // Persist selections on device and sync to account when signed in (PRD v6 Section 3)
  useEffect(() => {
    if (date) localStorage.setItem('freeroom_find_date', date);
    if (fromTime) localStorage.setItem('freeroom_find_from', fromTime);
    if (toTime) localStorage.setItem('freeroom_find_to', toTime);
    if (floor) localStorage.setItem('freeroom_find_floor', floor);
    if (user && updateSettings) {
      updateSettings({ lastDateWindow: { date, fromTime, toTime } });
    }
  }, [date, fromTime, toTime, floor, user, updateSettings]);

  // Mode switcher handler
  const handleSetMode = (newMode) => {
    const nextParams = new URLSearchParams(searchParams);
    if (newMode === 'room') {
      nextParams.set('mode', 'room');
      nextParams.set('room', selectedRoom || 'C');
    } else {
      nextParams.delete('mode');
      nextParams.delete('room');
    }
    setSearchParams(nextParams);
  };

  const handleSelectRoom = (roomName) => {
    setSelectedRoom(roomName);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('mode', 'room');
    nextParams.set('room', roomName);
    setSearchParams(nextParams);
  };

  // Perform search for Free rooms mode
  const fetchFreeRooms = useCallback(async () => {
    if (fromTime >= toTime) {
      toast.error('Start time must be earlier than end time');
      return;
    }
    setLoadingFree(true);
    try {
      const params = { buildingId: 1, date, startTime: fromTime, endTime: toTime };
      if (floor !== 'all') params.floor = floor;
      const res = await roomsAPI.getFreeWindow(params);
      setRooms(res.data.rooms || []);
      setClosedRooms(res.data.closed_rooms || []);
      setSearchReason(res.data.reason || null);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Search failed');
    } finally {
      setLoadingFree(false);
    }
  }, [date, fromTime, toTime, floor]);

  useEffect(() => {
    if (mode === 'free') {
      fetchFreeRooms();
    }
  }, [mode, fetchFreeRooms]);

  // Fetch timeline for By room mode
  const fetchTimeline = useCallback(async () => {
    setLoadingTimeline(true);
    try {
      const res = await roomsAPI.getTimeline(selectedRoom, date);
      setTimelineData(res.data);
    } catch (err) {
      toast.error(err.response?.data?.message || `Failed to load schedule for Room ${selectedRoom}`);
    } finally {
      setLoadingTimeline(false);
    }
  }, [selectedRoom, date]);

  useEffect(() => {
    if (mode === 'room') {
      fetchTimeline();
    }
  }, [mode, fetchTimeline]);

  // All free rooms combined
  const allRooms = [...rooms, ...closedRooms];

  // Duration in hours
  const [fh, fm] = fromTime.split(':').map(Number);
  const [th, tm] = toTime.split(':').map(Number);
  const diffHours = ((th * 60 + tm) - (fh * 60 + fm)) / 60;
  const isAllDayWindow = fromTime === '06:00' && toTime === '22:00';

  // Room meta for selected room in By room mode
  const currentRoomMeta = ROOM_META[selectedRoom] || { floor: '2nd', seats: 200, submeta: null };

  // Build By room timeline slots in chronological order
  const timelineSlots = (() => {
    if (!timelineData) return [];
    const slots = [];

    // Full-day closure
    if (timelineData.status === 'closed' && (!timelineData.busy_blocks || timelineData.busy_blocks.length === 0)) {
      return [{ type: 'closure', timeRange: '6:00 am – 10:00 pm' }];
    }

    // Free intervals
    (timelineData.free_intervals || []).forEach((fi) => {
      const s = new Date(fi.start);
      const e = new Date(fi.end);
      if (isNaN(s.getTime()) || isNaN(e.getTime())) return;
      slots.push({
        type: 'free',
        startMs: s.getTime(),
        endMs: e.getTime(),
        timeRange: `${formatTimeFromDate(s)} – ${formatTimeFromDate(e)}`,
      });
    });

    // Busy blocks
    (timelineData.busy_blocks || []).forEach((bb) => {
      const s = new Date(bb.start);
      const e = new Date(bb.end);
      if (isNaN(s.getTime()) || isNaN(e.getTime())) return;

      if (bb.is_closure) {
        slots.push({
          type: 'closure',
          startMs: s.getTime(),
          endMs: e.getTime(),
          timeRange: `${formatTimeFromDate(s)} – ${formatTimeFromDate(e)}`,
        });
        return;
      }

      const batch = bb.batch_year ? `Batch ${bb.batch_year}` : 'Batch 2029';
      const group = bb.group || (bb.groups_list && bb.groups_list[0]) || '';
      const subject = bb.subject_name || bb.title || '';
      const teacher = bb.instructor_name || bb.teacher || '';
      const isLab = (bb.entry_type || '').toLowerCase() === 'lab' || subject.toLowerCase().includes('lab');

      let prefix = '';
      if (selectedRoom === '2B' && bb.room_name && (bb.room_name === '2B1' || bb.room_name === '2B2')) {
        prefix = `${bb.room_name} · `;
      }

      const lineText = `${prefix}${[batch, group, subject, teacher].filter(Boolean).join(' · ')}`;

      slots.push({
        type: 'busy',
        startMs: s.getTime(),
        endMs: e.getTime(),
        timeRange: `${formatTimeFromDate(s)} – ${formatTimeFromDate(e)}`,
        what: lineText,
        isLab,
      });
    });

    slots.sort((a, b) => a.startMs - b.startMs);
    return slots;
  })();

  return (
    <section id="screen-findroom" className="screen active">
      <h1 className="page-title" style={{ marginBottom: '14px' }}>Find a room</h1>

      {/* Mode Switch: Free rooms / By room */}
      <div className="fr-seg" role="tablist" aria-label="Find a room view">
        <button
          type="button"
          role="tab"
          className={mode === 'free' ? 'active' : ''}
          aria-selected={mode === 'free'}
          onClick={() => handleSetMode('free')}
        >
          Free rooms
        </button>
        <button
          type="button"
          role="tab"
          className={mode === 'room' ? 'active' : ''}
          aria-selected={mode === 'room'}
          onClick={() => handleSetMode('room')}
        >
          By room
        </button>
      </div>

      <div className="fr-split">
        {/* Left Card / Panel: Date & Filters */}
        <aside className="fr-card fr-panel">
          {/* Shared Date Field */}
          <DatePicker
            value={date}
            onChange={setDate}
            variant="fr-card"
            id="find-date"
          />

          {mode === 'free' ? (
            <div>
              {/* From / To row */}
              <div className="fr-time-row">
                <div className="fr-time-btn">
                  <span className="fr-time-label">From</span>
                  <span className="fr-time-val">{formatTime12(fromTime)}</span>
                  <select
                    className="fr-time-select"
                    value={fromTime}
                    onChange={(e) => setFromTime(e.target.value)}
                    aria-label="From time"
                  >
                    {TIME_OPTIONS.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div className="fr-time-btn">
                  <span className="fr-time-label">To</span>
                  <span className="fr-time-val">{formatTime12(toTime)}</span>
                  <select
                    className="fr-time-select"
                    value={toTime}
                    onChange={(e) => setToTime(e.target.value)}
                    aria-label="To time"
                  >
                    {TIME_OPTIONS.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Floor Chips */}
              <div className="fr-panel-block">
                <div className="fr-panel-label">Floor</div>
                <div className="fr-chip-row">
                  {[
                    { id: 'all', label: 'Any floor' },
                    { id: 'Ground', label: 'Ground' },
                    { id: '1st', label: '1st' },
                    { id: '2nd', label: '2nd' },
                  ].map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      className="fr-chip"
                      aria-pressed={floor === f.id}
                      onClick={() => setFloor(f.id)}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            /* By room mode room chips */
            <div className="fr-panel-block">
              <div className="fr-panel-label">Room</div>
              <div className="fr-chip-row" id="room-chips">
                {ROOM_LIST.map((rName) => (
                  <button
                    key={rName}
                    type="button"
                    className="fr-chip"
                    aria-pressed={selectedRoom === rName}
                    onClick={() => handleSelectRoom(rName)}
                  >
                    {rName}
                  </button>
                ))}
              </div>
            </div>
          )}
        </aside>

        {/* Right Content Pane */}
        <section className="fr-content-pane">
          {mode === 'free' ? (
            <div>
              <div className="fr-section-head">
                <span className="fr-section-title">
                  {allRooms.length} {allRooms.length === 1 ? 'room' : 'rooms'} free
                </span>
                <span className="fr-meta">
                  {formatTime12(fromTime)} – {formatTime12(toTime)}
                  {!isAllDayWindow && diffHours > 0 && diffHours < 16 ? ` · ${diffHours} h` : ''}
                </span>
              </div>

              {loadingFree ? (
                <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-secondary)' }}>
                  Checking classroom availability…
                </div>
              ) : allRooms.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '48px 16px', background: 'var(--bg-card)', borderRadius: 'var(--radius-card)', border: '1px solid var(--border-subtle)' }}>
                  <div style={{ fontSize: '16px', fontWeight: 700, marginBottom: '6px' }}>
                    {searchReason || 'No rooms free for this window'}
                  </div>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
                    Try selecting a different time window or date.
                  </p>
                </div>
              ) : (
                <div className="rooms-grid" id="findroom-grid">
                  {allRooms.map((r) => (
                    <RoomCard
                      key={r.id || r.name}
                      room={r}
                      onClick={() => handleSelectRoom(r.name)}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* By room mode view */
            <div>
              <div className="fr-room-head">
                <span className="fr-section-title" id="room-title">{selectedRoom}</span>
                <span className="fr-meta" id="room-floor">
                  {currentRoomMeta.floor} · {currentRoomMeta.seats} seats
                </span>
                {currentRoomMeta.submeta && (
                  <span className="fr-submeta">{currentRoomMeta.submeta}</span>
                )}
              </div>

              {loadingTimeline ? (
                <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-secondary)' }}>
                  Loading schedule for Room {selectedRoom}…
                </div>
              ) : timelineSlots.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '48px 16px', background: 'var(--bg-card)', borderRadius: 'var(--radius-card)', border: '1px solid var(--border-subtle)' }}>
                  <div style={{ fontSize: '16px', fontWeight: 700, marginBottom: '6px' }}>
                    No timetable scheduled for this date
                  </div>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
                    Room {selectedRoom} is free for open study.
                  </p>
                </div>
              ) : (
                <div className="fr-slots">
                  {timelineSlots.map((slot, idx) => {
                    if (slot.type === 'free') {
                      return (
                        <div key={idx} className="fr-slot fr-slot--free">
                          <div className="fr-slot-top">
                            <span>{slot.timeRange}</span>
                            <span className="fr-tag-free">Free</span>
                          </div>
                        </div>
                      );
                    }
                    if (slot.type === 'closure') {
                      return (
                        <div key={idx} className="fr-slot fr-slot--closed">
                          <div className="fr-slot-top">
                            <span>{slot.timeRange ? `${slot.timeRange} · ` : ''}Closed for exams</span>
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div key={idx} className="fr-slot">
                        <div className="fr-slot-top">
                          <span>{slot.timeRange}</span>
                        </div>
                        <div className="fr-slot-what">
                          {slot.what}
                          {slot.isLab && <span className="fr-muted"> · Lab</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}

/* =========================================================
   SCREEN 3: MY GROUP
   ========================================================= */
function filterGapRooms(roomsList) {
  if (!roomsList || roomsList.length === 0) return [];
  const names = new Set(roomsList.map((r) => r.name));
  const has2B = names.has('2B');
  const has2B1 = names.has('2B1');
  const has2B2 = names.has('2B2');

  // Rule: show 2B only when 2B1 and 2B2 are both free.
  // Otherwise show the free halves as 2B1 and/or 2B2, and do not show 2B.
  if (has2B1 && has2B2) {
    const withoutHalves = roomsList.filter((r) => r.name !== '2B1' && r.name !== '2B2');
    if (!has2B) {
      withoutHalves.push({ id: '2B', name: '2B', floor: '2nd' });
    }
    return withoutHalves;
  }

  if (has2B1 || has2B2) {
    return roomsList.filter((r) => r.name !== '2B');
  }

  return roomsList;
}

const BATCH_CONFIG = {
  2027: { groups: ['A'], term: 13 },
  2028: { groups: ['A', 'B'], term: 9 },
  2029: { groups: ['A', 'B', 'C'], term: 5 },
  2030: { groups: ['A', 'B', 'C', 'D', 'E'], term: 1 },
};

const BATCH_LIST = [2027, 2028, 2029, 2030];

function GroupPickerModal({
  isOpen,
  onClose,
  initialBatch,
  initialGroupLetter,
  onSave,
}) {
  const [selectedBatch, setSelectedBatch] = useState(initialBatch);
  const [selectedGroupLetter, setSelectedGroupLetter] = useState(initialGroupLetter);
  const [activeColumn, setActiveColumn] = useState('batch');

  const batches = BATCH_LIST;
  const currentGroups = BATCH_CONFIG[selectedBatch]?.groups || ['A'];

  useEffect(() => {
    if (isOpen) {
      const validBatch = BATCH_LIST.includes(initialBatch) ? initialBatch : 2029;
      const validGroups = BATCH_CONFIG[validBatch]?.groups || ['A'];
      const safeGroup = validGroups.includes(initialGroupLetter) ? initialGroupLetter : validGroups[0];
      setSelectedBatch(validBatch);
      setSelectedGroupLetter(safeGroup);
      setActiveColumn('batch');
    }
  }, [isOpen, initialBatch, initialGroupLetter]);

  const handleSelectBatch = (b) => {
    setSelectedBatch(b);
    setActiveColumn('batch');
    const validGroups = BATCH_CONFIG[b]?.groups || ['A'];
    if (!validGroups.includes(selectedGroupLetter)) {
      setSelectedGroupLetter(validGroups[0]);
    }
  };

  const handleSelectGroup = (g) => {
    setSelectedGroupLetter(g);
    setActiveColumn('group');
  };

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        onSave(selectedBatch, selectedGroupLetter);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setActiveColumn('batch');
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setActiveColumn('group');
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (activeColumn === 'batch') {
          const idx = batches.indexOf(selectedBatch);
          const newB = idx > 0 ? batches[idx - 1] : batches[batches.length - 1];
          handleSelectBatch(newB);
        } else {
          const validGroups = BATCH_CONFIG[selectedBatch]?.groups || ['A'];
          const idx = validGroups.indexOf(selectedGroupLetter);
          const newG = idx > 0 ? validGroups[idx - 1] : validGroups[validGroups.length - 1];
          setSelectedGroupLetter(newG);
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (activeColumn === 'batch') {
          const idx = batches.indexOf(selectedBatch);
          const newB = idx < batches.length - 1 ? batches[idx + 1] : batches[0];
          handleSelectBatch(newB);
        } else {
          const validGroups = BATCH_CONFIG[selectedBatch]?.groups || ['A'];
          const idx = validGroups.indexOf(selectedGroupLetter);
          const newG = idx < validGroups.length - 1 ? validGroups[idx + 1] : validGroups[0];
          setSelectedGroupLetter(newG);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, activeColumn, selectedBatch, selectedGroupLetter, onClose, onSave]);

  if (!isOpen) return null;

  const termNum = BATCH_CONFIG[selectedBatch]?.term || 5;

  return (
    <div className="group-picker-backdrop" onClick={onClose}>
      <div
        className="group-picker-container"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Choose batch and group"
      >
        <div className="group-picker-header">
          <h3 className="group-picker-title">Choose batch and group</h3>
          <p className="group-picker-sub">Pick your batch year and group</p>
        </div>

        <div className="picker-wheels-wrapper">
          {/* Batch Column */}
          <div
            className={`picker-wheel-col${activeColumn === 'batch' ? ' col-active' : ''}`}
            onClick={() => setActiveColumn('batch')}
          >
            <div className="picker-wheel-label">Batch</div>
            <div className="picker-wheel-items">
              {batches.map((b) => (
                <button
                  key={b}
                  type="button"
                  className={`picker-wheel-item${selectedBatch === b ? ' selected' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSelectBatch(b);
                  }}
                >
                  {b}
                </button>
              ))}
            </div>
          </div>

          {/* Group Column */}
          <div
            className={`picker-wheel-col${activeColumn === 'group' ? ' col-active' : ''}`}
            onClick={() => setActiveColumn('group')}
          >
            <div className="picker-wheel-label">Group</div>
            <div className="picker-wheel-items">
              {currentGroups.map((g) => (
                <button
                  key={g}
                  type="button"
                  className={`picker-wheel-item${selectedGroupLetter === g ? ' selected' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSelectGroup(g);
                  }}
                >
                  Group {g}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Term follows batch */}
        <div className="picker-term-note">
          Batch {selectedBatch} · <strong>Term {termNum}</strong>
        </div>

        <div className="group-picker-actions">
          <button type="button" className="btn-picker-cancel" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-picker-save"
            onClick={() => onSave(selectedBatch, selectedGroupLetter)}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function MyGroupScreen() {
  const { user, updateSettings } = useAuth();
  const navigate = useNavigate();
  const weekDays = getCurrentWeekDays();
  const todayStr = getTodayStr();
  const tomorrowStr = getTomorrowStr();

  const savedBatchRaw = localStorage.getItem('freeroom_student_batch');
  const savedGroupRaw = localStorage.getItem('freeroom_student_group');

  // PRD v6 Section 3: Check if valid batch and group are present in local storage
  const hasValidSavedChoice = (() => {
    if (!savedBatchRaw || !savedGroupRaw) return false;
    const b = parseInt(savedBatchRaw, 10);
    if (!BATCH_LIST.includes(b)) return false;
    const letter = savedGroupRaw.replace(/^Group\s*/i, '').trim();
    const validGroups = BATCH_CONFIG[b]?.groups || [];
    return validGroups.includes(letter);
  })();

  const [batch, setBatch] = useState(() => {
    if (savedBatchRaw) {
      const b = parseInt(savedBatchRaw, 10);
      if (BATCH_LIST.includes(b)) return b;
    }
    return 2029;
  });
  const [group, setGroup] = useState(() => savedGroupRaw || 'Group A');
  const [hasPicked, setHasPicked] = useState(hasValidSavedChoice);
  const [showPicker, setShowPicker] = useState(!hasValidSavedChoice);
  // Default to next day as requested
  const [selectedDay, setSelectedDay] = useState(tomorrowStr);
  const [schedule, setSchedule] = useState(null);
  const [loading, setLoading] = useState(false);

  const groupLetter = group.replace(/^Group\s*/i, '').trim() || 'A';
  const termNum = BATCH_CONFIG[batch]?.term || 5;

  // PRD v6 Section 3: On sign-in, if account already has settings, account's settings win
  useEffect(() => {
    if (user?.settings?.batch && user?.settings?.group) {
      const b = user.settings.batch;
      const g = user.settings.group;
      if (BATCH_LIST.includes(b)) {
        setBatch(b);
        setGroup(g);
        setHasPicked(true);
        localStorage.setItem('freeroom_student_batch', String(b));
        localStorage.setItem('freeroom_student_group', g);
      }
    }
  }, [user]);

  // Auto-heal invalid group if loaded from previous mismatched state (e.g. 2028 with Group C)
  useEffect(() => {
    if (!hasPicked) return;
    const validGroups = BATCH_CONFIG[batch]?.groups || ['A'];
    if (!validGroups.includes(groupLetter)) {
      const fixedGroup = `Group ${validGroups[0]}`;
      setGroup(fixedGroup);
      localStorage.setItem('freeroom_student_group', fixedGroup);
      if (user && updateSettings) {
        updateSettings({ batch, group: fixedGroup });
      }
    }
  }, [batch, groupLetter, hasPicked, user, updateSettings]);

  const handleSavePicker = (newBatch, newGroupLetter) => {
    const validGroups = BATCH_CONFIG[newBatch]?.groups || ['A'];
    const safeLetter = validGroups.includes(newGroupLetter) ? newGroupLetter : validGroups[0];
    const fullGroup = `Group ${safeLetter}`;
    setBatch(newBatch);
    setGroup(fullGroup);
    localStorage.setItem('freeroom_student_batch', String(newBatch));
    localStorage.setItem('freeroom_student_group', fullGroup);
    setHasPicked(true);
    setShowPicker(false);

    // PRD v6 Section 3: If signed in, sync to account across devices
    if (user && updateSettings) {
      updateSettings({ batch: newBatch, group: fullGroup });
    }
  };

  const fetchSchedule = useCallback(async (d) => {
    if (!hasPicked) return;
    setLoading(true);
    try {
      const res = await roomsAPI.getMyGroup({
        batchYear: batch,
        group,
        date: d,
        buildingId: 1,
      });
      setSchedule(res.data);
    } catch {
      toast.error('Failed to load group schedule');
    } finally {
      setLoading(false);
    }
  }, [batch, group, hasPicked]);

  useEffect(() => {
    if (hasPicked) {
      fetchSchedule(selectedDay);
    }
  }, [fetchSchedule, selectedDay, hasPicked]);

  const dateHeading = (() => {
    if (!selectedDay) return '';
    const [y, m, d] = selectedDay.split('-').map(Number);
    const dateObj = new Date(y, m - 1, d);
    return dateObj.toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'short',
    });
  })();

  return (
    <section id="screen-mygroup" className="screen active">
      <div className="mygroup-layout">
        {/* Left Sidebar / Mobile Top Controls */}
        <div className="mygroup-sidebar">
          <div className="group-info-card">
            <div>
              <div className="group-name" id="group-title">Group {groupLetter}</div>
              <div className="group-batch">Batch {batch} · Term {termNum}</div>
            </div>
            <button className="change-btn" id="btn-change-group" onClick={() => setShowPicker(true)}>Change</button>
          </div>

          <div className="days-grid" role="group" aria-label="Select Day">
            {weekDays.map((d) => (
              <button
                key={d.dateStr}
                className={`day-btn${selectedDay === d.dateStr ? ' active' : ''}`}
                onClick={() => setSelectedDay(d.dateStr)}
              >
                <span className="day-name">{d.dayName}</span>
                <span className="day-num">{d.dayNum}</span>
              </button>
            ))}
          </div>

          <div style={{ marginTop: '12px' }}>
            <DatePicker
              value={selectedDay}
              onChange={setSelectedDay}
              label="Other date…"
              id="mygroup-date"
              hideQuickPills={true}
              hideDefaultLabel={true}
            />
          </div>
        </div>

        {/* Right Schedule Timeline */}
        <div className="mygroup-schedule">
          <div className="schedule-header-pc">
            <h2 className="schedule-day-title" id="schedule-date-heading">{dateHeading}</h2>
            <span className="schedule-summary">
              {schedule?.classes?.length || 0} classes · {schedule?.gaps?.length || 0} {schedule?.gaps?.length === 1 ? 'gap' : 'gaps'}
            </span>
          </div>

          {!hasPicked ? (
            <div style={{ textAlign: 'center', padding: '56px 20px', background: 'var(--bg-card)', borderRadius: 'var(--radius-card)', border: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: '18px', fontWeight: 700, marginBottom: '8px' }}>Select your batch & group</div>
              <p style={{ color: 'var(--text-secondary)', fontSize: '13.5px', marginBottom: '20px', maxWidth: '380px', margin: '0 auto 20px' }}>
                Please choose your batch and group to view your classes, timetable, and study gaps.
              </p>
              <button className="btn btn-primary" onClick={() => setShowPicker(true)}>
                Choose Batch & Group
              </button>
            </div>
          ) : loading ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-secondary)' }}>
              Loading schedule…
            </div>
          ) : !schedule ? null : schedule.is_no_class_day ? (
            <div style={{ textAlign: 'center', padding: '48px 16px', background: 'var(--bg-card)', borderRadius: 'var(--radius-card)', border: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: '18px', fontWeight: 700, marginBottom: '6px' }}>Holiday · {schedule.no_class_reason}</div>
              <p style={{ color: 'var(--text-secondary)', fontSize: '13.5px' }}>No academic classes today. Classrooms are open for self-study.</p>
            </div>
          ) : schedule.classes?.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 16px', background: 'var(--bg-card)', borderRadius: 'var(--radius-card)', border: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: '18px', fontWeight: 700, marginBottom: '6px' }}>No classes scheduled for today</div>
              <p style={{ color: 'var(--text-secondary)', fontSize: '13.5px' }}>All classrooms are free to use.</p>
            </div>
          ) : (
            <div className="timeline-list">
              {schedule.classes.map((cls, idx) => {
                const now = new Date();
                const [sh, sm] = cls.start_time.split(':').map(Number);
                const [eh, em] = cls.end_time.split(':').map(Number);
                const nowMinutes = now.getHours() * 60 + now.getMinutes();
                const isNow = selectedDay === todayStr && nowMinutes >= (sh * 60 + sm) && nowMinutes < (eh * 60 + em);
                const isLab = (cls.entry_type || '').toLowerCase() === 'lab';

                const gapAfter = schedule.gaps?.find((g) => g.start === cls.end_time);
                const visibleGapRooms = gapAfter?.free_rooms ? filterGapRooms(gapAfter.free_rooms) : [];

                return (
                  <div key={cls.id || idx}>
                    <div className={`class-card${isNow ? ' active-now' : ''}`}>
                      <div>
                        <div className="class-time-row">
                          <span>{formatTime12(cls.start_time)} – {formatTime12(cls.end_time)}</span>
                          {isNow && <span className="now-badge">Now</span>}
                        </div>
                        <div className="class-title">
                          {cls.subject} {isLab ? '(Lab)' : ''}
                        </div>
                        <div className="class-loc">
                          {cls.instructor ? `${cls.instructor} · ` : ''}{cls.floor} floor
                        </div>
                      </div>
                      <button
                        type="button"
                        className="room-pill-badge"
                        onClick={() => navigate(`/find?mode=room&room=${encodeURIComponent(cls.room_name)}`)}
                        style={{ cursor: 'pointer', border: 'none' }}
                        title={`View schedule for Room ${cls.room_name}`}
                      >
                        {cls.room_name}
                      </button>
                    </div>

                    {/* Gap between classes */}
                    {gapAfter && (
                      <div className="gap-block">
                        <div className="gap-title">
                          {gapAfter.duration_minutes} min free · {formatTime12(gapAfter.start)} – {formatTime12(gapAfter.end)}
                        </div>
                        {visibleGapRooms.length > 0 && (
                          <div className="gap-rooms">
                            {visibleGapRooms.map((r) => (
                              <button
                                key={r.id || r.name}
                                className="gap-room-pill"
                                onClick={() => navigate(`/find?mode=room&room=${encodeURIComponent(r.name)}`)}
                                title={`${r.name} · ${r.floor} floor`}
                              >
                                {r.name}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {showPicker && (
        <GroupPickerModal
          isOpen={showPicker}
          onClose={() => setShowPicker(false)}
          initialBatch={batch}
          initialGroupLetter={groupLetter}
          onSave={handleSavePicker}
        />
      )}
    </section>
  );
}

/* =========================================================
   ROOT DASHBOARD PAGE ROUTER
   ========================================================= */
export default function DashboardPage({ defaultTab = 'now' }) {
  return (
    <div className="freeroom-app">
      <Navbar />
      <main className="app-main">
        {defaultTab === 'now' && <FreeNowScreen />}
        {defaultTab === 'window' && <FindRoomScreen />}
        {defaultTab === 'group' && <MyGroupScreen />}
      </main>
    </div>
  );
}
