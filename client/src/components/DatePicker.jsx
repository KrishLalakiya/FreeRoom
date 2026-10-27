import { useState, useEffect, useRef } from 'react';

function pad(n) {
  return String(n).padStart(2, '0');
}

export function formatLocalDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function getTodayStr() {
  const mockStr = typeof window !== 'undefined' && (window.__MOCK_TIME__ || localStorage.getItem('freeroom_mock_time'));
  const d = mockStr ? new Date(mockStr) : new Date();
  return formatLocalDateStr(d);
}

export function getTomorrowStr() {
  const mockStr = typeof window !== 'undefined' && (window.__MOCK_TIME__ || localStorage.getItem('freeroom_mock_time'));
  const d = mockStr ? new Date(mockStr) : new Date();
  d.setDate(d.getDate() + 1);
  return formatLocalDateStr(d);
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const DAY_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

export default function DatePicker({
  value,
  onChange,
  label,
  id = 'date-picker',
  hideQuickPills = false,
  hideDefaultLabel = false,
  variant = 'default',
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  const todayStr = getTodayStr();
  const tomorrowStr = getTomorrowStr();

  // Parse current value
  const parsedValue = (() => {
    if (!value || typeof value !== 'string') return new Date();
    const [y, m, d] = value.split('-').map(Number);
    if (!y || !m || !d) return new Date();
    return new Date(y, m - 1, d);
  })();

  const [viewYear, setViewYear] = useState(parsedValue.getFullYear());
  const [viewMonth, setViewMonth] = useState(parsedValue.getMonth()); // 0-indexed

  // When value prop updates, sync view
  useEffect(() => {
    if (value) {
      const [y, m] = value.split('-').map(Number);
      if (y && m) {
        setViewYear(y);
        setViewMonth(m - 1);
      }
    }
  }, [value]);

  // Click outside listener
  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      const handleEsc = (e) => e.key === 'Escape' && setIsOpen(false);
      document.addEventListener('keydown', handleEsc);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
        document.removeEventListener('keydown', handleEsc);
      };
    }
  }, [isOpen]);

  // Navigate months
  const prevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const nextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  // Build month calendar days
  const firstDow = new Date(viewYear, viewMonth, 1).getDay(); // 0 = Sun
  const startOffset = (firstDow + 6) % 7; // 0 = Mon
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

  const days = [];

  // Trailing previous month days
  for (let i = startOffset - 1; i >= 0; i--) {
    const d = daysInPrevMonth - i;
    const m = viewMonth === 0 ? 12 : viewMonth;
    const y = viewMonth === 0 ? viewYear - 1 : viewYear;
    days.push({
      dayNum: d,
      dateStr: `${y}-${pad(m)}-${pad(d)}`,
      isCurrentMonth: false,
    });
  }

  // Current month days
  for (let d = 1; d <= daysInMonth; d++) {
    days.push({
      dayNum: d,
      dateStr: `${viewYear}-${pad(viewMonth + 1)}-${pad(d)}`,
      isCurrentMonth: true,
    });
  }

  // Next month leading days (fill up to multiple of 7)
  const remaining = (7 - (days.length % 7)) % 7;
  for (let d = 1; d <= remaining; d++) {
    const m = viewMonth === 11 ? 1 : viewMonth + 2;
    const y = viewMonth === 11 ? viewYear + 1 : viewYear;
    days.push({
      dayNum: d,
      dateStr: `${y}-${pad(m)}-${pad(d)}`,
      isCurrentMonth: false,
    });
  }

  // Human-readable formatted string for trigger button
  const formattedDisplay = (() => {
    if (!value) return 'Select date';
    const [y, m, d] = value.split('-').map(Number);
    const dateObj = new Date(y, m - 1, d);
    const labelStr = dateObj.toLocaleDateString('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    if (value === todayStr) return `Today · ${labelStr}`;
    if (value === tomorrowStr) return `Tomorrow · ${labelStr}`;
    return labelStr;
  })();

  const frFormattedDisplay = (() => {
    if (!value) return 'Select date';
    const [y, m, d] = value.split('-').map(Number);
    const dateObj = new Date(y, m - 1, d);
    const labelStr = dateObj.toLocaleDateString('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    if (value === todayStr) return `Today, ${labelStr}`;
    if (value === tomorrowStr) return `Tomorrow, ${labelStr}`;
    return labelStr;
  })();

  const handleSelect = (dateStr) => {
    onChange(dateStr);
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className="custom-datepicker-container" style={{ position: 'relative', width: '100%', minWidth: 0 }}>
      {variant === 'fr-card' ? (
        <button
          type="button"
          id={id}
          className={`fr-date-btn${isOpen ? ' active' : ''}`}
          onClick={() => setIsOpen((prev) => !prev)}
          aria-haspopup="dialog"
          aria-expanded={isOpen}
        >
          <span className="fr-date-label">Date</span>
          <span className="fr-date-val">{frFormattedDisplay}</span>
        </button>
      ) : (
        <>
          {label && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px', flexWrap: 'wrap', gap: '4px' }}>
              <label className="form-label" htmlFor={id} style={{ margin: 0 }}>
                {label}
              </label>
              {!hideDefaultLabel && (
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600 }}>
                  {value === tomorrowStr ? 'Next Day (Default)' : value === todayStr ? 'Today' : ''}
                </span>
              )}
            </div>
          )}

          {/* Trigger Button */}
          <button
            type="button"
            id={id}
            className={`custom-datepicker-trigger${isOpen ? ' active' : ''}`}
            onClick={() => setIsOpen((prev) => !prev)}
            aria-haspopup="dialog"
            aria-expanded={isOpen}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '9px', minWidth: 0, overflow: 'hidden' }}>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ color: 'var(--text-secondary)', flexShrink: 0 }}
              >
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              <span className="custom-datepicker-value" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{formattedDisplay}</span>
            </span>

            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                color: 'var(--text-secondary)',
                transition: 'transform 0.2s ease',
                transform: isOpen ? 'rotate(180deg)' : 'none',
                flexShrink: 0,
              }}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {/* Quick shortcuts under button */}
          {!hideQuickPills && (
            <div style={{ display: 'flex', gap: '6px', marginTop: '8px', flexWrap: 'wrap' }}>
              <button
                type="button"
                className={`filter-pill${value === todayStr ? ' active' : ''}`}
                style={{ padding: '4px 10px', fontSize: '12px' }}
                onClick={() => onChange(todayStr)}
              >
                Today
              </button>
              <button
                type="button"
                className={`filter-pill${value === tomorrowStr ? ' active' : ''}`}
                style={{ padding: '4px 10px', fontSize: '12px' }}
                onClick={() => onChange(tomorrowStr)}
              >
                Tomorrow (Default)
              </button>
            </div>
          )}
        </>
      )}

      {/* Pop-up or Inline Calendar */}
      {isOpen && (
        <div
          className={variant === 'fr-card' ? 'fr-date-inline-calendar' : 'custom-datepicker-popup'}
          role="dialog"
          aria-modal={variant !== 'fr-card'}
        >
          {/* Header Month / Year Navigation */}
          <div className="datepicker-header">
            <button
              type="button"
              className="datepicker-nav-btn"
              onClick={prevMonth}
              title="Previous month"
            >
              ‹
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span className="datepicker-month-title">
                {MONTH_NAMES[viewMonth]} {viewYear}
              </span>
            </div>

            <button
              type="button"
              className="datepicker-nav-btn"
              onClick={nextMonth}
              title="Next month"
            >
              ›
            </button>
          </div>

          {/* Quick Jump (Month & Year selectors) */}
          <div style={{ display: 'flex', gap: '6px', marginBottom: '12px' }}>
            <select
              className="datepicker-quick-select"
              value={viewMonth}
              onChange={(e) => setViewMonth(Number(e.target.value))}
            >
              {MONTH_NAMES.map((m, idx) => (
                <option key={m} value={idx}>{m}</option>
              ))}
            </select>

            <select
              className="datepicker-quick-select"
              value={viewYear}
              onChange={(e) => setViewYear(Number(e.target.value))}
            >
              {Array.from({ length: 11 }, (_, i) => viewYear - 5 + i).map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>

          {/* Days of Week Header */}
          <div className="datepicker-weekdays">
            {DAY_LABELS.map((d) => (
              <div key={d} className="datepicker-weekday">{d}</div>
            ))}
          </div>

          {/* Days Grid */}
          <div className="datepicker-grid">
            {days.map((dObj) => {
              const isSelected = dObj.dateStr === value;
              const isToday = dObj.dateStr === todayStr;

              return (
                <button
                  key={dObj.dateStr}
                  type="button"
                  className={`datepicker-day-cell${
                    isSelected ? ' selected' : ''
                  }${!dObj.isCurrentMonth ? ' dimmed' : ''}${
                    isToday ? ' today' : ''
                  }`}
                  onClick={() => handleSelect(dObj.dateStr)}
                >
                  {dObj.dayNum}
                </button>
              );
            })}
          </div>

          {/* Footer Actions */}
          <div className="datepicker-footer">
            <button
              type="button"
              className="datepicker-footer-link"
              onClick={() => handleSelect(todayStr)}
            >
              Today
            </button>
            <button
              type="button"
              className="datepicker-footer-link"
              onClick={() => handleSelect(tomorrowStr)}
            >
              Tomorrow
            </button>
            <button
              type="button"
              className="datepicker-footer-link"
              style={{ color: 'var(--text-secondary)' }}
              onClick={() => setIsOpen(false)}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
