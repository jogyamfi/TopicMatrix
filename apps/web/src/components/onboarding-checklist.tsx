import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Circle } from 'lucide-react';
import { subjectsListResponseSchema } from '@topicmatrix/shared';
import { apiFetch } from '../lib/api-client';
import { queryKeys } from '../lib/query-client';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';

interface Step {
  title: string;
  description: string;
  done: boolean;
  action: { to: string; label: string };
}

/**
 * First-run guide on the dashboard (R3 U-10): create a subject, add topics, log a first session.
 * Each step ticks itself off from the subjects list (topic counts and last activity are already
 * in its summaries), and the card disappears once all three are done.
 */
export function OnboardingChecklist(): React.JSX.Element | null {
  const subjectsQuery = useQuery({
    queryKey: queryKeys.subjects.list(),
    queryFn: () => apiFetch('/subjects', subjectsListResponseSchema),
  });
  if (!subjectsQuery.data) return null;

  const subjects = subjectsQuery.data.subjects;
  const firstSubject = subjects[0];
  const withTopics = subjects.find((s) => s.summary.topicCount > 0);
  const steps: Step[] = [
    {
      title: 'Create a subject',
      description: 'A subject is something you are studying, such as “Mathematics”.',
      done: subjects.length > 0,
      action: { to: '/subjects?new=1', label: 'New subject' },
    },
    {
      title: 'Break it into topics',
      description: 'Add the topics (and sub-topics) you want to track.',
      done: withTopics !== undefined,
      action: { to: firstSubject ? `/subjects/${firstSubject.id}` : '/subjects', label: 'Add topics' },
    },
    {
      title: 'Log your first session',
      description: 'Record how a practice session went; TopicMatrix schedules your next review.',
      done: subjects.some((s) => s.summary.lastActivityOn !== null),
      action: { to: '/review', label: 'Pick a topic' },
    },
  ];
  if (steps.every((step) => step.done)) return null;
  const next = steps.find((step) => !step.done);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Get started</CardTitle>
        <CardDescription>Three steps to your first review schedule.</CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="flex flex-col gap-3">
          {steps.map((step) => (
            <li key={step.title} className="flex flex-wrap items-start gap-3">
              {step.done ? (
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-health-strong" aria-hidden="true" />
              ) : (
                <Circle className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              )}
              <div className="min-w-0 flex-1">
                <p className={step.done ? 'text-sm text-muted-foreground line-through' : 'text-sm font-medium'}>
                  {step.title}
                  <span className="sr-only">{step.done ? ' (done)' : ' (to do)'}</span>
                </p>
                {step.done ? null : <p className="text-xs text-muted-foreground">{step.description}</p>}
              </div>
              {step === next ? (
                <Button asChild size="sm">
                  <Link to={step.action.to}>{step.action.label}</Link>
                </Button>
              ) : null}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
