import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { authResponseSchema, changePasswordRequestSchema } from '@topicmatrix/shared';
import { useAuth } from '../context/auth-context';
import { apiFetch } from '../lib/api-client';
import { authStore } from '../lib/auth-store';
import { useFormErrors } from '../lib/form-errors';
import { toast } from '../lib/toast-store';
import { FieldError, FormError } from '../components/field-error';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';

/**
 * Change password — both the forced first-login screen (FR-1.6: the route guards keep the user
 * here until it succeeds, and nothing links away) and the voluntary change from the user menu
 * (R4: cancellable). Either way the server ends every other session and starts a fresh one for
 * this browser, so the user stays signed in afterwards.
 */
export default function ChangePasswordPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { user } = useAuth();
  const forced = user?.mustChangePassword ?? false;
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const form = useFormErrors();

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const body = { currentPassword, newPassword };
    if (!form.validate(changePasswordRequestSchema, body)) return;
    setSubmitting(true);
    try {
      const session = await apiFetch('/auth/change-password', authResponseSchema, { method: 'POST', body });
      authStore.adoptSession(session);
      toast({
        title: 'Password changed',
        description: 'You have been signed out everywhere else.',
      });
      navigate('/', { replace: true });
    } catch (err) {
      form.setFromApi(err, 'Could not change your password');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-[80vh] items-center justify-center">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{forced ? 'Choose a new password' : 'Change password'}</CardTitle>
          <CardDescription>
            {forced
              ? 'You must set a new password before continuing.'
              : 'Changing it signs you out on every other device.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="currentPassword">Current password</Label>
              <Input
                id="currentPassword"
                type="password"
                autoComplete="current-password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                {...form.fieldProps('currentPassword', 'currentPassword')}
              />
              <FieldError inputId="currentPassword" message={form.errors.currentPassword} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="newPassword">New password</Label>
              <Input
                id="newPassword"
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                aria-describedby={form.errors.newPassword ? 'newPassword-error newPassword-hint' : 'newPassword-hint'}
                {...(form.errors.newPassword ? { 'aria-invalid': true } : {})}
              />
              <p id="newPassword-hint" className="text-xs text-muted-foreground">
                At least 12 characters, not a common password.
              </p>
              <FieldError inputId="newPassword" message={form.errors.newPassword} />
            </div>
            <FormError message={form.formError} />
            <div className="flex gap-2">
              {forced ? null : (
                <Button type="button" variant="outline" className="flex-1" onClick={() => navigate(-1)}>
                  Cancel
                </Button>
              )}
              <Button type="submit" className="flex-1" disabled={submitting}>
                {submitting ? 'Saving…' : 'Change password'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
