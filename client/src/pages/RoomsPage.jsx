import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { roomsAPI } from '../services/api';
import Navbar from '../components/Navbar';
import DatePicker from '../components/DatePicker';
import toast from 'react-hot-toast';

function fmtTimeFromISO(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const hr = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ampm = hr >= 12 ? 'pm' : 'am';
  const hr12 = hr % 12 || 12;
  return `${hr12}:${m} ${ampm}`;
}

function buildTimelineItems(timeline) {
  const items = [];
  if (timeline.busy_blocks) {
    for (const block of timeline.busy_blocks) {
      items.push({
        type: block.is_closure ? 'closure' : 'busy',
        start: block.start,
        end: block.end,
        subject_name: block.subject_name || block.title,
        instructor_name: block.instructor_name || block.teacher,
        batch_year: block.batch_year || null,
        batch_name: block.batch_name || null,
        groups_list: block.groups_list || (block.group ? [block.group] : []),
        is_closure: !!block.is_closure,
        reason: block.reason || null,
      });
    }
  }
  if (timeline.free_intervals) {
    for (const interval of timeline.free_intervals) {
      items.push({ type: 'free', start: interval.start, end: interval.end });
    }
  }
  items.sort((a, b) => new Date(a.start) - new Date(b.start));

  // Times outside building hours (6:00 AM - 10:00 PM) are not shown
  const bounded = [];
  for (const item of items) {
    const s = new Date(item.start);
    const e = new Date(item.end);
    const dayStart = new Date(s);
    dayStart.setHours(6, 0, 0, 0);
    const dayEnd = new Date(s);
    dayEnd.setHours(22, 0, 0, 0);

    const bStart = Math.max(s.getTime(), dayStart.getTime());
    const bEnd = Math.min(e.getTime(), dayEnd.getTime());

    if (bEnd > bStart) {
      bounded.push({
        ...item,
        start: new Date(bStart).toISOString(),
        end: new Date(bEnd).toISOString(),
      });
    }
  }

  return bounded;
}

function getCurrentWeekDays() {
  const today = new Date();
  const dow = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((dow + 6) % 7));

  const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return {
      dateStr: d.toISOString().split('T')[0],
      dayName: names[i],
      dayNum: d.getDate(),
      label: d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' }),
    };
  });
}

