import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import {
  adminUpdateUserResponseSchema,
  adminUsersListResponseSchema,
  type AdminUserView,
  type Role,
} from '@topicmatrix/shared';
import { apiFetch } from '../../lib/api-client';
import { describeError } from '../../lib/api-error';
import { queryKeys } from '../../lib/query-client';
import { invalidations } from '../../lib/invalidations';
import { toast } from '../../lib/toast-store';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Skeleton } from '../../components/ui/skeleton';
import { EmptyState } from '../../components/empty-state';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';
import { CreateUserDialog } from './create-user-dialog';
import { DeleteUserDialog } from './delete-user-dialog';
import { ResetPasswordDialog } from './reset-password-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { useAuth } from '../../context/auth-context';

export default function AdminUsersPage(): React.JSX.Element {
  const { user: currentUser } = useAuth();
  const usersQuery = useQuery({
    queryKey: queryKeys.admin.users(),
    queryFn: () => apiFetch('/admin/users', adminUsersListResponseSchema),
  });
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AdminUserView | null>(null);
  const [resetTarget, setResetTarget] = useState<AdminUserView | null>(null);

  const roleMutation = useMutation({
    mutationFn: (vars: { user: AdminUserView; role: Role }) =>
      apiFetch(`/admin/users/${vars.user.id}`, adminUpdateUserResponseSchema, {
        method: 'PATCH',
        body: { role: vars.role },
      }),
    onSuccess: async (data) => {
      await invalidations.afterAdminUserUpdate();
      toast({ title: `${data.user.displayName} is now ${data.user.role === 'ADMIN' ? 'an admin' : 'a learner'}` });
    },
    onError: (err) => {
      toast({ title: 'Could not change role', description: describeError(err), variant: 'destructive' });
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: (user: AdminUserView) =>
      apiFetch(`/admin/users/${user.id}`, adminUpdateUserResponseSchema, {
        method: 'PATCH',
        body: { isActive: !user.isActive },
      }),
    onSuccess: async (data) => {
      await invalidations.afterAdminUserUpdate();
      toast({ title: data.user.isActive ? 'User enabled' : 'User disabled' });
    },
    onError: (err) => {
      toast({ title: 'Could not update user', description: describeError(err), variant: 'destructive' });
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle>Users</CardTitle>
            <CardDescription>Create, disable and remove learner and admin accounts.</CardDescription>
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus />
            New user
          </Button>
        </CardHeader>
        <CardContent>
          {usersQuery.isPending ? (
            <div className="space-y-2">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : usersQuery.isError ? (
            <p role="alert" className="text-sm text-destructive">
              Could not load users: {describeError(usersQuery.error)}
            </p>
          ) : usersQuery.data.users.length === 0 ? (
            <EmptyState title="No users yet" description="Create the first account to get started." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {usersQuery.data.users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">
                      {user.displayName}
                      {user.id === currentUser?.id ? (
                        <span className="ml-1.5 text-xs font-normal text-muted-foreground">(you)</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{user.email}</TableCell>
                    <TableCell>
                      {/* Your own role can't be changed (the server refuses too). */}
                      {user.id === currentUser?.id ? (
                        <Badge variant={user.role === 'ADMIN' ? 'default' : 'secondary'}>{user.role}</Badge>
                      ) : (
                        <Select
                          value={user.role}
                          onValueChange={(role) => roleMutation.mutate({ user, role: role as Role })}
                          disabled={roleMutation.isPending}
                        >
                          <SelectTrigger className="h-8 w-32" aria-label={`Role for ${user.displayName}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="LEARNER">Learner</SelectItem>
                            <SelectItem value="ADMIN">Admin</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={user.isActive ? 'secondary' : 'destructive'}>
                        {user.isActive ? 'Active' : 'Disabled'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {/* The server refuses these for your own account, so an admin can't lock
                          everyone out (the acting admin is always an active one). */}
                      {user.id === currentUser?.id ? null : (
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={toggleActiveMutation.isPending}
                            onClick={() => toggleActiveMutation.mutate(user)}
                          >
                            {user.isActive ? 'Disable' : 'Enable'}
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => setResetTarget(user)}>
                            Reset password
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => setDeleteTarget(user)}>
                            Delete
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <CreateUserDialog open={createOpen} onOpenChange={setCreateOpen} />
      <DeleteUserDialog user={deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)} />
      <ResetPasswordDialog user={resetTarget} onOpenChange={(open) => !open && setResetTarget(null)} />
    </div>
  );
}

