import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Copy } from 'lucide-react';
import { adminCreateUserRequestSchema, adminCreateUserResponseSchema } from '@topicmatrix/shared';
import { apiFetch } from '../../lib/api-client';
import { useFormErrors } from '../../lib/form-errors';
import { FieldError, FormError } from '../../components/field-error';
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
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Create-user dialog (FR-1.8) — after success it shows the generated temporary password
 * exactly once, since the server never stores or re-exposes it. */
export function CreateUserDialog({ open, onOpenChange }: Props): React.JSX.Element {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const form = useFormErrors();
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (body: { email: string; displayName: string }) =>
      apiFetch('/admin/users', adminCreateUserResponseSchema, { method: 'POST', body }),
    onSuccess: async (data) => {
      await invalidations.afterAdminUserCreate();
      setTemporaryPassword(data.temporaryPassword);
    },
    onError: (err) => form.setFromApi(err, 'Could not create user'),
  });

  const reset = () => {
    setEmail('');
    setDisplayName('');
    form.clear();
    setTemporaryPassword(null);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const body = { email, displayName };
    if (!form.validate(adminCreateUserRequestSchema, body)) return;
    createMutation.mutate(body);
  };

  const copyPassword = async () => {
    if (!temporaryPassword) return;
    await navigator.clipboard.writeText(temporaryPassword);
    toast({ title: 'Copied to clipboard' });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        {temporaryPassword ? (
          <>
            <DialogHeader>
              <DialogTitle>User created</DialogTitle>
              <DialogDescription>
                Share this temporary password with the user now — it will not be shown again.
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2 rounded-md border bg-muted p-3 font-mono text-sm">
              <span className="flex-1 select-all">{temporaryPassword}</span>
              <Button type="button" variant="ghost" size="icon" onClick={copyPassword} aria-label="Copy password">
                <Copy className="size-4" />
              </Button>
            </div>
            <DialogFooter>
              <Button onClick={() => handleOpenChange(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={handleSubmit} noValidate>
            <DialogHeader>
              <DialogTitle>New user</DialogTitle>
              <DialogDescription>
                A temporary password is generated automatically; the user must change it on first
                login.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="new-user-email">Email</Label>
                <Input
                  id="new-user-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  {...form.fieldProps('email', 'new-user-email')}
                />
                <FieldError inputId="new-user-email" message={form.errors.email} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="new-user-name">Display name</Label>
                <Input
                  id="new-user-name"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  {...form.fieldProps('displayName', 'new-user-name')}
                />
                <FieldError inputId="new-user-name" message={form.errors.displayName} />
              </div>
              <FormError message={form.formError} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Creating…' : 'Create user'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
