"use client";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import Markdown from "./Markdown";
import MediaStudio from "./MediaStudio";
import { routeAgentForPrompt } from "@/services/ai/agent-routing";

type Tool = { name: string; source: string; args?: unknown; calc?: { name: string; formula: string; inputs: unknown; result: unknown; assumptions: string[]; source: string; timestamp: string } };
type Proposal = { id: string; status: string; resultRef?: string | null; payload: { date: string; narration: string; lines: { code: string; name: string; debit: string; credit: string }[] } };
type Msg = { role: "user" | "assistant"; content: string; tools?: Tool[]; proposals?: Proposal[]; error?: string; notice?: string; attachments?: string[] };
type Conv = { id: string; title: string; agent: string; folder: string | null; updatedAt: string };
type ProviderId = "cloudflare" | "gemini" | "openai";
type ModelOption = { id: string; label: string };
type Cfg = { configured: boolean; provider: ProviderId | null; models: ModelOption[]; providers: { provider: ProviderId; label: string; models: ModelOption[]; error?: string }[]; agents: { id: string; name: string; focus: string; starters: string[] }[] };
type ConversationPayload = {
  conversation: { agent: string };
  proposals?: Proposal[];
  messages: { role: "user" | "assistant"; content: string; meta?: { tools?: Tool[]; proposalIds?: string[]; attachments?: { name: string }[]; error?: string } }[];
};

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechWindow = Window & {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
};

const MIXED_STARTERS = [
  "Say 10 popular movies to watch",
  "Summarize my current cash position",
  "Explain a topic in simple terms",
  "Show my receivables ageing and collection risks",
  "Help me brainstorm an idea",
  "Analyse my financial ratios and explain what they mean",
];

