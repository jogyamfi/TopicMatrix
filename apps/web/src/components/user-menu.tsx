import { useState } from 'react';
import { KeyRound, LogOut, UserRound } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/auth-context';
import { Button } from './ui/button';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';

export function UserMenu(): React.JSX.Element | null {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  if (!user) return null;

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" className="gap-2">
          <UserRound className="size-4" />
          <span className="hidden sm:inline">{user.displayName}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-1">
        <div className="px-2 py-1.5 text-sm">
          <p className="font-medium">{user.displayName}</p>
          <p className="truncate text-muted-foreground">{user.email}</p>
        </div>
        <div className="my-1 h-px bg-border" />
        <Link
          to="/change-password"
          onClick={() => setOpen(false)}
          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
        >
          <KeyRound className="size-4" />
          Change password
        </Link>
        <button
          type="button"
          onClick={handleLogout}
          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
        >
          <LogOut className="size-4" />
          Log out
        </button>
      </PopoverContent>
    </Popover>
  );
}
