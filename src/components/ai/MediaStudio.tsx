"use client";

import { useEffect, useState } from "react";

type MediaModel = {
  id: string;
  label: string;
  durations: number[];
  resolutions: string[];
  aspectRatios: string[];
};
type VideoJob = {
  jobId: string;
  conversationId: string;
  status: "pending" | "in_progress" | "completed" | "failed" | "cancelled" | "expired" | "error";
  progress?: number;
  videoUrl?: string;
  cost?: number;
  error?: string;
};

function isMediaModel(value: unknown): value is MediaModel {
  if (typeof value !== "object" || value === null || !("id" in value) || !("label" in value)) return false;
  const model = value as Partial<MediaModel>;
  return typeof model.id === "string" && typeof model.label === "string"
    && Array.isArray(model.durations) && Array.isArray(model.resolutions) && Array.isArray(model.aspectRatios);
}

async function readJson(response: Response) {
  const value: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof value === "object" && value !== null && "error" in value && typeof value.error === "string"
      ? value.error
      : `Request failed (${response.status}).`;
    throw new Error(message);
  }
  return value;
}

export default function MediaStudio({
  conversationId,
  onConversationCreated,
}: {
  conversationId?: string;
  onConversationCreated: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"image" | "video">("image");
  const [models, setModels] = useState<MediaModel[]>([]);
  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState("");
  const [resolution, setResolution] = useState("");
  const [aspectRatio, setAspectRatio] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [imageResult, setImageResult] = useState<{ url: string; cost?: number } | null>(null);
  const [videoJob, setVideoJob] = useState<VideoJob | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("fv-ai-video-job");
      if (saved) {
        const job = JSON.parse(saved) as VideoJob;
        if (job.jobId && job.conversationId) setVideoJob(job);
      }
    } catch {
      localStorage.removeItem("fv-ai-video-job");
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (videoJob) localStorage.setItem("fv-ai-video-job", JSON.stringify(videoJob));
    else localStorage.removeItem("fv-ai-video-job");
  }, [hydrated, videoJob]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoadingModels(true);
    setError("");
    fetch(`/api/ai/media/models?type=${kind}`)
      .then(readJson)
      .then((result) => {
        if (!active) return;
        if (typeof result !== "object" || result === null || !("models" in result) || !Array.isArray(result.models)) {
          throw new Error("OpenRouter returned an invalid media model list.");
        }
        const options = result.models.filter(isMediaModel);
        setModels(options);
        setModel((current) => options.some((option) => option.id === current) ? current : options[0]?.id ?? "");
      })
      .catch((cause: Error) => { if (active) setError(cause.message); })
      .finally(() => { if (active) setLoadingModels(false); });
    return () => { active = false; };
  }, [kind, open]);

  const selectedModel = models.find((option) => option.id === model);
  useEffect(() => {
    setDuration(selectedModel?.durations[0]?.toString() ?? "");
    setResolution(selectedModel?.resolutions[0] ?? "");
    setAspectRatio(selectedModel?.aspectRatios[0] ?? "");
  }, [selectedModel?.id, selectedModel?.durations, selectedModel?.resolutions, selectedModel?.aspectRatios]);

  const jobId = videoJob?.jobId;
  const jobConversationId = videoJob?.conversationId;
  const jobStatus = videoJob?.status;
  useEffect(() => {
    if (!jobId || !jobConversationId || !jobStatus || ["completed", "failed", "cancelled", "expired", "error"].includes(jobStatus)) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const response = await fetch(`/api/ai/media/video?jobId=${encodeURIComponent(jobId)}&conversationId=${encodeURIComponent(jobConversationId)}`);
        const result = await readJson(response) as Omit<VideoJob, "jobId" | "conversationId">;
        if (!active) return;
        setVideoJob((current) => current?.jobId === jobId ? { ...current, ...result } : current);
        if (!["completed", "failed", "cancelled", "expired"].includes(result.status)) timer = setTimeout(poll, 15_000);
      } catch (cause) {
        if (!active) return;
        setVideoJob((current) => current?.jobId === jobId
          ? { ...current, status: "error", error: cause instanceof Error ? cause.message : "Could not check video status." }
          : current);
      }
    };
    timer = setTimeout(poll, 12_000);
    return () => { active = false; clearTimeout(timer); };
  }, [jobId, jobConversationId, jobStatus]);

  async function generate() {
    if (!selectedModel || !prompt.trim() || !confirmed || generating) return;
    setError("");
    setGenerating(true);
    setImageResult(null);
    try {
      const response = await fetch(`/api/ai/media/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(kind === "video" && conversationId ? { conversationId } : {}),
          model,
          prompt: prompt.trim(),
          ...(kind === "video" && duration ? { duration: Number(duration) } : {}),
          ...(kind === "video" && resolution ? { resolution } : {}),
          ...(kind === "video" && aspectRatio ? { aspectRatio } : {}),
          confirmCost: true,
        }),
      });
      const result = await readJson(response) as {
        imageUrl?: string;
        cost?: number;
        jobId?: string;
        conversationId?: string;
      };
      setConfirmed(false);
      if (kind === "image" && result.imageUrl) {
        setImageResult({ url: result.imageUrl, cost: result.cost });
      } else if (kind === "video" && result.jobId && result.conversationId) {
        onConversationCreated(result.conversationId);
        setVideoJob({ jobId: result.jobId, conversationId: result.conversationId, status: "pending" });
      } else {
        throw new Error("OpenRouter returned an incomplete generation response.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Generation failed.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="border-t border-line">
      <button type="button" className="w-full px-3 py-2 text-left text-xs font-semibold text-accent hover:bg-panel2" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {open ? "− Close media studio" : "＋ Create an image or video"}
      </button>
      {open && (
        <div className="space-y-2 border-t border-line bg-panel2/50 p-3">
          <div className="flex flex-wrap gap-2">
            <button type="button" className={`btn btn-sm ${kind === "image" ? "btn-primary" : ""}`} onClick={() => { setKind("image"); setConfirmed(false); }}>Image</button>
            <button type="button" className={`btn btn-sm ${kind === "video" ? "btn-primary" : ""}`} onClick={() => { setKind("video"); setConfirmed(false); }}>Video</button>
          </div>
          <p className="text-[10px] text-muted">
            Models come from OpenRouter’s current catalog; catalog listing does not guarantee your key can use a model. Prompts are sent to OpenRouter and generation may incur charges.
            {kind === "video" ? " Video generation is not eligible for Zero Data Retention; the provider temporarily retains output while the job is completed." : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            <select className="inp min-w-0 flex-1 !py-1 text-xs" aria-label={`${kind} generation model`} value={model} disabled={loadingModels || !models.length} onChange={(event) => setModel(event.target.value)}>
              {loadingModels && <option value="">Loading models…</option>}
              {!loadingModels && !models.length && <option value="">No models available</option>}
              {models.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
            {kind === "video" && selectedModel?.durations.length ? (
              <select className="inp !w-auto !py-1 text-xs" aria-label="Video duration" value={duration} onChange={(event) => setDuration(event.target.value)}>
                {selectedModel.durations.map((value) => <option key={value} value={value}>{value} sec</option>)}
              </select>
            ) : null}
            {kind === "video" && selectedModel?.resolutions.length ? (
              <select className="inp !w-auto !py-1 text-xs" aria-label="Video resolution" value={resolution} onChange={(event) => setResolution(event.target.value)}>
                {selectedModel.resolutions.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            ) : null}
            {kind === "video" && selectedModel?.aspectRatios.length ? (
              <select className="inp !w-auto !py-1 text-xs" aria-label="Video aspect ratio" value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value)}>
                {selectedModel.aspectRatios.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            ) : null}
          </div>
          <textarea className="inp min-h-16 w-full text-xs" maxLength={2000} placeholder={kind === "image" ? "Describe the image to create…" : "Describe the video scene and motion…"} value={prompt} onChange={(event) => setPrompt(event.target.value)} />
          <label className="flex items-start gap-2 text-[10px] text-muted">
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
            <span>I understand this sends my prompt to OpenRouter and may incur charges. I have read the data-retention notice above.</span>
          </label>
          <button type="button" className="btn btn-primary btn-sm" disabled={generating || loadingModels || !selectedModel || !prompt.trim() || !confirmed} onClick={() => void generate()}>
            {generating ? "Submitting…" : kind === "image" ? "Generate image" : "Generate video"}
          </button>
          {error && <p role="alert" className="rounded border border-down/40 bg-down/5 p-2 text-xs text-down">{error}</p>}
          {imageResult && (
            <div className="space-y-1 rounded border border-line bg-panel p-2">
              {/* Generated image URLs are short-lived provider URLs, not a configured image host. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageResult.url} alt="Generated by OpenRouter" className="max-h-72 max-w-full rounded object-contain" />
              <a className="text-xs text-accent underline" href={imageResult.url} target="_blank" rel="noreferrer">Open or download image</a>
              {imageResult.cost !== undefined && <p className="text-[10px] text-muted">Provider-reported cost: ${imageResult.cost.toFixed(4)}</p>}
            </div>
          )}
          {videoJob && (
            <div className="space-y-2 rounded border border-line bg-panel p-2 text-xs">
              <p>Video job: <span className="font-semibold">{videoJob.status}</span>{videoJob.progress !== undefined ? ` · ${videoJob.progress}%` : ""}</p>
              {videoJob.error && <p role="alert" className="text-down">{videoJob.error}</p>}
              {videoJob.videoUrl && <video className="max-h-72 max-w-full rounded" controls src={videoJob.videoUrl}>Your browser cannot play this video.</video>}
              {videoJob.cost !== undefined && <p className="text-[10px] text-muted">Provider-reported cost: ${videoJob.cost.toFixed(4)}</p>}
              {videoJob.status === "error" && <button type="button" className="btn btn-sm" onClick={() => setVideoJob((current) => current ? { ...current, status: "pending", error: undefined } : null)}>Retry status check</button>}
              {videoJob.status === "completed" && <button type="button" className="btn btn-sm" onClick={() => setVideoJob(null)}>Clear video result</button>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
