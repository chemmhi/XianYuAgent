export function VerificationProgress({ title, description, loading = true }: { title: string; description: string; loading?: boolean }) {
  return <div className="verification-progress-copy" role="status" aria-busy={loading}>
    <span className="verification-progress-icon" aria-hidden="true">
      {loading ? <span className="verification-progress-spinner" /> : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6z" /><path d="m8 12 3 3 5-6" /></svg>}
    </span>
    <h3>{title}</h3><p>{description}</p>
  </div>;
}
