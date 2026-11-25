import type { ExtensionMessage } from "../shared/messages";
import { encodePcmToWav, MAX_AUDIO_CHUNK_BYTES } from "../services/audio-wav";

const CHUNK_SECONDS = 4;

let mediaStream: MediaStream | null = null;
let audioContext: AudioContext | null = null;
let sourceNode: MediaStreamAudioSourceNode | null = null;
let chunkerNode: AudioWorkletNode | null = null;
let chunkSequence = 0;
let captureStartedAt = 0;
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
      if (comma < 0) return reject(new Error("Captured audio could not be encoded."));
      resolve(result.slice(comma + 1));
    };
    reader.readAsDataURL(blob);
  });
}

async function stopCapture(reportIdle = true): Promise<void> {
  activeVideoId = "";
  chunkerNode?.disconnect();
  sourceNode?.disconnect();
  chunkerNode = null;
  sourceNode = null;
  mediaStream?.getTracks().forEach((track) => track.stop());
  mediaStream = null;
  if (audioContext && audioContext.state !== "closed") {
    await audioContext.close().catch(() => undefined);
  }
  audioContext = null;
  chunkSequence = 0;
  captureStartedAt = 0;
  if (reportIdle) report("idle", "Audio capture stopped. Raw audio chunks are not retained by LearnLens.");
}

async function startCapture(streamId: string, videoId: string): Promise<void> {
  await stopCapture(false);
  if (!streamId || !videoId) {
    throw new Error("Audio capture could not start because the lesson or stream identifier is missing.");
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
    if (!mediaStream.getAudioTracks().length) throw new Error("Chrome did not provide an audio track for this tab.");

    audioContext = new AudioContext();
    await audioContext.audioWorklet.addModule(chrome.runtime.getURL("audio-chunk-processor.js"));
    sourceNode = audioContext.createMediaStreamSource(mediaStream);
    chunkerNode = new AudioWorkletNode(audioContext, "learnlens-audio-chunker", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2]
    });
    sourceNode.connect(chunkerNode);
    chunkerNode.connect(audioContext.destination);
    await audioContext.resume();
    if (audioContext.state !== "running") throw new Error("The audio processor could not enter the running state.");

    activeVideoId = videoId;
    captureStartedAt = performance.now();
    chunkSequence = 0;

    chunkerNode.port.onmessage = (event: MessageEvent<{ samples: ArrayBuffer; sampleRate: number }>) => {
      if (!activeVideoId || activeVideoId !== videoId) return;
      const samples = new Float32Array(event.data.samples);
      const wav = encodePcmToWav(samples, event.data.sampleRate);
      if (wav.size > MAX_AUDIO_CHUNK_BYTES) {
        report("error", "An audio chunk exceeded the safe processing limit. Audio capture has been stopped.");
        void stopCapture();
        return;
      }

      const sequence = ++chunkSequence;
      const captureElapsedSeconds = Math.max(0, (performance.now() - captureStartedAt) / 1000 - CHUNK_SECONDS);
      void toBase64(wav).then((dataBase64) => {
        if (activeVideoId !== videoId) return;
        send({
          type: "LEARNLENS_AUDIO_CHUNK",
          payload: {
            videoId,
            sequence,
            mimeType: "audio/wav",
            dataBase64,
            captureElapsedSeconds,
            durationSeconds: CHUNK_SECONDS
          }
        });
      }).catch((error: unknown) => {
        report("error", error instanceof Error ? error.message : "Could not prepare an audio chunk.");
        void stopCapture();
      });
    };

    report("capturing", "Audio stream connected. Processing four-second chunks; video playback is passed through.");
  } catch (error) {
    await stopCapture(false);
    throw error instanceof Error ? error : new Error("Could not capture this tab's audio.");
  }
}
chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  if (message.type === "LEARNLENS_OFFSCREEN_START_AUDIO_CAPTURE") {
    void startCapture(message.streamId, message.videoId).then(() => {
      sendResponse({ ok: true });
    }).catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : "Could not initialize the offscreen audio processor.";
      report("error", detail);
      sendResponse({ ok: false, error: detail });
    });
    return true;
  }
  if (message.type === "LEARNLENS_OFFSCREEN_STOP_AUDIO_CAPTURE") {
    void stopCapture().then(() => sendResponse({ ok: true }));
    return true;
  }
});
