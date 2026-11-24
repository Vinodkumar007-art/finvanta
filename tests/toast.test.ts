import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import toast, { getToastSnapshot } from "@/lib/toast";

describe("toast service", () => {
  beforeEach(() => vi.useFakeTimers());

  afterEach(() => {
    for (const item of getToastSnapshot()) toast.dismiss(item.id);
    vi.advanceTimersByTime(200);
    for (const item of getToastSnapshot()) toast.dismiss(item.id);
    vi.advanceTimersByTime(200);
    vi.useRealTimers();
  });

  it("limits visible toasts and promotes queued items after dismissal", () => {
    const ids = Array.from({ length: 6 }, (_, index) => toast.info(`Notice ${index + 1}`));
    expect(getToastSnapshot().filter((item) => item.phase !== "queued")).toHaveLength(5);
    expect(getToastSnapshot().find((item) => item.id === ids[5])?.phase).toBe("queued");

    toast.dismiss(ids[0]);
    vi.advanceTimersByTime(180);

    expect(getToastSnapshot().find((item) => item.id === ids[5])?.phase).toBe("visible");
  });

  it("pauses auto-dismiss while hovered or focused and keeps action toasts available", () => {
    const id = toast.info("Saved");
    const actionableId = toast.error("Needs attention", { action: { label: "Review", onClick: () => {} } });

    expect(getToastSnapshot().find((item) => item.id === actionableId)?.durationMs).toBeNull();
    toast.pause(id);
    vi.advanceTimersByTime(6000);
    expect(getToastSnapshot().find((item) => item.id === id)?.phase).toBe("visible");

    toast.resume(id);
    vi.advanceTimersByTime(5000);
    expect(getToastSnapshot().find((item) => item.id === id)?.phase).toBe("exiting");
  });

  it("updates a promise toast in place when the operation resolves", async () => {
    const id = toast.promise(Promise.resolve("report.csv"), {
      loading: "Preparing report",
      success: (file) => `${file} is ready`,
      error: "Report failed",
    });

    await Promise.resolve();

    expect(getToastSnapshot().find((item) => item.id === id)).toMatchObject({
      type: "success",
      message: "report.csv is ready",
      durationMs: 5000,
    });
  });
});
