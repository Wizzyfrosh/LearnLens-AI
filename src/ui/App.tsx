import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { BookOpen, BrainCircuit, Captions, CircleHelp, FileUp, LoaderCircle, Play, Send, Sparkles, Save, Trash2, Square, Bookmark, Download, Search, FileText } from "lucide-react";
import { askLearnLens, isAudioTranscriptionConfigured, transcribeAudioChunk } from "../services/firebase-ai";
import { MAX_TRANSCRIPT_CHARS, parseTranscriptImport, serializeSegmentsAsVtt } from "../services/transcript";
import { deleteLearningSession, deleteLearningNote, deleteLearningBookmark, getLatestManualSession, getLatestSessionForVideo, listLearningBookmarks, listLearningNotes, saveLearningBookmark, saveLearningNote, saveLearningSession } from "../services/session-store";
import type { LearningBookmark, LearningNote } from "../services/session-store";
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

function formatLessonTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.floor(seconds % 60);
  return `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}

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
  const [notes, setNotes] = useState<LearningNote[]>([]);
  const [bookmarks, setBookmarks] = useState<LearningBookmark[]>([]);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteContent, setNoteContent] = useState("");
  const [noteTimestamp, setNoteTimestamp] = useState("");
  const [noteSearch, setNoteSearch] = useState("");
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [artifactMessage, setArtifactMessage] = useState("");
  const [draftingNote, setDraftingNote] = useState(false);
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
  const filteredNotes = notes.filter((note) => !noteSearch.trim() || `${note.title}\n${note.content}`.toLocaleLowerCase().includes(noteSearch.trim().toLocaleLowerCase()));
  const isLiveTranscript = capturedSegments.length > 0;

  useEffect(() => {
    if (!sessionId || !savedSession) {
      setNotes([]);
      setBookmarks([]);
      return;
    }
    let cancelled = false;
    Promise.all([listLearningNotes(sessionId), listLearningBookmarks(sessionId)]).then(([savedNotes, savedBookmarks]) => {
      if (!cancelled) {
        setNotes(savedNotes);
        setBookmarks(savedBookmarks);
      }
    }).catch(() => {
      if (!cancelled) setArtifactMessage("Could not load saved notes and bookmarks from this device.");
    });
    return () => { cancelled = true; };
  }, [sessionId, savedSession]);

  useEffect(() => {
    if (!isLiveTranscript || !video.videoId) return;
    const timer = window.setTimeout(() => {
      const allHaveTimestamps = capturedSegments.every((segment) => segment.hasTimestamp);
      const transcriptText = allHaveTimestamps
        ? serializeSegmentsAsVtt(capturedSegments)
        : capturedSegments.map((segment) => segment.text).join("\n");
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
    try {
      if (audioCaptureTabIdRef.current !== null) await stopAudioTranscription();
      if (!video.videoId) {
        setCaptureStatus("unsupported");
        setCaptureMessage("Open a YouTube watch page before starting lesson capture.");
        return;
      }

      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (tab?.id === undefined) {
        throw new Error("LearnLens could not identify the active browser tab.");
      }

      setCapturedSegments([]);
      setRawTranscript("");
      setSavedSession(false);
      setStorageNotice("");
      setCaptureStatus("waiting_for_captions");
      setCaptureMessage("Connecting to the YouTube player and checking its existing captions.");

      await chrome.runtime.sendMessage({
        type: "LEARNLENS_START_CAPTION_CAPTURE",
        tabId: tab.id
      } satisfies ExtensionMessage);
    } catch (cause) {
      setCaptureStatus("error");
      setCaptureMessage(
        cause instanceof Error
          ? "Could not start lesson capture: " + cause.message
          : "Could not start lesson capture. Check the active YouTube tab and try again."
      );
    }
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
    if (preference === "only_on_device") {
      setAudioCaptureStatus("error");
      setAudioCaptureMessage("Audio transcription currently requires Firebase cloud processing. Change the tutor preference from On-device only and separately consent before starting.");
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
      // Invoke tabCapture synchronously inside the learner's button click.
      // Do not await tabs.query or send a worker message before this call:
      // Chrome requires the stream request to retain the initiating gesture.
      const streamIdPromise = chrome.tabCapture.getMediaStreamId();
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (tab?.id === undefined) throw new Error("Could not identify the active lesson tab.");
      const streamId = await streamIdPromise;
      if (!streamId) throw new Error("Chrome did not provide an audio stream ID for this lesson.");
      setCapturedSegments([]);
      setRawTranscript("");
      setSavedSession(false);
      setStorageNotice("");
      setAudioCaptureStatus("idle");
      setAudioCaptureMessage("Initializing the audio processor...");
      const response = await chrome.runtime.sendMessage({
        type: "LEARNLENS_START_AUDIO_CAPTURE",
        tabId: tab.id,
        videoId: video.videoId,
        streamId
      } satisfies ExtensionMessage) as { ok?: boolean; error?: string } | undefined;
      if (!response?.ok) throw new Error(response?.error || "Chrome did not confirm that audio capture started.");
      setAudioCaptureTabId(tab.id);
      audioCaptureTabIdRef.current = tab.id;
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

  async function draftNoteWithTutor() {
    if (!segmentCount) {
      setArtifactMessage("Capture or load lesson transcript text before drafting notes.");
      return;
    }
    setDraftingNote(true);
    setArtifactMessage("Generating a draft from the current lesson transcript. Review it before saving.");
    try {
      const draft = await askLearnLens(
        "Create clear, concise study notes from this lesson transcript. Use a short descriptive title on the first line, then structured headings and bullet points. Include only information supported by the transcript. Do not invent timestamps or facts. This is an editable draft for learner review.\n\nLesson: " + video.title,
        segments,
        preference,
        setProgress
      );
      const lines = draft.text.split("\n");
      const firstLine = lines.find((line) => line.trim())?.replace(/^#+\s*/, "").trim();
      setNoteTitle(firstLine || "Study notes");
      setNoteContent(draft.text);
      setNoteTimestamp("");
      setEditingNoteId(null);
      setArtifactMessage("AI draft created. Review and edit the content, then choose Save note.");
    } catch (cause) {
      setArtifactMessage(cause instanceof Error ? cause.message : "Could not generate a note draft.");
    } finally {
      setDraftingNote(false);
      setProgress(null);
    }
  }

  async function saveNote(event: FormEvent) {
    event.preventDefault();
    if (!sessionId || !savedSession || !noteTitle.trim() || !noteContent.trim()) return;
    const existing = notes.find((note) => note.id === editingNoteId);
    const now = Date.now();
    const timestamp = noteTimestamp === "" ? null : Number(noteTimestamp);
    const note: LearningNote = {
      id: existing?.id ?? crypto.randomUUID(),
      sessionId,
      videoId: video.videoId,
      title: noteTitle.trim(),
      content: noteContent.trim(),
      timestampSeconds: timestamp !== null && Number.isFinite(timestamp) && timestamp >= 0 ? timestamp : null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    try {
      await saveLearningNote(note);
      setNotes((current) => [note, ...current.filter((item) => item.id !== note.id)].sort((a, b) => b.updatedAt - a.updatedAt));
      setNoteTitle("");
      setNoteContent("");
      setNoteTimestamp("");
      setEditingNoteId(null);
      setArtifactMessage(existing ? "Note updated on this device." : "Note saved on this device.");
    } catch (cause) {
      setArtifactMessage(cause instanceof Error ? cause.message : "Could not save this note.");
    }
  }

  async function removeNote(id: string) {
    try {
      await deleteLearningNote(id);
      setNotes((current) => current.filter((note) => note.id !== id));
      if (editingNoteId === id) {
        setEditingNoteId(null);
        setNoteTitle("");
        setNoteContent("");
        setNoteTimestamp("");
      }
      setArtifactMessage("Note deleted.");
    } catch {
      setArtifactMessage("Could not delete this note.");
    }
  }

  async function addBookmark(segment: TranscriptSegment) {
    if (!sessionId || !savedSession || !segment.hasTimestamp) return;
    const timestampSeconds = segment.startSeconds;
    if (bookmarks.some((item) => item.timestampSeconds === timestampSeconds)) {
      setArtifactMessage("A bookmark already exists at this lesson timestamp.");
      return;
    }
    const bookmark: LearningBookmark = {
      id: crypto.randomUUID(),
      sessionId,
      videoId: video.videoId,
      label: segment.text.slice(0, 120),
      timestampSeconds,
      createdAt: Date.now()
    };
    try {
      await saveLearningBookmark(bookmark);
      setBookmarks((current) => [...current, bookmark].sort((a, b) => a.timestampSeconds - b.timestampSeconds));
      setArtifactMessage("Bookmark saved with the caption's timestamp.");
    } catch {
      setArtifactMessage("Could not save this bookmark.");
    }
  }

  async function removeBookmark(id: string) {
    try {
      await deleteLearningBookmark(id);
      setBookmarks((current) => current.filter((item) => item.id !== id));
      setArtifactMessage("Bookmark deleted.");
    } catch {
      setArtifactMessage("Could not delete this bookmark.");
    }
  }

  function exportNotes() {
    const lines = [
      `# ${video.title || "LearnLens lesson notes"}`,
      "",
      `Source: ${video.url || "Imported lesson"}`,
      "",
      ...notes.flatMap((note) => [
        `## ${note.title}`,
        note.timestampSeconds === null ? "" : `Timestamp: ${formatLessonTime(note.timestampSeconds)}`,
        "",
        note.content,
        ""
      ]),
      "## Bookmarks",
      ...bookmarks.map((item) => `- [${formatLessonTime(item.timestampSeconds)}] ${item.label}`)
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `learnlens-notes-${sessionId || "lesson"}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
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
          <small className="helper-text">This feature always uses cloud transcription. It is unavailable when the tutor is set to On-device only.</small>
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
                  {segment.hasTimestamp && savedSession && <button className="inline-bookmark" type="button" onClick={() => void addBookmark(segment)} aria-label={`Bookmark at ${formatLessonTime(segment.startSeconds)}`}><Bookmark size={12} /></button>}
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


        {savedSession && sessionId && (
          <section className="learning-artifacts">
            <div className="section-heading">
              <div><FileText size={17} /><h2>Lesson notes</h2></div>
              <span>{notes.length} notes · {bookmarks.length} bookmarks</span>
            </div>
            <div className="note-draft-row">
              <p>AI drafts are suggestions only. Review and edit before saving.</p>
              <button className="secondary-button" type="button" onClick={() => void draftNoteWithTutor()} disabled={draftingNote || !segmentCount}>
                {draftingNote ? <LoaderCircle className="spin" size={13} /> : <Sparkles size={13} />}
                {draftingNote ? "Drafting..." : "Draft notes with AI"}
              </button>
            </div>
            <form className="note-editor" onSubmit={(event) => void saveNote(event)}>
              <label className="field-label" htmlFor="note-title">Note title</label>
              <input id="note-title" value={noteTitle} onChange={(event) => setNoteTitle(event.target.value)} placeholder="e.g. How ATP is produced" required />
              <label className="field-label" htmlFor="note-content">Your notes</label>
              <textarea id="note-content" value={noteContent} onChange={(event) => setNoteContent(event.target.value)} placeholder="Write your explanation, key ideas, or questions..." rows={4} required />
              <label className="field-label" htmlFor="note-timestamp">Link to a captured lesson timestamp (optional)</label>
              <select id="note-timestamp" value={noteTimestamp} onChange={(event) => setNoteTimestamp(event.target.value)}>
                <option value="">No timestamp</option>
                {segments.filter((segment) => segment.hasTimestamp).map((segment) => (
                  <option key={segment.id} value={String(segment.startSeconds)}>{formatLessonTime(segment.startSeconds)} — {segment.text.slice(0, 72)}</option>
                ))}
              </select>
              <div className="session-actions">
                <button className="primary-button note-save" type="submit">{editingNoteId ? "Update note" : "Save note"}</button>
                {editingNoteId && <button className="secondary-button" type="button" onClick={() => { setEditingNoteId(null); setNoteTitle(""); setNoteContent(""); setNoteTimestamp(""); }}>Cancel edit</button>}
              </div>
            </form>
            <label className="note-search"><Search size={14} /><input value={noteSearch} onChange={(event) => setNoteSearch(event.target.value)} placeholder="Search saved notes..." /></label>
            <div className="saved-note-list">
              {filteredNotes.length ? filteredNotes.map((note) => (
                <article className="saved-note" key={note.id}>
                  <div className="saved-note-heading"><strong>{note.title}</strong>{note.timestampSeconds !== null && <span>{formatLessonTime(note.timestampSeconds)}</span>}</div>
                  <p>{note.content}</p>
                  <div className="session-actions">
                    <button className="secondary-button" type="button" onClick={() => { setEditingNoteId(note.id); setNoteTitle(note.title); setNoteContent(note.content); setNoteTimestamp(note.timestampSeconds === null ? "" : String(note.timestampSeconds)); }}>Edit</button>
                    <button className="secondary-button" type="button" onClick={() => void removeNote(note.id)}><Trash2 size={12} /> Delete</button>
                  </div>
                </article>
              )) : <p className="empty-artifact">{noteSearch ? "No notes match that search." : "Your saved lesson notes will appear here."}</p>}
            </div>
            <div className="bookmark-list">
              <strong>Bookmarks</strong>
              {bookmarks.length ? bookmarks.map((item) => (
                <div className="bookmark-row" key={item.id}>
                  <span><Bookmark size={13} /> {formatLessonTime(item.timestampSeconds)}</span>
                  <p>{item.label}</p>
                  <button className="icon-button" type="button" aria-label="Delete bookmark" onClick={() => void removeBookmark(item.id)}><Trash2 size={13} /></button>
                </div>
              )) : <p className="empty-artifact">No timestamp bookmarks yet. Use the bookmark control beside a timed caption below.</p>}
            </div>
            <button className="secondary-button export-button" type="button" onClick={exportNotes} disabled={!notes.length && !bookmarks.length}><Download size={14} /> Export notes as Markdown</button>
            {artifactMessage && <p className="helper-text">{artifactMessage}</p>}
          </section>
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
