"use client";

import { useRef, useSyncExternalStore, type FocusEvent, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, CircleX, Info, LoaderCircle, X } from "lucide-react";
import {
  getServerToastSnapshot,
  getToastSnapshot,
  subscribeToToasts,
  toast,
  type ToastRecord,
  type ToastType,
} from "@/lib/toast";

const icons = {
  success: CheckCircle2,
  error: CircleX,
  warning: AlertTriangle,
  info: Info,
  loading: LoaderCircle,
} satisfies Record<ToastType, typeof Info>;

const styles = {
  success: "border-up/40 text-up",
  error: "border-down/40 text-down",
  warning: "border-warn/40 text-warn",
  info: "border-accent/40 text-accent",
  loading: "border-accent/40 text-accent",
} satisfies Record<ToastType, string>;

function ToastItem({ item }: { item: ToastRecord }) {
  const Icon = icons[item.type];
  const hoveredRef = useRef(false);
  const focusedRef = useRef(false);

  const handleBlur = (event: FocusEvent<HTMLLIElement>) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    focusedRef.current = false;
    if (!hoveredRef.current) toast.resume(item.id);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLLIElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      toast.dismiss(item.id);
    }
  };

  return (
    <li
      className={`toast-item rounded-xl border bg-panel p-3 shadow-xl ${styles[item.type]}`}
      data-phase={item.phase}
      onPointerEnter={() => {
        hoveredRef.current = true;
        toast.pause(item.id);
      }}
      onPointerLeave={() => {
        hoveredRef.current = false;
        if (!focusedRef.current) toast.resume(item.id);
      }}
      onFocus={() => {
        focusedRef.current = true;
        toast.pause(item.id);
      }}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
    >
      <div
        role={item.type === "error" ? "alert" : "status"}
        aria-live={item.type === "error" ? "assertive" : "polite"}
        aria-atomic="true"
        className="flex items-start gap-3"
      >
        <Icon className={`mt-0.5 size-5 shrink-0 ${item.type === "loading" ? "animate-spin" : ""}`} aria-hidden="true" />
        <div className="min-w-0 flex-1 text-fg">
          <p className="text-sm font-semibold">{item.message}</p>
          {item.description && <p className="mt-1 text-xs leading-relaxed text-muted">{item.description}</p>}
          {item.action && (
            <button
              type="button"
              className="btn btn-sm mt-2"
              onClick={() => {
                item.action?.onClick();
                toast.dismiss(item.id);
              }}
            >
              {item.action.label}
            </button>
          )}
        </div>
        <button
          type="button"
          className="rounded p-1 text-muted hover:bg-panel2 hover:text-fg"
          aria-label="Dismiss notification"
          onClick={() => toast.dismiss(item.id)}
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
    </li>
  );
}

export default function ToastViewport() {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const items = useSyncExternalStore(subscribeToToasts, getToastSnapshot, getServerToastSnapshot);

  if (!mounted) return null;
  return createPortal(
    <ol className="toast-stack" aria-label="Notifications" aria-relevant="additions text">
      {items.filter((item) => item.phase !== "queued").map((item) => <ToastItem key={item.id} item={item} />)}
    </ol>,
    document.body,
  );
}
