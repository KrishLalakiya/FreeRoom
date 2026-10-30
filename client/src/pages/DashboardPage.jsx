import { useState, useEffect, useCallback, useRef } from 'react';
import { HiChevronLeft, HiChevronRight, HiOutlineCalendar } from 'react-icons/hi';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { roomsAPI, DEFAULT_BUILDING_ID } from '../services/api';
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

function getMondayOf(date) {
  const d = new Date(date);
  const dow = d.getDay(); // 0=Sun
  d.setDate(d.getDate() - ((dow + 6) % 7));
  d.setHours(0, 0, 0, 0);
  return d;
}

function getWeekDaysFromMonday(mondayDate) {
  const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(mondayDate);
    d.setDate(mondayDate.getDate() + i);
    const dateStr = formatLocalDateStr(d);
    return {
      dateStr,
      dayName: names[i],
      dayNum: d.getDate(),
      month: d.toLocaleDateString('en-US', { month: 'short' }),
      monthNum: d.getMonth(),
      year: d.getFullYear(),
      label: d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' }),
    };
  });
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

export function isClassOnlyRoom(name) {
  return (name || '').toUpperCase() === 'SSB';
}

function FreeNowScreen() {
  const { user } = useAuth();
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

  const DURATION_MAP = { any: 1, '30m': 30, '1h': 60, '2h': 120 };

  const [freenowError, setFreenowError] = useState(false);
  const freenowReqIdRef = useRef(0);

  const fetchRooms = useCallback(async () => {
    const reqId = ++freenowReqIdRef.current;
    setFreenowError(false);
    setLoading(true);
    try {
      const minDuration = DURATION_MAP[durationKey] ?? 30;
      const storedBatch = user?.settings?.batch || localStorage.getItem('freeroom_student_batch');
      const storedGroup = user?.settings?.group || localStorage.getItem('freeroom_student_group');
      const params = { buildingId: DEFAULT_BUILDING_ID, minDuration };
      if (storedBatch) params.batchYear = storedBatch;
      if (storedGroup) params.group = storedGroup;
      if (floor !== 'all') params.floor = floor;
      const res = await roomsAPI.getFreeNow(params);
      if (reqId !== freenowReqIdRef.current) return;
      setRooms(res.data.rooms || []);
      setClosedRooms(res.data.closed_rooms || []);
      setNextDayData(res.data.next_day || null);
      setIsAfterHours(!!res.data.is_after_last_class);
      const mockStr = window.__MOCK_TIME__ || localStorage.getItem('freeroom_mock_time');
      setLastUpdated(mockStr ? new Date(mockStr) : new Date());
    } catch (err) {
      if (reqId === freenowReqIdRef.current) {
        console.error('fetchRooms error:', err?.response?.data || err?.message || err);
        toast.error('Failed to load live availability');
        setFreenowError(true);
      }
    } finally {
      if (reqId === freenowReqIdRef.current) {
        setLoading(false);
      }
    }
  }, [durationKey, floor]);

  useEffect(() => {
    fetchRooms();
  }, [fetchRooms]);

  useEffect(() => {
    const id = setInterval(fetchRooms, 60000);
    return () => clearInterval(id);
  }, [fetchRooms]);

  const nextDayCacheRef = useRef({});

  const handleSelectDay = async (dateStr) => {
    if (nextDayCacheRef.current[dateStr]) {
      setNextDayData(nextDayCacheRef.current[dateStr]);
      return;
    }
    setLoadingNextDay(true);
    try {
      const res = await roomsAPI.getNextTimetable({ date: dateStr, buildingId: DEFAULT_BUILDING_ID });
      nextDayCacheRef.current[dateStr] = res.data;
      setNextDayData(res.data);
    } catch {
      toast.error('Failed to load timetable for selected day');
    } finally {
      setLoadingNextDay(false);
    }
  };

  // Room SSB is class-only for all batches; never shown as a free study room
  const isFreeStudyRoom = (r) => !isClassOnlyRoom(r?.name);
  const visibleRooms = rooms.filter(isFreeStudyRoom);
  const visibleClosedRooms = closedRooms.filter(isFreeStudyRoom);
  const allRooms = [...visibleRooms, ...visibleClosedRooms];
  const count = visibleRooms.length;
  const updatedStr = lastUpdated
    ? lastUpdated.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })
    : '--';

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

  const shouldShowNextDay = isAfterHours && !!nextDayData;

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
          <h1 className="page-title">{shouldShowNextDay ? (isAfterHours ? 'All classes are over for today' : 'Next Day Timetable') : 'Free now'}</h1>
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
      ) : freenowError ? (
        <div style={{ textAlign: 'center', padding: '48px 16px', background: 'var(--bg-card)', borderRadius: 'var(--radius-card)', border: '1px solid var(--border-subtle)' }}>
          <div style={{ fontSize: '16px', fontWeight: 600, marginBottom: '8px', color: 'var(--text-primary)' }}>Failed to load live availability</div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '13.5px', marginBottom: '16px' }}>Could not connect to the campus server.</p>
          <button className="btn btn-primary" onClick={fetchRooms}>
            Retry
          </button>
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
                    {isAfterHours ? 'All classes are over for today' : 'No classrooms free right now'}
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
                  {(nextDayData?.rooms || []).filter(isFreeStudyRoom).filter((r) => r.status === 'free').length || 0} classrooms free morning
                </span>
              </div>

              <div className="rooms-grid" id="freenow-nextday-grid">
                {(nextDayData?.rooms || []).filter(isFreeStudyRoom).map((room) => (
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
const BASE_ROOM_LIST = ['C', '1A', '1B', '2A', '2B', '2C'];
const ROOM_LIST = ['C', '1A', '1B', '2A', '2B', '2C', 'SSB'];

const ROOM_META = {
  'C': { floor: 'Ground', seats: 200, submeta: null },
  '1A': { floor: '1st', seats: 200, submeta: null },
  '1B': { floor: '1st', seats: 200, submeta: null },
  '2A': { floor: '2nd', seats: 200, submeta: null },
  '2B': { floor: '2nd', seats: 200, submeta: null },
  '2B1': { floor: '2nd', seats: 100, submeta: null },
  '2B2': { floor: '2nd', seats: 100, submeta: null },
  '2C': { floor: '2nd', seats: 200, submeta: null },
  'SSB': { floor: 'Ground', seats: 200, submeta: 'Class Access Only · No Open Study Seating' },
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

  // By room mode: all batches have class access to SSB, but it is class-only (no open seating)
  const availableRoomsList = ROOM_LIST;

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
      const last = user.settings?.lastDateWindow;
      if (last?.date !== date || last?.fromTime !== fromTime || last?.toTime !== toTime) {
        updateSettings({ lastDateWindow: { date, fromTime, toTime } });
      }
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

  const [freeRoomsError, setFreeRoomsError] = useState(false);
  const [timelineError, setTimelineError] = useState(false);
  const freeRoomsReqIdRef = useRef(0);
  const timelineReqIdRef = useRef(0);

  // Perform search for Free rooms mode
  const fetchFreeRooms = useCallback(async () => {
    setFreeRoomsError(false);
    if (fromTime >= toTime) {
      toast.error('Start time must be earlier than end time');
      return;
    }
    const reqId = ++freeRoomsReqIdRef.current;
    setLoadingFree(true);
    try {
      const params = { buildingId: DEFAULT_BUILDING_ID, date, startTime: fromTime, endTime: toTime };
      if (floor !== 'all') params.floor = floor;
      const res = await roomsAPI.getFreeWindow(params);
      if (reqId !== freeRoomsReqIdRef.current) return;
      setRooms(res.data.rooms || []);
      setClosedRooms(res.data.closed_rooms || []);
      setSearchReason(res.data.reason || null);
    } catch (err) {
      if (reqId === freeRoomsReqIdRef.current) {
        toast.error(err.response?.data?.message || 'Search failed');
        setFreeRoomsError(true);
      }
    } finally {
      if (reqId === freeRoomsReqIdRef.current) {
        setLoadingFree(false);
      }
    }
  }, [date, fromTime, toTime, floor]);

  useEffect(() => {
    if (mode === 'free') {
      fetchFreeRooms();
    }
  }, [mode, fetchFreeRooms]);

  // Fetch timeline for By room mode
  const fetchTimeline = useCallback(async () => {
    const reqId = ++timelineReqIdRef.current;
    setTimelineError(false);
    setLoadingTimeline(true);
    try {
      const res = await roomsAPI.getTimeline(selectedRoom, date);
      if (reqId !== timelineReqIdRef.current) return;
      setTimelineData(res.data);
    } catch (err) {
      if (reqId === timelineReqIdRef.current) {
        toast.error(err.response?.data?.message || `Failed to load schedule for Room ${selectedRoom}`);
        setTimelineError(true);
      }
    } finally {
      if (reqId === timelineReqIdRef.current) {
        setLoadingTimeline(false);
      }
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
      const isClassOnly = isClassOnlyRoom(selectedRoom);
      slots.push({
        type: isClassOnly ? 'no_seating' : 'free',
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

      const batch = bb.batch_year ? `Batch ${bb.batch_year}` : '';
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
                {availableRoomsList.map((rName) => (
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
              ) : freeRoomsError ? (
                <div style={{ textAlign: 'center', padding: '48px 16px', background: 'var(--bg-card)', borderRadius: 'var(--radius-card)', border: '1px solid var(--border-subtle)' }}>
                  <div style={{ fontSize: '16px', fontWeight: 600, marginBottom: '8px', color: 'var(--text-primary)' }}>Failed to load rooms</div>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '16px' }}>Could not check room availability for this window.</p>
                  <button className="btn btn-primary" onClick={fetchFreeRooms}>
                    Retry
                  </button>
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
              ) : timelineError ? (
                <div style={{ textAlign: 'center', padding: '48px 16px', background: 'var(--bg-card)', borderRadius: 'var(--radius-card)', border: '1px solid var(--border-subtle)' }}>
                  <div style={{ fontSize: '16px', fontWeight: 600, marginBottom: '8px', color: 'var(--text-primary)' }}>Failed to load room schedule</div>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '16px' }}>Could not fetch schedule for Room {selectedRoom}.</p>
                  <button className="btn btn-primary" onClick={fetchTimeline}>
                    Retry
                  </button>
                </div>
              ) : timelineSlots.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '48px 16px', background: 'var(--bg-card)', borderRadius: 'var(--radius-card)', border: '1px solid var(--border-subtle)' }}>
                  <div style={{ fontSize: '16px', fontWeight: 700, marginBottom: '6px' }}>
                    No timetable scheduled for this date
                  </div>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
                    {isClassOnlyRoom(selectedRoom)
                      ? 'Room SSB is reserved for scheduled classes only. No open study seating allowed.'
                      : `Room ${selectedRoom} is free for open study.`}
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
                    if (slot.type === 'no_seating') {
                      return (
                        <div key={idx} className="fr-slot" style={{ opacity: 0.65, border: '1px dashed var(--border-control)' }}>
                          <div className="fr-slot-top">
                            <span>{slot.timeRange}</span>
                            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                              No seating · Classes only
                            </span>
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
  // SSB is class-only; never suggest as a break study room for any batch
  let list = roomsList.filter((r) => !isClassOnlyRoom(r?.name));
  const names = new Set(list.map((r) => r.name));
  const has2B = names.has('2B');
  const has2B1 = names.has('2B1');
  const has2B2 = names.has('2B2');

  // Rule: show 2B only when 2B1 and 2B2 are both free.
  // Otherwise show the free halves as 2B1 and/or 2B2, and do not show 2B.
  if (has2B1 && has2B2) {
    const withoutHalves = list.filter((r) => r.name !== '2B1' && r.name !== '2B2');
    if (!has2B) {
      withoutHalves.push({ id: '2B', name: '2B', floor: '2nd' });
    }
    return withoutHalves;
  }

  if (has2B1 || has2B2) {
    return list.filter((r) => r.name !== '2B');
  }

  return list;
}

const DEFAULT_BATCH_CONFIG = {
  2027: { groups: ['A'], term: 14 },
  2028: { groups: ['A', 'B'], term: 10 },
  2029: { groups: ['A', 'B', 'C'], term: 6 },
  2030: { groups: ['A', 'B', 'C', 'D'], term: 2 },
};

const BATCH_CONFIG = DEFAULT_BATCH_CONFIG;

const BATCH_LIST = [2027, 2028, 2029, 2030];

function GroupPickerModal({
  isOpen,
  onClose,
  initialBatch,
  initialGroupLetter,
  onSave,
  batchConfig = DEFAULT_BATCH_CONFIG,
}) {
  const [selectedBatch, setSelectedBatch] = useState(initialBatch);
  const [selectedGroupLetter, setSelectedGroupLetter] = useState(initialGroupLetter);
  const [activeColumn, setActiveColumn] = useState('batch');

  const config = batchConfig || DEFAULT_BATCH_CONFIG;
  const batches = BATCH_LIST;
  const currentGroups = config[selectedBatch]?.groups || ['A'];

  useEffect(() => {
    if (isOpen) {
      const validBatch = BATCH_LIST.includes(initialBatch) ? initialBatch : 2029;
      const validGroups = config[validBatch]?.groups || ['A'];
      const safeGroup = validGroups.includes(initialGroupLetter) ? initialGroupLetter : validGroups[0];
      setSelectedBatch(validBatch);
      setSelectedGroupLetter(safeGroup);
      setActiveColumn('batch');
    }
  }, [isOpen, initialBatch, initialGroupLetter, config]);

  const handleSelectBatch = (b) => {
    setSelectedBatch(b);
    setActiveColumn('batch');
    const validGroups = config[b]?.groups || ['A'];
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
          const validGroups = config[selectedBatch]?.groups || ['A'];
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
          const validGroups = config[selectedBatch]?.groups || ['A'];
          const idx = validGroups.indexOf(selectedGroupLetter);
          const newG = idx < validGroups.length - 1 ? validGroups[idx + 1] : validGroups[0];
          setSelectedGroupLetter(newG);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, activeColumn, selectedBatch, selectedGroupLetter, onClose, onSave, batches, config]);

  if (!isOpen) return null;

  const termNum = config[selectedBatch]?.term || 6;

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
  const todayStr = getTodayStr();
  const tomorrowStr = getTomorrowStr();
  const scheduleRef = useRef(null);

  // Dynamic Week Monday state initialized to Monday of the initial day
  const [weekMonday, setWeekMonday] = useState(() => {
    const initDate = tomorrowStr
      ? new Date(Number(tomorrowStr.split('-')[0]), Number(tomorrowStr.split('-')[1]) - 1, Number(tomorrowStr.split('-')[2]))
      : new Date();
    return getMondayOf(initDate);
  });

  const weekDays = getWeekDaysFromMonday(weekMonday);

  const weekRangeLabel = (() => {
    if (!weekDays || weekDays.length === 0) return '';
    const startDay = weekDays[0];
    const endDay = weekDays[5];
    if (startDay.month === endDay.month) {
      return `${startDay.dayNum} – ${endDay.dayNum} ${startDay.month}`;
    }
    return `${startDay.dayNum} ${startDay.month} – ${endDay.dayNum} ${endDay.month}`;
  })();

  const isCurrentWeek = (() => {
    const curMon = getMondayOf(new Date());
    return (
      curMon.getFullYear() === weekMonday.getFullYear() &&
      curMon.getMonth() === weekMonday.getMonth() &&
      curMon.getDate() === weekMonday.getDate()
    );
  })();

  const changeWeekBy = (deltaDays) => {
    setWeekMonday((prevMonday) => {
      const nextMon = new Date(prevMonday);
      nextMon.setDate(nextMon.getDate() + deltaDays);

      if (selectedDay) {
        const [y, m, d] = selectedDay.split('-').map(Number);
        const currDate = new Date(y, m - 1, d);
        const dow = currDate.getDay();
        const offset = dow === 0 ? 0 : dow - 1; // 0 for Mon ... 5 for Sat
        const targetDate = new Date(nextMon);
        targetDate.setDate(nextMon.getDate() + Math.min(Math.max(offset, 0), 5));
        setSelectedDay(formatLocalDateStr(targetDate));
      }

      return nextMon;
    });
  };

  const goToPrevWeek = () => changeWeekBy(-7);
  const goToNextWeek = () => changeWeekBy(7);

  const goToCurrentWeek = () => {
    const today = new Date();
    setWeekMonday(getMondayOf(today));
    setSelectedDay(formatLocalDateStr(today));
  };

  const handleSelectCustomDate = (dateStr) => {
    setSelectedDay(dateStr);
    if (dateStr) {
      const [y, m, d] = dateStr.split('-').map(Number);
      setWeekMonday(getMondayOf(new Date(y, m - 1, d)));
    }
  };

  // Touch Swipe for Week: swipe left -> next week, swipe right -> prev week
  const weekTouchStartX = useRef(null);
  const weekTouchStartY = useRef(null);
  const weekTouchStartTime = useRef(null);
  const lastWeekSwipeTime = useRef(0);

  const handleWeekTouchStart = (e) => {
    if (e.touches && e.touches[0]) {
      weekTouchStartX.current = e.touches[0].clientX;
      weekTouchStartY.current = e.touches[0].clientY;
      weekTouchStartTime.current = Date.now();
    }
  };

  const handleWeekTouchEnd = (e) => {
    if (weekTouchStartX.current == null || weekTouchStartY.current == null) return;
    const now = Date.now();
    // Enforce cooldown so only a single week is swiped at a time (slow down single scroll)
    if (now - lastWeekSwipeTime.current < 450) {
      weekTouchStartX.current = null;
      weekTouchStartY.current = null;
      return;
    }

    const touchEndX = e.changedTouches[0].clientX;
    const touchEndY = e.changedTouches[0].clientY;
    const dx = touchEndX - weekTouchStartX.current;
    const dy = touchEndY - weekTouchStartY.current;
    const dt = now - (weekTouchStartTime.current || 0);

    // Clear horizontal swipe intent
    if (Math.abs(dx) > Math.abs(dy) * 1.3 && (Math.abs(dx) > 35 || (Math.abs(dx) > 20 && dt < 250))) {
      lastWeekSwipeTime.current = now;
      if (dx < 0) {
        // Swiped left (finger moves right to left) -> upcoming / next week
        goToNextWeek();
      } else {
        // Swiped right (finger moves left to right) -> previous week
        goToPrevWeek();
      }
    }

    weekTouchStartX.current = null;
    weekTouchStartY.current = null;
    weekTouchStartTime.current = null;
  };

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

  // Reset right schedule scroll to top on day change
  useEffect(() => {
    if (scheduleRef.current) {
      scheduleRef.current.scrollTop = 0;
    }
  }, [selectedDay]);

  const [batchConfig, setBatchConfig] = useState(DEFAULT_BATCH_CONFIG);

  useEffect(() => {
    let mounted = true;
    roomsAPI.getBatchesAndGroups()
      .then((res) => {
        if (!mounted || !res.data?.batches) return;
        const next = { ...DEFAULT_BATCH_CONFIG };
        res.data.batches.forEach((b) => {
          next[b.batchYear] = {
            groups: b.groups && b.groups.length > 0 ? b.groups : (next[b.batchYear]?.groups || ['A']),
            term: b.currentTerm || next[b.batchYear]?.term || 1,
          };
        });
        setBatchConfig(next);
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  const groupLetter = group.replace(/^Group\s*/i, '').trim() || 'A';
  const termNum = schedule?.term?.term_number || batchConfig[batch]?.term || DEFAULT_BATCH_CONFIG[batch]?.term || 6;

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
    const validGroups = (batchConfig || DEFAULT_BATCH_CONFIG)[batch]?.groups || ['A'];
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
    const validGroups = (batchConfig || DEFAULT_BATCH_CONFIG)[newBatch]?.groups || ['A'];
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

  const scheduleCacheRef = useRef({});
  const [scheduleError, setScheduleError] = useState(false);
  const scheduleReqIdRef = useRef(0);

  const fetchSchedule = useCallback(async (d, force = false) => {
    if (!hasPicked) return;
    const cacheKey = `${batch}-${group}-${d}`;
    const cached = scheduleCacheRef.current[cacheKey];
    const now = Date.now();
    if (!force && cached && (now - cached.timestamp < 60000)) {
      setSchedule(cached.data);
      return;
    }
    const reqId = ++scheduleReqIdRef.current;
    setLoading(true);
    try {
      const res = await roomsAPI.getMyGroup({
        batchYear: batch,
        group,
        date: d,
        buildingId: DEFAULT_BUILDING_ID,
      });
      if (reqId !== scheduleReqIdRef.current) return;
      scheduleCacheRef.current[cacheKey] = { data: res.data, timestamp: Date.now() };
      setSchedule(res.data);
    } catch {
      if (reqId === scheduleReqIdRef.current) {
        toast.error('Failed to load group schedule');
        setScheduleError(true);
      }
    } finally {
      if (reqId === scheduleReqIdRef.current) {
        setLoading(false);
      }
    }
  }, [batch, group, hasPicked]);

  useEffect(() => {
    if (hasPicked) {
      fetchSchedule(selectedDay);
    }
  }, [fetchSchedule, selectedDay, hasPicked]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && hasPicked && selectedDay) {
        fetchSchedule(selectedDay, true);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [fetchSchedule, hasPicked, selectedDay]);

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

          {/* Week Navigation Header (Range + PC Prev/Next Buttons + Today Jump) */}
          <div className="week-nav-bar">
            <div className="week-nav-info">
              <span className="week-nav-range">{weekRangeLabel}</span>
              {!isCurrentWeek && (
                <button
                  type="button"
                  className="week-nav-today-btn"
                  onClick={goToCurrentWeek}
                  title="Return to this week"
                >
                  This week
                </button>
              )}
            </div>
            <div className="week-nav-arrows">
              <button
                type="button"
                className="week-nav-btn"
                onClick={goToPrevWeek}
                title="Previous week (or swipe right)"
                aria-label="Previous week"
              >
                ‹
              </button>
              <button
                type="button"
                className="week-nav-btn"
                onClick={goToNextWeek}
                title="Next week (or swipe left)"
                aria-label="Next week"
              >
                ›
              </button>
            </div>
          </div>

          <div
            className="days-grid"
            role="group"
            aria-label="Select Day"
            onTouchStart={handleWeekTouchStart}
            onTouchEnd={handleWeekTouchEnd}
            style={{ touchAction: "pan-y" }}
          >
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
              onChange={handleSelectCustomDate}
              label="Other date…"
              id="mygroup-date"
              hideQuickPills={true}
              hideDefaultLabel={true}
            />
          </div>
        </div>

        {/* Right Schedule Timeline */}
        <div className="mygroup-schedule" ref={scheduleRef}>
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
          ) : scheduleError ? (
            <div style={{ textAlign: 'center', padding: '48px 16px', background: 'var(--bg-card)', borderRadius: 'var(--radius-card)', border: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: '16px', fontWeight: 600, marginBottom: '8px', color: 'var(--text-primary)' }}>Failed to load group schedule</div>
              <p style={{ color: 'var(--text-secondary)', fontSize: '13.5px', marginBottom: '16px' }}>Could not fetch schedule for this day.</p>
              <button className="btn btn-primary" onClick={() => fetchSchedule(selectedDay)}>
                Retry
              </button>
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
                const otherFreeRooms = visibleGapRooms.filter(
                  (r) => !gapAfter?.plan?.chain?.some((s) => s.room_name === r.name)
                );

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

                    {/* Gap between classes / after last class (PRD v8 Room Chaining) */}
                    {gapAfter && (
                      <div className="gap-block">
                        <div className="gap-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                          <span>
                            {gapAfter.is_after_last_class ? 'After classes' : 'Break'} · {gapAfter.duration_minutes >= 60 ? `${Math.floor(gapAfter.duration_minutes / 60)} h ${gapAfter.duration_minutes % 60 ? `${gapAfter.duration_minutes % 60} m` : ''}`.trim() : `${gapAfter.duration_minutes} min`} ({formatTime12(gapAfter.start)} – {formatTime12(gapAfter.end)})
                          </span>
                          {gapAfter.plan?.is_covered && (
                            <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '12px', background: 'rgba(16, 185, 129, 0.15)', color: 'var(--green-text, #10b981)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                              {gapAfter.plan.level <= 2 ? 'Single Room' : 'Room Chain'}
                            </span>
                          )}
                        </div>

                        {/* PRD v8: Recommended Room or Chain Plan */}
                        {gapAfter.plan?.is_covered && gapAfter.plan.chain?.length > 0 ? (
                          gapAfter.plan.chain.length === 1 ? (
                            <div style={{ marginTop: '8px', padding: '10px 14px', background: 'var(--bg-subtle, rgba(255,255,255,0.03))', borderRadius: '8px', border: '1px solid var(--border-subtle, rgba(255,255,255,0.08))' }}>
                              <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)', marginBottom: '6px' }}>
                                Recommended for whole gap:
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                                <button
                                  type="button"
                                  className="gap-room-pill"
                                  style={{ padding: '6px 14px', fontSize: '13px', fontWeight: 700 }}
                                  onClick={() => navigate(`/find?mode=room&room=${encodeURIComponent(gapAfter.plan.chain[0].room_name)}`)}
                                >
                                  Room {gapAfter.plan.chain[0].room_name}
                                </button>
                                <span style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                                  {gapAfter.plan.chain[0].start_12h} – {gapAfter.plan.chain[0].end_12h} ({gapAfter.plan.chain[0].duration_minutes} min)
                                </span>
                              </div>
                            </div>
                          ) : (
                            <div style={{ marginTop: '8px', padding: '10px 14px', background: 'var(--bg-subtle, rgba(255,255,255,0.03))', borderRadius: '8px', border: '1px solid var(--border-subtle, rgba(255,255,255,0.08))' }}>
                              <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)', marginBottom: '8px', fontWeight: 500 }}>
                                {gapAfter.plan.description}
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                {gapAfter.plan.chain.map((step, sIdx) => (
                                  <div key={sIdx} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                                    <button
                                      type="button"
                                      className="gap-room-pill"
                                      style={{ padding: '5px 12px', fontSize: '12.5px', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                                      onClick={() => navigate(`/find?mode=room&room=${encodeURIComponent(step.room_name)}`)}
                                      title={`View Room ${step.room_name} schedule`}
                                    >
                                      <span>Room {step.room_name}</span>
                                      <span style={{ opacity: 0.75, fontSize: '11px', fontWeight: 500 }}>
                                        ({step.start_12h} – {step.end_12h})
                                      </span>
                                    </button>
                                    {sIdx < gapAfter.plan.chain.length - 1 && (
                                      <span style={{ color: 'var(--text-secondary)', fontWeight: 700, fontSize: '14px' }}>→</span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )
                        ) : gapAfter.plan && !gapAfter.plan.is_covered && gapAfter.plan.level === 5 ? (
                          <div style={{ marginTop: '8px', padding: '10px 14px', background: 'var(--bg-subtle, rgba(255,255,255,0.03))', borderRadius: '8px', border: '1px dashed var(--border-control)' }}>
                            <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)', marginBottom: '6px' }}>
                              Gap not fully covered by a single plan. Longest available stretches:
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                              {gapAfter.plan.longest_stretches?.map((stretch, stIdx) => (
                                <button
                                  key={stIdx}
                                  type="button"
                                  className="gap-room-pill"
                                  style={{ padding: '4px 10px', fontSize: '12px' }}
                                  onClick={() => navigate(`/find?mode=room&room=${encodeURIComponent(stretch.room_name)}`)}
                                >
                                  Room {stretch.room_name}: {stretch.duration_minutes}m ({stretch.start_12h} – {stretch.end_12h})
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        {/* Other individual rooms that are free for the whole gap */}
                        {otherFreeRooms.length > 0 && (
                          <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Other free rooms:</span>
                            {otherFreeRooms.map((r) => (
                                <button
                                  key={r.id || r.name}
                                  className="gap-room-pill"
                                  onClick={() => navigate(`/find?mode=room&room=${encodeURIComponent(r.name)}`)}
                                  title={`${r.name} · ${r.floor} floor`}
                                  style={{ padding: '3px 8px', fontSize: '12px' }}
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
          batchConfig={batchConfig}
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
