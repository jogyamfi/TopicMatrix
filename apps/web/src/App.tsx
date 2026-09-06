import { lazy, Suspense } from 'react';
import { Outlet, Route, RouterProvider, createBrowserRouter, createRoutesFromElements } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/query-client';
import { ThemeProvider } from './context/theme-context';
import { AuthProvider } from './context/auth-context';
import { Toaster } from './components/toaster';
import { TooltipProvider } from './components/ui/tooltip';
import { Skeleton } from './components/ui/skeleton';
import { AppShell } from './components/layout/app-shell';
import {
  AdminRoute,
  ProtectedRoute,
  PublicOnlyRoute,
  RequirePasswordChanged,
} from './components/layout/route-guards';

// Route-level code splitting (P6 task 1) — each page is its own chunk.
const LoginPage = lazy(() => import('./pages/login-page'));
const ChangePasswordPage = lazy(() => import('./pages/change-password-page'));
const DashboardPage = lazy(() => import('./pages/dashboard-page'));
const AdminUsersPage = lazy(() => import('./pages/admin/users-page'));
const SubjectsPage = lazy(() => import('./pages/subjects/subjects-page'));
const SubjectTreePage = lazy(() => import('./pages/subjects/subject-tree-page'));
const TopicDetailPage = lazy(() => import('./pages/topics/topic-detail-page'));
const TagsPage = lazy(() => import('./pages/tags/tags-page'));
const NotFoundPage = lazy(() => import('./pages/not-found-page'));

function PageFallback(): React.JSX.Element {
  return (
    <div className="p-6">
      <Skeleton className="h-8 w-48" />
    </div>
  );
}

// A single Suspense boundary for every lazily-loaded route. `useMatches`/route `handle` (used by
// Breadcrumbs) only work under a "data router" (createBrowserRouter), not plain <BrowserRouter>.
function RootLayout(): React.JSX.Element {
  return (
    <Suspense fallback={<PageFallback />}>
      <Outlet />
    </Suspense>
  );
}

const router = createBrowserRouter(
  createRoutesFromElements(
    <Route element={<RootLayout />}>
      <Route element={<PublicOnlyRoute />}>
        <Route path="/login" element={<LoginPage />} />
      </Route>
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route
            path="/change-password"
            element={<ChangePasswordPage />}
            handle={{ breadcrumb: 'Change password' }}
          />
          <Route element={<RequirePasswordChanged />}>
            <Route index element={<DashboardPage />} handle={{ breadcrumb: 'Dashboard' }} />
            <Route path="/subjects" element={<SubjectsPage />} handle={{ breadcrumb: 'Subjects' }} />
            <Route path="/subjects/:subjectId" element={<SubjectTreePage />} handle={{ breadcrumb: 'Topic tree' }} />
            <Route
              path="/subjects/:subjectId/topics/:topicId"
              element={<TopicDetailPage />}
              handle={{ breadcrumb: 'Topic' }}
            />
            <Route path="/tags" element={<TagsPage />} handle={{ breadcrumb: 'Tags' }} />
            <Route element={<AdminRoute />}>
              <Route path="/admin/users" element={<AdminUsersPage />} handle={{ breadcrumb: 'Users' }} />
            </Route>
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Route>,
  ),
);

export default function App(): React.JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <TooltipProvider>
            <RouterProvider router={router} />
            <Toaster />
          </TooltipProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
