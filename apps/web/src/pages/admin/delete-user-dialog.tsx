import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { statusResponseSchema, type AdminUserView } from '@topicmatrix/shared';
import { apiFetch, ApiError } from '../../lib/api-client';
import { invalidations } from '../../lib/invalidations';
import { toast } from '../../lib/toast-store';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';

interface Props {
  user: AdminUserView | null;
  onOpenChange: (open: boolean) => void;
}

/** Delete-user dialog with typed-name confirmation (FR-1.8) — the destructive action stays
 * disabled until the user types the account's exact display name. */
export function DeleteUserDialog({ user, onOpenChange }: Props): React.JSX.Element {
  const [confirmText, setConfirmText] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setConfirmText('');
    setError(null);
  }, [user?.id]);

  const deleteMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/admin/users/${user?.id}`, statusResponseSchema, {
        method: 'DELETE',
        body: { confirm: true },
      }),
    onSuccess: async () => {
      await invalidations.afterAdminUserDelete();
      toast({ title: 'User deleted' });
      onOpenChange(false);
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Could not delete user');
    },
  });

  const matches = user !== null && confirmText === user.displayName;

  return (
    <Dialog open={user !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {user?.displayName}?</DialogTitle>
          <DialogDescription>
            This permanently deletes the account and everything associated with it. Type{' '}
            <span className="font-semibold">{user?.displayName}</span> to confirm.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5 py-2">
          <Label htmlFor="confirm-delete-name">Display name</Label>
          <Input
            id="confirm-delete-name"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            autoComplete="off"
          />
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!matches || deleteMutation.isPending}
            onClick={() => deleteMutation.mutate()}
          >
            {deleteMutation.isPending ? 'Deleting…' : 'Delete account'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
