import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { roomsAPI, reportsAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import Navbar from '../components/Navbar';
import DatePicker, { getTomorrowStr } from '../components/DatePicker';
import {
  HiOutlineArrowLeft,
  HiOutlineLocationMarker,
  HiOutlineUsers,
  HiOutlineExclamationCircle,
  HiOutlineCheckCircle,
  HiOutlineInformationCircle,
  HiOutlineClock,
} from 'react-icons/hi';
import toast from 'react-hot-toast';

function formatTime(dateOrStr) {
  if (!dateOrStr) return '--';
  const d = new Date(dateOrStr);
  if (isNaN(d.getTime())) return '--';
  return d.toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).toLowerCase();
}

function formatTime12Simple(tStr) {
  if (!tStr) return '';
  const parts = String(tStr).split(':');
  if (parts.length < 2) return tStr;
  const hr = parseInt(parts[0], 10);
  const min = parts[1];
  const ampm = hr >= 12 ? 'pm' : 'am';
  const hr12 = hr % 12 || 12;
  return `${hr12}:${min} ${ampm}`;
}

function formatDateHeading(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  const dateObj = new Date(y, m - 1, d);
  return dateObj.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function renderTypeChip(entryType) {
  const type = (entryType || 'class').toLowerCase();
  if (type === 'lab') {
    return <span className="schedule-type-chip lab">🔬 Lab</span>;
  }
  if (type === 'club') {
    return <span className="schedule-type-chip club">🎯 Club</span>;
  }
  if (type === 'tutorial') {
    return <span className="schedule-type-chip tutorial">📝 Tutorial</span>;
  }
  return <span className="schedule-type-chip lecture">📚 Lecture</span>;
}

export default function RoomDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isAdmin } = useAuth();

  const tomorrowStr = getTomorrowStr();
  const [selectedDate, setSelectedDate] = useState(() => {
    return searchParams.get('date') || localStorage.getItem('freeroom_find_date') || tomorrowStr;
  });

  const [timeline, setTimeline] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reporting, setReporting] = useState(false);
  const [selectedProvenance, setSelectedProvenance] = useState(null);

  const fetchTimeline = async (dateToFetch) => {
    setLoading(true);
    try {
      const res = await roomsAPI.getTimeline(id, dateToFetch);
      setTimeline(res.data);
    } catch (err) {
      console.error('Failed to fetch timeline:', err);
      toast.error('Failed to load room details');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTimeline(selectedDate);
  }, [id, selectedDate]);

  const handleDateChange = (newDate) => {
    setSelectedDate(newDate);
    localStorage.setItem('freeroom_find_date', newDate);
  };

  const handleReport = async (status) => {
    setReporting(true);
    try {
      const res = await reportsAPI.submit(parseInt(id, 10), status);
      const msg =
        res.data.action === 'auto_override'
          ? 'Status updated automatically based on crowd agreement!'
          : res.data.action === 'flagged_for_review'
          ? 'Flagged for admin review'
          : 'Report submitted. Thanks for keeping the schedule accurate!';
      toast.success(msg);
      fetchTimeline(selectedDate);
    } catch (err) {
      if (err.response?.status === 429) {
        toast.error(err.response.data.message);
      } else {
        toast.error('Failed to submit report');
      }
    } finally {
      setReporting(false);
    }
  };

  // Build combined timeline items (busy blocks + free intervals)
  const timelineItems = useMemo(() => {
    if (!timeline) return [];
    return buildTimelineItems(timeline);
  }, [timeline]);

  // Robust visual day bar calculation (bounded 6:00 AM to 10:00 PM)
  const visualSegments = useMemo(() => {
    if (!timeline || (!timeline.busy_blocks && !timeline.free_intervals)) return [];

    const parseTimeToMins = (tStr, defaultMins) => {
      if (!tStr) return defaultMins;
      const parts = String(tStr).split(':');
      if (parts.length >= 2) {
        return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
      }
      return defaultMins;
    };

    const openMins = parseTimeToMins(timeline.opening_time, 6 * 60); // 360
    const closeMins = parseTimeToMins(timeline.closing_time, 22 * 60); // 1320
    const totalDayMins = closeMins - openMins;
    if (totalDayMins <= 0) return [];

    const segments = [];
    for (const item of timelineItems) {
      const dStart = new Date(item.start);
      const dEnd = new Date(item.end);
      if (isNaN(dStart.getTime()) || isNaN(dEnd.getTime())) continue;

      const itemStartMins = dStart.getHours() * 60 + dStart.getMinutes();
      const itemEndMins = dEnd.getHours() * 60 + dEnd.getMinutes();

      const boundedStart = Math.max(openMins, itemStartMins);
      const boundedEnd = Math.min(closeMins, itemEndMins);

      if (boundedEnd > boundedStart) {
        const widthPercent = ((boundedEnd - boundedStart) / totalDayMins) * 100;
        segments.push({
          ...item,
          is_closure: !!item.is_closure,
          reason: item.reason,
          widthPercent: Math.max(widthPercent, 0.4),
          formattedStart: formatTime(dStart),
          formattedEnd: formatTime(dEnd),
        });
      }
    }
    return segments;
  }, [timeline, timelineItems]);

  if (loading && !timeline) {
    return (
      <div className="freeroom-app">
        <Navbar />
        <main className="app-main">
          <div style={{ textAlign: 'center', padding: '80px 20px', color: 'var(--text-secondary)' }}>
            Loading room schedule…
          </div>
        </main>
      </div>
    );
  }

  if (!timeline) {
    return (
      <div className="freeroom-app">
        <Navbar />
        <main className="app-main">
          <div className="detail-card" style={{ textAlign: 'center', padding: '60px 20px', maxWidth: 480, margin: '40px auto' }}>
            <div style={{ fontSize: '32px', marginBottom: 12 }}>🏫</div>
            <h2 style={{ fontSize: '20px', fontWeight: 700, marginBottom: 8 }}>Room not found</h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 20 }}>
              The classroom requested could not be located in this campus building.
            </p>
            <button className="detail-back-btn" onClick={() => navigate('/rooms')}>
              Back to Rooms
            </button>
          </div>
        </main>
      </div>
    );
  }

  const isFree = timeline.status === 'free';
  const isClosed = timeline.status === 'closed';
  const isDividable = timeline.name === '2B';
  const isSplit = timeline.name === '2B1' || timeline.name === '2B2' || !!timeline.parent_room_id;

  const statusLabel = (() => {
    if (isClosed) return `Closed (${timeline.reason || 'Exam'})`;
    if (isFree) return 'Free Now';
    if (timeline.status === 'scheduled') return 'Scheduled';
    if (timeline.status === 'busy') return 'Occupied Now';
    return 'Schedule Unknown';
  })();

  const opHoursFormatted = `${formatTime12Simple(timeline.opening_time || '06:00')} – ${formatTime12Simple(timeline.closing_time || '22:00')}`;

  return (
    <div className="freeroom-app">
      <Navbar />
      <main className="app-main">
        <div className="room-detail-container">
          {/* Navigation Bar */}
          <button className="detail-back-btn" onClick={() => navigate(-1)}>
            <HiOutlineArrowLeft size={15} />
            <span>Back to Rooms</span>
          </button>

          <div className="room-detail-layout">
            {/* ── Left Sidebar ──────────────────────────────── */}
            <aside className="room-detail-sidebar">
              {/* Room Profile Card */}
              <div className="detail-card detail-card-profile">
                <div className="detail-room-title-row">
                  <div>
                    <h1 className="detail-room-name">Room {timeline.name}</h1>
                  </div>
                  <span className={`status-badge ${isClosed ? 'status-closed' : isFree ? 'status-free' : 'status-busy'}`}>
                    <span className={`status-dot ${isClosed ? 'status-dot-closed' : isFree ? 'status-dot-free' : 'status-dot-busy'}`} />
                    {statusLabel}
                  </span>
                </div>

                <div className="detail-meta-pills">
                  <span className="detail-meta-chip">
                    <HiOutlineLocationMarker size={14} />
                    {timeline.building_name || 'Pilot Building'} · {timeline.floor} Floor
                  </span>
                  {timeline.capacity && (
                    <span className="detail-meta-chip">
                      <HiOutlineUsers size={14} />
                      {timeline.capacity} seats
                    </span>
                  )}
                </div>

                {isDividable && (
                  <div style={{ marginBottom: 12 }}>
                    <span className="room-card-badge badge-dividable">
                      Dividable Room (Combines 2B1 and 2B2)
                    </span>
                  </div>
                )}
                {isSplit && (
                  <div style={{ marginBottom: 12 }}>
                    <span className="room-card-badge badge-split">
                      Split Room (Partition of Room 2B)
                    </span>
                  </div>
                )}

                {/* Live Availability Banner */}
                {isFree && timeline.free_until && (
                  <div className="detail-status-banner free">
                    <span>🟢 Free until <strong>{formatTime(timeline.free_until)}</strong></span>
                  </div>
                )}
                {isClosed && (
                  <div className="detail-status-banner closed">
                    <span>🚫 Closed for {timeline.reason || 'Exam'}{timeline.closed_until ? ` until ${formatTime(timeline.closed_until)}` : ' today'}</span>
                  </div>
                )}

                {/* Crowd Verification Actions */}
                <div style={{ marginTop: 20 }}>
                  <div className="detail-section-label">
                    Crowd Status Check
                  </div>
                  <div className="detail-crowd-actions">
                    <button
                      className="detail-action-btn not-empty"
                      onClick={() => handleReport('not_empty')}
                      disabled={reporting}
                      title="Report room as occupied"
                    >
                      <HiOutlineExclamationCircle size={16} />
                      <span>Not empty</span>
                    </button>
                    <button
                      className="detail-action-btn free"
                      onClick={() => handleReport('actually_free')}
                      disabled={reporting}
                      title="Report room as free"
                    >
                      <HiOutlineCheckCircle size={16} />
                      <span>Actually free</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Date Picker Card */}
              <div className="detail-card detail-card-date">
                <DatePicker
                  value={selectedDate}
                  onChange={handleDateChange}
                  label="Select Schedule Date"
                  id="timeline-datepicker"
                />
              </div>

              {/* Campus Room Specs Card */}
              <div className="detail-card detail-card-specs" style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <HiOutlineInformationCircle size={16} style={{ color: 'var(--text-secondary)' }} />
                  Campus Room Specs
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Operating Hours:</span>
                    <strong style={{ color: 'var(--text-primary)' }}>{opHoursFormatted}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Schedule Accuracy:</span>
                    <strong style={{ color: 'var(--text-primary)' }}>Exact (0 min buffer)</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Building:</span>
                    <strong style={{ color: 'var(--text-primary)' }}>{timeline.building_name || 'Pilot Building'}</strong>
                  </div>
                </div>
              </div>
            </aside>

            {/* ── Right Content ─────────────────────────────── */}
            <section className="room-detail-content">
              {/* Visual Day Schedule Strip */}
              <div className="timeline-strip-container detail-strip-container">
                <div className="timeline-strip-title">
                  <span>Visual Day Bar · {formatDateHeading(selectedDate)}</span>
                  <div className="timeline-strip-legend">
                    <div className="legend-item">
                      <span className="legend-color" style={{ background: 'var(--green-text)' }} />
                      <span>Free</span>
                    </div>
                    <div className="legend-item">
                      <span className="legend-color" style={{ background: '#64748b' }} />
                      <span>Occupied</span>
                    </div>
                    <div className="legend-item">
                      <span className="legend-color" style={{ background: 'var(--urgent-bg)' }} />
                      <span>Closed</span>
                    </div>
                  </div>
                </div>

                {/* Colored Progress Bar */}
                <div className="timeline-visual-bar" style={{ height: 24, borderRadius: 8 }}>
                  {visualSegments.map((seg, i) => (
                    <div
                      key={i}
                      className={`timeline-segment ${
                        seg.is_closure
                          ? 'timeline-segment-closed'
                          : seg.type === 'free'
                          ? 'timeline-segment-free'
                          : 'timeline-segment-busy'
                      }`}
                      style={{
                        width: `${seg.widthPercent}%`,
                        ...(seg.is_closure
                          ? { background: 'var(--urgent-bg)' }
                          : seg.type === 'free'
                          ? { background: 'var(--green-text)' }
                          : { background: '#64748b' }),
                      }}
                      title={`${
                        seg.is_closure
                          ? `Closed: ${seg.reason || 'Exam'}`
                          : seg.type === 'free'
                          ? 'Available for Study'
                          : seg.title || 'Lecture'
                      } (${seg.formattedStart} – ${seg.formattedEnd})`}
                    />
                  ))}
                </div>

                {/* Hours Axis (6 AM to 10 PM) */}
                <div className="timeline-hours-axis" style={{ marginTop: 10 }}>
                  <span>6 AM</span>
                  <span>10 AM</span>
                  <span>2 PM</span>
                  <span>6 PM</span>
                  <span>10 PM</span>
                </div>
              </div>

              {/* Detailed Schedule Breakdown */}
              <div className="detail-breakdown-section">
                <div style={{ marginBottom: 16 }}>
                <h2 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em', marginBottom: 4 }}>
                  Schedule Breakdown
                </h2>
                <p style={{ fontSize: '13.5px', color: 'var(--text-secondary)' }}>
                  All lectures, events, and free study gaps for {formatDateHeading(selectedDate)}
                </p>
              </div>

              <div className="schedule-breakdown-list">
                {timelineItems.map((item, i) => {
                  const isItemFree = item.type === 'free';
                  const isItemClosed = item.is_closure;
                  const durationMins = Math.round((new Date(item.end) - new Date(item.start)) / 60000);

                  if (isItemFree) {
                    return (
                      <div key={i} className="schedule-item-card free-slot">
                        <div className="schedule-time-row">
                          <span className="schedule-time-range" style={{ color: 'var(--green-text)' }}>
                            <HiOutlineClock style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                            {formatTime(item.start)} – {formatTime(item.end)}
                          </span>
                          <span className="schedule-type-chip free">
                            🟢 Free
                          </span>
                        </div>
                        <div className="schedule-item-title" style={{ color: '#166534', fontSize: '15px' }}>
                          Available for Study
                        </div>
                        <div className="schedule-item-meta" style={{ color: '#15803d' }}>
                          <span>{durationMins} minutes continuous study time</span>
                        </div>
                      </div>
                    );
                  }

                  if (isItemClosed) {
                    return (
                      <div key={i} className="schedule-item-card closed-slot">
                        <div className="schedule-time-row">
                          <span className="schedule-time-range" style={{ color: 'var(--urgent-bg)' }}>
                            {formatTime(item.start)} – {formatTime(item.end)}
                          </span>
                          <span className="schedule-type-chip closed">
                            🚫 Closed
                          </span>
                        </div>
                        <div className="schedule-item-title" style={{ color: '#991b1b' }}>
                          Closed for {item.reason || 'Exam'}
                        </div>
                        <div className="schedule-item-meta" style={{ color: 'var(--urgent-bg)' }}>
                          <span>{item.note || 'Classroom unavailable for continuous study.'}</span>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div key={i} className="schedule-item-card">
                      <div className="schedule-time-row">
                        <span className="schedule-time-range">
                          {formatTime(item.start)} – {formatTime(item.end)}
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {renderTypeChip(item.entry_type)}
                          {isAdmin && item.provenance?.raw_cell && (
                            <button
                              className="admin-inspect-btn"
                              onClick={() => setSelectedProvenance({
                                ...item.provenance,
                                subject: item.subject_name || item.title,
                                time: `${formatTime(item.start)} – ${formatTime(item.end)}`,
                                roomName: timeline.name,
                              })}
                              title="Inspect raw cell import provenance"
                            >
                              🔍 Cell
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="schedule-item-title">
                        {item.subject_name || item.title || 'Class Lecture'}
                      </div>

                      <div className="schedule-item-meta">
                        <span>
                          <strong>Instructor:</strong> {item.instructor_name || item.teacher || 'TBD'}
                        </span>
                        {item.batch_term_label && (
                          <span>
                            <strong>Cohort:</strong> {item.batch_term_label}
                          </span>
                        )}
                      </div>

                      <div className="schedule-group-row">
                        <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>Groups:</span>
                        {item.groups_list && item.groups_list.length > 0 ? (
                          item.groups_list.map((g) => (
                            <span key={g} className="group-pill">{g}</span>
                          ))
                        ) : (
                          <span className="group-pill">{item.group || 'All'}</span>
                        )}
                      </div>
                    </div>
                  );
                })}

                {timelineItems.length === 0 && (
                  <div className="detail-card" style={{ textAlign: 'center', padding: '48px 16px', color: 'var(--text-secondary)' }}>
                    <div style={{ fontSize: '28px', marginBottom: 8 }}>📖</div>
                    <div style={{ fontWeight: 700, fontSize: '15px', color: 'var(--text-primary)', marginBottom: 4 }}>
                      No scheduled classes or events
                    </div>
                    <p style={{ fontSize: '13px' }}>
                      This classroom is completely free for open study throughout the day.
                    </p>
                  </div>
                )}
              </div>
            </div>
            </section>
          </div>
        </div>

        {/* Admin Provenance Modal (C19) */}
        {selectedProvenance && (
          <div className="modal-overlay" onClick={() => setSelectedProvenance(null)}>
            <div className="modal-card fade-in" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <div className="modal-title">
                  🔍 Timetable Cell Provenance
                </div>
                <button
                  className="modal-close-btn"
                  onClick={() => setSelectedProvenance(null)}
                >
                  ✕
                </button>
              </div>

              <div className="provenance-grid">
                <div className="provenance-field">
                  <div className="provenance-label">Source Spreadsheet</div>
                  <div className="provenance-value">{selectedProvenance.source_file || 'Excel File'}</div>
                </div>
                <div className="provenance-field">
                  <div className="provenance-label">Sheet Name</div>
                  <div className="provenance-value">{selectedProvenance.sheet_name || 'Schedule'}</div>
                </div>
                <div className="provenance-field">
                  <div className="provenance-label">Cell Coordinate</div>
                  <div className="provenance-value">{selectedProvenance.cell_coord || 'N/A'}</div>
                </div>
                <div className="provenance-field">
                  <div className="provenance-label">Imported At</div>
                  <div className="provenance-value">
                    {selectedProvenance.imported_at
                      ? new Date(selectedProvenance.imported_at).toLocaleString('en-IN')
                      : 'Initial Batch Seed'}
                  </div>
                </div>
              </div>

              <div className="provenance-field">
                <div className="provenance-label">Class Details</div>
                <div className="provenance-value" style={{ marginBottom: 12 }}>
                  {selectedProvenance.subject} · {selectedProvenance.time} (Room {selectedProvenance.roomName})
                </div>
              </div>

              <div className="provenance-field">
                <div className="provenance-label">Raw Cell Content from Excel</div>
                <pre className="provenance-raw">
                  {selectedProvenance.raw_cell || 'No raw text recorded'}
                </pre>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
                <button className="btn btn-secondary" onClick={() => setSelectedProvenance(null)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

/**
 * Merge busy_blocks and free_intervals into a single sorted timeline.
 */
function buildTimelineItems(timeline) {
  const items = [];

  if (timeline.busy_blocks) {
    for (const block of timeline.busy_blocks) {
      items.push({
        type: block.is_closure ? 'closure' : 'busy',
        start: block.start,
        end: block.end,
        title: block.title,
        subject_name: block.subject_name || block.title,
        teacher: block.teacher,
        instructor_name: block.instructor_name || block.teacher,
        group: block.group,
        groups_list: block.groups_list || (block.group ? [block.group] : []),
        entry_type: block.entry_type || (block.is_closure ? 'closure' : 'class'),
        batch_year: block.batch_year || null,
        batch_name: block.batch_name || null,
        batch_term_label: block.batch_term_label || null,
        is_closure: !!block.is_closure,
        reason: block.reason || null,
        scope: block.scope || null,
        note: block.note || null,
        provenance: block.provenance || null,
      });
    }
  }

  if (timeline.free_intervals) {
    for (const interval of timeline.free_intervals) {
      items.push({
        type: 'free',
        start: interval.start,
        end: interval.end,
      });
    }
  }

  items.sort((a, b) => new Date(a.start) - new Date(b.start));
  return items;
}
