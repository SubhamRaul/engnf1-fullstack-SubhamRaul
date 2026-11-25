import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../api/client';

export default function AdminPage() {
  const [tab, setTab] = useState('bookings'); // 'bookings' | 'resources' | 'analytics'
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  // Bookings tab state
  const [bookings, setBookings] = useState([]);
  const [bStatus, setBStatus] = useState('');
  const [rejectNotes, setRejectNotes] = useState({});

  // Resources tab state
  const [resources, setResources] = useState([]);
  const [newRes, setNewRes] = useState({ name: '', type: 'ROOM', capacity: 4, description: '' });

  // Analytics tab state
  const [adminStats, setAdminStats] = useState(null);

  const loadBookings = useCallback(async () => {
    const qs = new URLSearchParams();
    if (bStatus) qs.set('status', bStatus);
    const res = await apiFetch(`/bookings?${qs.toString()}`);
    setBookings(res.data);
  }, [bStatus]);

  const loadResources = useCallback(async () => {
    const res = await apiFetch('/resources?page=1');
    setResources(res.data);
  }, []);

  const loadAnalytics = useCallback(async () => {
    setAdminStats(await apiFetch('/admin/stats'));
  }, []);

  useEffect(() => {
    setError('');
    if (tab === 'bookings') loadBookings().catch((e) => setError(e.message));
    if (tab === 'resources') loadResources().catch((e) => setError(e.message));
    if (tab === 'analytics') loadAnalytics().catch((e) => setError(e.message));
  }, [tab, loadBookings, loadResources, loadAnalytics]);

  async function approveBooking(id) {
    setError(''); setNotice('');
    try {
      await apiFetch(`/bookings/${id}/approve`, { method: 'PATCH' });
      setNotice(`Booking #${id} approved.`);
      loadBookings();
    } catch (err) { setError(err.message); }
  }

  async function rejectBooking(id) {
    setError(''); setNotice('');
    const note = (rejectNotes[id] || '').trim();
    if (note.length < 5) {
      setError('Enter a rejection note of at least 5 characters.');
      return;
    }
    try {
      await apiFetch(`/bookings/${id}/reject`, {
        method: 'PATCH',
        body: JSON.stringify({ note }),
      });
      setNotice(`Booking #${id} rejected.`);
      loadBookings();
    } catch (err) { setError(err.message); }
  }

  async function createResource(e) {
    e.preventDefault();
    setError(''); setNotice('');
    try {
      await apiFetch('/resources', {
        method: 'POST',
        body: JSON.stringify({ ...newRes, capacity: Number(newRes.capacity) }),
      });
      setNotice(`Resource "${newRes.name}" created.`);
      setNewRes({ name: '', type: 'ROOM', capacity: 4, description: '' });
      loadResources();
    } catch (err) { setError(err.message); }
  }

  async function toggleResourceActive(r) {
    setError(''); setNotice('');
    try {
      await apiFetch(`/resources/${r.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !r.isActive }),
      });
      setNotice(`${r.name} is now ${!r.isActive ? 'Active' : 'Inactive'}.`);
      loadResources();
    } catch (err) { setError(err.message); }
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Admin Console</h1>
        <div className="btn-group">
          <button className={`btn ${tab === 'bookings' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('bookings')}>Bookings</button>
          <button className={`btn ${tab === 'resources' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('resources')}>Resources</button>
          <button className={`btn ${tab === 'analytics' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('analytics')}>Analytics</button>
        </div>
      </div>

      {notice && <div className="alert alert-success">{notice}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      {/* TAB 1: BOOKINGS */}
      {tab === 'bookings' && (
        <div className="card">
          <div className="filter-bar">
            <select value={bStatus} onChange={(e) => setBStatus(e.target.value)}>
              <option value="">All Statuses</option>
              <option value="PENDING">PENDING</option>
              <option value="APPROVED">APPROVED</option>
              <option value="REJECTED">REJECTED</option>
              <option value="CANCELLED">CANCELLED</option>
            </select>
          </div>
          {bookings.length === 0 ? (
            <div className="state-box">No bookings found.</div>
          ) : (
            <div className="list-stack">
              {bookings.map((b) => (
                <div key={b.id} className="audit-item">
                  <div className="row-between">
                    <strong>Booking #{b.id} • Resource #{b.resourceId} • User #{b.userId}</strong>
                    <span className="badge">{b.status}</span>
                  </div>
                  <div className="small">{new Date(b.startTime).toLocaleString()} → {new Date(b.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                  <div className="muted small">Purpose: {b.purpose}</div>
                  {b.status === 'PENDING' && new Date(b.startTime) > new Date() && (
                    <div className="filter-bar" style={{ marginTop: '0.5rem', marginBottom: 0 }}>
                      <button className="btn btn-primary" onClick={() => approveBooking(b.id)}>Approve</button>
                      <input
                        type="text"
                        placeholder="Rejection note (5-200 chars)"
                        value={rejectNotes[b.id] || ''}
                        onChange={(e) => setRejectNotes({ ...rejectNotes, [b.id]: e.target.value })}
                      />
                      <button className="btn btn-danger" onClick={() => rejectBooking(b.id)}>Reject</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: RESOURCES */}
      {tab === 'resources' && (
        <div className="split-layout">
          <div className="card">
            <h2>Add Resource</h2>
            <form onSubmit={createResource} className="stack-form">
              <label>
                <span>Name (3-60 chars)</span>
                <input required value={newRes.name} onChange={(e) => setNewRes({ ...newRes, name: e.target.value })} />
              </label>
              <label>
                <span>Type</span>
                <select value={newRes.type} onChange={(e) => setNewRes({ ...newRes, type: e.target.value })}>
                  <option value="ROOM">ROOM</option>
                  <option value="LAB">LAB</option>
                  <option value="EQUIPMENT">EQUIPMENT</option>
                </select>
              </label>
              <label>
                <span>Capacity (1-500)</span>
                <input type="number" min="1" max="500" required value={newRes.capacity} onChange={(e) => setNewRes({ ...newRes, capacity: e.target.value })} />
              </label>
              <label>
                <span>Description</span>
                <input value={newRes.description} onChange={(e) => setNewRes({ ...newRes, description: e.target.value })} />
              </label>
              <button type="submit" className="btn btn-primary">Create Resource</button>
            </form>
          </div>

          <div className="card">
            <h2>All Resources ({resources.length})</h2>
            <div className="list-stack">
              {resources.map((r) => (
                <div key={r.id} className="audit-item row-between">
                  <div>
                    <strong>{r.name}</strong> <span className="badge">{r.type}</span>
                    <div className="muted small">Cap: {r.capacity} • {r.isActive ? 'Active' : 'Inactive'}</div>
                  </div>
                  <button className="btn btn-secondary" onClick={() => toggleResourceActive(r)}>
                    {r.isActive ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: ANALYTICS */}
      {tab === 'analytics' && (
        !adminStats ? (
          <div className="card state-box">Loading analytics...</div>
        ) : (
          <div>
            <div className="stats-strip">
              <div className="stat-card"><span className="stat-label">Active Resources</span><strong className="stat-value">{adminStats.activeResources}</strong></div>
              <div className="stat-card"><span className="stat-label">Pending Bookings</span><strong className="stat-value">{adminStats.bookingsByStatus.PENDING}</strong></div>
              <div className="stat-card"><span className="stat-label">Approved Bookings</span><strong className="stat-value">{adminStats.bookingsByStatus.APPROVED}</strong></div>
              <div className="stat-card"><span className="stat-label">Rejected Bookings</span><strong className="stat-value">{adminStats.bookingsByStatus.REJECTED}</strong></div>
              <div className="stat-card"><span className="stat-label">Cancelled Bookings</span><strong className="stat-value">{adminStats.bookingsByStatus.CANCELLED}</strong></div>
              <div className="stat-card"><span className="stat-label">Model Agreement</span><strong className="stat-value">{adminStats.ticketStats.modelAgreementRate}%</strong></div>
            </div>

            <div className="card">
              <h2>Top 3 Most Booked Resources</h2>
              <ul className="audit-list">
                {adminStats.topResources.map((r) => (
                  <li key={r.id} className="audit-item row-between">
                    <span><strong>{r.name}</strong> ({r.type})</span>
                    <span className="badge">{r.bookingCount} bookings</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )
      )}
    </div>
  );
}