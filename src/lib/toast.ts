export type ToastType = "success" | "error" | "warning" | "info" | "loading";
export type ToastPhase = "visible" | "queued" | "exiting";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  description?: string;
  action?: ToastAction;
  duration?: number;
}

export interface ToastRecord {
  id: string;
  type: ToastType;
  message: string;
  description?: string;
  action?: ToastAction;
  durationMs: number | null;
  remainingMs: number | null;
  phase: ToastPhase;
}

export interface ToastUpdate {
  type?: ToastType;
  message?: string;
  description?: string | undefined;
  action?: ToastAction | undefined;
  duration?: number;
}

export interface PromiseToastMessages<T> {
  loading: string;
  success: string | ((value: T) => string);
  error: string | ((reason: unknown) => string);
}

const MAX_VISIBLE_TOASTS = 5;
const DEFAULT_DURATION_MS = 5000;
const EXIT_ANIMATION_MS = 180;
const EMPTY_TOASTS: readonly ToastRecord[] = Object.freeze([]);

let snapshot: readonly ToastRecord[] = EMPTY_TOASTS;
let sequence = 0;
const listeners = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const timerStartedAt = new Map<string, number>();
const pausedToastIds = new Set<string>();

function publish(next: readonly ToastRecord[]) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

function replaceToast(id: string, update: (toast: ToastRecord) => ToastRecord) {
  publish(snapshot.map((toast) => toast.id === id ? update(toast) : toast));
}

function stopTimer(id: string) {
  const timer = timers.get(id);
  if (timer !== undefined) clearTimeout(timer);
  timers.delete(id);
  timerStartedAt.delete(id);
}

function startTimer(id: string) {
  const toast = snapshot.find((candidate) => candidate.id === id);
  if (!toast || toast.phase !== "visible" || toast.durationMs === null || pausedToastIds.has(id) || timers.has(id)) return;
  const remaining = Math.max(0, toast.remainingMs ?? toast.durationMs);
  const startedAt = Date.now();
  timerStartedAt.set(id, startedAt);
  timers.set(id, setTimeout(() => {
    timers.delete(id);
    timerStartedAt.delete(id);
    dismissToast(id);
  }, remaining));
}

function durationFor(options: ToastOptions, type: ToastType): number | null {
  if (options.duration !== undefined) {
    return Number.isFinite(options.duration) && options.duration > 0 ? options.duration : null;
  }
  if (type === "loading" || options.action) return null;
  return DEFAULT_DURATION_MS;
}

function removeToast(id: string) {
  stopTimer(id);
  pausedToastIds.delete(id);
  let next = snapshot.filter((toast) => toast.id !== id);
  const activeCount = next.filter((toast) => toast.phase !== "queued").length;
  if (activeCount < MAX_VISIBLE_TOASTS) {
    const queuedIndex = next.findIndex((toast) => toast.phase === "queued");
    if (queuedIndex !== -1) {
      const promoted = next[queuedIndex];
      next = next.map((toast, index) => index === queuedIndex ? { ...toast, phase: "visible" } : toast);
      publish(next);
      startTimer(promoted.id);
      return;
    }
  }
  publish(next);
}

function dismissToast(id: string) {
  const toast = snapshot.find((candidate) => candidate.id === id);
  if (!toast || toast.phase === "exiting") return;
  stopTimer(id);
  pausedToastIds.delete(id);
  if (toast.phase === "queued") {
    removeToast(id);
    return;
  }
  replaceToast(id, (current) => ({ ...current, phase: "exiting" }));
  const delay = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? 0
    : EXIT_ANIMATION_MS;
  setTimeout(() => removeToast(id), delay);
}

function createToast(type: ToastType, message: string, options: ToastOptions = {}): string {
  const id = `toast-${Date.now()}-${++sequence}`;
  const durationMs = durationFor(options, type);
  const activeCount = snapshot.filter((toast) => toast.phase !== "queued").length;
  const toast: ToastRecord = {
    id,
    type,
    message,
    description: options.description,
    action: options.action,
    durationMs,
    remainingMs: durationMs,
    phase: activeCount < MAX_VISIBLE_TOASTS ? "visible" : "queued",
  };
  publish([...snapshot, toast]);
  startTimer(id);
  return id;
}

function updateToast(id: string, update: ToastUpdate): void {
  const current = snapshot.find((toast) => toast.id === id);
  if (!current || current.phase === "exiting") return;
  stopTimer(id);
  const durationMs = update.duration === undefined
    ? current.durationMs
    : Number.isFinite(update.duration) && update.duration > 0 ? update.duration : null;
  const next: ToastRecord = {
    ...current,
    type: update.type ?? current.type,
    message: update.message ?? current.message,
    description: "description" in update ? update.description : current.description,
    action: "action" in update ? update.action : current.action,
    durationMs,
    remainingMs: durationMs,
  };
  replaceToast(id, () => next);
  startTimer(id);
}

function pauseToast(id: string): void {
  pausedToastIds.add(id);
  const timer = timers.get(id);
  const startedAt = timerStartedAt.get(id);
  const toast = snapshot.find((candidate) => candidate.id === id);
  if (timer === undefined || startedAt === undefined || !toast) return;
  clearTimeout(timer);
  timers.delete(id);
  timerStartedAt.delete(id);
  const remainingMs = Math.max(0, (toast.remainingMs ?? 0) - (Date.now() - startedAt));
  replaceToast(id, (current) => ({ ...current, remainingMs }));
}

function resumeToast(id: string): void {
  pausedToastIds.delete(id);
  startTimer(id);
}

export function subscribeToToasts(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getToastSnapshot(): readonly ToastRecord[] {
  return snapshot;
}

export function getServerToastSnapshot(): readonly ToastRecord[] {
  return EMPTY_TOASTS;
}

export const toast = {
  success: (message: string, options?: ToastOptions) => createToast("success", message, options),
  error: (message: string, options?: ToastOptions) => createToast("error", message, options),
  warning: (message: string, options?: ToastOptions) => createToast("warning", message, options),
  info: (message: string, options?: ToastOptions) => createToast("info", message, options),
  loading: (message: string, options?: ToastOptions) => createToast("loading", message, options),
  pause: pauseToast,
  resume: resumeToast,
  dismiss: dismissToast,
  update: updateToast,
  promise<T>(promise: PromiseLike<T>, messages: PromiseToastMessages<T>, options: ToastOptions = {}): string {
    const id = createToast("loading", messages.loading, { ...options, duration: 0 });
    const settledDuration = options.duration ?? (options.action ? 0 : DEFAULT_DURATION_MS);
    void Promise.resolve(promise).then(
      (value) => updateToast(id, {
        type: "success",
        message: typeof messages.success === "function" ? messages.success(value) : messages.success,
        duration: settledDuration,
      }),
      (reason: unknown) => updateToast(id, {
        type: "error",
        message: typeof messages.error === "function" ? messages.error(reason) : messages.error,
        duration: settledDuration,
      }),
    );
    return id;
  },
};

export default toast;
