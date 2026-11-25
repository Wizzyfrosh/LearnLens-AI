import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { BookOpen, BrainCircuit, Captions, CircleHelp, FileUp, LoaderCircle, Play, Send, Sparkles } from "lucide-react";
import { askLearnLens } from "../services/firebase-ai";
import { parseTranscript } from "../services/transcript";
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

  const segments: TranscriptSegment[] = useMemo(() => parseTranscript(rawTranscript), [rawTranscript]);
  const segmentCount = segments.length;

  async function submitQuestion(event: FormEvent) {
    event.preventDefault();
    if (!question.trim()) return;
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
          <span>{segmentCount} lines</span>
        </div>
        <label className="upload-box">
          <FileUp size={18} />
          <span><strong>Paste or import a transcript</strong><small>Supports VTT, SRT and plain text</small></span>
          <input type="file" accept=".vtt,.srt,.txt,text/plain" onChange={async (event) => {
            const file = event.target.files?.[0];
            if (file) setRawTranscript(await file.text());
          }} />
        </label>
        <textarea value={rawTranscript} onChange={(event) => setRawTranscript(event.target.value)} placeholder="Paste the video's transcript here. Timestamped VTT/SRT gives the tutor better references." rows={5} />
        {segmentCount > 0 && <div className="inline-success"><BookOpen size={14} /> Transcript ready for context-aware questions</div>}
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
        <form onSubmit={submitQuestion}>
          <textarea value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask about an idea, example, or section in this lesson..." rows={3} />
          <button className="primary-button" type="submit" disabled={busy || !question.trim() || segmentCount === 0}>
            {busy ? <LoaderCircle className="spin" size={16} /> : <Send size={15} />}
            {busy ? "Thinking..." : "Ask LearnLens"}
          </button>
        </form>
        {progress !== null && <p className="helper-text">Preparing on-device model: {Math.round(progress * 100)}%</p>}
        {error && <div className="error-box"><CircleHelp size={15} />{error}</div>}
        {answer && <article className="answer-card"><div className="answer-meta">LEARNLENS RESPONSE <span>{source === "ON_DEVICE" ? "ON DEVICE" : source === "IN_CLOUD" ? "CLOUD" : "SOURCE UNKNOWN"}</span></div><p>{answer}</p></article>}
      </section>

      <footer>Built for focused learning. Your transcript stays in this browser unless you choose cloud inference.</footer>
    </main>
  );
}