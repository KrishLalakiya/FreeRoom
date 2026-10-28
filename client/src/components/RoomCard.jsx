function formatDurationHoursMinutes(minutes) {
  if (minutes == null || isNaN(minutes) || minutes <= 0) return '';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h > 0 && m > 0) return `${h} h ${m} m`;
  if (h > 0) return `${h} h`;
  return `${m} m`;
}

function formatTime12(t) {
  if (!t) return '';
  const [h, m] = t.split(':');
  const hr = parseInt(h, 10);
  const ampm = hr >= 12 ? 'pm' : 'am';
  const hr12 = hr % 12 || 12;
  return `${hr12}:${m} ${ampm}`;
}

function getUntilAndLeft(room) {
  if (room.status === 'closed') {
    return { until: 'Closed for exams', left: 'Closed for exams', isUrgent: false };
  }

  if (room.is_next_day) {
    const untilTime = room.first_class?.start_time ? formatTime12(room.first_class.start_time) : '10:00 pm';
    const until = `until ${untilTime}`;
    const left = room.first_class
      ? `First class: ${formatTime12(room.first_class.start_time)}`
      : `All day free`;
    return { until, left, isUrgent: false };
  }

  const freeMin = room.free_duration ?? room.free_for_minutes;
  let until = 'until 10:00 pm';
  if (room.free_until) {
    const d = new Date(room.free_until);
    if (!isNaN(d.getTime())) {
      until = `until ${d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase()}`;
    }
  }

  let left = '';
  let isUrgent = false;
  if (freeMin != null && !isNaN(freeMin) && freeMin > 0) {
    left = `${formatDurationHoursMinutes(freeMin)} left`;
    isUrgent = freeMin <= 50;
  }

  return { until, left, isUrgent };
}

export default function RoomCard({ room, onClick }) {
  const isClosed = room.status === 'closed';
  const { until, left, isUrgent } = getUntilAndLeft(room);
  const floorStr = room.floor ? room.floor.replace(/\s*floor/i, '') : '';

  return (
    <article
      className={`room-card${isUrgent ? ' urgent' : ''}${isClosed ? ' closed' : ''}`}
      onClick={() => onClick?.(room)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick?.(room)}
      id={`room-card-${room.id}`}
    >
      <div className="room-card-top">
        <div>
          <div className="room-code">{room.name}</div>
          <div className="room-meta">
            {floorStr ? `${floorStr} · ` : ''}{room.capacity ?? '—'} seats
          </div>
        </div>

        {isClosed ? (
          <span className="status-badge closed">Closed</span>
        ) : room.is_next_day ? (
          <span className="status-badge free">Opens {formatTime12(room.opens_at) || '6:00 am'}</span>
        ) : isUrgent ? (
          <span className="status-badge urgent">Ends soon</span>
        ) : (
          <span className="status-badge free">Free</span>
        )}

        <div className="room-card-right-mobile">
          <div className="mobile-until">{until}</div>
          <div className="mobile-time-left">{left}</div>
        </div>
      </div>

      <div className="room-card-footer-pc">
        <span className="footer-label">{room.is_next_day ? 'Morning status' : 'Free until'}</span>
        <span className="footer-value">
          {isClosed
            ? 'Closed for exams'
            : room.is_next_day
            ? `Free until ${room.first_class ? formatTime12(room.first_class.start_time) : '10:00 pm'}${room.first_class ? ` · First class: ${room.first_class.course_name}` : ' · All day free'}`
            : `${until.replace('until ', '')}${left ? ` · ${left.replace(' left', '')}` : ''}`}
        </span>
      </div>
    </article>
  );
}
