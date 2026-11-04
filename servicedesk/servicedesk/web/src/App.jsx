import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Tickets from './pages/Tickets.jsx';
import TicketDetail from './pages/TicketDetail.jsx';
import NewTicket from './pages/NewTicket.jsx';
import Assets from './pages/Assets.jsx';
import Knowledge from './pages/Knowledge.jsx';
import Admin from './pages/Admin.jsx';
import Account from './pages/Account.jsx';

function Mark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg width="16" height="16" viewBox="0 0 16 16"><path d="M1 4h14v3a1.5 1.5 0 0 0 0 3v3H1v-3a1.5 1.5 0 0 0 0-3z" fill="white" /></svg>
    </span>
  );
}

function Shell({ children }) {
  const { user, isStaff, isAdmin, signOut } = useAuth();
  return (
    <div className="shell">
      <nav className="nav" aria-label="Main">
        <div className="brand"><Mark /> ServiceDesk</div>
        {isStaff && <NavLink to="/" end>Dashboard</NavLink>}
        <NavLink to="/tickets">{isStaff ? 'Tickets' : 'My tickets'}</NavLink>
        <NavLink to="/tickets/new">{isStaff ? 'New ticket' : 'Report an issue'}</NavLink>
        {isStaff && <NavLink to="/assets">Assets</NavLink>}
        <NavLink to="/kb">Knowledge base</NavLink>
        {isAdmin && <NavLink to="/admin">Administration</NavLink>}
        <div className="spacer" />
        <div className="me">
          <strong>{user.name}</strong>
          <span className="small">{user.email}</span>
          <div className="row" style={{ marginTop: 6 }}>
            <NavLink to="/account" style={{ padding: 0 }}>Account</NavLink>
            <button className="linkish small" onClick={signOut}>Sign out</button>
          </div>
        </div>
      </nav>
      <main className="main">{children}</main>
    </div>
  );
}

export default function App() {
  const { user, ready, isStaff, isAdmin } = useAuth();
  const loc = useLocation();
  if (!ready) return null;
  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to={`/login?next=${encodeURIComponent(loc.pathname)}`} replace />} />
      </Routes>
    );
  }
  return (
    <Shell>
      <Routes>
        <Route path="/" element={isStaff ? <Dashboard /> : <Navigate to="/tickets" replace />} />
        <Route path="/tickets" element={<Tickets />} />
        <Route path="/tickets/new" element={<NewTicket />} />
        <Route path="/tickets/:id" element={<TicketDetail />} />
        {isStaff && <Route path="/assets" element={<Assets />} />}
        <Route path="/kb" element={<Knowledge />} />
        <Route path="/kb/:id" element={<Knowledge />} />
        {isAdmin && <Route path="/admin" element={<Admin />} />}
        <Route path="/account" element={<Account />} />
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="*" element={<div className="empty">This page doesn't exist. <NavLink to="/tickets">Go to tickets</NavLink></div>} />
      </Routes>
    </Shell>
  );
}
