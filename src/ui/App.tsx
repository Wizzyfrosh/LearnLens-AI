import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { BookOpen, BrainCircuit, Captions, CircleHelp, FileUp, LoaderCircle, Play, Send, Sparkles } from "lucide-react";
import { askLearnLens } from "../services/firebase-ai";
import { MAX_TRANSCRIPT_CHARS, parseTranscriptImport } from "../services/transcript";
import type { InferencePreference, TranscriptSegment, VideoContext } from "../shared/types";

const emptyContext: VideoContext = {
  videoId: "",
  title: "No video detected",
  url: "",
  platform: "youtube"
};

export default function App() {
  const [video, setVideo] = useState<VideoContext>(emptyContext);
  const [rawTranscript, setRawTranscript] = useState("");
  const [transcriptSource, setTranscriptSource] = useState("Pasted transcript");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [source, setSource] = useState("");
  const [preference, setPreference] = useState<InferencePreference>("prefer_on_device");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<number | null>(null);

  useEffect(() => {
    if (!chrome?.tabs?.query) return;
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab?.url?.includes("youtube.com/watch")) return;
      const url = new URL(tab.url);
      const context = { videoId: url.searchParams.get("v") ?? "", title: tab.title?.replace(" - YouTube", "") ?? "YouTube video", url: tab.url, platform: "youtube" as const };
      setVideo(context);
    });
  }, []);

  const importedTranscript = useMemo(
    () => (rawTranscript.trim() ? parseTranscriptImport(rawTranscript) : null),
    [rawTranscript]
  );
  const segments: TranscriptSegment[] = importedTranscript?.segments ?? [];
  const segmentCount = segments.length;

  async function submitQuestion(event: FormEvent) {
    event.preventDefault();
    if (!question.trim() || !segmentCount) return;
    setBusy(true);
    setError("");
    setAnswer("");
    setSource("");
    try {
      const reply = await askLearnLens(question.trim(), segments, preference, setProgress);
      setAnswer(reply.text);
      setSource(reply.inferenceSource);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The tutor request failed.");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function importFile(file?: File) {
    if (!file) return;
    if (file.size > MAX_TRANSCRIPT_CHARS) {
      setRawTranscript("");
      setError(`This file exceeds the ${MAX_TRANSCRIPT_CHARS.toLocaleString()} character import limit.`);
      return;
    }
    try {
      const content = await file.text();
      setRawTranscript(content);
      setTranscriptSource(file.name);
      setError("");
    } catch {
      setError("The selected transcript could not be read. Try saving it as UTF-8 text.");
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand-mark"><BrainCircuit size={21} /></div>
        <div><strong>LearnLens</strong><span>AI LEARNING COMPANION</span></div>
        <div className="status-pill"><i /> Workspace</div>
      </header>

      <section className="video-card">
        <div className="section-kicker"><Play size={13} /> CURRENT LESSON</div>
        <h1>{video.title}</h1>
        <p>{video.videoId ? "YouTube video detected" : "Open a YouTube video, or add a transcript below to begin."}</p>
        {video.url && <a href={video.url} target="_blank" rel="noreferrer">Open source video</a>}
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div><Captions size={17} /><h2>Lesson transcript</h2></div>
          <span>{segmentCount} segments</span>
        </div>
        <label className="upload-box">
          <FileUp size={18} />
          <span><strong>Paste or import a transcript</strong><small>Supports VTT, SRT and plain text · 500,000 characters max</small></span>
          <input type="file" accept=".vtt,.srt,.txt,text/vtt,text/plain" onChange={(event) => {
            void importFile(event.target.files?.[0]);
            event.currentTarget.value = "";
          }} />
        </label>
        <textarea value={rawTranscript} onChange={(event) => {
          setRawTranscript(event.target.value);
          setTranscriptSource("Pasted transcript");
          setError("");
        }} placeholder="Paste the video's transcript here. Timestamped VTT/SRT gives the tutor better references." rows={5} />
        {importedTranscript && (
          <div className="transcript-status">
            {importedTranscript.errors.length > 0 ? (
              <div className="error-box"><CircleHelp size={15} />{importedTranscript.errors.join(" ")}</div>
            ) : (
              <div className="inline-success"><BookOpen size={14} />{segmentCount} segments ready · {importedTranscript.format.toUpperCase()} · {transcriptSource}</div>
            )}
            {importedTranscript.warnings.map((warning) => <p className="helper-text" key={warning}>{warning}</p>)}
            {segmentCount > 0 && (
              <div className="transcript-preview">
                <strong>Preview</strong>
                {segments.slice(0, 3).map((segment) => (
                  <p key={segment.id}>
                    {segment.hasTimestamp && <span>[{Math.floor(segment.startSeconds / 60).toString().padStart(2, "0")}:{Math.floor(segment.startSeconds % 60).toString().padStart(2, "0")}] </span>}
                    {segment.text}
                  </p>
                ))}
                {segmentCount > 3 && <small>And {segmentCount - 3} more segments</small>}
              </div>
            )}
          </div>
        )}
      </section>

      <section className="section-block tutor-block">
        <div className="section-heading">
          <div><Sparkles size={17} /><h2>Ask your tutor</h2></div>
          <span className="ai-label">AI TUTOR</span>
        </div>
        <label className="field-label" htmlFor="inference">AI processing preference</label>
        <select id="inference" value={preference} onChange={(event) => setPreference(event.target.value as InferencePreference)}>
          <option value="prefer_on_device">Prefer on-device, cloud fallback</option>
          <option value="only_on_device">On-device only (never send to cloud)</option>
          <option value="only_in_cloud">Cloud only</option>
        </select>
        <p className="helper-text">Prefer on-device can fall back to cloud and send transcript context. Choose on-device only to prevent cloud fallback.</p>
        <form onSubmit={submitQuestion}>
          <textarea value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask about an idea, example, or section in this lesson..." rows={3} />
          <button className="primary-button" type="submit" disabled={busy || !question.trim() || segmentCount === 0 || Boolean(importedTranscript?.errors.length)}>
            {busy ? <LoaderCircle className="spin" size={16} /> : <Send size={15} />}
            {busy ? "Thinking..." : "Ask LearnLens"}
          </button>
        </form>
        {progress !== null && <p className="helper-text">Preparing on-device model: {Math.round(progress * 100)}%</p>}
        {error && <div className="error-box"><CircleHelp size={15} />{error}</div>}
        {answer && <article className="answer-card"><div className="answer-meta">LEARNLENS RESPONSE <span>{source === "ON_DEVICE" ? "ON DEVICE" : source === "IN_CLOUD" ? "CLOUD" : "SOURCE UNKNOWN"}</span></div><p>{answer}</p></article>}
      </section>

      <footer>Transcripts are processed in this browser and are not saved by LearnLens. Prefer-on-device may use cloud fallback; on-device-only blocks cloud fallback.</footer>
    </main>
  );
}
