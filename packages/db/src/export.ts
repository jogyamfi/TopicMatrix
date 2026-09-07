// Data export (FR-9.1-FR-9.3, delivery-plan.md P10). Every collection is read in fixed-size
// pages rather than one unbounded `findMany`, so a large account's export survives D1/Workers
// limits (\u00a714.4) even though the current SQLite/PostgreSQL providers could technically do it in
// one query \u2014 the pagination is a deliberate, provider-agnostic discipline, not a workaround for
// a problem only D1 has.
import { AppError } from '@topicmatrix/shared';
import type { Db } from './db.js';

const EXPORT_PAGE_SIZE = 500;
export const EXPORT_FORMAT_VERSION = 1;

async function* paginate<T>(
  fetchPage: (skip: number, take: number) => Promise<T[]>,
): AsyncGenerator<T[]> {
  let skip = 0;
  for (;;) {
    const page = await fetchPage(skip, EXPORT_PAGE_SIZE);
    if (page.length === 0) {
      return;
    }
    yield page;
    if (page.length < EXPORT_PAGE_SIZE) {
      return;
    }
    skip += EXPORT_PAGE_SIZE;
  }
}

async function writeJsonArrayField<T>(
  write: (chunk: string) => void,
  name: string,
  fetchPage: (skip: number, take: number) => Promise<T[]>,
): Promise<void> {
  write(`"${name}":[`);
  let first = true;
  for await (const page of paginate(fetchPage)) {
    for (const item of page) {
      write(`${first ? '' : ','}${JSON.stringify(item)}`);
      first = false;
    }
  }
  write(']');
}

/**
 * Builds the complete, versioned, lossless JSON export (FR-9.1, FR-9.3) as a `ReadableStream`,
 * writing each collection field-by-field in paginated chunks rather than materialising the
 * whole account in memory at once. Deliberately excludes `passwordHash` and `RefreshToken` rows
 * \u2014 those are authentication secrets, not study data, and re-importing them into a fresh
 * database would never be meaningful (a fresh account gets fresh credentials).
 */
export function buildUserExportStream(db: Db, userId: string, exportedAt: Date): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (chunk: string) => controller.enqueue(encoder.encode(chunk));
      try {
        const [user, settings] = await Promise.all([db.users.findById(userId), db.userSettings.find(userId)]);
        if (!user) {
          throw new AppError('NOT_FOUND', 'User not found');
        }

        write('{');
        write(`"version":${EXPORT_FORMAT_VERSION},`);
        write(`"exportedAt":${JSON.stringify(exportedAt.toISOString())},`);
        write(
          `"user":${JSON.stringify({
            id: user.id,
            email: user.email,
            displayName: user.displayName,
            createdAt: user.createdAt,
          })},`,
        );
        write(`"settings":${JSON.stringify(settings)},`);
        await writeJsonArrayField(write, 'subjects', (skip, take) =>
          db.subjects.list(userId, { includeArchived: true, skip, take }),
        );
        write(',');
        await writeJsonArrayField(write, 'topics', (skip, take) => db.topics.listAllForUser(userId, { skip, take }));
        write(',');
        await writeJsonArrayField(write, 'studySessions', (skip, take) =>
          db.studySessions.listAllForUser(userId, { skip, take }),
        );
        write(',');
        await writeJsonArrayField(write, 'reviewSchedules', (skip, take) =>
          db.reviewSchedules.listAllForUser(userId, { skip, take }),
        );
        write(',');
        await writeJsonArrayField(write, 'competencySnapshots', (skip, take) =>
          db.competencySnapshots.listAllForUser(userId, { skip, take }),
        );
        write(',');
        await writeJsonArrayField(write, 'tags', (skip, take) => db.tags.list(userId, { skip, take }));
        write(',');
        await writeJsonArrayField(write, 'topicTags', (skip, take) =>
          db.tags.listAllTopicTagsForUser(userId, { skip, take }),
        );
        write('}');
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
}

/**
 * A cell is CSV-injection-dangerous if a spreadsheet application would interpret it as a
 * formula when the file is opened (\u00a711.2 A03) \u2014 prefixed with `=`, `+`, `-` or `@`. Prefixing
 * with a single quote defuses it while keeping the visible value unchanged in every major
 * spreadsheet application.
 */
export function sanitiseCsvCell(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

function csvField(value: string | number | null): string {
  const raw = value === null ? '' : sanitiseCsvCell(String(value));
  return /[",\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

export interface SessionsCsvFilter {
  subjectId?: string;
  from?: Date;
  to?: Date;
}

const CSV_HEADER = [
  'studiedOn',
  'subjectName',
  'topicName',
  'sourceLabel',
  'questionsAttempted',
  'questionsCorrect',
  'accuracy',
  'confidence',
  'durationMinutes',
  'notes',
] as const;

/**
 * Filterable session export (FR-9.2) as CSV text. Reads topics/subjects once (small, bounded by
 * the account's own tree) then pages through sessions rather than loading the whole history at
 * once \u2014 the same internal-pagination discipline as the JSON export.
 */
export async function buildSessionsCsv(db: Db, userId: string, filter: SessionsCsvFilter): Promise<string> {
  const [subjects, topics] = await Promise.all([
    db.subjects.list(userId, { includeArchived: true }),
    db.topics.listAllForUser(userId),
  ]);
  const subjectNameById = new Map(subjects.map((s) => [s.id, s.name]));
  const topicById = new Map(topics.map((t) => [t.id, t]));

  const rows: string[] = [CSV_HEADER.join(',')];
  for await (const page of paginate((skip, take) => db.studySessions.listAllForUser(userId, { skip, take }))) {
    for (const session of page) {
      const topic = topicById.get(session.topicId);
      if (!topic) {
        continue;
      }
      if (filter.subjectId && topic.subjectId !== filter.subjectId) {
        continue;
      }
      if (filter.from && session.studiedOn < filter.from) {
        continue;
      }
      if (filter.to && session.studiedOn > filter.to) {
        continue;
      }
      rows.push(
        [
          csvField(session.studiedOn.toISOString().slice(0, 10)),
          csvField(subjectNameById.get(topic.subjectId) ?? ''),
          csvField(topic.name),
          csvField(session.sourceLabel),
          csvField(session.questionsAttempted),
          csvField(session.questionsCorrect),
          csvField(session.accuracy),
          csvField(session.confidence),
          csvField(session.durationMinutes),
          csvField(session.notes),
        ].join(','),
      );
    }
  }
  return rows.join('\r\n') + '\r\n';
}
