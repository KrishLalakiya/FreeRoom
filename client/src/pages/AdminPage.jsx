import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminAPI, roomsAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import Navbar from '../components/Navbar';
import {
  HiOutlineCalendar,
  HiOutlinePlusCircle,
  HiOutlineTrash,
  HiOutlineBan,
  HiOutlineArrowLeft,
  HiOutlineViewList,
  HiOutlineUpload,
  HiOutlineLink,
  HiOutlineCheckCircle,
  HiOutlineExclamationCircle,
  HiOutlineLockClosed,
} from 'react-icons/hi';
import toast from 'react-hot-toast';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function AdminPage() {
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState('events'); // 'events', 'cancel', 'timetable', 'import', 'closures'
  const [rooms, setRooms] = useState([]);
  const [events, setEvents] = useState([]);
  const [timetable, setTimetable] = useState([]);
  const [loading, setLoading] = useState(false);

  // New Event Form State
  const [eventRoomId, setEventRoomId] = useState('');
  const [eventTitle, setEventTitle] = useState('');
  const [eventStartAt, setEventStartAt] = useState('');
  const [eventEndAt, setEventEndAt] = useState('');
  const [creatingEvent, setCreatingEvent] = useState(false);

  // Cancel Class Form State
  const [cancelEntryId, setCancelEntryId] = useState('');
  const [cancelDate, setCancelDate] = useState(new Date().toISOString().split('T')[0]);
  const [cancelReason, setCancelReason] = useState('');
  const [cancellingClass, setCancellingClass] = useState(false);

  // Timetable Filters
  const [timetableRoomFilter, setTimetableRoomFilter] = useState('');
  const [timetableTermFilter, setTimetableTermFilter] = useState('');

  // Terms state (C4)
  const [terms, setTerms] = useState([]);
  const [selectedTermId, setSelectedTermId] = useState('');
  const [showCreateTerm, setShowCreateTerm] = useState(false);
  const [newBatchYear, setNewBatchYear] = useState('2029');
  const [newSemesterNumber, setNewSemesterNumber] = useState('3');
  const [newTermNumber, setNewTermNumber] = useState('5');
  const [newTermStartDate, setNewTermStartDate] = useState('2026-08-01');
  const [newTermEndDate, setNewTermEndDate] = useState('2026-10-28');
  const [creatingTerm, setCreatingTerm] = useState(false);

  // Timetable import
  const [importFile, setImportFile] = useState(null);
  const [saveValidRowsOnly, setSaveValidRowsOnly] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importReport, setImportReport] = useState(null);

  // Room aliases
  const [aliases, setAliases] = useState([]);
  const [aliasName, setAliasName] = useState('');
  const [aliasRoomId, setAliasRoomId] = useState('');
  const [savingAlias, setSavingAlias] = useState(false);

  // Closures state (C8)
  const [closures, setClosures] = useState([]);
  const [closureScope, setClosureScope] = useState('room');
  const [closureRoomId, setClosureRoomId] = useState('');
  const [closureFloor, setClosureFloor] = useState('Ground');
  const [closureStartDate, setClosureStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [closureEndDate, setClosureEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [closureIsWholeDay, setClosureIsWholeDay] = useState(true);
  const [closureStartTime, setClosureStartTime] = useState('09:00');
  const [closureEndTime, setClosureEndTime] = useState('13:00');
  const [closureReason, setClosureReason] = useState('Exam');
  const [closureNote, setClosureNote] = useState('');
  const [creatingClosure, setCreatingClosure] = useState(false);

  useEffect(() => {
    if (!isAdmin) {
      toast.error('Admin privileges required');
      navigate('/');
      return;
    }

    loadInitialData();
  }, [isAdmin, navigate]);

  const loadInitialData = async () => {
    setLoading(true);
    try {
      const [roomsRes, eventsRes, timetableRes, aliasesRes, termsRes, closuresRes] = await Promise.all([
        roomsAPI.list(1),
        adminAPI.getEvents(),
        adminAPI.getTimetable(),
        adminAPI.getRoomAliases(),
        adminAPI.getTerms(),
        adminAPI.getClosures(),
      ]);

      const rList = roomsRes.data.rooms || [];
      setRooms(rList);
      if (rList.length > 0) {
        setEventRoomId((current) => current || rList[0].id);
        setAliasRoomId((current) => current || rList[0].id);
        setClosureRoomId((current) => current || rList[0].id.toString());
        setClosureFloor((current) => current || rList[0].floor || 'Ground');
      }
      setEvents(eventsRes.data.events || []);
      setTimetable(timetableRes.data.entries || []);
      setAliases(aliasesRes.data.aliases || []);
      setClosures(closuresRes.data.closures || []);

      const tList = termsRes.data.terms || [];
      setTerms(tList);
      if (tList.length > 0) {
        setSelectedTermId((current) => current || tList[0].id.toString());
      }
    } catch (err) {
      console.error('Failed to load admin data:', err);
      toast.error('Failed to load admin data');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateEvent = async (e) => {
    e.preventDefault();
    if (!eventRoomId || !eventTitle || !eventStartAt || !eventEndAt) {
      toast.error('All event fields are required');
      return;
    }

    if (new Date(eventStartAt) >= new Date(eventEndAt)) {
      toast.error('Start time must be before end time');
      return;
    }

    setCreatingEvent(true);
    try {
      await adminAPI.createEvent({
        roomId: parseInt(eventRoomId, 10),
        title: eventTitle.trim(),
        startAt: new Date(eventStartAt).toISOString(),
        endAt: new Date(eventEndAt).toISOString(),
      });

      toast.success('Event scheduled successfully!');
      setEventTitle('');
      setEventStartAt('');
      setEventEndAt('');

      // Refresh events list
      const res = await adminAPI.getEvents();
      setEvents(res.data.events || []);
    } catch (err) {
      if (err.response?.status === 409) {
        toast.error(err.response.data.message || 'Time clash detected!');
      } else {
        toast.error(err.response?.data?.message || 'Failed to create event');
      }
    } finally {
      setCreatingEvent(false);
    }
  };

  const handleDeleteEvent = async (eventId) => {
    if (!window.confirm('Are you sure you want to cancel this event?')) return;

    try {
      await adminAPI.deleteEvent(eventId);
      toast.success('Event deleted');
      setEvents(events.filter((ev) => ev.id !== eventId));
    } catch (err) {
      console.error('Failed to delete event:', err);
      toast.error('Failed to delete event');
    }
  };

  const handleCancelClass = async (e) => {
    e.preventDefault();
    if (!cancelEntryId || !cancelDate) {
      toast.error('Please select a class and date');
      return;
    }

    setCancellingClass(true);
    try {
      await adminAPI.cancelClass({
        timetableEntryId: parseInt(cancelEntryId, 10),
        date: cancelDate,
        reason: cancelReason.trim() || 'Cancelled by instructor',
      });

      toast.success('Class occurrence cancelled successfully for selected date!');
      setCancelReason('');
    } catch (err) {
      if (err.response?.status === 409) {
        toast.error(err.response.data.message || 'Already cancelled for this date');
      } else {
        toast.error(err.response?.data?.message || 'Failed to cancel class');
      }
    } finally {
      setCancellingClass(false);
    }
  };

  const filteredTimetable = timetable.filter((te) => {
    if (timetableRoomFilter && te.room_id.toString() !== timetableRoomFilter) return false;
    if (timetableTermFilter && te.term_id?.toString() !== timetableTermFilter) return false;
    return true;
  });

  const handleCreateTerm = async (e) => {
    e.preventDefault();
    if (!newBatchYear || !newSemesterNumber || !newTermNumber || !newTermStartDate || !newTermEndDate) {
      toast.error('Please fill in all term fields');
      return;
    }
    if (newTermStartDate > newTermEndDate) {
      toast.error('Start date must be before end date');
      return;
    }

    setCreatingTerm(true);
    try {
      const res = await adminAPI.createTerm({
        batchYear: parseInt(newBatchYear, 10),
        semesterNumber: parseInt(newSemesterNumber, 10),
        termNumber: parseInt(newTermNumber, 10),
        startDate: newTermStartDate,
        endDate: newTermEndDate,
      });

      toast.success(`Created Term ${res.data.term.term_number} for Batch ${res.data.term.batch_year}`);
      const refreshed = await adminAPI.getTerms();
      setTerms(refreshed.data.terms || []);
      setSelectedTermId(res.data.term.id.toString());
      setShowCreateTerm(false);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to create term');
    } finally {
      setCreatingTerm(false);
    }
  };

  const handleImportTimetable = async (e) => {
    e.preventDefault();

    if (!importFile) {
      toast.error('Choose an .xlsx file to upload');
      return;
    }
    if (!selectedTermId) {
      toast.error('Please select the Batch and Term for this timetable');
      return;
    }

    const formData = new FormData();
    formData.append('file', importFile);
    formData.append('buildingId', '1');
    formData.append('termId', selectedTermId);
    formData.append('saveValidRowsOnly', saveValidRowsOnly ? 'true' : 'false');

    setImporting(true);
    setImportReport(null);
    try {
      const res = await adminAPI.importTimetable(formData);
      setImportReport(res.data);
      toast.success(res.data.message || 'Timetable imported');

      const timetableRes = await adminAPI.getTimetable();
      setTimetable(timetableRes.data.entries || []);
      setImportFile(null);
    } catch (err) {
      const report = err.response?.data;
      if (report && report.errors) {
        setImportReport(report);
        toast.error(report.message || 'Upload rejected. Check the report.');
      } else {
        toast.error(report?.message || 'Failed to import timetable');
      }
    } finally {
      setImporting(false);
    }
  };

  const handleAddAlias = async (e) => {
    e.preventDefault();
    if (!aliasName.trim() || !aliasRoomId) {
      toast.error('Enter a spelling and pick a room');
      return;
    }

    setSavingAlias(true);
    try {
      await adminAPI.createRoomAlias(aliasName.trim(), parseInt(aliasRoomId, 10));
      toast.success('Room alias saved');
      setAliasName('');
      const res = await adminAPI.getRoomAliases();
      setAliases(res.data.aliases || []);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save alias');
    } finally {
      setSavingAlias(false);
    }
  };

  const handleDeleteAlias = async (aliasId) => {
    try {
      await adminAPI.deleteRoomAlias(aliasId);
      setAliases(aliases.filter((a) => a.id !== aliasId));
      toast.success('Alias deleted');
    } catch (err) {
      toast.error('Failed to delete alias');
    }
  };

  const handleCreateClosure = async (e) => {
    e.preventDefault();
    if (closureScope === 'building') {
      const confirmed = window.confirm(
        '⚠️ Are you sure you want to close the ENTIRE college building? This will mark all classrooms as closed for this period.'
      );
      if (!confirmed) return;
    }

    if (closureEndDate < closureStartDate) {
      toast.error('End date cannot be before start date');
      return;
    }

    if (!closureIsWholeDay && closureStartTime >= closureEndTime) {
      toast.error('Start time must be before end time');
      return;
    }

    setCreatingClosure(true);
    try {
      const payload = {
        scope: closureScope,
        startDate: closureStartDate,
        endDate: closureEndDate,
        startTime: closureIsWholeDay ? null : closureStartTime,
        endTime: closureIsWholeDay ? null : closureEndTime,
        reason: closureReason.trim() || 'Exam',
        note: closureNote.trim() || null,
      };

      if (closureScope === 'room') {
        payload.roomId = parseInt(closureRoomId, 10);
      } else if (closureScope === 'floor') {
        payload.floor = closureFloor;
      }

      const res = await adminAPI.createClosure(payload);
      if (res.data.warning) {
        toast((t) => <span>⚠️ {res.data.warning}</span>, { icon: '⚠️' });
      }
      if (res.data.merged) {
        toast.success('Overlapping closure merged successfully!');
      } else {
        toast.success('Closure scheduled successfully!');
      }

      setClosureNote('');
      const updated = await adminAPI.getClosures();
      setClosures(updated.data.closures || []);
    } catch (err) {
      console.error('Failed to create closure:', err);
      toast.error(err.response?.data?.message || 'Failed to create closure');
    } finally {
      setCreatingClosure(false);
    }
  };

  const handleDeleteClosure = async (closureId) => {
    if (!window.confirm('Are you sure you want to delete this closure?')) return;
    try {
      await adminAPI.deleteClosure(closureId);
      toast.success('Closure removed');
      setClosures((prev) => prev.filter((c) => c.id !== closureId));
    } catch (err) {
      console.error('Failed to delete closure:', err);
      toast.error('Failed to delete closure');
    }
  };

  return (
    <div className="app-container">
      <Navbar />

      <button className="back-btn" onClick={() => navigate('/')}>
        <HiOutlineArrowLeft size={16} />
        Back to Dashboard
      </button>

      {/* Admin Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 className="section-title" style={{ fontSize: '1.75rem' }}>
          Schedule Administration
        </h1>
        <p className="section-subtitle">
          Create one-off events with clash detection, cancel single occurrences of classes, inspect master timetable, and manage exam closures.
        </p>
      </div>

      {/* Tabs */}
      <div className="search-tabs" style={{ marginBottom: 24 }}>
        <button
          className={`search-tab ${activeTab === 'events' ? 'search-tab-active' : ''}`}
          onClick={() => setActiveTab('events')}
        >
          <HiOutlineCalendar size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} />
          One-Off Events
        </button>
        <button
          className={`search-tab ${activeTab === 'closures' ? 'search-tab-active' : ''}`}
          onClick={() => setActiveTab('closures')}
        >
          <HiOutlineLockClosed size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} />
          Exam & Room Closures
        </button>
        <button
          className={`search-tab ${activeTab === 'cancel' ? 'search-tab-active' : ''}`}
          onClick={() => setActiveTab('cancel')}
        >
          <HiOutlineBan size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} />
          Cancel Class Occurrence
        </button>
        <button
          className={`search-tab ${activeTab === 'timetable' ? 'search-tab-active' : ''}`}
          onClick={() => setActiveTab('timetable')}
        >
          <HiOutlineViewList size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} />
          Master Timetable
        </button>
        <button
          className={`search-tab ${activeTab === 'import' ? 'search-tab-active' : ''}`}
          onClick={() => setActiveTab('import')}
        >
          <HiOutlineUpload size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} />
          Import Timetable
        </button>
      </div>

      {/* ── Tab 1: One-Off Events ────────────────────────── */}
      {activeTab === 'events' && (
        <div className="admin-grid fade-in">
          {/* Create Event Card */}
          <div className="admin-card">
            <h2 className="section-title" style={{ fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: 8 }}>
              <HiOutlinePlusCircle size={20} style={{ color: 'var(--accent-primary)' }} />
              Schedule One-Off Event
            </h2>
            <p className="section-subtitle" style={{ marginBottom: 16 }}>
              Add seminars, exams, or club meetings with automatic room clash validation.
            </p>

            <form onSubmit={handleCreateEvent}>
              <div className="input-group">
                <label className="input-label">Classroom</label>
                <select
                  className="input-field"
                  value={eventRoomId}
                  onChange={(e) => setEventRoomId(e.target.value)}
                  required
                >
                  {rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      Room {r.name} ({r.floor} Floor · {r.capacity} seats)
                    </option>
                  ))}
                </select>
              </div>

              <div className="input-group">
                <label className="input-label">Event Title</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="e.g. AI Seminar / Midterm Exam"
                  value={eventTitle}
                  onChange={(e) => setEventTitle(e.target.value)}
                  required
                />
              </div>

              <div className="form-row">
                <div className="input-group">
                  <label className="input-label">Starts At</label>
                  <input
                    type="datetime-local"
                    className="input-field"
                    value={eventStartAt}
                    onChange={(e) => setEventStartAt(e.target.value)}
                    required
                  />
                </div>
                <div className="input-group">
                  <label className="input-label">Ends At</label>
                  <input
                    type="datetime-local"
                    className="input-field"
                    value={eventEndAt}
                    onChange={(e) => setEventEndAt(e.target.value)}
                    required
                  />
                </div>
              </div>

              <button
                type="submit"
                className="btn btn-primary btn-full"
                disabled={creatingEvent}
                style={{ marginTop: 12 }}
              >
                {creatingEvent ? 'Checking Clashes...' : 'Schedule Event'}
              </button>
            </form>
          </div>

          {/* Upcoming Events List */}
          <div className="admin-card">
            <h2 className="section-title" style={{ fontSize: '1.15rem' }}>
              Upcoming Special Events ({events.length})
            </h2>
            <p className="section-subtitle" style={{ marginBottom: 16 }}>
              Active events that override normal timetable availability.
            </p>

            {events.length === 0 ? (
              <div className="empty-state" style={{ padding: '32px 0' }}>
                <div className="empty-state-title" style={{ fontSize: '0.95rem' }}>No upcoming events</div>
                <div className="empty-state-text">Scheduled events will appear here.</div>
              </div>
            ) : (
              <div style={{ maxHeight: '420px', overflowY: 'auto' }}>
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Room</th>
                      <th>Event</th>
                      <th>Time</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((ev) => (
                      <tr key={ev.id}>
                        <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                          {ev.room_name}
                        </td>
                        <td>{ev.title}</td>
                        <td style={{ fontSize: '0.75rem' }}>
                          {new Date(ev.start_at).toLocaleDateString()}
                          <br />
                          {new Date(ev.start_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} -{' '}
                          {new Date(ev.end_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td>
                          <button
                            className="btn btn-ghost btn-icon"
                            style={{ color: 'var(--accent-danger)' }}
                            onClick={() => handleDeleteEvent(ev.id)}
                            title="Delete event"
                          >
                            <HiOutlineTrash size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Tab 2: Cancel Class Occurrence ───────────────── */}
      {activeTab === 'cancel' && (
        <div className="admin-card fade-in" style={{ maxWidth: 640 }}>
          <h2 className="section-title" style={{ fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: 8 }}>
            <HiOutlineBan size={20} style={{ color: 'var(--accent-danger)' }} />
            Cancel Single Class Occurrence
          </h2>
          <p className="section-subtitle" style={{ marginBottom: 20 }}>
            Frees up a room for a specific date (e.g. cancelled lecture) without modifying the recurring master timetable.
          </p>

          <form onSubmit={handleCancelClass}>
            <div className="input-group">
              <label className="input-label">Select Recurring Class</label>
              <select
                className="input-field"
                value={cancelEntryId}
                onChange={(e) => setCancelEntryId(e.target.value)}
                required
              >
                <option value="">-- Choose a recurring class --</option>
                {timetable.map((te) => (
                  <option key={te.id} value={te.id}>
                    {DAY_NAMES[te.day_of_week]} {te.start_time}-{te.end_time}: {te.course_name} (Room {te.room_name})
                  </option>
                ))}
              </select>
            </div>

            <div className="input-group">
              <label className="input-label">Date of Cancellation</label>
              <input
                type="date"
                className="input-field"
                value={cancelDate}
                onChange={(e) => setCancelDate(e.target.value)}
                required
              />
            </div>

            <div className="input-group">
              <label className="input-label">Reason / Notes (Optional)</label>
              <input
                type="text"
                className="input-field"
                placeholder="e.g. Instructor on leave / Holiday"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              disabled={cancellingClass}
              style={{ marginTop: 8 }}
            >
              {cancellingClass ? 'Recording...' : 'Cancel Occurrence & Free Room'}
            </button>
          </form>
        </div>
      )}

      {/* ── Tab 3: Master Timetable ──────────────────────── */}
      {activeTab === 'timetable' && (
        <div className="admin-card fade-in">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
            <div>
              <h2 className="section-title" style={{ fontSize: '1.15rem' }}>Master Weekly Timetable</h2>
              <p className="section-subtitle">Showing all recurring class slots across the academic week.</p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <label className="input-label" style={{ marginBottom: 0 }}>Term:</label>
                <select
                  className="input-field"
                  style={{ width: 'auto', padding: '6px 12px' }}
                  value={timetableTermFilter}
                  onChange={(e) => setTimetableTermFilter(e.target.value)}
                >
                  <option value="">All Terms</option>
                  {terms.map((t) => (
                    <option key={t.id} value={t.id}>
                      Batch {t.batch_year} (T{t.term_number})
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <label className="input-label" style={{ marginBottom: 0 }}>Room:</label>
                <select
                  className="input-field"
                  style={{ width: 'auto', padding: '6px 12px' }}
                  value={timetableRoomFilter}
                  onChange={(e) => setTimetableRoomFilter(e.target.value)}
                >
                  <option value="">All Rooms</option>
                  {rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      Room {r.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Day</th>
                  <th>Time</th>
                  <th>Batch / Term</th>
                  <th>Room</th>
                  <th>Course</th>
                  <th>Teacher</th>
                  <th>Group</th>
                </tr>
              </thead>
              <tbody>
                {filteredTimetable.map((te) => (
                  <tr key={te.id}>
                    <td style={{ fontWeight: 600, color: 'var(--accent-primary-light)' }}>
                      {DAY_NAMES[te.day_of_week]}
                    </td>
                    <td>
                      {te.start_time} - {te.end_time}
                    </td>
                    <td>
                      {te.batch_year ? (
                        <span className="room-card-floor" style={{ background: 'rgba(56, 189, 248, 0.12)', color: 'var(--accent-primary-light)' }}>
                          {te.batch_year} (T{te.term_number})
                        </span>
                      ) : (
                        '--'
                      )}
                    </td>
                    <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                      Room {te.room_name} ({te.floor} Fl)
                    </td>
                    <td>{te.course_name}</td>
                    <td>{te.teacher || '--'}</td>
                    <td>
                      <span className="room-card-floor">{te.group_name || 'All'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {/* ── Tab 4: Import Timetable ──────────────────────── */}
      {activeTab === 'import' && (
        <div className="fade-in">
          <div className="admin-grid">
            <div className="admin-card">
              <h2 className="section-title" style={{ fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                <HiOutlineUpload size={20} style={{ color: 'var(--accent-primary)' }} />
                Upload Weekly Timetable
              </h2>
              <p className="section-subtitle" style={{ marginBottom: 16 }}>
                Upload the .xlsx export for a batch and term. Each batch has its own sheet and term schedule.
                Historical terms remain intact.
              </p>

              <form onSubmit={handleImportTimetable}>
                <div className="input-group">
                  <label className="input-label">Timetable File (.xlsx)</label>
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    className="input-field"
                    onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                    required
                  />
                </div>

                <div className="input-group">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <label className="input-label" style={{ marginBottom: 0 }}>Batch & Term</label>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ padding: '2px 8px', fontSize: '0.8rem' }}
                      onClick={() => setShowCreateTerm(!showCreateTerm)}
                    >
                      {showCreateTerm ? 'Cancel' : '+ Add New Term'}
                    </button>
                  </div>
                  <select
                    className="input-field"
                    value={selectedTermId}
                    onChange={(e) => setSelectedTermId(e.target.value)}
                    required
                  >
                    <option value="">-- Choose Batch & Term --</option>
                    {terms.map((t) => (
                      <option key={t.id} value={t.id}>
                        Batch {t.batch_year} — Term {t.term_number} (Sem {t.semester_number}) [{String(t.start_date).slice(0, 10)} to {String(t.end_date).slice(0, 10)}]
                      </option>
                    ))}
                  </select>
                </div>

                {terms.find((t) => t.id.toString() === selectedTermId.toString()) && (
                  <div style={{
                    padding: '10px 14px',
                    background: 'rgba(56, 189, 248, 0.08)',
                    border: '1px solid rgba(56, 189, 248, 0.25)',
                    borderRadius: 'var(--radius-md)',
                    marginBottom: 16,
                    fontSize: '0.85rem',
                  }}>
                    {(() => {
                      const t = terms.find((term) => term.id.toString() === selectedTermId.toString());
                      return (
                        <>
                          <div style={{ fontWeight: 600, color: 'var(--accent-primary-light)' }}>
                            Batch {t.batch_year} • Semester {t.semester_number} • Term {t.term_number}
                          </div>
                          <div style={{ color: 'var(--text-secondary)', marginTop: 4 }}>
                            Term Duration: <strong>{String(t.start_date).slice(0, 10)}</strong> to <strong>{String(t.end_date).slice(0, 10)}</strong>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                )}

                {showCreateTerm && (
                  <div style={{
                    padding: '14px',
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-md)',
                    marginBottom: 16,
                  }}>
                    <h3 style={{ fontSize: '0.95rem', marginBottom: 10, color: 'var(--text-primary)' }}>
                      Add New Term
                    </h3>
                    <div className="form-row">
                      <div className="input-group">
                        <label className="input-label">Batch Year</label>
                        <input
                          type="number"
                          className="input-field"
                          placeholder="e.g. 2029"
                          value={newBatchYear}
                          onChange={(e) => setNewBatchYear(e.target.value)}
                        />
                      </div>
                      <div className="input-group">
                        <label className="input-label">Semester #</label>
                        <input
                          type="number"
                          className="input-field"
                          placeholder="e.g. 3"
                          value={newSemesterNumber}
                          onChange={(e) => setNewSemesterNumber(e.target.value)}
                        />
                      </div>
                      <div className="input-group">
                        <label className="input-label">Term #</label>
                        <input
                          type="number"
                          className="input-field"
                          placeholder="e.g. 5"
                          value={newTermNumber}
                          onChange={(e) => setNewTermNumber(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="form-row">
                      <div className="input-group">
                        <label className="input-label">Start Date</label>
                        <input
                          type="date"
                          className="input-field"
                          value={newTermStartDate}
                          onChange={(e) => setNewTermStartDate(e.target.value)}
                        />
                      </div>
                      <div className="input-group">
                        <label className="input-label">End Date</label>
                        <input
                          type="date"
                          className="input-field"
                          value={newTermEndDate}
                          onChange={(e) => setNewTermEndDate(e.target.value)}
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ fontSize: '0.85rem', padding: '6px 14px' }}
                      disabled={creatingTerm}
                      onClick={handleCreateTerm}
                    >
                      {creatingTerm ? 'Saving...' : 'Save Term'}
                    </button>
                  </div>
                )}

                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 12 }}>
                  <input
                    type="checkbox"
                    checked={saveValidRowsOnly}
                    onChange={(e) => setSaveValidRowsOnly(e.target.checked)}
                  />
                  Save valid rows only (skip rows with errors)
                </label>

                <button
                  type="submit"
                  className="btn btn-primary btn-full"
                  disabled={importing}
                >
                  {importing ? 'Validating & importing...' : 'Validate & Import'}
                </button>
              </form>
            </div>

            <div className="admin-card">
              <h2 className="section-title" style={{ fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                <HiOutlineLink size={20} style={{ color: 'var(--accent-primary)' }} />
                Room Name Aliases ({aliases.length})
              </h2>
              <p className="section-subtitle" style={{ marginBottom: 16 }}>
                Map the spellings used in the sheet (e.g. "Class A 1st floor") to a real room.
                Unmapped names are reported after an upload.
              </p>

              <form onSubmit={handleAddAlias} style={{ marginBottom: 16 }}>
                <div className="form-row">
                  <div className="input-group">
                    <label className="input-label">Spelling in sheet</label>
                    <input
                      type="text"
                      className="input-field"
                      placeholder="e.g. Class A ist floor"
                      value={aliasName}
                      onChange={(e) => setAliasName(e.target.value)}
                    />
                  </div>
                  <div className="input-group">
                    <label className="input-label">Room</label>
                    <select
                      className="input-field"
                      value={aliasRoomId}
                      onChange={(e) => setAliasRoomId(e.target.value)}
                    >
                      {rooms.map((r) => (
                        <option key={r.id} value={r.id}>
                          Room {r.name} ({r.floor})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <button type="submit" className="btn btn-ghost" disabled={savingAlias}>
                  {savingAlias ? 'Saving...' : 'Add Alias'}
                </button>
              </form>

              <div style={{ maxHeight: 240, overflowY: 'auto' }}>
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Sheet Spelling</th>
                      <th>Room</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {aliases.map((a) => (
                      <tr key={a.id}>
                        <td>{a.alias}</td>
                        <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{a.room_name}</td>
                        <td>
                          <button
                            className="btn btn-ghost btn-icon"
                            style={{ color: 'var(--accent-danger)' }}
                            onClick={() => handleDeleteAlias(a.id)}
                            title="Delete alias"
                          >
                            <HiOutlineTrash size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {aliases.length === 0 && (
                      <tr>
                        <td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                          No aliases yet
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {importReport && (
            <div className="admin-card fade-in" style={{ marginTop: 20 }}>
              <h2 className="section-title" style={{ fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                {importReport.committed ? (
                  <HiOutlineCheckCircle size={20} style={{ color: 'var(--accent-success)' }} />
                ) : (
                  <HiOutlineExclamationCircle size={20} style={{ color: 'var(--accent-danger)' }} />
                )}
                Import Report
              </h2>

              <div className="stats-row" style={{ marginBottom: 16 }}>
                <div className="stat-card">
                  <div className="stat-value">{importReport.parsedCount ?? 0}</div>
                  <div className="stat-label">Parsed</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{importReport.savedCount ?? 0}</div>
                  <div className="stat-label">Saved</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{importReport.duplicateCount ?? 0}</div>
                  <div className="stat-label">Duplicates skipped</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{importReport.errors?.length ?? 0}</div>
                  <div className="stat-label">Errors</div>
                </div>
              </div>

              <p className="section-subtitle" style={{ marginBottom: 12 }}>
                {importReport.message}
                {importReport.sheetName ? ` Sheet: ${importReport.sheetName}.` : ''}
              </p>

              {importReport.unmappedRooms?.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div className="input-label">Unmapped room names</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {importReport.unmappedRooms.map((room) => (
                      <span key={room} className="room-card-badge badge-split">{room}</span>
                    ))}
                  </div>
                </div>
              )}

              {importReport.errors?.length > 0 && (
                <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Row</th>
                        <th>Day</th>
                        <th>Cell</th>
                        <th>Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importReport.errors.map((err, i) => (
                        <tr key={i}>
                          <td>{err.sheetRow}</td>
                          <td>{err.dayOfWeek !== undefined ? DAY_NAMES[err.dayOfWeek] : '--'}</td>
                          <td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {err.value || '--'}
                          </td>
                          <td>{err.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Exam & Room Closures (C8) ────────────────── */}
      {activeTab === 'closures' && (
        <div className="admin-grid fade-in">
          {/* Create Closure Card */}
          <div className="admin-card">
            <h2 className="section-title" style={{ fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: 8 }}>
              <HiOutlineLockClosed size={20} style={{ color: 'var(--accent-primary)' }} />
              Schedule Exam or Room Closure
            </h2>
            <p className="section-subtitle" style={{ marginBottom: 16 }}>
              Block rooms, entire floors, or the college building for exams or maintenance. Closures supersede normal timetables.
            </p>

            <form onSubmit={handleCreateClosure}>
              <div className="input-group">
                <label className="input-label">Closure Scope</label>
                <div style={{ display: 'flex', gap: 12, marginTop: 4, flexWrap: 'wrap' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: '0.9rem' }}>
                    <input
                      type="radio"
                      name="closureScope"
                      value="room"
                      checked={closureScope === 'room'}
                      onChange={() => setClosureScope('room')}
                    />
                    Specific Room
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: '0.9rem' }}>
                    <input
                      type="radio"
                      name="closureScope"
                      value="floor"
                      checked={closureScope === 'floor'}
                      onChange={() => setClosureScope('floor')}
                    />
                    Entire Floor
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: '0.9rem' }}>
                    <input
                      type="radio"
                      name="closureScope"
                      value="building"
                      checked={closureScope === 'building'}
                      onChange={() => setClosureScope('building')}
                    />
                    Whole Building
                  </label>
                </div>
              </div>

              {closureScope === 'room' && (
                <div className="input-group">
                  <label className="input-label">Classroom</label>
                  <select
                    className="input-field"
                    value={closureRoomId}
                    onChange={(e) => setClosureRoomId(e.target.value)}
                    required
                  >
                    {rooms.map((r) => (
                      <option key={r.id} value={r.id}>
                        Room {r.name} ({r.floor} Floor · {r.capacity} seats)
                      </option>
                    ))}
                  </select>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 4 }}>
                    Note: Closing Room 2B automatically blocks sub-rooms 2B1 and 2B2. Closing 2B1 or 2B2 blocks full 2B.
                  </div>
                </div>
              )}

              {closureScope === 'floor' && (
                <div className="input-group">
                  <label className="input-label">Select Floor</label>
                  <select
                    className="input-field"
                    value={closureFloor}
                    onChange={(e) => setClosureFloor(e.target.value)}
                    required
                  >
                    {[...new Set(rooms.map((r) => r.floor).filter(Boolean))].map((f) => (
                      <option key={f} value={f}>
                        {f} Floor
                      </option>
                    ))}
                  </select>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 4 }}>
                    Note: Closing a floor covers every classroom on that floor.
                  </div>
                </div>
              )}

              {closureScope === 'building' && (
                <div className="card" style={{ padding: 12, marginBottom: 16, borderColor: 'var(--accent-warning)', background: 'var(--accent-warning-bg, rgba(245, 158, 11, 0.1))' }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                    ⚠️ Whole Building Closure
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                    This will block all classrooms across all floors during the specified period. A confirmation dialog will appear upon saving.
                  </div>
                </div>
              )}

              <div className="form-row">
                <div className="input-group">
                  <label className="input-label">Start Date</label>
                  <input
                    type="date"
                    className="input-field"
                    value={closureStartDate}
                    onChange={(e) => {
                      setClosureStartDate(e.target.value);
                      if (closureEndDate < e.target.value) {
                        setClosureEndDate(e.target.value);
                      }
                    }}
                    required
                  />
                </div>
                <div className="input-group">
                  <label className="input-label">End Date</label>
                  <input
                    type="date"
                    className="input-field"
                    value={closureEndDate}
                    min={closureStartDate}
                    onChange={(e) => setClosureEndDate(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="input-group" style={{ marginBottom: 12 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.9rem' }}>
                  <input
                    type="checkbox"
                    checked={closureIsWholeDay}
                    onChange={(e) => setClosureIsWholeDay(e.target.checked)}
                  />
                  <span>Whole Day Closure (Building Hours)</span>
                </label>
              </div>

              {!closureIsWholeDay && (
                <div className="form-row">
                  <div className="input-group">
                    <label className="input-label">Start Time</label>
                    <input
                      type="time"
                      className="input-field"
                      value={closureStartTime}
                      onChange={(e) => setClosureStartTime(e.target.value)}
                      required={!closureIsWholeDay}
                    />
                  </div>
                  <div className="input-group">
                    <label className="input-label">End Time</label>
                    <input
                      type="time"
                      className="input-field"
                      value={closureEndTime}
                      onChange={(e) => setClosureEndTime(e.target.value)}
                      required={!closureIsWholeDay}
                    />
                  </div>
                </div>
              )}

              <div className="input-group">
                <label className="input-label">Reason</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="e.g. Midterm Exam / Final Exam"
                  value={closureReason}
                  onChange={(e) => setClosureReason(e.target.value)}
                  required
                />
              </div>

              <div className="input-group">
                <label className="input-label">Admin Note (Optional)</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="e.g. Batch 2029 Term 5 End-term exams"
                  value={closureNote}
                  onChange={(e) => setClosureNote(e.target.value)}
                />
              </div>

              <button
                type="submit"
                className="btn btn-primary btn-full"
                disabled={creatingClosure}
                style={{ marginTop: 12 }}
              >
                {creatingClosure ? 'Saving Closure...' : 'Schedule Closure'}
              </button>
            </form>
          </div>

          {/* Closures List Card */}
          <div className="admin-card">
            <h2 className="section-title" style={{ fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: 8 }}>
              <HiOutlineViewList size={20} style={{ color: 'var(--accent-primary)' }} />
              Active & Upcoming Closures ({closures.length})
            </h2>
            <p className="section-subtitle" style={{ marginBottom: 16 }}>
              Exams and closures take priority over recurring timetables.
            </p>

            {closures.length === 0 ? (
              <div className="empty-state">
                <HiOutlineLockClosed size={36} className="empty-state-icon" />
                <div className="empty-state-title">No Closures Scheduled</div>
                <div className="empty-state-desc">Classrooms will be available according to the academic timetable.</div>
              </div>
            ) : (
              <div style={{ maxHeight: 600, overflowY: 'auto' }}>
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Scope & Target</th>
                      <th>Dates</th>
                      <th>Time</th>
                      <th>Reason</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {closures.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <div style={{ fontWeight: 600 }}>
                            {c.scope === 'building' && 'Whole Building'}
                            {c.scope === 'floor' && `${c.floor} Floor`}
                            {c.scope === 'room' && `Room ${c.room_name || c.room_id}`}
                          </div>
                          <span
                            className={`room-card-badge ${
                              c.scope === 'building' ? 'badge-danger' : c.scope === 'floor' ? 'badge-split' : ''
                            }`}
                            style={{ fontSize: '0.7rem' }}
                          >
                            {c.scope}
                          </span>
                        </td>
                        <td>
                          {c.start_date === c.end_date ? (
                            <span>{c.start_date}</span>
                          ) : (
                            <span>
                              {c.start_date} <br />
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>to {c.end_date}</span>
                            </span>
                          )}
                        </td>
                        <td>
                          {!c.start_time ? (
                            <span className="room-card-badge">Whole day</span>
                          ) : (
                            <span style={{ fontSize: '0.85rem' }}>
                              {String(c.start_time).slice(0, 5)} - {String(c.end_time).slice(0, 5)}
                            </span>
                          )}
                        </td>
                        <td>
                          <div style={{ fontWeight: 500 }}>{c.reason || 'Exam'}</div>
                          {c.note && (
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                              {c.note}
                            </div>
                          )}
                        </td>
                        <td>
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={() => handleDeleteClosure(c.id)}
                            title="Delete closure"
                          >
                            <HiOutlineTrash size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
