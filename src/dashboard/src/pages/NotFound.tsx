import { Link } from "react-router-dom";
import { AsciiHeadline } from "../components/AsciiHeadline";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

export function NotFound() {
  useDocumentTitle("InkCache — 404");

  return (
    <div className="ascii-scanlines relative flex min-h-screen flex-col items-center justify-center gap-6 bg-void p-6 text-center">
      <div className="relative z-10 flex flex-col items-center gap-6">
        <AsciiHeadline lines={["404"]} size="clamp(5px, 1.6vw, 13px)" />
        <p className="text-xs text-dim">-- no route mapped to this path --</p>
        <Link
          to="/"
          className="border border-ghost px-4 py-2 text-[11px] tracking-widest text-accent uppercase hover:border-accent hover:text-bright"
        >
          [ back home ]
        </Link>
      </div>
    </div>
  );
}
