import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Navbar from './components/Navbar';
import Login from './pages/Login';
import Register from './pages/Register';
import TicketsPage from './pages/TicketsPage';
import ResourcesPage from './pages/ResourcesPage';
import ResourceDetailPage from './pages/ResourceDetailPage';
import MyBookingsPage from './pages/MyBookingsPage';
import AdminPage from './pages/AdminPage';

function ProtectedRoute({ children, adminOnly = false }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="state-box">Checking session...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && user.role !== 'ADMIN') return <Navigate to="/tickets" replace />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Navbar />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/tickets" element={<ProtectedRoute><TicketsPage /></ProtectedRoute>} />
          <Route path="/resources" element={<ProtectedRoute><ResourcesPage /></ProtectedRoute>} />
          <Route path="/resources/:id" element={<ProtectedRoute><ResourceDetailPage /></ProtectedRoute>} />
          <Route path="/bookings" element={<ProtectedRoute><MyBookingsPage /></ProtectedRoute>} />
          <Route path="/admin" element={<ProtectedRoute adminOnly><AdminPage /></ProtectedRoute>} />
          <Route path="*" element={<Navigate to="/tickets" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}