import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import ProtectedRoute from './auth/ProtectedRoute';
import { useAuth } from './auth/AuthContext';
import AppShell from './components/AppShell';
import LandingPage from './pages/LandingPage';
import InvitePage from './pages/InvitePage';
import LoginPage from './pages/LoginPage';
import NotificationsPage from './pages/NotificationsPage';
import CirclesPage from './pages/CirclesPage';
import HomePage from './pages/HomePage';
import ExplorePage from './pages/ExplorePage';
import TeamDetailPage from './pages/TeamDetailPage';
import TeamsPage from './pages/TeamsPage';
import ProfilePage from './pages/ProfilePage';
import GamePage from './pages/GamePage';
import CircleChannelPage from './pages/CircleChannelPage';

// Screens most people open rarely (venue tools, races, golf, scoreboard, studio, admin...) load when first opened,
// so the first visit downloads only the everyday app. They used to be one 1.4 MB file loaded before anything showed.
const WaitAppConnectPage = lazy(() => import('./pages/WaitAppConnectPage'));
const VenueWaitAppReturnPage = lazy(() => import('./pages/VenueWaitAppReturnPage'));
const GolfDayCreatePage = lazy(() => import('./pages/GolfDayCreatePage'));
const GolfDayPage = lazy(() => import('./pages/GolfDayPage'));
const ScoreboardViewPage = lazy(() => import('./pages/ScoreboardViewPage'));
const ScoreboardControlPage = lazy(() => import('./pages/ScoreboardControlPage'));
const AdminVenuesPage = lazy(() => import('./pages/AdminVenuesPage'));
const CompetitionsPage = lazy(() => import('./pages/CompetitionsPage'));
const GafferPage = lazy(() => import('./pages/GafferPage'));
const VenueProfilePage = lazy(() => import('./pages/VenueProfilePage'));
const VenueDashboardPage = lazy(() => import('./pages/VenueDashboardPage'));
const VenueManagePage = lazy(() => import('./pages/VenueManagePage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const LineupPage = lazy(() => import('./pages/LineupPage'));
const RulesPage = lazy(() => import('./pages/RulesPage'));
const CompetitionPage = lazy(() => import('./pages/CompetitionPage'));
const CompetitionCreatePage = lazy(() => import('./pages/CompetitionCreatePage'));
const RaceCreatePage = lazy(() => import('./pages/RaceCreatePage'));
const CreatorStudioPage = lazy(() => import('./pages/CreatorStudioPage'));
const PlayerPage = lazy(() => import('./pages/PlayerPage'));
const RacePage = lazy(() => import('./pages/RacePage'));
const RaceEnterPage = lazy(() => import('./pages/RaceEnterPage'));
const FinishLinePage = lazy(() => import('./pages/FinishLinePage'));
const CompetitionRegisterPage = lazy(() => import('./pages/CompetitionRegisterPage'));
const OnboardingPage = lazy(() => import('./pages/OnboardingPage'));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'));
const CommunityPage = lazy(() => import('./pages/PolicyPages').then((m) => ({ default: m.CommunityPage })));
const DataDeletionPage = lazy(() => import('./pages/PolicyPages').then((m) => ({ default: m.DataDeletionPage })));
const PrivacyPage = lazy(() => import('./pages/PolicyPages').then((m) => ({ default: m.PrivacyPage })));
const TermsPage = lazy(() => import('./pages/PolicyPages').then((m) => ({ default: m.TermsPage })));
const CreatorPage = lazy(() => import('./pages/CreatorPage'));
const CreatorPostPage = lazy(() => import('./pages/CreatorPage').then((m) => ({ default: m.CreatorPostPage })));

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
    <Suspense fallback={<div className="page"><p className="muted">Loading…</p></div>}>
    <Routes>
      <Route path="/" element={<LandingGate />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/i/:code" element={<InvitePage />} />
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
    </Suspense>
  );
}
