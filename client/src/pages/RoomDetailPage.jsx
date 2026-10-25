import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { roomsAPI, reportsAPI } from '../services/api';
import Navbar from '../components/Navbar';
import {
  HiOutlineArrowLeft,
  HiOutlineLocationMarker,
  HiOutlineUsers,
  HiOutlineExclamationCircle,
  HiOutlineCheckCircle,
  HiOutlineInformationCircle,
} from 'react-icons/hi';
import toast from 'react-hot-toast';

function formatTime(dateOrStr) {
  if (!dateOrStr) return '--';
  const d = new Date(dateOrStr);
  return d.toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function RoomDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [timeline, setTimeline] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reporting, setReporting] = useState(false);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);

  useEffect(() => {
    fetchTimeline();
  }, [id, selectedDate]);

  const fetchTimeline = async () => {
    setLoading(true);
    try {
      const res = await roomsAPI.getTimeline(id, selectedDate);
      setTimeline(res.data);
    } catch (err) {
      console.error('Failed to fetch timeline:', err);
      toast.error('Failed to load room details');
    } finally {
      setLoading(false);
    }
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
      fetchTimeline();
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

  // Compute visual bar segments (9:00 AM to 8:00 PM)
  const visualSegments = useMemo(() => {
    if (!timeline || !timeline.busy_blocks || !timeline.free_intervals) return [];

    const dateStr = selectedDate;
    const dayStart = new Date(`${dateStr}T${timeline.opening_time || '09:00'}:00`);
    const dayEnd = new Date(`${dateStr}T${timeline.closing_time || '20:00'}:00`);
    const totalMs = dayEnd - dayStart;

    if (totalMs <= 0) return [];

    const segments = [];
    for (const item of timelineItems) {
      const start = new Date(item.start);
      const end = new Date(item.end);

      const boundedStart = Math.max(start, dayStart);
      const boundedEnd = Math.min(end, dayEnd);

      if (boundedEnd > boundedStart) {
        const widthPercent = ((boundedEnd - boundedStart) / totalMs) * 100;
        segments.push({
          ...item,
          widthPercent,
          formattedStart: formatTime(start),
          formattedEnd: formatTime(end),
        });
      }
    }
    return segments;
  }, [timeline, timelineItems, selectedDate]);

  if (loading && !timeline) {
    return (
      <div className="app-container">
        <Navbar />
        <div className="loading-spinner">
          <div className="spinner" />
        </div>
      </div>
    );
  }

  if (!timeline) {
    return (
      <div className="app-container">
        <Navbar />
        <div className="empty-state">
          <div className="empty-state-icon">❌</div>
          <div className="empty-state-title">Room not found</div>
          <button className="btn btn-primary" onClick={() => navigate('/')}>
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const isFree = timeline.status === 'free';
  const statusMeta =
    {
      free: { label: 'Free Now', className: 'status-free', dot: 'status-dot-free' },
      busy: { label: 'Occupied Now', className: 'status-busy', dot: 'status-dot-busy' },
      scheduled: { label: 'Scheduled', className: 'status-free', dot: 'status-dot-free' },
      closed: { label: 'Campus Closed', className: 'status-busy', dot: 'status-dot-busy' },
      unknown: { label: 'Schedule Unknown', className: 'status-busy', dot: 'status-dot-busy' },
    }[timeline.status] || { label: 'Unknown', className: 'status-busy', dot: 'status-dot-busy' };
  const isDividable = timeline.name === '2B';
  const isSplit = timeline.name === '2B1' || timeline.name === '2B2' || !!timeline.parent_room_id;

  return (
    <div className="app-container">
      <Navbar />

      <button className="back-btn" onClick={() => navigate('/')}>
        <HiOutlineArrowLeft size={16} />
        Back to all classrooms
      </button>

      <div className="fade-in">
        <div className="room-detail-grid">
          {/* ── Left Sidebar (Sticky on Tablet & PC) ──────────────── */}
          <div className="room-detail-sidebar">
            {/* Room Main Card */}
            <div className={`card ${isFree ? 'card-free' : 'card-busy'}`} style={{ marginBottom: 20 }}>
              <div className="room-card-header">
                <div>
                  <div className="room-card-name" style={{ fontSize: '1.6rem' }}>
                    Room {timeline.name}
                  </div>
                  <div className="room-card-info" style={{ marginTop: 8 }}>
                    <span className="room-card-info-item">
                      <HiOutlineLocationMarker size={14} />
                      {timeline.building_name} · {timeline.floor} Floor
                    </span>
                    {timeline.capacity && (
                      <span className="room-card-info-item">
                        <HiOutlineUsers size={14} />
                        {timeline.capacity} seats
                      </span>
                    )}
                  </div>
                </div>
                <span className={`status-badge ${statusMeta.className}`}>
                  <span className={`status-dot ${statusMeta.dot}`} />
                  {statusMeta.label}
                </span>
              </div>

              {/* Dividable room badge */}
              {isDividable && (
                <div style={{ margin: '8px 0 12px' }}>
                  <span className="room-card-badge badge-dividable">
                    Dividable Room (Combines 2B1 and 2B2)
                  </span>
                </div>
              )}
              {isSplit && (
                <div style={{ margin: '8px 0 12px' }}>
                  <span className="room-card-badge badge-split">
                    Split Room (Partition of Room 2B)
                  </span>
                </div>
              )}

              {isFree && timeline.free_until && (
                <div className="free-until-text" style={{ fontSize: '1rem', marginTop: 12 }}>
                  Free until <span className="free-until-time" style={{ fontSize: '1.15rem' }}>{formatTime(timeline.free_until)}</span>
                </div>
              )}

              {/* Crowd Reporting */}
              <div style={{ marginTop: 18 }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                  Crowd Status Check
                </div>
                <div className="report-actions">
                  <button
                    className="report-btn report-btn-not-empty"
                    onClick={() => handleReport('not_empty')}
                    disabled={reporting}
                    title="Report room as occupied"
                  >
                    <HiOutlineExclamationCircle size={16} />
                    Not empty
                  </button>
                  <button
                    className="report-btn report-btn-free"
                    onClick={() => handleReport('actually_free')}
                    disabled={reporting}
                    title="Report room as free"
                  >
                    <HiOutlineCheckCircle size={16} />
                    Actually free
                  </button>
                </div>
              </div>
            </div>

            {/* Date Selector Card */}
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label" htmlFor="timeline-date">Select Schedule Date</label>
                <input
                  type="date"
                  className="input-field"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  id="timeline-date"
                />
              </div>
            </div>

            {/* Room Info Specs */}
            <div className="card" style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                <HiOutlineInformationCircle size={16} style={{ color: 'var(--accent-primary)' }} />
                Campus Room Specs
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Operating Hours:</span>
                  <span style={{ color: 'var(--text-primary)' }}>{timeline.opening_time} – {timeline.closing_time}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Transition Buffer:</span>
                  <span style={{ color: 'var(--text-primary)' }}>5 minutes</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Building:</span>
                  <span style={{ color: 'var(--text-primary)' }}>{timeline.building_name}</span>
                </div>
              </div>
            </div>
          </div>

          {/* ── Right Column: Interactive Schedule & Timeline ────── */}
          <div className="room-detail-main">
            {(timeline.status === 'unknown' || timeline.status === 'closed') && (
              <div className="card" style={{ marginBottom: 20, borderColor: 'var(--accent-danger)' }}>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
                  {timeline.status === 'closed' ? 'Campus closed' : 'Availability unknown'}
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  {timeline.status === 'closed'
                    ? 'This day is a closed day, so no free intervals are shown.'
                    : timeline.coverage?.valid_from
                    ? `The timetable only covers ${timeline.coverage.valid_from} to ${timeline.coverage.valid_to}. This room is not assumed free outside that range.`
                    : 'No timetable has been uploaded for this building yet.'}
                </div>
              </div>
            )}

            {/* Visual Day Schedule Strip */}
            <div className="timeline-strip-container">
              <div className="timeline-strip-title">
                <span>Visual Day Bar · {formatDate(selectedDate)}</span>
                <div className="timeline-strip-legend">
                  <div className="legend-item">
                    <span className="legend-color" style={{ background: '#10b981' }} />
                    <span>Free</span>
                  </div>
                  <div className="legend-item">
                    <span className="legend-color" style={{ background: '#ef4444' }} />
                    <span>Occupied</span>
                  </div>
                </div>
              </div>

              {/* Visual colored bar */}
              <div className="timeline-visual-bar">
                {visualSegments.map((seg, i) => (
                  <div
                    key={i}
                    className={`timeline-segment ${seg.type === 'free' ? 'timeline-segment-free' : 'timeline-segment-busy'}`}
                    style={{ width: `${seg.widthPercent}%` }}
                    title={`${seg.type === 'free' ? 'Free' : seg.title || 'Occupied'}: ${seg.formattedStart} - ${seg.formattedEnd}`}
                  />
                ))}
              </div>

              {/* Hours Axis */}
              <div className="timeline-hours-axis">
                <span>9 AM</span>
                <span>12 PM</span>
                <span>3 PM</span>
                <span>6 PM</span>
                <span>8 PM</span>
              </div>
            </div>

            {/* Detailed Timeline List */}
            <div className="section-header">
              <div className="section-title">Schedule Breakdown</div>
              <div className="section-subtitle">
                All lectures, events, and free study gaps for {formatDate(selectedDate)}
              </div>
            </div>

            <div className="timeline">
              {timelineItems.map((item, i) => (
                <div key={i} className="timeline-item slide-in" style={{ animationDelay: `${i * 0.04}s` }}>
                  <div className={`timeline-dot ${item.type === 'free' ? 'timeline-dot-free' : 'timeline-dot-busy'}`} />
                  <div className="timeline-time">
                    {formatTime(item.start)} — {formatTime(item.end)}
                  </div>
                  <div className="timeline-title">
                    {item.type === 'free' ? '🟢 Available for Study' : item.title || 'Occupied Block'}
                  </div>
                  {item.type === 'free' && (
                    <div className="timeline-subtitle" style={{ color: 'var(--accent-success)' }}>
                      {Math.round((new Date(item.end) - new Date(item.start)) / 60000)} minutes continuous study time
                    </div>
                  )}
                  {item.type !== 'free' && (
                    <div className="timeline-subtitle">
                      {item.teacher ? `Instructor: ${item.teacher}` : 'Class / Campus Event'}
                      {item.group ? ` · ${item.group}` : ''}
                    </div>
                  )}
                </div>
              ))}
              {timelineItems.length === 0 && (
                <div className="empty-state">
                  <div className="empty-state-text">No scheduled events or timetable entries for this date</div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
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
        type: 'busy',
        start: block.start,
        end: block.end,
        title: block.title,
        teacher: block.teacher,
        group: block.group,
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
