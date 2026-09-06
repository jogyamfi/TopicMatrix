import { BookOpen, LayoutDashboard, Tag, Users } from 'lucide-react';
import type { Role } from '@topicmatrix/shared';

export interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  adminOnly?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/subjects', label: 'Subjects', icon: BookOpen },
  { to: '/tags', label: 'Tags', icon: Tag },
  { to: '/admin/users', label: 'Users', icon: Users, adminOnly: true },
];

export function navItemsFor(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.adminOnly || role === 'ADMIN');
}
