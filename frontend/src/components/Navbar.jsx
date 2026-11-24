import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/login');
  }

  if (!user) return null;

  return (
    <nav className="navbar">
      <div className="navbar-inner">
        <Link to="/tickets" className="brand">TriageSync</Link>
        <div className="nav-links">
          <Link to="/tickets">Triage Queue</Link>
          <Link to="/resources">Resources</Link>
          <Link to="/bookings">My Bookings</Link>
          {user.role === 'ADMIN' && <Link to="/admin">Admin</Link>}
        </div>
        <div className="nav-user">
          <span className="muted small">{user.name} ({user.role})</span>
          <button type="button" className="btn btn-secondary" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </div>
    </nav>
  );
}