import { Button, EmptyState as UiEmptyState } from './ui';

interface Props {
  title: string;
  hint?: string;
  actionLabel?: string;
  onAction?: () => void;
}

// Older screens still call this; it now renders the design-system empty state.
export default function EmptyState({ title, hint, actionLabel, onAction }: Props) {
  return (
    <UiEmptyState
      title={title}
      body={hint}
      action={
        actionLabel && onAction ? (
          <Button variant="primary" size="sm" onClick={onAction}>
            {actionLabel}
          </Button>
        ) : undefined
      }
    />
  );
}
