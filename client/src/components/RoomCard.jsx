import { HiOutlineClock, HiOutlineLocationMarker, HiOutlineUsers, HiOutlineArrowRight } from 'react-icons/hi';

/**
 * Formats a Date or ISO string to a human-readable time like "2:30 PM"
 */
function formatTime(dateOrStr) {
  if (!dateOrStr) return '--';
  const d = new Date(dateOrStr);
  return d.toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Formats minutes into a readable duration like "2h 30m"
 */
function formatDuration(minutes) {
  if (!minutes || minutes <= 0) return '--';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export default function RoomCard({ room, onClick, staggerIndex = 0 }) {
  const isFree = room.status === 'free' || room.status === 'free_for_window';
  const maxDuration = 11 * 60; // 11 hours (9 AM to 8 PM)
  const fillPercent = Math.min(((room.free_duration || 0) / maxDuration) * 100, 100);

  const isDividable = room.name === '2B';
  const isSplit = room.name === '2B1' || room.name === '2B2' || !!room.parent_room_id;

  return (
    <div
      className={`card room-card ${isFree ? 'card-free' : 'card-busy'} fade-in stagger-${Math.min(staggerIndex, 6)}`}
      onClick={() => onClick?.(room)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick?.(room)}
      id={`room-card-${room.id}`}
    >
      <div>
        {/* Header */}
        <div className="room-card-header">
          <div>
            <div className="room-card-name">
              Room {room.name}
              <span className="room-card-floor">{room.floor} Floor</span>
            </div>
            {isDividable && (
              <div style={{ marginTop: 4 }}>
                <span className="room-card-badge badge-dividable">
                  Dividable (2B1 + 2B2)
                </span>
              </div>
            )}
            {isSplit && (
              <div style={{ marginTop: 4 }}>
                <span className="room-card-badge badge-split">
                  Split Room (Part of 2B)
                </span>
              </div>
            )}
          </div>
          <div className="room-card-status">
            <span className={`status-badge ${isFree ? 'status-free' : 'status-busy'}`}>
              <span className={`status-dot ${isFree ? 'status-dot-free' : 'status-dot-busy'}`} />
              {isFree ? 'Free' : 'Busy'}
            </span>
          </div>
        </div>

        {/* Info Row */}
        <div className="room-card-info">
          {room.capacity && (
            <span className="room-card-info-item">
              <HiOutlineUsers size={14} />
              {room.capacity} seats
            </span>
          )}
          {room.building_name && (
            <span className="room-card-info-item">
              <HiOutlineLocationMarker size={14} />
              {room.building_name}
            </span>
          )}
        </div>
      </div>

      {/* Duration & Availability Footer */}
      <div style={{ marginTop: 14 }}>
        {isFree && room.free_duration ? (
          <>
            <div className="room-card-duration">
              <HiOutlineClock size={14} style={{ color: 'var(--text-muted)' }} />
              <div className="duration-bar">
                <div
                  className="duration-fill"
                  style={{ width: `${Math.max(fillPercent, 8)}%` }}
                />
              </div>
              <span className="duration-text">
                {formatDuration(room.free_duration)}
              </span>
            </div>
            <div className="free-until-text" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>
                Free until <span className="free-until-time">{formatTime(room.free_until)}</span>
              </span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-accent)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                Details <HiOutlineArrowRight size={12} />
              </span>
            </div>
          </>
        ) : isFree ? (
          <div className="free-until-text" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="free-until-time">Free for selected window</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-accent)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              Details <HiOutlineArrowRight size={12} />
            </span>
          </div>
        ) : (
          <div className="free-until-text" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: 'var(--accent-danger)' }}>Currently occupied</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              Schedule <HiOutlineArrowRight size={12} />
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
