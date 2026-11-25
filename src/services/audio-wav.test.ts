import { describe, expect, it } from "vitest";
import { encodePcmToWav, MAX_AUDIO_CHUNK_BYTES } from "./audio-wav";

describe("encodePcmToWav", () => {
  it("writes a valid mono PCM WAV header and payload", async () => {
    const blob = encodePcmToWav(new Float32Array([-1, 0, 1]), 48_000);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const view = new DataView(bytes.buffer);

    expect(blob.type).toBe("audio/wav");
    expect(bytes.byteLength).toBe(50);
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(bytes.slice(8, 12))).toBe("WAVE");
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(48_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getInt16(44, true)).toBe(-32768);
    expect(view.getInt16(46, true)).toBe(0);
    expect(view.getInt16(48, true)).toBe(32767);
  });

  it("rejects invalid sample rates", () => {
    expect(() => encodePcmToWav(new Float32Array([0]), 0)).toThrow(/sample rate/i);
    expect(() => encodePcmToWav(new Float32Array([0]), 192_000)).toThrow(/sample rate/i);
  });

  it("keeps a four-second 48 kHz chunk below the raw-byte safety limit", () => {
    const fourSeconds = new Float32Array(48_000 * 4);
    const wav = encodePcmToWav(fourSeconds, 48_000);
    expect(wav.size).toBeLessThan(MAX_AUDIO_CHUNK_BYTES);
  });
});
