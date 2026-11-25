import type { ExtensionMessage } from "../shared/messages";

const MAX_AUDIO_CHUNK_BYTES = 1_500_000;
const CHUNK_INTERVAL_MS = 4_000;

let mediaStream: MediaStream | null = null;
let mediaRecorder: MediaRecorder | null = null;
let audioContext: AudioContext | null = null;
let playbackSource: MediaStreamAudioSourceNode | null = null;
let captureStartedAt = 0;
let chunkSequence = 0;
let activeVideoId = "";

function send(message: ExtensionMessage): void {
  void chrome.runtime.sendMessage(message).catch(() => undefined);
}

function report(status: "idle" | "capturing" | "error", message: string): void {
  send({ type: "LEARNLENS_AUDIO_CAPTURE_STATUS", payload: { status, message } });
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the captured audio chunk."));
    reader.onloadend = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      if (comma < 0) {
        reject(new Error("Captured audio could not be encoded."));
        return;
      }
      resolve(result.slice(comma + 1));
    };
    reader.readAsDataURL(blob);
  });
}

async function stopCapture(): Promise<void> {
  const recorder = mediaRecorder;
  mediaRecorder = null;
  if (recorder && recorder.state !== "inactive") {
    await new Promise<void>((resolve) => {
      recorder.addEventListener("stop", () => resolve(), { once: true });
      recorder.stop();
    });
  }

  mediaStream?.getTracks().forEach((track) => track.stop());
  mediaStream = null;
  playbackSource?.disconnect();
  playbackSource = null;
  if (audioContext && audioContext.state !== "closed") {
    await audioContext.close().catch(() => undefined);
  }
  audioContext = null;
  captureStartedAt = 0;
  chunkSequence = 0;
  activeVideoId = "";
  report("idle", "Audio capture stopped. Raw audio chunks are not retained by LearnLens.");
}

async function startCapture(streamId: string, videoId: string): Promise<void> {
  await stopCapture();

  if (!streamId || !videoId) {
    report("error", "Audio capture could not start because the lesson or stream identifier is missing.");
    return;
  }

  try {
    const constraints = {
      audio: {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: streamId
        }
      },
      video: false
    } as unknown as MediaStreamConstraints;

    mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
    if (!mediaStream.getAudioTracks().length) {
      throw new Error("Chrome did not provide an audio track for this tab.");
    }

    audioContext = new AudioContext();
    playbackSource = audioContext.createMediaStreamSource(mediaStream);
    playbackSource.connect(audioContext.destination);

    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "";

    if (!mimeType) {
      throw new Error("This Chrome version does not support WebM audio recording.");
    }

    activeVideoId = videoId;
    captureStartedAt = performance.now();
    chunkSequence = 0;
    mediaRecorder = new MediaRecorder(mediaStream, { mimeType, audioBitsPerSecond: 48_000 });

    mediaRecorder.addEventListener("dataavailable", (event) => {
      if (!event.data.size || activeVideoId !== videoId) return;
      if (event.data.size > MAX_AUDIO_CHUNK_BYTES) {
        report("error", "An audio chunk exceeded the safe processing limit. Audio capture has been stopped.");
        void stopCapture();
        return;
      }

      const sequence = ++chunkSequence;
      const elapsedSeconds = Math.max(0, (performance.now() - captureStartedAt) / 1000);
      void toBase64(event.data).then((dataBase64) => {
        if (activeVideoId !== videoId) return;
        send({
          type: "LEARNLENS_AUDIO_CHUNK",
          payload: {
            videoId,
            sequence,
            mimeType: "audio/webm",
            dataBase64,
            captureElapsedSeconds: Math.max(0, elapsedSeconds - CHUNK_INTERVAL_MS / 1000),
            durationSeconds: CHUNK_INTERVAL_MS / 1000
          }
        });
      }).catch((error: unknown) => {
        report("error", error instanceof Error ? error.message : "Could not prepare an audio chunk.");
        void stopCapture();
      });
    });

    mediaRecorder.addEventListener("error", () => {
      report("error", "Chrome encountered an audio recording error.");
      void stopCapture();
    });

    mediaRecorder.start(CHUNK_INTERVAL_MS);
    report("capturing", "Capturing lesson audio. Audio chunks are processed temporarily and are not saved as files.");
  } catch (error) {
    await stopCapture();
    report("error", error instanceof Error ? error.message : "Could not capture this tab's audio.");
  }
}

chrome.runtime.onMessage.addListener((message: ExtensionMessage) => {
  if (message.type === "LEARNLENS_OFFSCREEN_START_AUDIO_CAPTURE") {
    void startCapture(message.streamId, message.videoId);
  } else if (message.type === "LEARNLENS_OFFSCREEN_STOP_AUDIO_CAPTURE") {
    void stopCapture();
  }
});