export default function ChatPanel({ compact = false, initialId, initialAgent, mediaEnabled = false }: { compact?: boolean; initialId?: string; initialAgent?: string; mediaEnabled?: boolean }) {
  const path = usePathname();
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [agent, setAgent] = useState(initialAgent ?? "general"); const [model, setModel] = useState(""); const [modelSearch, setModelSearch] = useState("");
  const [agentSelection, setAgentSelection] = useState(initialAgent ?? "auto");
  const [provider, setProvider] = useState<ProviderId | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]); const [input, setInput] = useState("");
  const [convId, setConvId] = useState<string | undefined>(initialId);
  const [convs, setConvs] = useState<Conv[]>([]); const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false); const [attach, setAttach] = useState<{ name: string; text: string }[]>([]);
  const [err, setErr] = useState(""); const [copied, setCopied] = useState(-1);
  const [listening, setListening] = useState(false); const [speakReplies, setSpeakReplies] = useState(false);
  const [modelTesting, setModelTesting] = useState(false); const [modelTested, setModelTested] = useState(false);
  const endRef = useRef<HTMLDivElement>(null); const abortRef = useRef<AbortController | null>(null); const fileRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const loadConvs = useCallback(async (q = "") => { const r = await fetch(`/api/ai/conversations?q=${encodeURIComponent(q)}`); if (r.ok) setConvs(await r.json()); }, []);
  const applyConversation = useCallback((id: string, conversation: ConversationPayload) => {
    const proposals = conversation.proposals ?? [];
    setConvId(id);
    setAgent(conversation.conversation.agent);
    setMsgs(conversation.messages.map((message) => ({
      role: message.role,
      content: message.content,
      tools: message.meta?.tools,
      error: message.meta?.error,
      attachments: message.meta?.attachments?.map((attachment) => attachment.name),
      proposals: proposals.filter((proposal) => message.meta?.proposalIds?.includes(proposal.id)),
    })));
  }, []);
  const open = useCallback(async (id: string) => {
    const response = await fetch(`/api/ai/conversations/${id}`);
    if (!response.ok) { if (compact) localStorage.removeItem("fv-widget-conv"); return; }
    applyConversation(id, await response.json() as ConversationPayload);
  }, [applyConversation, compact]);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/ai/chat")
      .then(async (r) => {
        const c = await r.json();
        if (!r.ok) throw new Error(c.error ?? `Model configuration failed (${r.status}).`);
        return c as Cfg;
      })
      .then((c) => {
        if (cancelled) return;
        setCfg(c);
        setProvider(c.provider);
        setModel(c.models[0]?.id ?? "");
      })
      .catch((e: Error) => { if (!cancelled) setErr(e.message); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => { if (!compact) { const t = setTimeout(() => void loadConvs(search), 200); return () => clearTimeout(t); } }, [search, compact, loadConvs]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs]);
  useEffect(() => () => { recognitionRef.current?.stop(); }, []);
  useEffect(() => {
    const id = initialId ?? (compact ? localStorage.getItem("fv-widget-conv") : null);
    if (!id) return;
    let cancelled = false;
    fetch(`/api/ai/conversations/${id}`)
      .then(async (response) => {
        if (!response.ok) {
          if (compact) localStorage.removeItem("fv-widget-conv");
          return null;
        }
        return await response.json() as ConversationPayload;
      })
      .then((conversation) => { if (conversation && !cancelled) applyConversation(id, conversation); })
      .catch((error) => { if (!cancelled) setErr(error instanceof Error ? error.message : "Could not load conversation."); });
    return () => { cancelled = true; };
  }, [applyConversation, compact, initialId]);
  const newChat = () => { setConvId(undefined); setMsgs([]); setErr(""); if (compact) localStorage.removeItem("fv-widget-conv"); };

  function toggleListening() {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const speechWindow = window as SpeechWindow;
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setErr("Voice input is not supported in this browser. You can still type your message.");
      return;
    }
    setErr("");
    const recognition = new Recognition();
    recognition.lang = navigator.language || "en-US";
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results).map((result) => result[0]?.transcript ?? "").join(" ").trim();
      if (transcript) setInput((current) => current ? `${current} ${transcript}` : transcript);
    };
    recognition.onerror = (event) => {
      setErr(event.error === "not-allowed" || event.error === "service-not-allowed"
        ? "Microphone access was denied. Allow microphone access in your browser settings and try again."
        : `Voice input failed${event.error ? ` (${event.error})` : ""}. You can type your message instead.`);
      setListening(false);
    };
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch (error) {
      setErr(error instanceof Error ? `Could not start voice input: ${error.message}` : "Could not start voice input.");
      setListening(false);
    }
  }

  async function testModel() {
    if (!provider || !model || modelTesting) return;
    if (!window.confirm(`Send a short test prompt to ${model}? OpenRouter or the selected provider may charge for this request.`)) return;
    setErr("");
    setModelTesting(true);
    setModelTested(false);
    try {
      const response = await fetch("/api/ai/chat/test-model", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, model }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? `Model test failed (${response.status}).`);
      setModelTested(true);
    } catch (error) {
      setErr(error instanceof Error ? error.message : "Model test failed.");
    } finally {
      setModelTesting(false);
    }
  }

  async function send(text: string) {
    if (!text.trim() || busy) return;
    const routedAgent = agentSelection === "auto" ? routeAgentForPrompt(text) : agentSelection;
    setAgent(routedAgent);
    setErr(""); setBusy(true); setInput("");
    const atts = attach; setAttach([]);
    setMsgs((m) => [...m, { role: "user", content: text, attachments: atts.map((a) => a.name) }, { role: "assistant", content: "", tools: [], proposals: [] }]);
    const ac = new AbortController(); abortRef.current = ac;
    try {
      const res = await fetch("/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json" }, signal: ac.signal, body: JSON.stringify({ conversationId: convId, agent: routedAgent, ...(provider ? { provider } : {}), model, message: text, attachments: atts, path }) });
      if (!res.ok || !res.body) { const j = await res.json().catch(() => ({})); throw new Error(j.error ?? `Request failed (${res.status})`); }
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ""; let spokenReply = "";
      const patch = (f: (m: Msg) => Msg) => setMsgs((all) => { const c = [...all]; c[c.length - 1] = f(c[c.length - 1]); return c; });
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true }); let i: number;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line) continue;
          const ev = JSON.parse(line);
          if (ev.type === "meta") { setConvId(ev.conversationId); if (compact) localStorage.setItem("fv-widget-conv", ev.conversationId); }
          else if (ev.type === "model") setModel(ev.model);
          else if (ev.type === "text") { spokenReply += ev.delta; patch((m) => ({ ...m, content: m.content + ev.delta })); }
          else if (ev.type === "tool") patch((m) => ({ ...m, tools: [...(m.tools ?? []), { name: ev.name, source: ev.source, args: ev.args, calc: ev.calc }] }));
          else if (ev.type === "proposal") patch((m) => ({ ...m, proposals: [...(m.proposals ?? []), ev.proposal] }));
          else if (ev.type === "notice") patch((m) => ({ ...m, notice: m.notice ? `${m.notice} ${ev.text}` : ev.text }));
          else if (ev.type === "error") patch((m) => ({ ...m, error: ev.error }));
        }
      }
      if (speakReplies && spokenReply.trim() && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(new SpeechSynthesisUtterance(spokenReply));
      }
    } catch (e) { if ((e as Error).name !== "AbortError") { setErr((e as Error).message); setMsgs((m) => (m[m.length - 1]?.content === "" ? m.slice(0, -1) : m)); } }
    finally { setBusy(false); abortRef.current = null; if (!compact) void loadConvs(search); }
  }

  async function upload(f: File | undefined) {
    if (!f) return; setErr("");
    const fd = new FormData(); fd.append("file", f);
    const r = await fetch("/api/ai/attach", { method: "POST", body: fd }); const j = await r.json();
    if (!r.ok) setErr(j.error); else setAttach((a) => [...a, { name: j.name, text: j.text }].slice(0, 3));
    if (fileRef.current) fileRef.current.value = "";
  }
  async function decide(p: Proposal, action: "approve" | "reject") {
    const r = await fetch(`/api/ai/proposals/${p.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    const j = await r.json(); if (!r.ok) { setErr(j.error); return; }
    setMsgs((all) => all.map((m) => ({ ...m, proposals: m.proposals?.map((x) => (x.id === p.id ? { ...x, status: j.status, resultRef: j.voucher } : x)) })));
  }
  async function convAction(c: Conv, kind: "rename" | "folder" | "delete") {
    if (kind === "delete") { if (!confirm("Delete this conversation?")) return; await fetch(`/api/ai/conversations/${c.id}`, { method: "DELETE" }); if (c.id === convId) newChat(); }
    else { const v = prompt(kind === "rename" ? "New title" : "Folder name (empty to remove)", kind === "rename" ? c.title : c.folder ?? ""); if (v === null) return; await fetch(`/api/ai/conversations/${c.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(kind === "rename" ? { title: v } : { folder: v || null }) }); }
    void loadConvs(search);
  }

  const cur = cfg?.agents.find((a) => a.id === agent);
  const selectedProvider = cfg?.providers.find((option) => option.provider === provider);
  const modelOptions = selectedProvider?.models ?? cfg?.models ?? [];
  const filteredModelOptions = modelOptions.filter((option) => `${option.label} ${option.id}`.toLowerCase().includes(modelSearch.trim().toLowerCase()));
  const selectedModelOption = modelOptions.find((option) => option.id === model);
  const visibleModelOptions = selectedModelOption && !filteredModelOptions.some((option) => option.id === model)
    ? [selectedModelOption, ...filteredModelOptions]
    : filteredModelOptions;
  const providerName = selectedProvider?.label ?? (provider === "cloudflare" ? "Cloudflare" : provider === "gemini" ? "Gemini" : "OpenAI");
  const suggestions = agentSelection === "auto" ? MIXED_STARTERS : cur?.starters ?? [];
  const isOpenRouter = provider === "openai" && providerName === "OpenRouter";
  const folders = [...new Set(convs.map((c) => c.folder).filter(Boolean))] as string[];
  const lastAssistant = msgs.length && msgs[msgs.length - 1].role === "assistant" && !busy;

  return (
    <div className={`flex ${compact ? "h-full" : "h-[calc(100vh-9rem)]"} min-h-0 overflow-hidden ${compact ? "" : "rounded-xl border border-line bg-panel"}`}>
      {!compact && (
        <aside className="hidden w-64 shrink-0 flex-col border-r border-line md:flex">
          <div className="space-y-2 border-b border-line p-3">
            <button className="btn btn-primary w-full justify-center" onClick={newChat}>＋ New conversation</button>
            <input className="inp" placeholder="Search conversations…" aria-label="Search conversations" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="flex-1 overflow-y-auto p-2 text-xs">
            {convs.length === 0 && <p className="p-3 text-center text-muted">No conversations yet.</p>}
            {[...folders, null].map((f) => {
              const list = convs.filter((c) => (c.folder ?? null) === f); if (!list.length) return null;
              return (
                <div key={f ?? "none"} className="mb-3">
                  <div className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted">{f ? `📁 ${f}` : "Recent"}</div>
                  {list.map((c) => (
                    <div key={c.id} className={`group flex items-center justify-between rounded-lg px-2 py-1.5 ${c.id === convId ? "bg-accent/12" : "hover:bg-panel2"}`}>
                      <button className="min-w-0 flex-1 truncate text-left" onClick={() => void open(c.id)}>{c.title}</button>
                      <span className="hidden gap-1 group-hover:flex">
                        <button title="Rename" aria-label="Rename" onClick={() => void convAction(c, "rename")}>✎</button>
                        <button title="Move to folder" aria-label="Move to folder" onClick={() => void convAction(c, "folder")}>📁</button>
                        <button title="Delete" aria-label="Delete" onClick={() => void convAction(c, "delete")}>🗑</button>
                      </span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </aside>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <select aria-label="AI agent" className="inp !w-auto !py-1 text-xs" value={agentSelection} onChange={(e) => {
            setAgentSelection(e.target.value);
            if (e.target.value !== "auto") setAgent(e.target.value);
          }}>
            <option value="auto">Auto — route by prompt</option>
            {cfg?.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          {cfg && cfg.providers.length > 1 && <select aria-label="AI provider" className="inp !w-auto !py-1 text-xs" value={provider ?? ""} onChange={(e) => {
            const option = cfg.providers.find((item) => item.provider === e.target.value);
            setProvider(option?.provider ?? null);
            setModel(option?.models[0]?.id ?? "");
            setModelTested(false);
            setModelSearch("");
            setErr(option?.error ?? "");
          }}>{cfg.providers.map((option) => <option key={option.provider} value={option.provider} disabled={!option.models.length}>{option.label}{option.error ? " (configuration error)" : ""}</option>)}</select>}
          {provider && modelOptions.length > 20 && <input aria-label="Search models" className="inp !w-44 !py-1 text-xs" placeholder="Search GPT, Gemini, Claude…" value={modelSearch} onChange={(e) => setModelSearch(e.target.value)} />}
          {provider && modelOptions.length > 0 && <select aria-label="Model" className="inp max-w-[22rem] !w-auto !py-1 text-xs" value={model} onChange={(e) => { setModel(e.target.value); setModelTested(false); }}>{visibleModelOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select>}
          <span className="hidden text-[11px] text-muted sm:inline">{agentSelection === "auto" ? `Auto → ${cur?.name ?? "CFO AI"}` : cur?.focus}</span>
          <span className={`ml-auto rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${cfg?.configured ? "border-up/40 text-up" : "border-warn/40 text-warn"}`} title={cfg?.configured ? `${providerName} configuration detected; a live request has not been verified.` : "Configure a Gemini, OpenAI, or Cloudflare AI provider to enable the full assistant."}>{cfg ? (cfg.configured ? `${providerName} configured` : "Engine mode") : "…"}</span>
          {provider && model && <button type="button" className="btn btn-sm" onClick={() => void testModel()} disabled={modelTesting} title="Sends a short synthetic prompt; provider charges may apply">{modelTesting ? "Testing…" : modelTested ? "Test passed ✓" : "Test model"}</button>}
          {convId && !compact && <a className="btn btn-sm" href={`/api/ai/export?id=${convId}`}>Export</a>}
          {compact && <button className="btn btn-sm" onClick={newChat}>New</button>}
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-4" aria-live="polite">
          {msgs.length === 0 && (
            <div className="mx-auto max-w-xl py-8 text-center">
              <h2 className="text-lg font-semibold">{cur?.name ?? "FINVANTA AI"}</h2>
              <p className="mb-4 mt-1 text-sm text-muted">{cur?.focus}. Grounded in your ledger through verified calculation tools — it will not invent figures.</p>
              {cfg && !cfg.configured && <p className="mx-auto mb-4 max-w-md rounded-lg border border-warn/40 bg-warn/5 p-2 text-xs text-warn">No language-model provider is configured. <b>Engine mode</b> answers supported finance questions deterministically. Configure OpenRouter, Gemini, OpenAI or Cloudflare for general conversation.</p>}
              <div className="grid gap-2">{suggestions.map((s) => <button key={s} className="btn justify-start text-left" onClick={() => void send(s)}>{s}</button>)}</div>
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : ""}`}>
              <div className={`max-w-[92%] rounded-xl px-3.5 py-2.5 ${m.role === "user" ? "bg-accent/15" : "border border-line bg-bg2"}`}>
                {m.role === "user" ? <div className="whitespace-pre-wrap text-sm">{m.content}{m.attachments?.length ? <div className="mt-1 text-[11px] text-muted">📎 {m.attachments.join(", ")}</div> : null}</div> : (
                  <>
                    {m.notice && <div className="mb-1 whitespace-pre-wrap text-[11px] text-warn">{m.notice}</div>}
                    {m.content ? <Markdown>{m.content}</Markdown> : !m.error && <div className="skeleton h-4 w-40" />}
                    {m.error && <div role="alert" className="mt-1 rounded border border-down/40 bg-down/5 p-2 text-xs text-down">{m.error}</div>}
                    {m.proposals?.map((p) => (
                      <div key={p.id} className="mt-2 rounded-lg border border-accent/40 bg-panel p-3 text-xs">
                        <div className="mb-1 font-semibold">Draft journal entry — requires your approval</div>
                        <div className="text-muted">{p.payload.date} · {p.payload.narration}</div>
                        <table className="tbl mt-1"><tbody>{p.payload.lines.map((l, k) => <tr key={k}><td>{l.code} {l.name}</td><td className="r num">{Number(l.debit) ? l.debit : ""}</td><td className="r num">{Number(l.credit) ? l.credit : ""}</td></tr>)}</tbody></table>
                        {p.status === "pending" ? <div className="mt-2 flex gap-2"><button className="btn btn-primary btn-sm" onClick={() => void decide(p, "approve")}>Approve & post</button><button className="btn btn-sm" onClick={() => void decide(p, "reject")}>Reject</button></div>
                          : <div className="mt-2 font-semibold">{p.status === "approved" ? `✅ Posted as ${p.resultRef}` : "Rejected — nothing posted"}</div>}
                      </div>
                    ))}
                    {!!m.tools?.length && (
                      <details className="mt-2 text-[11px] text-muted"><summary className="cursor-pointer">Sources & calculations ({m.tools.length})</summary>
                        <ul className="mt-1 space-y-1.5">{m.tools.map((t, k) => (
                          <li key={k} className="rounded border border-line p-1.5"><span className="font-semibold text-fg">{t.name}</span> · <span>{t.source}</span>
                            {t.calc && <div className="mt-1 space-y-0.5"><div>Formula: {t.calc.formula}</div><div>Inputs: <code>{JSON.stringify(t.calc.inputs)}</code></div><div>Result: <code>{JSON.stringify(t.calc.result)}</code></div><div>Assumptions: {t.calc.assumptions.join(" ")}</div><div>As of {t.calc.timestamp}</div></div>}
                          </li>))}</ul>
                      </details>
                    )}
                    {m.content && !busy && <div className="mt-1.5 flex gap-2"><button className="text-[11px] text-muted hover:text-fg" onClick={() => { void navigator.clipboard.writeText(m.content); setCopied(i); setTimeout(() => setCopied(-1), 1200); }}>{copied === i ? "Copied ✓" : "Copy"}</button></div>}
                  </>
                )}
              </div>
            </div>
          ))}
          {lastAssistant && cur && msgs.length > 0 && (
            <div className="flex flex-wrap gap-1.5" aria-label="Follow-up suggestions">{(agentSelection === "auto" ? MIXED_STARTERS : cur.starters).slice(0, 3).map((s) => <button key={s} className="btn btn-sm" onClick={() => void send(s)}>{s}</button>)}</div>
          )}
          <div ref={endRef} />
        </div>
        {err && <div role="alert" className="mx-4 mb-2 rounded border border-down/40 bg-down/5 px-3 py-1.5 text-xs text-down">{err}</div>}
        {!compact && isOpenRouter && (mediaEnabled
          ? <MediaStudio conversationId={convId} onConversationCreated={(id) => { setConvId(id); void loadConvs(search); }} />
          : <p className="border-t border-line px-3 py-2 text-[10px] text-muted">Image/video generation is paused. Enable it with server setting AI_MEDIA_ENABLED=true after an image/video quota is available.</p>)}
        <form className="border-t border-line p-3" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
          {attach.length > 0 && <div className="mb-2 flex flex-wrap gap-1.5">{attach.map((a, i) => <span key={i} className="rounded-md border border-line bg-panel2 px-2 py-0.5 text-[11px]">📎 {a.name} <button type="button" aria-label="Remove" onClick={() => setAttach(attach.filter((_, k) => k !== i))}>✕</button></span>)}</div>}
          <div className="flex items-end gap-2">
            <input ref={fileRef} type="file" hidden accept=".pdf,.csv,.xlsx,.txt" disabled onChange={(e) => void upload(e.target.files?.[0])} />
            <button type="button" className="btn cursor-not-allowed opacity-50" aria-label="File attachments unavailable" title="File attachments are disabled until secure storage and antivirus scanning are configured and integrated" disabled>📎</button>
            <button type="button" className={`btn ${listening ? "border-down text-down" : ""}`} aria-label={listening ? "Stop voice input" : "Start voice input"} title="Voice input; browser speech recognition may use its own speech service" onClick={toggleListening} disabled={busy}>{listening ? "Listening…" : "🎙"}</button>
            <button type="button" className={`btn ${speakReplies ? "border-accent text-accent" : ""}`} aria-pressed={speakReplies} title="Read future replies aloud using your browser's speech engine" onClick={() => { setSpeakReplies((value) => !value); if (speakReplies && "speechSynthesis" in window) window.speechSynthesis.cancel(); }}>{speakReplies ? "🔊 Speech on" : "🔈 Read replies"}</button>
            <textarea className="inp max-h-40 min-h-[40px] flex-1" rows={1} placeholder={`Ask ${cur?.name ?? "FINVANTA AI"}…  (Enter to send, Shift+Enter for newline)`} aria-label="Message" value={input} disabled={busy}
              onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(input); } }} />
            {busy ? <button type="button" className="btn" onClick={() => abortRef.current?.abort()}>Stop</button> : <button className="btn btn-primary" disabled={!input.trim()}>Send</button>}
          </div>
          <p className="mt-1 text-[10px] text-muted">Voice input is processed by your browser’s speech service; review the editable transcript before sending. Spoken replies use your browser’s speech engine.</p>
          <p className="mt-1.5 text-[10px] text-muted">AI output is decision support, not professional advice. Figures come from verified tools; postings need your approval.</p>
        </form>
      </div>
    </div>
  );
}
