import { Fragment } from 'react';
import { Link, useMatches } from 'react-router-dom';

interface RouteHandle {
  breadcrumb?: string;
}

export function Breadcrumbs(): React.JSX.Element | null {
  const matches = useMatches();
  const crumbs = matches
    .map((match) => ({ path: match.pathname, breadcrumb: (match.handle as RouteHandle | undefined)?.breadcrumb }))
    .filter((crumb): crumb is { path: string; breadcrumb: string } => Boolean(crumb.breadcrumb));

  if (crumbs.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
      <ol className="flex items-center gap-1.5">
        {crumbs.map((crumb, index) => (
          <Fragment key={crumb.path}>
            {index > 0 ? <span aria-hidden="true">/</span> : null}
            <li>
              {index === crumbs.length - 1 ? (
                <span aria-current="page" className="font-medium text-foreground">
                  {crumb.breadcrumb}
                </span>
              ) : (
                <Link to={crumb.path} className="hover:underline">
                  {crumb.breadcrumb}
                </Link>
              )}
            </li>
          </Fragment>
        ))}
      </ol>
    </nav>
  );
}
