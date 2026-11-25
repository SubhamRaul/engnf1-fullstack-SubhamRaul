import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../api/client';

export default function MyBookingsPage() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [bookings, setBookings] = useState([]);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionMsg, setActionMsg] = useState('');

  const loadBookings = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const qs = new URLSearchParams({ page: String(page) });
      if (status) qs.set('status', status);
      const res = await apiFetch(`/bookings/mine?${qs.toString()}`);
      setBookings(res.data);
      setTotalPages(Math.max(1, res.totalPages || 1));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [status, page]);

  useEffect(() => { loadBookings(); }, [loadBookings]);

  async function handleCancel(bookingId) {
    if (!window.confirm('Are you sure you want to cancel this booking?')) return;
    setActionMsg('');
    setError('');
    try {
      await apiFetch(`/bookings/${bookingId}/cancel`, { method: 'PATCH' });
      setActionMsg(`Booking #${bookingId} cancelled.`);
      loadBookings();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>My Bookings</h1>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All Statuses</option>
          <option value="PENDING">PENDING</option>
          <option value="APPROVED">APPROVED</option>
          <option value="REJECTED">REJECTED</option>
          <option value="CANCELLED">CANCELLED</option>
        </select>
      </div>

      {actionMsg && <div className="alert alert-success">{actionMsg}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      <div className="card">
        {loading ? (
          <div className="state-box">Loading your bookings...</div>
        ) : bookings.length === 0 ? (
          <div className="state-box">You have no bookings matching this filter.</div>
        ) : (
          <>
            <div className="list-stack">
              {bookings.map((b) => {
                const canCancel = ['PENDING', 'APPROVED'].includes(b.status) && new Date(b.startTime) > new Date();
                return (
                  <div key={b.id} className="audit-item">
                    <div className="row-between">
                      <strong>Booking #{b.id} • Resource #{b.resourceId}</strong>
                      <span className="badge">{b.status}</span>
                    </div>
                    <div className="small" style={{ margin: '0.35rem 0' }}>
                      {new Date(b.startTime).toLocaleString()} → {new Date(b.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                    <div className="muted small">Purpose: {b.purpose}</div>
                    {b.ticketId && <div className="muted small">Linked Ticket: #{b.ticketId}</div>}
                    {b.decisionNote && <div className="error-text small">Rejection Note: {b.decisionNote}</div>}
                    {canCancel && (
                      <div style={{ marginTop: '0.5rem' }}>
                        <button type="button" className="btn btn-danger" onClick={() => handleCancel(b.id)}>
                          Cancel Booking
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="pagination-bar">
              <span className="muted small">Page {page} of {totalPages}</span>
              <div className="btn-group">
                <button className="btn btn-secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</button>
                <button className="btn btn-secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}