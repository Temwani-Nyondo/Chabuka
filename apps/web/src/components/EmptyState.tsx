interface Props {
  title: string;
  hint?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export default function EmptyState({ title, hint, actionLabel, onAction }: Props) {
  return (
    <div className="card empty empty-brand">
      <img className="brand-mark" src="/brand/logo-mark.png" alt="" width={40} height={40} />
      <strong>{title}</strong>
      {hint ? <p className="muted">{hint}</p> : null}
      {actionLabel && onAction ? (
        <button className="btn btn-primary" type="button" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
