import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { BookOpen, BrainCircuit, Captions, CircleHelp, FileUp, LoaderCircle, Play, Send, Sparkles, Save, Trash2, Square } from "lucide-react";
import { askLearnLens, isAudioTranscriptionConfigured, transcribeAudioChunk } from "../services/firebase-ai";
import { MAX_TRANSCRIPT_CHARS, parseTranscriptImport, serializeSegmentsAsVtt } from "../services/transcript";
import { deleteLearningSession, getLatestManualSession, getLatestSessionForVideo, saveLearningSession } from "../services/session-store";
import type { InferencePreference, TranscriptSegment, VideoContext } from "../shared/types";
import type { AudioCaptureStatus, CaptionCaptureStatus, ExtensionMessage } from "../shared/messages";

const emptyContext: VideoContext = {
  videoId: "",
  title: "No video detected",
  url: "",
  platform: "youtube"
};

const captureStatusLabel: Record<CaptionCaptureStatus, string> = {
  idle: "Not capturing",
  waiting_for_captions: "Waiting for captions",
  capturing: "Capturing lesson",
  unsupported: "Unsupported page",
  error: "Capture unavailable"
};

export default function App() {
  const [video, setVideo] = useState<VideoContext>(emptyContext);
  const [rawTranscript, setRawTranscript] = useState("");
  const [transcriptSource, setTranscriptSource] = useState("Pasted transcript");
  const [capturedSegments, setCapturedSegments] = useState<TranscriptSegment[]>([]);
  const [captureStatus, setCaptureStatus] = useState<CaptionCaptureStatus>("idle");
  const [captureMessage, setCaptureMessage] = useState("Open a YouTube lesson and turn on CC to capture its captions automatically.");
  const [audioConsent, setAudioConsent] = useState(false);
  const [audioCaptureStatus, setAudioCaptureStatus] = useState<AudioCaptureStatus>("idle");
  const [audioCaptureMessage, setAudioCaptureMessage] = useState("Audio transcription is optional and sends lesson audio to Firebase for transcription.");
  const [audioCaptureTabId, setAudioCaptureTabId] = useState<number | null>(null);
  const audioCaptureTabIdRef = useRef<number | null>(null);
  const audioQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingAudioChunksRef = useRef(0);
  const [sessionId, setSessionId] = useState("");
  const [savedSession, setSavedSession] = useState(false);
  const [storageNotice, setStorageNotice] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [source, setSource] = useState("");
  const [preference, setPreference] = useState<InferencePreference>("prefer_on_device");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let restoreVersion = 0;
    let lastVideoId = "";
    let receivedBackgroundContext = false;

    const applyContext = (context: VideoContext | null, initial = false) => {
      if (cancelled) return;
      const next = context ?? emptyContext;
      const changedVideo = lastVideoId !== next.videoId;
      lastVideoId = next.videoId;
      setVideo(next);
      setAnswer("");
      setSource("");
      setError("");

      if (changedVideo && !initial) {
        setRawTranscript("");
        setCapturedSegments([]);
        setTranscriptSource("Pasted transcript");
        setSessionId(next.videoId);
        setSavedSession(false);
        setStorageNotice("");
        setCaptureStatus("idle");
        setCaptureMessage("The active lesson changed. Start learning to capture its captions.");
      }

      const version = ++restoreVersion;
      const restore = next.videoId
        ? getLatestSessionForVideo(next.videoId)
        : getLatestManualSession();
      void restore.then((saved) => {
        if (cancelled || version !== restoreVersion) return;
        if (saved) {
          if (!next.videoId) setVideo({ ...emptyContext, title: saved.title || "Saved imported lesson" });
          if (saved.transcriptSource === "YouTube live captions" || saved.transcriptSource === "Audio transcription") {
            const parsed = parseTranscriptImport(saved.transcriptText);
            const sourceType = saved.transcriptSource === "Audio transcription" ? "audio-transcription" : "visible-captions";
            setCapturedSegments(parsed.segments.map((segment) => ({ ...segment, source: sourceType })));
            setRawTranscript("");
          } else {
            setCapturedSegments([]);
            setRawTranscript(saved.transcriptText);
          }
          setTranscriptSource(saved.transcriptSource);
          setSessionId(saved.id);
          setSavedSession(true);
          setStorageNotice("Restored a lesson saved on this device.");
        } else if (next.videoId) {
          setSessionId(next.videoId);
          setSavedSession(false);
        } else if (initial) {
          setSessionId("");
        }
      }).catch(() => {
        if (!cancelled && version === restoreVersion) {
          setStorageNotice("Could not read saved lessons from this browser.");
        }
      });
    };

    const onRuntimeMessage = (message: ExtensionMessage) => {
      if (message.type === "LEARNLENS_ACTIVE_CONTEXT_CHANGED") {
        receivedBackgroundContext = true;
        applyContext(message.payload);
      } else if (message.type === "LEARNLENS_CAPTURE_STATUS") {
        setCaptureStatus(message.payload.status);
        setCaptureMessage(message.payload.message);
      } else if (message.type === "LEARNLENS_AUDIO_CAPTURE_STATUS") {
        setAudioCaptureStatus(message.payload.status);
        setAudioCaptureMessage(message.payload.message);
        if (message.payload.status === "idle" || message.payload.status === "error") {
          setAudioCaptureTabId(null);
          audioCaptureTabIdRef.current = null;
        }
      } else if (message.type === "LEARNLENS_AUDIO_CHUNK") {
        pendingAudioChunksRef.current += 1;
        if (pendingAudioChunksRef.current > 3) {
          setAudioCaptureStatus("error");
          setAudioCaptureMessage("Audio transcription is slower than capture. It was stopped to prevent an unbounded queue.");
          if (audioCaptureTabIdRef.current !== null) {
            chrome.runtime.sendMessage({ type: "LEARNLENS_STOP_AUDIO_CAPTURE", tabId: audioCaptureTabIdRef.current } satisfies ExtensionMessage).catch(() => undefined);
          }
          pendingAudioChunksRef.current = 0;
          return;
        }
        audioQueueRef.current = audioQueueRef.current.then(async () => {
          const text = await transcribeAudioChunk(message.payload.dataBase64, message.payload.mimeType, message.payload.sequence);
          if (!text) return;
          const segment: TranscriptSegment = {
            id: `audio-${message.payload.videoId}-${message.payload.sequence}`,
            startSeconds: 0,
            endSeconds: 0,
            hasTimestamp: false,
            text,
            source: "audio-transcription"
          };
          setCapturedSegments((current) => current.some((item) => item.id === segment.id) ? current : [...current, segment]);
          setTranscriptSource("Audio transcription");
          setRawTranscript("");
        }).catch((cause: unknown) => {
          setAudioCaptureStatus("error");
          setAudioCaptureMessage(cause instanceof Error ? cause.message : "Audio transcription failed.");
          if (audioCaptureTabIdRef.current !== null) {
            chrome.runtime.sendMessage({ type: "LEARNLENS_STOP_AUDIO_CAPTURE", tabId: audioCaptureTabIdRef.current } satisfies ExtensionMessage).catch(() => undefined);
          }
        }).finally(() => {
          pendingAudioChunksRef.current = Math.max(0, pendingAudioChunksRef.current - 1);
        });
      } else if (message.type === "LEARNLENS_CAPTION_SEGMENT") {
        setCapturedSegments((current) => {
          if (current.some((segment) => segment.id === message.payload.id)) return current;
          return [...current, message.payload].sort((a, b) => a.startSeconds - b.startSeconds);
        });
        setTranscriptSource("YouTube live captions");
        setRawTranscript("");
      }
    };

    chrome.runtime.onMessage.addListener(onRuntimeMessage);
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      if (cancelled || receivedBackgroundContext) return;
      const tab = tabs[0];
      let context: VideoContext | null = null;
      if (tab?.url) {
        try {
          const url = new URL(tab.url);
          const videoId = url.hostname === "www.youtube.com" && url.pathname === "/watch"
            ? url.searchParams.get("v")
            : null;
          if (videoId) {
            context = {
              videoId,
              title: (tab.title ?? "YouTube video").replace(" - YouTube", "").trim() || "YouTube video",
              url: tab.url,
              platform: "youtube"
            };
          }
        } catch {
          context = null;
        }
      }
      applyContext(context, true);
    });

    return () => {
      cancelled = true;
      chrome.runtime.onMessage.removeListener(onRuntimeMessage);
      if (audioCaptureTabIdRef.current !== null) {
        chrome.runtime.sendMessage({
          type: "LEARNLENS_STOP_AUDIO_CAPTURE",
          tabId: audioCaptureTabIdRef.current
        } satisfies ExtensionMessage).catch(() => undefined);
      }
    };
  }, []);

  const importedTranscript = useMemo(
    () => (rawTranscript.trim() ? parseTranscriptImport(rawTranscript) : null),
    [rawTranscript]
  );
  const segments: TranscriptSegment[] = capturedSegments.length
    ? capturedSegments
    : importedTranscript?.segments ?? [];
  const segmentCount = segments.length;
  const isLiveTranscript = capturedSegments.length > 0;

  useEffect(() => {
    if (!isLiveTranscript || !video.videoId) return;
    const timer = window.setTimeout(() => {
      const allHaveTimestamps = capturedSegments.every((segment) => segment.hasTimestamp);
      const transcriptText = allHaveTimestamps
        ? serializeSegmentsAsVtt(capturedSegments)
        : capturedSegments.map((segment) => segment.text).join("\\n");
      void saveLearningSession({
        id: video.videoId,
        videoId: video.videoId,
        title: video.title,
        url: video.url,
        platform: "youtube",
        transcriptText,
        transcriptFormat: allHaveTimestamps ? "vtt" : "plain-text",
        transcriptSource: capturedSegments.some((segment) => segment.source === "audio-transcription") ? "Audio transcription" : "YouTube live captions",
        updatedAt: Date.now()
      }).then(() => {
        setSessionId(video.videoId);
        setSavedSession(true);
        setStorageNotice("Lesson transcript is being saved automatically on this device.");
      }).catch(() => {
        setStorageNotice("Live captions are available in this session, but automatic local saving failed.");
      });
    }, 1400);
    return () => window.clearTimeout(timer);
  }, [capturedSegments, isLiveTranscript, video.videoId, video.title, video.url]);

  async function startLearning() {
    if (audioCaptureTabIdRef.current !== null) await stopAudioTranscription();
    if (!video.videoId) {
      setCaptureStatus("unsupported");
      setCaptureMessage("Open a YouTube watch page before starting lesson capture.");
      return;
    }
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id === undefined) {
      setCaptureStatus("error");
      setCaptureMessage("LearnLens could not identify the active browser tab.");
      return;
    }
    setCapturedSegments([]);
    setRawTranscript("");
    setSavedSession(false);
    setStorageNotice("");
    setCaptureStatus("waiting_for_captions");
    setCaptureMessage("Connecting to the YouTube player. Turn on CC if captions are not appearing.");
    chrome.runtime.sendMessage({ type: "LEARNLENS_START_CAPTION_CAPTURE", tabId: tab.id } satisfies ExtensionMessage)
      .catch(() => {
        setCaptureStatus("error");
        setCaptureMessage("Could not start lesson capture. Reload the YouTube page and try again.");
      });
  }

  async function stopLearning() {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id !== undefined) {
      chrome.runtime.sendMessage({ type: "LEARNLENS_STOP_CAPTION_CAPTURE", tabId: tab.id } satisfies ExtensionMessage)
        .catch(() => undefined);
    }
    setCaptureStatus("idle");
    setCaptureMessage("Lesson capture stopped. Captured captions remain saved on this device.");
  }


  async function startAudioTranscription() {
    if (!audioConsent) {
      setAudioCaptureMessage("Please confirm that you understand lesson audio will be sent to Firebase for transcription.");
      return;
    }
    if (!isAudioTranscriptionConfigured()) {
      setAudioCaptureStatus("error");
      setAudioCaptureMessage("Audio transcription is not configured in this build. Firebase settings and App Check debug mode must be configured before audio can be uploaded.");
      return;
    }
    if (!video.videoId) {
      setAudioCaptureStatus("error");
      setAudioCaptureMessage("Open a supported YouTube lesson before starting audio transcription.");
      return;
    }

    try {
      // Invoke tabCapture immediately in the click handler, before any await,
      // so Chrome can associate it with the learner's explicit gesture.
      const streamIdPromise = chrome.tabCapture.getMediaStreamId();
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (tab?.id === undefined) throw new Error("Could not identify the active lesson tab.");
      const streamId = await streamIdPromise;
      setCapturedSegments([]);
      setRawTranscript("");
      setSavedSession(false);
      setStorageNotice("");
      setAudioCaptureTabId(tab.id);
      audioCaptureTabIdRef.current = tab.id;
      setAudioCaptureStatus("capturing");
      setAudioCaptureMessage("Connecting to the active lesson audio. The video should continue playing normally.");
      await chrome.runtime.sendMessage({
        type: "LEARNLENS_START_AUDIO_CAPTURE",
        tabId: tab.id,
        videoId: video.videoId,
        streamId
      } satisfies ExtensionMessage);
    } catch (cause) {
      setAudioCaptureStatus("error");
      setAudioCaptureMessage(cause instanceof Error ? cause.message : "Could not start audio transcription.");
      setAudioCaptureTabId(null);
      audioCaptureTabIdRef.current = null;
    }
  }

  async function stopAudioTranscription() {
    if (audioCaptureTabId !== null) {
      await chrome.runtime.sendMessage({
        type: "LEARNLENS_STOP_AUDIO_CAPTURE",
        tabId: audioCaptureTabId
      } satisfies ExtensionMessage).catch(() => undefined);
    }
    setAudioCaptureStatus("idle");
    setAudioCaptureMessage("Audio transcription stopped. Raw audio chunks are not retained.");
    setAudioCaptureTabId(null);
    audioCaptureTabIdRef.current = null;
  }

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
      setCapturedSegments([]);
      setSavedSession(false);
      setError("This file exceeds the " + MAX_TRANSCRIPT_CHARS.toLocaleString() + " character import limit.");
      return;
    }
    try {
      const content = await file.text();
      setCapturedSegments([]);
      setRawTranscript(content);
      setTranscriptSource(file.name);
      setSavedSession(false);
      setStorageNotice("");
      setError("");
    } catch {
      setError("The selected transcript could not be read. Try saving it as UTF-8 text.");
    }
  }

  async function saveCurrentSession() {
    if (!importedTranscript || importedTranscript.errors.length || !segments.length) return;
    const id = video.videoId || sessionId || crypto.randomUUID();
    try {
      await saveLearningSession({
        id,
        videoId: video.videoId,
        title: video.videoId ? video.title : "Imported lesson",
        url: video.url,
        platform: video.videoId ? "youtube" : "manual",
        transcriptText: rawTranscript,
        transcriptFormat: importedTranscript.format,
        transcriptSource,
        updatedAt: Date.now()
      });
      setSessionId(id);
      setSavedSession(true);
      setStorageNotice("Lesson saved locally on this device.");
    } catch (cause) {
      setStorageNotice(cause instanceof Error ? cause.message : "Could not save this lesson locally.");
    }
  }

  async function clearSavedSession() {
    if (!savedSession || !sessionId) return;
    try {
      await deleteLearningSession(sessionId);
      setSavedSession(false);
      setStorageNotice("Saved lesson removed from this device. The current transcript remains open.");
    } catch (cause) {
      setStorageNotice(cause instanceof Error ? cause.message : "Could not remove the saved lesson.");
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
        <p>{video.videoId ? "YouTube video detected" : "Open a YouTube lesson to start learning."}</p>
        {video.url && <a href={video.url} target="_blank" rel="noreferrer">Open source video</a>}
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div><Captions size={17} /><h2>Lesson transcript</h2></div>
          <span>{segmentCount} segments</span>
        </div>

        <div className="capture-card">
          <div className="capture-card-heading">
            <div>
              <strong>Automatic lesson capture</strong>
              <small>{captureStatusLabel[captureStatus]}</small>
            </div>
            <span className={"capture-indicator " + (captureStatus === "capturing" ? "active" : "")} />
          </div>
          <p>{captureMessage}</p>
          {captureStatus === "capturing" || captureStatus === "waiting_for_captions" ? (
            <button className="capture-button stop" type="button" onClick={() => void stopLearning()}>
              <Square size={14} /> Stop capture
            </button>
          ) : (
            <button className="capture-button" type="button" onClick={() => void startLearning()} disabled={!video.videoId}>
              <Play size={14} /> Start learning
            </button>
          )}
          <small className="capture-privacy">This first automatic path reads captions rendered by YouTube. Turn on CC in the video player. Captured text is saved locally; AI questions follow your selected processing preference.</small>
        </div>


        <div className="capture-card audio-capture-card">
          <div className="capture-card-heading">
            <div>
              <strong>Audio transcription</strong>
              <small>{audioCaptureStatus === "capturing" ? "Transcribing lesson audio" : audioCaptureStatus === "error" ? "Audio transcription unavailable" : "Optional fallback when captions are unavailable"}</small>
            </div>
            <span className={"capture-indicator " + (audioCaptureStatus === "capturing" ? "active" : "")} />
          </div>
          <p>{audioCaptureMessage}</p>
          <label className="helper-text audio-consent">
            <input type="checkbox" checked={audioConsent} onChange={(event) => setAudioConsent(event.target.checked)} />
            I agree to send this lesson's tab audio to Firebase AI Logic for transcription. Raw audio chunks are processed temporarily and are not saved as files.
          </label>
          {audioCaptureStatus === "capturing" ? (
            <button className="capture-button stop" type="button" onClick={() => void stopAudioTranscription()}>
              <Square size={14} /> Stop audio transcription
            </button>
          ) : (
            <button className="capture-button" type="button" onClick={() => void startAudioTranscription()} disabled={!video.videoId || !audioConsent}>
              <Play size={14} /> Start audio transcription
            </button>
          )}
          {!isAudioTranscriptionConfigured() && <small className="helper-text">Setup required: this GitHub build needs Firebase web configuration and App Check debug mode before it can upload audio.</small>}
        </div>

        {isLiveTranscript && (
          <div className="transcript-status">
            <div className="inline-success"><BookOpen size={14} />{segmentCount} {capturedSegments.some((segment) => segment.source === "audio-transcription") ? "transcribed audio segments" : "live caption segments"} · saved automatically on this device</div>
            <div className="transcript-preview">
              <strong>Captured lesson</strong>
              {segments.slice(-8).map((segment) => (
                <p key={segment.id}>
                  {segment.hasTimestamp && <span>[{Math.floor(segment.startSeconds / 60).toString().padStart(2, "0")}:{Math.floor(segment.startSeconds % 60).toString().padStart(2, "0")}] </span>}
                  {segment.text}
                </p>
              ))}
            </div>
          </div>
        )}

        {importedTranscript && !isLiveTranscript && (
          <div className="transcript-status">
            {importedTranscript.errors.length > 0 ? (
              <div className="error-box"><CircleHelp size={15} />{importedTranscript.errors.join(" ")}</div>
            ) : (
              <div className="inline-success"><BookOpen size={14} />{segmentCount} segments ready · {importedTranscript.format.toUpperCase()} · {transcriptSource}</div>
            )}
            {importedTranscript.warnings.map((warning) => <p className="helper-text" key={warning}>{warning}</p>)}
            {segmentCount > 0 && (
              <>
                <div className="transcript-preview">
                  <strong>Preview</strong>
                  {segments.slice(0, 3).map((segment) => <p key={segment.id}>{segment.text}</p>)}
                  {segmentCount > 3 && <small>And {segmentCount - 3} more segments</small>}
                </div>
                <div className="session-actions">
                  <button className="secondary-button" type="button" onClick={() => void saveCurrentSession()} disabled={savedSession}>
                    <Save size={14} /> {savedSession ? "Saved on this device" : "Save lesson locally"}
                  </button>
                  {savedSession && <button className="secondary-button" type="button" onClick={() => void clearSavedSession()}><Trash2 size={14} /> Remove saved copy</button>}
                </div>
              </>
            )}
            {storageNotice && <p className="helper-text">{storageNotice}</p>}
          </div>
        )}

        <details className="fallback-import">
          <summary>Import a transcript instead (fallback)</summary>
          <label className="upload-box">
            <FileUp size={18} />
            <span><strong>Paste or import a transcript</strong><small>VTT, SRT and plain text · 500,000 characters max</small></span>
            <input type="file" accept=".vtt,.srt,.txt,text/vtt,text/plain" onChange={(event) => {
              void importFile(event.target.files?.[0]);
              event.currentTarget.value = "";
            }} />
          </label>
          <textarea value={rawTranscript} onChange={(event) => {
            setCapturedSegments([]);
            setRawTranscript(event.target.value);
            setTranscriptSource("Pasted transcript");
            setSavedSession(false);
            setStorageNotice("");
            setError("");
          }} placeholder="Paste transcript text here..." rows={4} />
        </details>
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
          <button className="primary-button" type="submit" disabled={busy || !question.trim() || segmentCount === 0 || Boolean(importedTranscript?.errors.length && !isLiveTranscript)}>
            {busy ? <LoaderCircle className="spin" size={16} /> : <Send size={15} />}
            {busy ? "Thinking..." : "Ask LearnLens"}
          </button>
        </form>
        {progress !== null && <p className="helper-text">Preparing on-device model: {Math.round(progress * 100)}%</p>}
        {error && <div className="error-box"><CircleHelp size={15} />{error}</div>}
        {answer && <article className="answer-card"><div className="answer-meta">LEARNLENS RESPONSE <span>{source === "ON_DEVICE" ? "ON DEVICE" : source === "IN_CLOUD" ? "CLOUD" : "SOURCE UNKNOWN"}</span></div><p>{answer}</p></article>}
      </section>

      <footer>Captured captions and saved lessons stay in this browser. Audio transcription sends lesson audio to Firebase only after separate learner consent and App Check configuration.</footer>
    </main>
  );
}
