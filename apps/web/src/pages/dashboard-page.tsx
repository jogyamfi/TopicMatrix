import { BookOpen } from 'lucide-react';
import { useAuth } from '../context/auth-context';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { EmptyState } from '../components/empty-state';

/** Placeholder home (P6 scope: shell only). P7 replaces this with real subject cards. */
export default function DashboardPage(): React.JSX.Element {
  const { user } = useAuth();

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Welcome back{user ? `, ${user.displayName}` : ''}</CardTitle>
          <CardDescription>Here&apos;s a look at your study progress.</CardDescription>
        </CardHeader>
        <CardContent>
          <EmptyState
            icon={<BookOpen className="size-8" />}
            title="No subjects yet"
            description="Subjects and topics arrive in the next phase of TopicMatrix."
          />
        </CardContent>
      </Card>
    </div>
  );
}
