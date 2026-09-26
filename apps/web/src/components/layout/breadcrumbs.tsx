import { Fragment, type ReactNode } from 'react';
import { Link, useMatches, type Params } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { subjectResponseSchema, topicResponseSchema } from '@topicmatrix/shared';
import { apiFetch } from '../../lib/api-client';
import { queryKeys } from '../../lib/query-client';

export interface Crumb {
  /** Omitted for the current page. */
  to?: string;
  label: ReactNode;
}

/**
 * A route's `handle`: either one fixed label, or a full trail built from the URL params — for
 * pages whose parents aren't nested routes (e.g. a topic page shows Subjects › <subject> ›
 * <topic> although it isn't routed under the subject page).
 */
export interface RouteHandle {
  breadcrumb?: string;
  crumbs?: (params: Params) => Crumb[];
}

function useName<T>(queryKey: readonly unknown[], fetch: () => Promise<T>, pick: (data: T) => string): string {
  const query = useQuery({ queryKey, queryFn: fetch });
  return query.data ? pick(query.data) : '…';
}

/** A subject's name, from the same cached query the subject pages use. */
export function SubjectName({ subjectId }: { subjectId: string }): React.JSX.Element {
  return (
    <>
      {useName(
        queryKeys.subjects.detail(subjectId),
        () => apiFetch(`/subjects/${subjectId}`, subjectResponseSchema),
        (data) => data.subject.name,
      )}
    </>
  );
}

/** A topic's name, from the topic page's own cached query. */
export function TopicName({ topicId }: { topicId: string }): React.JSX.Element {
  return (
    <>
      {useName(
        queryKeys.topics.detail(topicId),
        () => apiFetch(`/topics/${topicId}`, topicResponseSchema),
        (data) => data.topic.name,
      )}
    </>
  );
}

export function Breadcrumbs(): React.JSX.Element | null {
  const matches = useMatches();
  const crumbs: Crumb[] = [];
  for (const match of matches) {
    const handle = match.handle as RouteHandle | undefined;
    if (handle?.crumbs) {
      crumbs.push(...handle.crumbs(match.params));
    } else if (handle?.breadcrumb) {
      crumbs.push({ to: match.pathname, label: handle.breadcrumb });
    }
  }

  if (crumbs.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className="min-w-0 text-sm text-muted-foreground">
      <ol className="flex min-w-0 items-center gap-1.5">
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;
          return (
            <Fragment key={index}>
              {index > 0 ? <span aria-hidden="true">/</span> : null}
              <li className="min-w-0 truncate">
                {isLast || !crumb.to ? (
                  <span aria-current={isLast ? 'page' : undefined} className={isLast ? 'font-medium text-foreground' : undefined}>
                    {crumb.label}
                  </span>
                ) : (
                  <Link to={crumb.to} className="hover:underline">
                    {crumb.label}
                  </Link>
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
