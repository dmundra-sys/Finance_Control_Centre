import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth';
import Layout from './components/Layout';
import { Loading } from './components/ui';
import Login, { Forgot, Reset } from './pages/Login';
import Dashboard from './pages/Dashboard';
import PaymentsList from './pages/PaymentsList';
import PaymentForm from './pages/PaymentForm';
import PaymentDetail from './pages/PaymentDetail';
import Queue from './pages/Queue';
import Vendors from './pages/Vendors';
import Reports from './pages/Reports';
import AuditTrail from './pages/AuditTrail';
import Profile from './pages/Profile';
import Verify from './pages/Verify';
import Walkthrough from './pages/Walkthrough';
const Management = lazy(() => import('./pages/Management'));
const Admin = lazy(() => import('./pages/admin/Admin'));

function Guard({ perm, children }: { perm?: string; children: JSX.Element }) {
  const { can } = useAuth();
  if (perm && !can(perm)) return <div className="card mx-auto mt-10 max-w-md p-8 text-center"><h2 className="text-lg font-semibold text-navy-900">Access restricted</h2><p className="mt-2 text-sm text-slate-500">Your role does not have permission to open this page.</p></div>;
  return children;
}
function Private() {
  const { me, loading } = useAuth(); const loc = useLocation();
  if (loading) return <Loading text="Starting…" />;
  if (!me) return <Navigate to={`/login${loc.pathname !== '/' ? `?next=${encodeURIComponent(loc.pathname + loc.search)}` : ''}`} replace />;
  if (me.user.mustChangePassword && loc.pathname !== '/profile') return <Navigate to="/profile?force=1" replace />;
  return <Layout />;
}
export default function App() {
  const { loading } = useAuth();
  if (loading) return <Loading text="Starting…" />;
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/login" element={<Login />} /><Route path="/forgot" element={<Forgot />} /><Route path="/reset" element={<Reset />} /><Route path="/reset-password" element={<Reset />} />
        <Route element={<Private />}>
          <Route index element={<Dashboard />} />
          <Route path="management" element={<Guard perm="dashboard.management"><Management /></Guard>} />
          <Route path="queue" element={<Guard perm="payment.verify_c"><Queue /></Guard>} />
          <Route path="payments" element={<Guard perm="payment.view"><PaymentsList /></Guard>} />
          <Route path="payments/new" element={<Guard perm="payment.create"><PaymentForm /></Guard>} />
          <Route path="payments/:id/edit" element={<Guard perm="payment.create"><PaymentForm /></Guard>} />
          <Route path="payments/:id" element={<Guard perm="payment.view"><PaymentDetail /></Guard>} />
          <Route path="vendors" element={<Guard perm="vendor.view"><Vendors /></Guard>} />
          <Route path="reports" element={<Guard perm="report.view"><Reports /></Guard>} />
          <Route path="reports/:key" element={<Guard perm="report.view"><Reports /></Guard>} />
          <Route path="audit" element={<Guard perm="audit.view"><AuditTrail /></Guard>} />
          <Route path="admin/:section" element={<Guard perm="admin.access"><Admin /></Guard>} />
          <Route path="profile" element={<Profile />} />
          <Route path="verify/:paNo" element={<Verify />} />
          <Route path="walkthrough" element={<Walkthrough />} />
          <Route path="*" element={<div className="py-20 text-center text-slate-500">Page not found.</div>} />
        </Route>
      </Routes>
    </Suspense>
  );
}
