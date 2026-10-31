interface Props {
  title: string;
  hint: string;
}

// Preview shells (brief section 8): read-only roadmap tiles. Every action a
// shell could take carries a "Coming soon" tag and does nothing else.
export default function ComingSoon({ title, hint }: Props) {
  return (
    <div className="card">
      <div className="row">
        <strong>{title}</strong>
        <span className="tag">Coming soon</span>
      </div>
      <p className="muted">{hint}</p>
    </div>
  );
}
