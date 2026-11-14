import { Navigate, Route, Routes } from 'react-router-dom';
import ProtectedRoute from './auth/ProtectedRoute';
import { useAuth } from './auth/AuthContext';
import AppShell from './components/AppShell';
import LandingPage from './pages/LandingPage';
import InvitePage from './pages/InvitePage';
import LoginPage from './pages/LoginPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import NotificationsPage from './pages/NotificationsPage';
import { CommunityPage, DataDeletionPage, PrivacyPage, TermsPage } from './pages/PolicyPages';
import OnboardingPage from './pages/OnboardingPage';
import WaitAppConnectPage from './pages/WaitAppConnectPage';
import ScoreboardViewPage from './pages/ScoreboardViewPage';
import ScoreboardControlPage from './pages/ScoreboardControlPage';
import AdminVenuesPage from './pages/AdminVenuesPage';
import CirclesPage from './pages/CirclesPage';
import CompetitionsPage from './pages/CompetitionsPage';
import GafferPage from './pages/GafferPage';
import HomePage from './pages/HomePage';
import ExplorePage from './pages/ExplorePage';
import TeamDetailPage from './pages/TeamDetailPage';
import TeamsPage from './pages/TeamsPage';
import ProfilePage from './pages/ProfilePage';
import VenueProfilePage from './pages/VenueProfilePage';
import VenueDashboardPage from './pages/VenueDashboardPage';

function LandingGate() {
  const { loading, user } = useAuth();
  if (loading)
    return (
      <div className="page">
        <p className="loading">Loading…</p>
      </div>
    );
  if (user) return <Navigate to="/home" replace />;
  return <LandingPage />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingGate />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/invite/:code" element={<InvitePage />} />
      <Route path="/invite" element={<InvitePage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="/terms" element={<TermsPage />} />
      <Route path="/community" element={<CommunityPage />} />
      <Route path="/data-deletion" element={<DataDeletionPage />} />
      <Route path="/s/:code" element={<ScoreboardViewPage />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route path="/connect/waitapp" element={<WaitAppConnectPage />} />
        <Route path="/scoreboard/:id/control" element={<ScoreboardControlPage />} />
        <Route element={<AppShell />}>
          <Route path="home" element={<HomePage />} />
          <Route path="explore" element={<ExplorePage />} />
          <Route path="teams" element={<TeamsPage />} />
        <Route path="teams/:id" element={<TeamDetailPage />} />
          <Route path="gaffer" element={<GafferPage />} />
          <Route path="board" element={<CompetitionsPage />} />
          <Route path="circles" element={<CirclesPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="venues/dashboard" element={<VenueDashboardPage />} />
          <Route path="admin/venues" element={<AdminVenuesPage />} />
          <Route path="venues/:venueId" element={<VenueProfilePage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
