import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { apiFetch } from '../api/client';

// Build 48 half-hour time options: 00:00, 00:30, ..., 23:30
const HALF_HOUR_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const hh = String(Math.floor(i / 2)).padStart(2, '0');
  const mm = i % 2 === 0 ? '00' : '30';
  return `${hh}:${mm}`;
});

function tomorrowDateStr() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function ResourceDetailPage() {
  const { id } = useParams();
  const [resource, setResource] = useState(null);
  const [date, setDate] = useState(tomorrowDateStr());
  const [bookedSlots, setBookedSlots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Booking form state
  const [startTimeLocal, setStartTimeLocal] = useState('10:00');
  const [durationMins, setDurationMins] = useState(30);
  const [purpose, setPurpose] = useState('');
  const [ticketId, setTicketId] = useState('');
  const [formMsg, setFormMsg] = useState('');
  const [formErr, setFormErr] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadAvailability = useCallback(async () => {
    const dayStart = new Date(`${date}T00:00:00`);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const qs = new URLSearchParams({
      from: dayStart.toISOString(),
      to: dayEnd.toISOString(),
    });
    const avail = await apiFetch(`/resources/${id}/availability?${qs.toString()}`);
    setBookedSlots(avail.bookings);
  }, [id, date]);

  useEffect(() => {
    setLoading(true);
    setError('');
    Promise.all([apiFetch(`/resources/${id}`), loadAvailability()])
      .then(([resData]) => setResource(resData))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id, loadAvailability]);

  async function handleBook(e) {
    e.preventDefault();
    setFormMsg('');
    setFormErr('');
    setSubmitting(true);

    try {
      const startObj = new Date(`${date}T${startTimeLocal}:00`);
      const endObj = new Date(startObj.getTime() + Number(durationMins) * 60000);

      await apiFetch('/bookings', {
        method: 'POST',
        body: JSON.stringify({
          resourceId: Number(id),
          startTime: startObj.toISOString(),
          endTime: endObj.toISOString(),
          purpose,
          ticketId: ticketId.trim() ? Number(ticketId) : undefined,
        }),
      });

      setFormMsg('Booking created (PENDING approval)!');
      setPurpose('');
      setTicketId('');
      await loadAvailability();
    } catch (err) {
      setFormErr(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div className="page-container"><div className="card state-box">Loading resource...</div></div>;
  if (error) return <div className="page-container"><div className="card state-box error-text">{error}</div></div>;

  return (
    <div className="page-container">
      <p><Link to="/resources">← Back to Resources</Link></p>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="row-between">
          <h1 style={{ margin: 0 }}>{resource.name}</h1>
          <span className="badge">{resource.type} • Cap {resource.capacity}</span>
        </div>
        <p className="muted">{resource.description || 'No description.'}</p>
      </div>

      <div className="split-layout">
        {/* Left: Availability for chosen date */}
        <div className="card">
          <h2>Booked Slots (Your Local Time)</h2>
          <label className="stack-label" style={{ marginBottom: '1rem' }}>
            <span>Select Date</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>

          {bookedSlots.length === 0 ? (
            <div className="state-box">No active bookings on {date}. All slots are free!</div>
          ) : (
            <ul className="audit-list">
              {bookedSlots.map((slot, idx) => (
                <li key={idx} className="audit-item row-between">
                  <span>
                    {new Date(slot.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    {' – '}
                    {new Date(slot.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="badge">{slot.status}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Right: 30-min Slot Booking Form */}
        <div className="card">
          <h2>Request a Time Slot</h2>
          {formMsg && <div className="alert alert-success">{formMsg}</div>}
          {formErr && <div className="alert alert-error">{formErr}</div>}

          <form onSubmit={handleBook} className="stack-form">
            <label>
              <span>Start Time (Local)</span>
              <select value={startTimeLocal} onChange={(e) => setStartTimeLocal(e.target.value)}>
                {HALF_HOUR_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>

            <label>
              <span>Duration</span>
              <select value={durationMins} onChange={(e) => setDurationMins(Number(e.target.value))}>
                {[30, 60, 90, 120, 150, 180, 210, 240].map((m) => (
                  <option key={m} value={m}>{m} minutes</option>
                ))}
              </select>
            </label>

            <label>
              <span>Purpose (5-200 chars)</span>
              <input
                type="text"
                required
                minLength={5}
                maxLength={200}
                placeholder="e.g., Live screen-share troubleshooting for checkout bug"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
              />
            </label>

            <label>
              <span>Linked Ticket ID (optional)</span>
              <input
                type="number"
                min="1"
                placeholder="e.g., 1"
                value={ticketId}
                onChange={(e) => setTicketId(e.target.value)}
              />
            </label>

            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Booking...' : 'Submit Booking Request'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}