import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await register(name, email, password);
      navigate('/login');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-wrapper">
      <div className="card auth-card">
        <h1>Create Agent Account</h1>
        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSubmit} className="stack-form">
          <label>
            <span>Full Name (2-50 chars)</span>
            <input type="text" required value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            <span>Email</span>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label>
            <span>Password (8+ chars, letter + digit)</span>
            <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Creating account...' : 'Register'}
          </button>
        </form>

        <p className="muted small" style={{ marginTop: '1rem' }}>
          Already registered? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}