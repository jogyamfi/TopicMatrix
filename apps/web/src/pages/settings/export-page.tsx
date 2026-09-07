import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { subjectsListResponseSchema } from '@topicmatrix/shared';
import { authStore } from '../../lib/auth-store';
import { apiFetch } from '../../lib/api-client';
import { toast } from '../../lib/toast-store';
import { describeError } from '../admin/users-page';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Skeleton } from '../../components/ui/skeleton';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';

/** Triggers a browser download of an authenticated API response (`apiFetch` isn't used here —
 * these routes return raw JSON/CSV files, not a Zod-validated body shape). */
async function downloadFile(path: string, filenameFallback: string): Promise<void> {
  const token = authStore.getState().accessToken;
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? res.statusText);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filenameFallback;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Data export (FR-9.1-FR-9.3, delivery-plan.md P10). */
export default function ExportPage(): React.JSX.Element {
  const subjectsQuery = useQuery({
    queryKey: ['subjects'],
    queryFn: () => apiFetch('/subjects', subjectsListResponseSchema),
  });
  const [subjectId, setSubjectId] = useState<string>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const jsonMutation = useMutation({
    mutationFn: () => downloadFile('/export/json', 'topicmatrix-export.json'),
    onError: (err) => toast({ title: 'Export failed', description: describeError(err), variant: 'destructive' }),
  });

  const csvMutation = useMutation({
    mutationFn: () => {
      const params = new URLSearchParams();
      if (subjectId !== 'all') {
        params.set('subjectId', subjectId);
      }
      if (from) {
        params.set('from', from);
      }
      if (to) {
        params.set('to', to);
      }
      const query = params.toString();
      return downloadFile(`/export/sessions.csv${query ? `?${query}` : ''}`, 'topicmatrix-sessions.csv');
    },
    onError: (err) => toast({ title: 'Export failed', description: describeError(err), variant: 'destructive' }),
  });

  const handleCsvSubmit = (event: FormEvent) => {
    event.preventDefault();
    csvMutation.mutate();
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Export data</h1>
        <p className="text-sm text-muted-foreground">Download your data for backup or use elsewhere.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Complete export</CardTitle>
          <CardDescription>A lossless JSON snapshot of every subject, topic, session and schedule you own.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button type="button" onClick={() => jsonMutation.mutate()} disabled={jsonMutation.isPending}>
            <Download className="size-4" /> Download JSON export
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Session history (CSV)</CardTitle>
          <CardDescription>Filter by subject and date range, for use in a spreadsheet.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCsvSubmit} className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="export-subject">Subject</Label>
                {subjectsQuery.isPending ? (
                  <Skeleton className="h-10 w-full" />
                ) : (
                  <Select value={subjectId} onValueChange={setSubjectId}>
                    <SelectTrigger id="export-subject">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All subjects</SelectItem>
                      {subjectsQuery.data?.subjects.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="export-from">From</Label>
                <Input id="export-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="export-to">To</Label>
                <Input id="export-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
            </div>
            <Button type="submit" variant="outline" className="w-fit" disabled={csvMutation.isPending}>
              <Download className="size-4" /> Download CSV
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
