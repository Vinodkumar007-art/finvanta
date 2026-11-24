"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import ChatPanel from "./ChatPanel";

export default function AiWidget() {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  if (path.startsWith("/ai")) return null;
  return (
    <>
      {open && (
        <div role="dialog" aria-label="FINVANTA AI assistant" className="fixed bottom-20 right-4 z-40 flex h-[70vh] w-[min(420px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl glow">
          <div className="flex items-center justify-between border-b border-line px-3 py-2 text-xs font-semibold">FINVANTA AI
            <span className="flex gap-1"><Link href="/ai" className="btn btn-sm">Open full screen</Link><button className="btn btn-sm" aria-label="Close assistant" onClick={() => setOpen(false)}>✕</button></span>
          </div>
          <div className="min-h-0 flex-1"><ChatPanel compact /></div>
        </div>
      )}
      <button onClick={() => setOpen(!open)} aria-label="Toggle AI assistant" aria-expanded={open}
        className="fixed bottom-4 right-4 z-40 grid h-12 w-12 place-items-center rounded-full bg-accent text-sm font-bold text-accentfg shadow-xl glow transition-transform hover:scale-105">AI</button>
    </>
  );
}
