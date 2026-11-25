import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../api/client';

export default function ResourcesPage() {
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [minCapacity, setMinCapacity] = useState('');
  const [page, setPage] = useState(1);

  const [resources, setResources] = useState([]);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadResources = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const qs = new URLSearchParams({ page: String(page) });
      if (search.trim()) qs.set('search', search.trim());
      if (type) qs.set('type', type);
      if (minCapacity) qs.set('minCapacity', minCapacity);

      const res = await apiFetch(`/resources?${qs.toString()}`);
      setResources(res.data);
      setTotalPages(Math.max(1, res.totalPages || 1));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [search, type, minCapacity, page]);

  useEffect(() => {
    const t = setTimeout(loadResources, 250);
    return () => clearTimeout(t);
  }, [loadResources]);

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Bookable Resources</h1>
          <p className="muted small">Reserve rooms, labs, and diagnostic equipment in 30-minute slots.</p>
        </div>
      </div>

      <div className="filter-bar">
        <input
          type="search"
          placeholder="Search resources..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
        <select value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}>
          <option value="">All Types</option>
          <option value="ROOM">ROOM</option>
          <option value="LAB">LAB</option>
          <option value="EQUIPMENT">EQUIPMENT</option>
        </select>
        <input
          type="number"
          min="1"
          placeholder="Min capacity"
          value={minCapacity}
          onChange={(e) => { setMinCapacity(e.target.value); setPage(1); }}
          style={{ maxWidth: '140px' }}
        />
      </div>

      {loading ? (
        <div className="card state-box">Loading resources...</div>
      ) : error ? (
        <div className="card state-box error-text">{error}</div>
      ) : resources.length === 0 ? (
        <div className="card state-box">No matching resources found.</div>
      ) : (
        <>
          <div className="card-grid">
            {resources.map((r) => (
              <div key={r.id} className="card">
                <div className="row-between">
                  <span className="badge">{r.type}</span>
                  <span className="muted small">Capacity: {r.capacity}</span>
                </div>
                <h3 style={{ margin: '0.5rem 0 0.25rem' }}>{r.name}</h3>
                <p className="muted small">{r.description || 'No description provided.'}</p>
                {!r.isActive && <span className="badge priority-urgent">Inactive</span>}
                <div style={{ marginTop: '0.75rem' }}>
                  <Link to={`/resources/${r.id}`} className="btn btn-primary" style={{ display: 'inline-block', textDecoration: 'none' }}>
                    View Availability & Book
                  </Link>
                </div>
              </div>
            ))}
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
  );
}