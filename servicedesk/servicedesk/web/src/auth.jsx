import { createContext, useContext, useEffect, useState } from 'react';
import { api, session } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!session.token) { setReady(true); return; }
    api('/auth/me').then((d) => setUser(d.user)).catch(() => session.set(null)).finally(() => setReady(true));
  }, []);

  const signIn = ({ token, user }) => { session.set(token); setUser(user); };
  const signOut = () => { session.set(null); setUser(null); };
  const isStaff = user && (user.role === 'agent' || user.role === 'admin');

  return <AuthContext.Provider value={{ user, ready, signIn, signOut, isStaff, isAdmin: user?.role === 'admin' }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
