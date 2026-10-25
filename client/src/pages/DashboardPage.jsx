import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { roomsAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import Navbar from '../components/Navbar';
import RoomCard from '../components/RoomCard';
import {
  HiOutlineSearch,
  HiOutlineClock,
  HiOutlineCalendar,
  HiOutlineRefresh,
} from 'react-icons/hi';
import toast from 'react-hot-toast';

const DURATION_OPTIONS = [30, 60, 90, 120, 180];
const FLOOR_OPTIONS = ['All', 'Ground', '1st', '2nd'];

export default function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  // State
  const [mode, setMode] = useState('now'); // 'now' or 'window'
  const [rooms, setRooms] = useState([]);
  const [closedRooms, setClosedRooms] = useState([]);
  const [buildingClosure, setBuildingClosure] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [scheduleStatus, setScheduleStatus] = useState('ok');
  const [scheduleReason, setScheduleReason] = useState(null);
  const [coverage, setCoverage] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [capacityFilter, setCapacityFilter] = useState('all');

  // Free-now filters
  const [minDuration, setMinDuration] = useState(60);
  const [selectedFloor, setSelectedFloor] = useState('All');

  // Window search
  const [searchDate, setSearchDate] = useState(new Date().toISOString().split('T')[0]);
  const [startTime, setStartTime] = useState('14:00');
  const [endTime, setEndTime] = useState('16:00');

  // Free-now query
  const fetchFreeNow = useCallback(async () => {
    setLoading(true);
    try {
      const params = {
        buildingId: 1,
        minDuration,
      };
      if (selectedFloor !== 'All') {
        params.floor = selectedFloor;
      }

      const res = await roomsAPI.getFreeNow(params);
      setRooms(res.data.rooms || []);
      setClosedRooms(res.data.closed_rooms || []);
      setBuildingClosure(res.data.building_closure || null);
      setScheduleStatus(res.data.status || 'ok');
      setScheduleReason(res.data.reason || null);
      setCoverage(res.data.coverage || null);
      setLastUpdated(new Date());
    } catch (err) {
      console.error('Failed to fetch free rooms:', err);
      toast.error('Failed to load rooms');
    } finally {
      setLoading(false);
    }
  }, [minDuration, selectedFloor]);

  // Window search query
  const fetchFreeWindow = async () => {
    if (!searchDate || !startTime || !endTime) {
      toast.error('Please fill in all search fields');
      return;
    }
    if (startTime >= endTime) {
      toast.error('Start time must be before end time');
      return;
    }

    setLoading(true);
    try {
      const params = {
        buildingId: 1,
        date: searchDate,
        startTime,
        endTime,
      };
      if (selectedFloor !== 'All') {
        params.floor = selectedFloor;
      }

      const res = await roomsAPI.getFreeWindow(params);
      setRooms(res.data.rooms || []);
      setClosedRooms(res.data.closed_rooms || []);
      setBuildingClosure(res.data.building_closure || null);
      setScheduleStatus(res.data.status || 'ok');
      setScheduleReason(res.data.reason || null);
      setCoverage(res.data.coverage || null);
      setLastUpdated(new Date());
    } catch (err) {
      console.error('Failed to search rooms:', err);
      toast.error(err.response?.data?.message || 'Search failed');
    } finally {
      setLoading(false);
    }
  };

  // Auto-fetch on mount and when filters change
  useEffect(() => {
    if (mode === 'now') {
      fetchFreeNow();
    }
  }, [fetchFreeNow, mode]);

  // Auto-refresh every 60 seconds for "now" mode
  useEffect(() => {
    if (mode !== 'now') return;
    const interval = setInterval(fetchFreeNow, 60000);
    return () => clearInterval(interval);
  }, [fetchFreeNow, mode]);

  const handleRoomClick = (room) => {
    navigate(`/room/${room.id}`);
  };

  const handleRefresh = () => {
    if (mode === 'now') {
      fetchFreeNow();
    } else {
      fetchFreeWindow();
    }
  };

  // Filtered rooms by query and capacity
  const filteredRooms = useMemo(() => {
    return rooms.filter((r) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesName = r.name.toLowerCase().includes(q);
        const matchesFloor = r.floor.toLowerCase().includes(q);
        const matchesBuilding = r.building_name?.toLowerCase().includes(q);
        if (!matchesName && !matchesFloor && !matchesBuilding) return false;
      }

      if (capacityFilter === '60' && (r.capacity || 0) < 60) return false;
      if (capacityFilter === '100' && (r.capacity || 0) < 100) return false;

      return true;
    });
  }, [rooms, searchQuery, capacityFilter]);

  // Filtered closed rooms (never in free list)
  const filteredClosedRooms = useMemo(() => {
    return closedRooms.filter((r) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesName = r.name.toLowerCase().includes(q);
        const matchesFloor = r.floor.toLowerCase().includes(q);
        const matchesBuilding = r.building_name?.toLowerCase().includes(q);
        if (!matchesName && !matchesFloor && !matchesBuilding) return false;
      }

      if (selectedFloor !== 'All' && r.floor !== selectedFloor) return false;
      if (capacityFilter === '60' && (r.capacity || 0) < 60) return false;
      if (capacityFilter === '100' && (r.capacity || 0) < 100) return false;

      return true;
    });
  }, [closedRooms, searchQuery, selectedFloor, capacityFilter]);

  const firstName = user?.name?.split(' ')[0] || 'there';
  const greeting = getGreeting();

  return (
    <div className="app-container">
      <Navbar />

      {/* Hero Section */}
      <div className="hero-section">
        <div className="live-pill">
          <span className="live-pulse-dot" />
          <span>Live Availability · Pilot Building (9 AM – 8 PM)</span>
        </div>
        <h1 className="hero-title">
          {greeting}, <span className="hero-title-gradient">{firstName}</span>
        </h1>
        <p className="hero-subtitle">
          Find guaranteed empty classrooms on campus. Instant live updates, crowd-verified schedules, and timetable clash detection.
        </p>
      </div>

      {/* Stats Cards */}
      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-value">{filteredRooms.length}</div>
          <div className="stat-label">Rooms Available</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{mode === 'now' ? `${minDuration}m` : 'Window'}</div>
          <div className="stat-label">{mode === 'now' ? 'Min Duration' : 'Custom Slot'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">
            {lastUpdated ? lastUpdated.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }) : '--'}
          </div>
          <div className="stat-label">Last Checked</div>
        </div>
      </div>

      {/* Mode Switcher Tabs */}
      <div className="search-tabs">
        <button
          className={`search-tab ${mode === 'now' ? 'search-tab-active' : ''}`}
          onClick={() => setMode('now')}
          id="tab-free-now"
        >
          <HiOutlineClock size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} />
          Free Right Now
        </button>
        <button
          className={`search-tab ${mode === 'window' ? 'search-tab-active' : ''}`}
          onClick={() => setMode('window')}
          id="tab-search-window"
        >
          <HiOutlineCalendar size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} />
          Search Future Window
        </button>
      </div>

      {/* C9: Building Closure Banner */}
      {(buildingClosure || scheduleStatus === 'closed') && (
        <div className="card fade-in" style={{
          marginBottom: 20,
          borderColor: 'var(--accent-danger)',
          background: 'rgba(239, 68, 68, 0.12)',
          padding: '16px 20px',
        }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <span style={{ fontSize: '1.75rem', lineHeight: 1 }}>🚫</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: '1.05rem', color: 'var(--accent-danger)', marginBottom: 3 }}>
                College closed today for exams{buildingClosure?.reason ? `: ${buildingClosure.reason}` : scheduleReason ? `: ${scheduleReason}` : ''}. No rooms available.
              </div>
              <div style={{ fontSize: '0.86rem', color: 'var(--text-secondary)' }}>
                {buildingClosure?.note || 'Administrative exam or building closure active. All classrooms in this building are closed.'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Schedule unknown banner (outside academic term) */}
      {scheduleStatus === 'unknown' && !buildingClosure && (
        <div className="card fade-in" style={{ marginBottom: 20, borderColor: 'var(--accent-warning, #f59e0b)' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <span style={{ fontSize: '1.25rem' }}>⚠️</span>
            <div>
              <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
                Schedule unknown for this date
              </div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                {coverage?.valid_from
                  ? `The uploaded timetable only covers ${coverage.valid_from} to ${coverage.valid_to}. Rooms are not shown as free outside that range.`
                  : 'No timetable has been uploaded yet. Ask a schedule admin to import the weekly timetable.'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Duration Picker (Free Now mode) */}
      {mode === 'now' && (
        <div className="duration-picker fade-in">
          <div className="duration-picker-label">Minimum Free Time Required</div>
          <div className="duration-picker-options">
            {DURATION_OPTIONS.map((d) => (
              <button
                key={d}
                className={`duration-option ${minDuration === d ? 'duration-option-active' : ''}`}
                onClick={() => setMinDuration(d)}
              >
                {d >= 60 ? `${d / 60}h` : `${d}m`}
                {d < 60 ? '' : d % 60 !== 0 ? ` ${d % 60}m` : ''}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Window Search Form (Responsive Grid on Tablet/PC) */}
      {mode === 'window' && (
        <div className="window-search-form fade-in">
          <div className="window-search-grid">
            <div className="input-group">
              <label className="input-label">Date</label>
              <input
                type="date"
                className="input-field"
                value={searchDate}
                onChange={(e) => setSearchDate(e.target.value)}
                id="search-date"
              />
            </div>
            <div className="input-group">
              <label className="input-label">Start Time</label>
              <input
                type="time"
                className="input-field"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                id="search-start-time"
              />
            </div>
            <div className="input-group">
              <label className="input-label">End Time</label>
              <input
                type="time"
                className="input-field"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                id="search-end-time"
              />
            </div>
            <button
              className="btn btn-primary"
              onClick={fetchFreeWindow}
              disabled={loading}
              id="search-submit"
            >
              <HiOutlineSearch size={16} />
              {loading ? 'Searching...' : 'Find Free Rooms'}
            </button>
          </div>
        </div>
      )}

      {/* Controls Toolbar: Floor Filter Chips + Search Input + Refresh */}
      <div className="controls-toolbar">
        <div className="filter-bar" style={{ marginBottom: 0 }}>
          {FLOOR_OPTIONS.map((f) => (
            <button
              key={f}
              className={`filter-chip ${selectedFloor === f ? 'filter-chip-active' : ''}`}
              onClick={() => setSelectedFloor(f)}
            >
              {f === 'All' ? '🏢 All Floors' : `${f} Floor`}
            </button>
          ))}
          <select
            className="filter-chip"
            value={capacityFilter}
            onChange={(e) => setCapacityFilter(e.target.value)}
            style={{ background: 'var(--bg-card)', color: 'var(--text-secondary)' }}
          >
            <option value="all">👥 Any Capacity</option>
            <option value="60">👥 60+ seats</option>
            <option value="100">👥 100+ seats (Large)</option>
          </select>
          <button className="filter-chip" onClick={handleRefresh} title="Refresh">
            <HiOutlineRefresh size={14} className={loading ? 'spinning' : ''} />
            Refresh
          </button>
        </div>

        <div className="search-input-wrapper">
          <HiOutlineSearch size={16} className="search-input-icon" />
          <input
            type="text"
            className="search-input"
            placeholder="Search room (e.g. 1A, 2B)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Room List Header */}
      <div className="room-list-header">
        <span className="room-list-title">
          {mode === 'now' ? 'Available Classrooms' : 'Matching Classrooms'}
        </span>
        <span className="room-list-count">
          Showing {filteredRooms.length} of {rooms.length} room{rooms.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Room Grid / Empty States */}
      {loading ? (
        <div className="loading-spinner">
          <div className="spinner" />
        </div>
      ) : filteredRooms.length === 0 ? (
        <div className="empty-state fade-in">
          <div className="empty-state-icon">🏫</div>
          <div className="empty-state-title">No matching rooms found</div>
          <div className="empty-state-text">
            {searchQuery
              ? `No rooms matched "${searchQuery}". Clear your search query.`
              : scheduleStatus === 'unknown'
              ? 'The timetable does not cover this date, so availability is unknown rather than assumed free.'
              : scheduleStatus === 'closed'
              ? 'Campus is closed on this date, so no rooms are shown as free.'
              : mode === 'now'
              ? `No rooms are free for ${minDuration}+ minutes right now. Try a shorter duration.`
              : 'No rooms match your search window. Try different hours or dates.'}
          </div>
        </div>
      ) : (
        <div className="room-list">
          {filteredRooms.map((room, i) => (
            <RoomCard
              key={room.id}
              room={room}
              onClick={handleRoomClick}
              staggerIndex={i + 1}
            />
          ))}
        </div>
      )}

      {/* Closed Classrooms Section (C9) */}
      {!loading && filteredClosedRooms.length > 0 && (
        <div style={{ marginTop: 36 }} className="fade-in">
          <div className="room-list-header">
            <span className="room-list-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>Closed Classrooms</span>
              <span className="badge badge-closed">{filteredClosedRooms.length}</span>
            </span>
            <span className="room-list-count">
              Exams, floor closures, or administrative holds
            </span>
          </div>
          <div className="room-list">
            {filteredClosedRooms.map((room, i) => (
              <RoomCard
                key={`closed-${room.id}`}
                room={room}
                onClick={handleRoomClick}
                staggerIndex={i + 1}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}
