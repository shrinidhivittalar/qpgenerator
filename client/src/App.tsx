import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthContext, createAuthState, useAuth } from './hooks/useAuth';
import type { Role } from './types';

import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';

const ROLE_LANDING: Record<Role, string> = {
  teacher:   '/dashboard',
  hod:       '/dashboard',
  principal: '/dashboard',
  student:   '/dashboard',
};

export function roleLandingPage(role: Role): string {
  return ROLE_LANDING[role];
}

function AuthProvider({ children }: { children: React.ReactNode }) {
  const auth = createAuthState();
  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}

function Spinner() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-spin h-8 w-8 rounded-full border-4 border-indigo-600 border-t-transparent" />
    </div>
  );
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (user) return <Navigate to={roleLandingPage(user.role)} replace />;
  return <>{children}</>;
}

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function DashboardPlaceholder() {
  const { user, logout } = useAuth();
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-semibold">Question Bank — Module 1</h1>
      <p className="text-gray-500">Logged in as {user?.name} ({user?.role})</p>
      <button
        onClick={logout}
        className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
      >
        Logout
      </button>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login"           element={<PublicRoute><LoginPage /></PublicRoute>} />
          <Route path="/register"        element={<PublicRoute><RegisterPage /></PublicRoute>} />
          <Route path="/forgot-password" element={<PublicRoute><ForgotPasswordPage /></PublicRoute>} />
          <Route path="/reset-password"  element={<ResetPasswordPage />} />
          <Route path="/dashboard"       element={<PrivateRoute><DashboardPlaceholder /></PrivateRoute>} />
          <Route path="*"                element={<Navigate to="/login" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
