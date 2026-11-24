import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(email, password);
      navigate('/tickets');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-wrapper">
      <div className="card auth-card">
        <h1>Sign in to TriageSync</h1>
        <p className="muted small">Demo: user@triagesync.test / User@123 or admin@triagesync.test / Admin@123</p>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSubmit} className="stack-form">
          <label>
            <span>Email</span>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label>
            <span>Password</span>
            <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <p className="muted small" style={{ marginTop: '1rem' }}>
          Need an account? <Link to="/register">Register</Link>
        </p>
      </div>
    </div>
  );
}