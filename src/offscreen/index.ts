import type { ExtensionMessage } from "../shared/messages";

const CHUNK_SECONDS = 4;
const MAX_AUDIO_CHUNK_BYTES = 1_500_000;

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

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const bytesPerSample = 2;
  const dataLength = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);
  const writeText = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };

  writeText(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += bytesPerSample;
  }
  return new Blob([buffer], { type: "audio/wav" });
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

async function stopCapture(): Promise<void> {
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

    activeVideoId = videoId;
    captureStartedAt = performance.now();
    chunkSequence = 0;

    chunkerNode.port.onmessage = (event: MessageEvent<{ samples: ArrayBuffer; sampleRate: number }>) => {
      if (!activeVideoId || activeVideoId !== videoId) return;
      const samples = new Float32Array(event.data.samples);
      const wav = encodeWav(samples, event.data.sampleRate);
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

    report("capturing", "Capturing lesson audio in four-second PCM chunks. Playback continues normally; raw audio is not saved as files.");
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
