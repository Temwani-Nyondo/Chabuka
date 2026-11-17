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
import VenueWaitAppReturnPage from './pages/VenueWaitAppReturnPage';
import GolfDayCreatePage from './pages/GolfDayCreatePage';
import GolfDayPage from './pages/GolfDayPage';
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
import VenueManagePage from './pages/VenueManagePage';
import GamePage from './pages/GamePage';
import SettingsPage from './pages/SettingsPage';
import LineupPage from './pages/LineupPage';
import RulesPage from './pages/RulesPage';
import CompetitionPage from './pages/CompetitionPage';
import CompetitionCreatePage from './pages/CompetitionCreatePage';
import RaceCreatePage from './pages/RaceCreatePage';
import CircleChannelPage from './pages/CircleChannelPage';
import CreatorPage, { CreatorPostPage } from './pages/CreatorPage';
import CreatorStudioPage from './pages/CreatorStudioPage';
import PlayerPage from './pages/PlayerPage';
import RacePage from './pages/RacePage';
import RaceEnterPage from './pages/RaceEnterPage';
import FinishLinePage from './pages/FinishLinePage';
import CompetitionRegisterPage from './pages/CompetitionRegisterPage';

function LandingGate() {
  const { loading, user } = useAuth();
  if (loading)
    return (
      <div className="page">
        <p className="loading">Loading…</p>
      </div>
    );
  if (user) return <Navigate to="/today" replace />;
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
        <Route path="/venues/waitapp/return" element={<VenueWaitAppReturnPage />} />
        <Route path="/scoreboard/:id/control" element={<ScoreboardControlPage />} />
        <Route element={<AppShell />}>
          <Route path="today" element={<HomePage />} />
          <Route path="home" element={<Navigate to="/today" replace />} />
          <Route path="explore" element={<ExplorePage />} />
          <Route path="games/:id" element={<GamePage />} />
          <Route path="lineup/:type/:id" element={<LineupPage />} />
          <Route path="rules/:type/:id" element={<RulesPage />} />
          <Route path="teams" element={<TeamsPage />} />
          <Route path="teams/:id" element={<TeamDetailPage />} />
          <Route path="gaffer" element={<GafferPage />} />
          <Route path="board" element={<CompetitionsPage />} />
          <Route path="competitions" element={<CompetitionsPage />} />
          <Route path="competitions/new" element={<CompetitionCreatePage />} />
          <Route path="races/new" element={<RaceCreatePage />} />
          <Route path="circles/:id" element={<CircleChannelPage />} />
          <Route path="c/:handle" element={<CreatorPage />} />
          <Route path="c/:handle/:postId" element={<CreatorPostPage />} />
          <Route path="studio" element={<CreatorStudioPage />} />
          <Route path="players/:id" element={<PlayerPage />} />
          <Route path="races/:id" element={<RacePage />} />
          <Route path="golf/new" element={<GolfDayCreatePage />} />
          <Route path="golf/:id" element={<GolfDayPage />} />
          <Route path="races/:id/enter" element={<RaceEnterPage />} />
          <Route path="races/:id/line" element={<FinishLinePage />} />
          <Route path="competitions/:id" element={<CompetitionPage />} />
          <Route path="competitions/:id/register" element={<CompetitionRegisterPage />} />
          <Route path="circles" element={<CirclesPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="you" element={<ProfilePage />} />
          <Route path="you/settings" element={<SettingsPage />} />
          <Route path="profile" element={<Navigate to="/you" replace />} />
          <Route path="venues/dashboard" element={<VenueDashboardPage />} />
          <Route path="admin/venues" element={<AdminVenuesPage />} />
          <Route path="venues/:venueId" element={<VenueProfilePage />} />
          <Route path="venues/:venueId/manage" element={<VenueManagePage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
