import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../api/client';
import { useAuth } from '../context/AuthContext';

const CATEGORIES = ['BILLING', 'BUG', 'FEATURE_REQUEST', 'LOGIN', 'DELIVERY'];
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
const STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];

export default function TicketsPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);

  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [page, setPage] = useState(1);

  const [tickets, setTickets] = useState([]);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [rollbackMsg, setRollbackMsg] = useState('');
  const [importMsg, setImportMsg] = useState('');
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQ(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const loadStats = useCallback(async () => {
    try {
      setStats(await apiFetch('/stats'));
    } catch {
      // ignore non-critical stats error
    }
  }, []);

  const loadTickets = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const qs = new URLSearchParams({ page: String(page), limit: '10' });
      if (statusFilter) qs.set('status', statusFilter);
      if (categoryFilter) qs.set('category', categoryFilter);
      if (priorityFilter) qs.set('priority', priorityFilter);
      if (debouncedQ) qs.set('q', debouncedQ);

      const res = await apiFetch(`/tickets?${qs.toString()}`);
      setTickets(res.data);
      setTotalPages(Math.max(1, res.totalPages || 1));
      setTotalCount(res.total || 0);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, categoryFilter, priorityFilter, debouncedQ, page]);

  useEffect(() => { loadStats(); }, [loadStats]);
  useEffect(() => { loadTickets(); }, [loadTickets]);

  async function selectTicket(id) {
    setSelectedId(id);
    setRollbackMsg('');
    setLoadingDetail(true);
    try {
      setDetail(await apiFetch(`/tickets/${id}`));
    } catch (err) {
      setRollbackMsg(err.message);
    } finally {
      setLoadingDetail(false);
    }
  }

  // Optimistic UI update + snapshot rollback on server/network error
  async function updateTicketField(ticketId, updates) {
    setRollbackMsg('');
    const prevTickets = tickets;
    const prevDetail = detail;

    const optimisticPatch = {
      ...updates,
      ...(updates.category && prevDetail?.ticket?.category !== updates.category
        ? { isHumanOverride: true, isReviewed: true }
        : {}),
      ...(updates.status && prevDetail?.ticket?.status === 'OPEN' && updates.status !== 'OPEN'
        ? { isReviewed: true }
        : {}),
    };

    // 1. Update screen instantly
    setTickets((list) => list.map((t) => (t.id === ticketId ? { ...t, ...optimisticPatch } : t)));
    if (detail?.ticket?.id === ticketId) {
      setDetail((cur) => ({ ...cur, ticket: { ...cur.ticket, ...optimisticPatch } }));
    }

    try {
      // 2. Call API with X-Agent header
      const res = await apiFetch(`/tickets/${ticketId}`, {
        method: 'PATCH',
        headers: { 'X-Agent': user?.email || 'agent@triagesync.test' },
        body: JSON.stringify(updates),
      });
      // 3. Sync real server data & audit events
      setTickets((list) => list.map((t) => (t.id === ticketId ? res.ticket : t)));
      if (selectedId === ticketId) setDetail(res);
      loadStats();
    } catch (err) {
      // 4. Roll back UI & show visible message
      setTickets(prevTickets);
      setDetail(prevDetail);
      setRollbackMsg(`Update failed and was rolled back: ${err.message}`);
    }
  }

  async function handleReimport() {
    setImporting(true);
    setImportMsg('');
    setRollbackMsg('');
    const feed = [
      {
        externalId: 'EXT-001',
        subject: 'Need refund for duplicate invoice charge',
        body: 'I was charged twice on my monthly invoice. Please process a refund.',
      },
      {
        externalId: 'EXT-003',
        subject: 'My package has not arrived',
        body: 'Tracking shows delayed shipping for 6 days and delivery never happened.',
      },
      {
        externalId: `EXT-FEED-${new Date().toISOString().slice(0, 10)}`,
        subject: 'Invoice payment failing with 500 error',
        body: 'Customer gets a 500 error during billing invoice payment.',
      },
    ];
    try {
      const res = await apiFetch('/tickets/import', {
        method: 'POST',
        body: JSON.stringify({ tickets: feed }),
      });
      setImportMsg(
        `Feed imported: ${res.importedCount} new, ${res.updatedCount} updated, ${res.skippedOverrideCount} overrides preserved.`
      );
      await Promise.all([loadTickets(), loadStats()]);
      if (selectedId) selectTicket(selectedId);
    } catch (err) {
      setRollbackMsg(`Import failed: ${err.message}`);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Support Triage Queue</h1>
          <p className="muted small">Auto-triaged support tickets with human-override protection and audit trail.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={handleReimport} disabled={importing}>
          {importing ? 'Syncing...' : 'Re-Import Feed'}
        </button>
      </div>

      {stats && (
        <div className="stats-strip">
          <div className="stat-card"><span className="stat-label">Open</span><strong className="stat-value">{stats.byStatus.OPEN}</strong></div>
          <div className="stat-card"><span className="stat-label">In Progress</span><strong className="stat-value">{stats.byStatus.IN_PROGRESS}</strong></div>
          <div className="stat-card"><span className="stat-label">Resolved</span><strong className="stat-value">{stats.byStatus.RESOLVED}</strong></div>
          <div className="stat-card"><span className="stat-label">Reviewed</span><strong className="stat-value">{stats.reviewedCount}</strong></div>
          <div className="stat-card"><span className="stat-label">Model Agreement</span><strong className="stat-value">{stats.modelAgreementRate}%</strong></div>
        </div>
      )}

      {importMsg && <div className="alert alert-success"><span>{importMsg}</span><button className="btn-link" onClick={() => setImportMsg('')}>Dismiss</button></div>}
      {rollbackMsg && <div className="alert alert-error" role="alert"><span>{rollbackMsg}</span><button className="btn-link" onClick={() => setRollbackMsg('')}>Dismiss</button></div>}

      <div className="filter-bar">
        <input
          type="search"
          placeholder="Search subject or body..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
          <option value="">All Statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={categoryFilter} onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }}>
          <option value="">All Categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={priorityFilter} onChange={(e) => { setPriorityFilter(e.target.value); setPage(1); }}>
          <option value="">All Priorities</option>
          {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      <div className="split-layout">
        <div className="card">
          {loading ? (
            <div className="state-box">Loading tickets...</div>
          ) : error ? (
            <div className="state-box error-text">{error}</div>
          ) : tickets.length === 0 ? (
            <div className="state-box">No tickets found.</div>
          ) : (
            <>
              <div className="list-stack">
                {tickets.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={`list-item-btn ${selectedId === t.id ? 'selected' : ''}`}
                    onClick={() => selectTicket(t.id)}
                  >
                    <div className="row-between">
                      <span className="mono muted">{t.externalId}</span>
                      <div className="badge-group">
                        <span className={`badge priority-${t.priority.toLowerCase()}`}>{t.priority}</span>
                        <span className="badge">{t.category}</span>
                        <span className="badge">{t.status}</span>
                        {t.isHumanOverride && <span className="badge badge-override">Override</span>}
                      </div>
                    </div>
                    <div className="item-title">{t.subject}</div>
                    <div className="item-snippet">{t.body}</div>
                  </button>
                ))}
              </div>
              <div className="pagination-bar">
                <span className="muted small">Page {page} of {totalPages} ({totalCount} total)</span>
                <div className="btn-group">
                  <button className="btn btn-secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</button>
                  <button className="btn btn-secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="card">
          {!selectedId ? (
            <div className="state-box">Click any ticket to inspect details and audit history.</div>
          ) : loadingDetail && !detail ? (
            <div className="state-box">Loading ticket details...</div>
          ) : detail ? (
            <div>
              <div className="row-between small muted">
                <span className="mono">{detail.ticket.externalId}</span>
                <span>Auto-classified: <strong>{detail.ticket.autoCategory}</strong></span>
              </div>
              <h2 className="detail-subject">{detail.ticket.subject}</h2>
              <p className="detail-body">{detail.ticket.body}</p>
              <div className="row-between small muted">
                <span>Override: <strong>{detail.ticket.isHumanOverride ? 'Yes' : 'No'}</strong></span>
                <span>Reviewed: <strong>{detail.ticket.isReviewed ? 'Yes' : 'No'}</strong></span>
              </div>

              <div className="controls-grid">
                <label>
                  <span>Category</span>
                  <select
                    value={detail.ticket.category}
                    onChange={(e) => updateTicketField(detail.ticket.id, { category: e.target.value })}
                  >
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <label>
                  <span>Priority</span>
                  <select
                    value={detail.ticket.priority}
                    onChange={(e) => updateTicketField(detail.ticket.id, { priority: e.target.value })}
                  >
                    {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </label>
                <label>
                  <span>Status</span>
                  <select
                    value={detail.ticket.status}
                    onChange={(e) => updateTicketField(detail.ticket.id, { status: e.target.value })}
                  >
                    {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
              </div>

              <div className="audit-section">
                <h3>Audit Trail ({detail.events.length})</h3>
                {detail.events.length === 0 ? (
                  <p className="muted small">No changes logged yet.</p>
                ) : (
                  <ul className="audit-list">
                    {detail.events.map((ev) => (
                      <li key={ev.id} className="audit-item">
                        <div><strong>{ev.field}</strong>: {ev.oldValue ?? 'none'} → <strong>{ev.newValue ?? 'none'}</strong></div>
                        <div className="muted small">by {ev.actor} • {new Date(ev.createdAt).toLocaleString()}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}