export default function RoomsPage() {
  const navigate = useNavigate();
  const todayStr = new Date().toISOString().split('T')[0];
  const weekDays = getCurrentWeekDays();

  const [rooms, setRooms] = useState([]);
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [selectedDay, setSelectedDay] = useState(todayStr);
  const [timeline, setTimeline] = useState(null);
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [loadingTimeline, setLoadingTimeline] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);

  useEffect(() => {
    roomsAPI.list(1)
      .then((res) => {
        const list = res.data?.rooms || res.data || [];
        setRooms(list);
        if (list.length > 0) setSelectedRoom(list[0]);
      })
      .catch(() => toast.error('Failed to load rooms'))
      .finally(() => setLoadingRooms(false));
  }, []);

  useEffect(() => {
    if (!selectedRoom) return;
    setLoadingTimeline(true);
    roomsAPI.getTimeline(selectedRoom.id, selectedDay)
      .then((res) => {
        setTimeline(res.data);
        setLastUpdated(new Date());
      })
      .catch(() => toast.error('Failed to load timeline'))
      .finally(() => setLoadingTimeline(false));
  }, [selectedRoom, selectedDay]);

  const visibleRooms = rooms.filter((r) => {
    if (r.name === '2B1' || r.name === '2B2' || r.parent_room_id) {
      return timeline?.is_split || (selectedRoom && (selectedRoom.name === '2B1' || selectedRoom.name === '2B2'));
    }
    return true;
  });

  const updatedStr = lastUpdated
    ? lastUpdated.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })
    : '';

  return (
    <div className="freeroom-app">
      <Navbar />
      <main className="app-main">
        <div className="rooms-layout">
          {/* Left: room list (PC) / chips (phone) */}
          <aside className="rooms-sidebar">
            <h1 className="page-title">Rooms</h1>
            <p className="page-subtitle" style={{ marginBottom: 16 }}>
              {rooms.length} rooms{updatedStr ? ` · updated ${updatedStr}` : ''}
            </p>

            {loadingRooms ? (
              <div style={{ color: 'var(--text-secondary)' }}>Loading rooms…</div>
            ) : (
              <>
                {/* Phone: room chips */}
                <div className="rooms-phone-chips">
                  {visibleRooms.map((r) => (
                    <button
                      key={r.id}
                      className={`filter-pill${selectedRoom?.id === r.id ? ' active' : ''}`}
                      onClick={() => setSelectedRoom(r)}
                    >
                      {r.name}
                    </button>
                  ))}
                </div>

                {/* PC: room list */}
                <div className="rooms-pc-list">
                  {rooms.map((r) => (
                    <button
                      key={r.id}
                      className={`rooms-pc-item${selectedRoom?.id === r.id ? ' active' : ''}`}
                      onClick={() => setSelectedRoom(r)}
                    >
                      <span className="room-pc-name">{r.name}</span>
                      <span className="room-pc-meta">{r.floor} floor · {r.capacity} seats</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </aside>

          {/* Right: day timeline */}
          <section className="rooms-timeline">
            {selectedRoom && (
              <>
                <div className="room-header-row">
                  <div>
                    <div className="room-header-name">Room {selectedRoom.name}</div>
                    <div className="room-header-meta">
                      {selectedRoom.floor} floor · {selectedRoom.capacity} seats
                    </div>
                  </div>
                  <button
                    className="change-btn"
                    onClick={() => navigate(`/room/${selectedRoom.id}`)}
                  >
                    Full details →
                  </button>
                </div>

                {/* Day selector buttons */}
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

                <div style={{ marginTop: '12px', marginBottom: '16px' }}>
                  <DatePicker
                    value={selectedDay}
                    onChange={setSelectedDay}
                    label="Pick any date"
                    id="room-timeline-date"
                  />
                </div>

                {/* Timeline rows */}
                {loadingTimeline ? (
                  <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-secondary)' }}>
                    Loading room schedule…
                  </div>
                ) : !timeline ? null : timeline.status === 'closed' ? (
                  <div style={{ marginTop: 16, padding: '16px 20px', borderRadius: 'var(--radius-card)', background: 'rgba(179, 58, 43, 0.08)', border: '1px solid var(--border-urgent)', color: 'var(--urgent-bg)', fontWeight: 600 }}>
                    Closed for exams
                  </div>
                ) : (() => {
                  const items = buildTimelineItems(timeline);
                  if (items.length === 0) {
                    return (
                      <div style={{ marginTop: 16, padding: '16px 20px', borderRadius: 'var(--radius-card)', background: 'var(--green-bg)', border: '1px solid var(--green-border)', color: 'var(--green-text)', fontWeight: 600 }}>
                        Free all day (no classes scheduled)
                      </div>
                    );
                  }
                  return (
                    <div className="room-timeline-rows">
                      {items.map((slot, idx) => (
                        <div
                          key={idx}
                          className={`timeline-row-item${slot.type === 'free' ? ' timeline-row-free' : slot.is_closure ? ' timeline-row-closed' : ''}`}
                        >
                          <div className="timeline-row-time">
                            {fmtTimeFromISO(slot.start)} – {fmtTimeFromISO(slot.end)}
                          </div>
                          {slot.type === 'free' ? (
                            <div className="timeline-row-free-label">Free</div>
                          ) : slot.is_closure ? (
                            <div style={{ color: 'var(--urgent-bg)', fontWeight: 600 }}>
                              Closed for exams{slot.reason ? ` · ${slot.reason}` : ''}
                            </div>
                          ) : (
                            <div className="timeline-row-info">
                              {(slot.batch_year || slot.batch_name) && (
                                <strong>
                                  {slot.batch_name || `Batch ${slot.batch_year}`}
                                  {slot.groups_list?.length > 0 && ` · ${slot.groups_list.join(', ')}`} ·{' '}
                                </strong>
                              )}
                              {slot.subject_name && <span>{slot.subject_name}</span>}
                              {slot.instructor_name && <span style={{ color: 'var(--text-secondary)' }}> · {slot.instructor_name}</span>}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
