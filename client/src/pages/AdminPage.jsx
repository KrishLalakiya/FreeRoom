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
} from 'react-icons/hi';
import toast from 'react-hot-toast';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function AdminPage() {
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState('events'); // 'events', 'cancel', 'timetable'
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

  // Timetable Room Filter
  const [timetableRoomFilter, setTimetableRoomFilter] = useState('');

  // Timetable import
  const [importFile, setImportFile] = useState(null);
  const [importValidFrom, setImportValidFrom] = useState(new Date().toISOString().split('T')[0]);
  const [importValidTo, setImportValidTo] = useState('');
  const [saveValidRowsOnly, setSaveValidRowsOnly] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importReport, setImportReport] = useState(null);

  // Room aliases
  const [aliases, setAliases] = useState([]);
  const [aliasName, setAliasName] = useState('');
  const [aliasRoomId, setAliasRoomId] = useState('');
  const [savingAlias, setSavingAlias] = useState(false);

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
      const [roomsRes, eventsRes, timetableRes, aliasesRes] = await Promise.all([
        roomsAPI.list(1),
        adminAPI.getEvents(),
        adminAPI.getTimetable(),
        adminAPI.getRoomAliases(),
      ]);

      const rList = roomsRes.data.rooms || [];
      setRooms(rList);
      if (rList.length > 0) {
        setEventRoomId((current) => current || rList[0].id);
        setAliasRoomId((current) => current || rList[0].id);
      }
      setEvents(eventsRes.data.events || []);
      setTimetable(timetableRes.data.entries || []);
      setAliases(aliasesRes.data.aliases || []);
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

  const filteredTimetable = timetableRoomFilter
    ? timetable.filter((te) => te.room_id.toString() === timetableRoomFilter)
    : timetable;

  const handleImportTimetable = async (e) => {
    e.preventDefault();

    if (!importFile) {
      toast.error('Choose an .xlsx file to upload');
      return;
    }
    if (!importValidFrom || !importValidTo) {
      toast.error('Set the timetable validity dates');
      return;
    }
    if (importValidFrom > importValidTo) {
      toast.error('Valid-from must be before valid-to');
      return;
    }

    const formData = new FormData();
    formData.append('file', importFile);
    formData.append('buildingId', '1');
    formData.append('validFrom', importValidFrom);
    formData.append('validTo', importValidTo);
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
          Create one-off events with clash detection, cancel single occurrences of classes, and inspect master timetable.
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

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <label className="input-label" style={{ marginBottom: 0 }}>Filter Room:</label>
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

          <div style={{ overflowX: 'auto' }}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Day</th>
                  <th>Time</th>
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
                Upload the .xlsx export of the Google Sheet. Merged class blocks, room-name variants and
                lunch cells are handled automatically. Identical classes across groups are de-duplicated.
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

                <div className="form-row">
                  <div className="input-group">
                    <label className="input-label">Valid From</label>
                    <input
                      type="date"
                      className="input-field"
                      value={importValidFrom}
                      onChange={(e) => setImportValidFrom(e.target.value)}
                      required
                    />
                  </div>
                  <div className="input-group">
                    <label className="input-label">Valid To</label>
                    <input
                      type="date"
                      className="input-field"
                      value={importValidTo}
                      onChange={(e) => setImportValidTo(e.target.value)}
                      required
                    />
                  </div>
                </div>

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

    </div>
  );
}
