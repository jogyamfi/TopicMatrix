import type { Hono } from 'hono';
import { AppError, dateOnlySchema } from '@topicmatrix/shared';
import { buildUserExportStream, buildSessionsCsv } from '@topicmatrix/db';
import type { AppEnv } from '../deps.js';
import { getAuthUser, requireAuth, requirePasswordChanged } from '../middleware/auth.js';

function parseOptionalDateQuery(raw: string | undefined, key: string): Date | undefined {
  if (!raw) {
    return undefined;
  }
  const result = dateOnlySchema.safeParse(raw);
  if (!result.success) {
    throw new AppError('BAD_REQUEST', `${key} must be an ISO date (YYYY-MM-DD)`);
  }
  return result.data;
}

/**
 * Data export (FR-9.1-FR-9.3, delivery-plan.md P10). Both routes stream their response body
 * rather than building the whole payload in memory first — `buildUserExportStream` yields
 * paginated chunks internally (\u00a714.4); the CSV endpoint's underlying data is also read in pages
 * (`buildSessionsCsv`), even though the response itself is joined into one string at the end
 * (a CSV file's realistic size is far below the JSON export's, so this is a smaller concern).
 */
export function registerExportRoutes(app: Hono<AppEnv>): void {
  app.use('/export/*', requireAuth, requirePasswordChanged);

  app.get('/export/json', (c) => {
    const deps = c.get('deps');
    const user = getAuthUser(c);
    const stream = buildUserExportStream(deps.db, user.id, deps.clock());
    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': 'attachment; filename="topicmatrix-export.json"',
      },
    });
  });

  app.get('/export/sessions.csv', async (c) => {
    const deps = c.get('deps');
    const user = getAuthUser(c);
    const subjectId = c.req.query('subjectId');
    if (subjectId) {
      const subject = await deps.db.subjects.findById(user.id, subjectId);
      if (!subject) {
        throw new AppError('NOT_FOUND', 'Subject not found');
      }
    }
    const from = parseOptionalDateQuery(c.req.query('from'), 'from');
    const to = parseOptionalDateQuery(c.req.query('to'), 'to');
    const csv = await buildSessionsCsv(deps.db, user.id, {
      ...(subjectId ? { subjectId } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    });
    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="topicmatrix-sessions.csv"',
      },
    });
  });
}
