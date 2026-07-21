import { Link } from "react-router-dom";

export function NotFound() {
  return (
    <div className="neu-field flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
      <span className="text-3xl font-bold text-ink">404</span>
      <p className="text-sm text-ink-mid">-- route not found --</p>
      <Link to="/" className="text-xs font-bold tracking-widest text-accent uppercase">
        back home
      </Link>
    </div>
  );
}
