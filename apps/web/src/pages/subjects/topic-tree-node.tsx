import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  FolderPlus,
  GripVertical,
  ListChecks,
  MoveVertical,
  Pencil,
  Trash2,
} from 'lucide-react';
import { topicResponseSchema, type TopicTreeNodeView } from '@topicmatrix/shared';
import { apiFetch } from '../../lib/api-client';
import { invalidations } from '../../lib/invalidations';
import { toast } from '../../lib/toast-store';
import { describeError } from '../../lib/api-error';
import { cn } from '../../lib/utils';
import { HealthStatusBadge, type HealthStatus } from '../../components/health-status-badge';
import { Badge } from '../../components/ui/badge';
import { Input } from '../../components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';

/** Non-blocking depth warning (FR-3.2) — deeply nested trees are hard to navigate. */
const DEPTH_WARNING_THRESHOLD = 6;

interface IconButtonProps {
  label: string;
  /** The topic the action applies to — every row repeats the same buttons, so the accessible
   * name says which row ("Log session: Algebra"); the tooltip keeps the short label. */
  topicName: string;
  onClick: () => void;
  children: React.ReactNode;
}

function IconButton({ label, topicName, onClick, children }: IconButtonProps): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`${label}: ${topicName}`}
          onClick={onClick}
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export interface TopicRowActions {
  onAddChild: (parentId: string) => void;
  onDelete: (node: TopicTreeNodeView) => void;
  onMove: (node: TopicTreeNodeView) => void;
  onLogSession: (node: TopicTreeNodeView) => void;
  onDropTopic: (draggedId: string, newParentId: string) => void;
}

interface TopicTreeNodeRowProps extends TopicRowActions {
  node: TopicTreeNodeView;
  subjectId: string;
  siblings: readonly TopicTreeNodeView[];
  index: number;
  collapsed: ReadonlySet<string>;
  onToggleCollapsed: (id: string) => void;
  onReorder: (node: TopicTreeNodeView, siblings: readonly TopicTreeNodeView[], index: number, direction: 'up' | 'down') => void;
}

export function TopicTreeNodeRow(props: TopicTreeNodeRowProps): React.JSX.Element {
  const {
    node,
    subjectId,
    siblings,
    index,
    collapsed,
    onToggleCollapsed,
    onReorder,
    onAddChild,
    onDelete,
    onMove,
    onLogSession,
    onDropTopic,
  } = props;

  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(node.name);
  const [dragOver, setDragOver] = useState(false);

  const renameMutation = useMutation({
    mutationFn: (nextName: string) =>
      apiFetch(`/topics/${node.id}`, topicResponseSchema, { method: 'PATCH', body: { name: nextName } }),
    onSuccess: async () => {
      await invalidations.afterTopicWrite(subjectId);
      setRenaming(false);
    },
    onError: (err) => {
      toast({
        title: 'Could not rename topic',
        description: describeError(err),
        variant: 'destructive',
      });
      setName(node.name);
      setRenaming(false);
    },
  });

  const commitRename = () => {
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed === node.name) {
      setName(node.name);
      setRenaming(false);
      return;
    }
    renameMutation.mutate(trimmed);
  };

  const handleRenameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitRename();
    } else if (event.key === 'Escape') {
      setName(node.name);
      setRenaming(false);
    }
  };

  const hasChildren = node.children.length > 0;
  const isCollapsed = collapsed.has(node.id);

  return (
    <li>
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', node.id);
          e.dataTransfer.effectAllowed = 'move';
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
        }}
        onDragEnter={() => setDragOver(true)}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragOver(false);
          const draggedId = e.dataTransfer.getData('text/plain');
          if (draggedId && draggedId !== node.id) {
            onDropTopic(draggedId, node.id);
          }
        }}
        className={cn(
          'group flex items-center gap-1 rounded-md py-1 pr-1',
          dragOver && 'bg-accent ring-1 ring-ring',
        )}
        style={{ paddingLeft: node.depth * 20 }}
      >
        <GripVertical
          aria-hidden="true"
          className="size-4 shrink-0 cursor-grab text-muted-foreground opacity-0 group-hover:opacity-100"
        />
        {hasChildren ? (
          <button
            type="button"
            aria-label={isCollapsed ? `Expand ${node.name}` : `Collapse ${node.name}`}
            aria-expanded={!isCollapsed}
            onClick={() => onToggleCollapsed(node.id)}
            className="flex size-5 shrink-0 items-center justify-center text-muted-foreground"
          >
            {isCollapsed ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
          </button>
        ) : (
          <span className="size-5 shrink-0" />
        )}

        {renaming ? (
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={handleRenameKeyDown}
            className="h-7 max-w-xs"
          />
        ) : (
          <Link to={`/subjects/${subjectId}/topics/${node.id}`} className="min-w-0 flex-1 truncate text-sm hover:underline">
            {node.name}
          </Link>
        )}

        {node.depth >= DEPTH_WARNING_THRESHOLD ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <AlertTriangle aria-label="Deeply nested topic" className="size-4 shrink-0 text-amber-500" />
            </TooltipTrigger>
            <TooltipContent>Deeply nested topics can be hard to navigate</TooltipContent>
          </Tooltip>
        ) : null}
        {node.isSuspended ? <Badge variant="secondary">Suspended</Badge> : null}
        <span className="shrink-0">
          <HealthStatusBadge status={(node.metrics.aggregateHealthStatus ?? 'notStarted') as HealthStatus} />
        </span>

        <div className="ml-1 flex shrink-0 items-center gap-0.5">
          <IconButton topicName={node.name} label="Move up" onClick={() => onReorder(node, siblings, index, 'up')}>
            <MoveVertical className="size-4 rotate-180" aria-hidden="true" />
          </IconButton>
          <IconButton topicName={node.name} label="Move down" onClick={() => onReorder(node, siblings, index, 'down')}>
            <MoveVertical className="size-4" aria-hidden="true" />
          </IconButton>
          <IconButton topicName={node.name} label="Log session" onClick={() => onLogSession(node)}>
            <ListChecks className="size-4" aria-hidden="true" />
          </IconButton>
          <IconButton topicName={node.name} label="Add sub-topic" onClick={() => onAddChild(node.id)}>
            <FolderPlus className="size-4" aria-hidden="true" />
          </IconButton>
          <IconButton topicName={node.name} label="Rename" onClick={() => setRenaming(true)}>
            <Pencil className="size-4" aria-hidden="true" />
          </IconButton>
          <IconButton topicName={node.name} label="Move to…" onClick={() => onMove(node)}>
            <ChevronRight className="size-4" aria-hidden="true" />
          </IconButton>
          <IconButton topicName={node.name} label="Delete" onClick={() => onDelete(node)}>
            <Trash2 className="size-4" aria-hidden="true" />
          </IconButton>
        </div>
      </div>

      {hasChildren && !isCollapsed ? (
        <ul>
          {node.children.map((child, childIndex) => (
            <TopicTreeNodeRow
              key={child.id}
              node={child}
              subjectId={subjectId}
              siblings={node.children}
              index={childIndex}
              collapsed={collapsed}
              onToggleCollapsed={onToggleCollapsed}
              onReorder={onReorder}
              onAddChild={onAddChild}
              onDelete={onDelete}
              onMove={onMove}
              onLogSession={onLogSession}
              onDropTopic={onDropTopic}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
