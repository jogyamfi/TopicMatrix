import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Copy } from 'lucide-react';
import { adminResetPasswordResponseSchema, type AdminUserView } from '@topicmatrix/shared';
import { apiFetch } from '../../lib/api-client';
import { describeError } from '../../lib/api-error';
import { invalidations } from '../../lib/invalidations';
import { toast } from '../../lib/toast-store';
import { FormError } from '../../components/field-error';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';

/**
 * Admin password reset (R4): confirm, then show the new temporary password exactly once — the
 * server never stores or re-exposes it. The user must change it at next login, and every
 * existing session of theirs is ended.
 */
export function ResetPasswordDialog({
  user,
  onOpenChange,
}: {
  user: AdminUserView | null;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);

  const resetMutation = useMutation({
    mutationFn: (userId: string) =>
      apiFetch(`/admin/users/${userId}/reset-password`, adminResetPasswordResponseSchema, { method: 'POST' }),
    onSuccess: async (data) => {
      await invalidations.afterAdminUserUpdate();
      setTemporaryPassword(data.temporaryPassword);
    },
    onError: (err) => setError(describeError(err)),
  });

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setTemporaryPassword(null);
      setError(undefined);
    }
    onOpenChange(open);
  };

  const copyPassword = async () => {
    if (!temporaryPassword) return;
    await navigator.clipboard.writeText(temporaryPassword);
    toast({ title: 'Copied to clipboard' });
  };

  return (
    <Dialog open={user !== null} onOpenChange={handleOpenChange}>
      <DialogContent>
        {temporaryPassword ? (
          <>
            <DialogHeader>
              <DialogTitle>Password reset</DialogTitle>
              <DialogDescription>
                Share this temporary password with {user?.displayName} now — it will not be shown again. They
                must change it when they next sign in.
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2 rounded-md border bg-muted p-3 font-mono text-sm">
              <span className="flex-1 select-all" data-testid="temporary-password">
                {temporaryPassword}
              </span>
              <Button type="button" variant="ghost" size="icon" onClick={copyPassword} aria-label="Copy password">
                <Copy className="size-4" />
              </Button>
            </div>
            <DialogFooter>
              <Button onClick={() => handleOpenChange(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Reset password for {user?.displayName}?</DialogTitle>
              <DialogDescription>
                Their current password stops working and they are signed out everywhere. You&apos;ll get a
                temporary password to give them.
              </DialogDescription>
            </DialogHeader>
            <FormError message={error} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={resetMutation.isPending}
                onClick={() => user && resetMutation.mutate(user.id)}
              >
                {resetMutation.isPending ? 'Resetting…' : 'Reset password'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
