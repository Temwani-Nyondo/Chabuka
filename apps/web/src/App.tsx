import { Navigate, Route, Routes } from 'react-router-dom';
import ProtectedRoute from './auth/ProtectedRoute';
import AppShell from './components/AppShell';
import LoginPage from './pages/LoginPage';
import RoadmapPage from './pages/RoadmapPage';
import NotificationsPage from './pages/NotificationsPage';
import { CommunityPage, PrivacyPage, TermsPage } from './pages/PolicyPages';
import OnboardingPage from './pages/OnboardingPage';
import CirclesPage from './pages/CirclesPage';
import CompetitionsPage from './pages/CompetitionsPage';
import GafferPage from './pages/GafferPage';
import HomePage from './pages/HomePage';
import ExplorePage from './pages/ExplorePage';
import TeamsPage from './pages/TeamsPage';
import ProfilePage from './pages/ProfilePage';
import VenueProfilePage from './pages/VenueProfilePage';
import VenueDashboardPage from './pages/VenueDashboardPage';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="/terms" element={<TermsPage />} />
      <Route path="/community" element={<CommunityPage />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route element={<AppShell />}>
          <Route index element={<HomePage />} />
          <Route path="explore" element={<ExplorePage />} />
          <Route path="teams" element={<TeamsPage />} />
          <Route path="gaffer" element={<GafferPage />} />
          <Route path="board" element={<CompetitionsPage />} />
          <Route path="circles" element={<CirclesPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="roadmap" element={<RoadmapPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="venues/dashboard" element={<VenueDashboardPage />} />
          <Route path="venues/:venueId" element={<VenueProfilePage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
