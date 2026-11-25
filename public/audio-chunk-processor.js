class LearnLensAudioChunker extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunkFrames = Math.floor(sampleRate * 4);
    this.buffer = new Float32Array(this.chunkFrames);
    this.offset = 0;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0 || !output || output.length === 0) return true;

    // Pass the captured audio through so the learner continues hearing the tab.
    for (let channel = 0; channel < output.length; channel += 1) {
      const source = input[Math.min(channel, input.length - 1)];
      output[channel].set(source);
    }

    const frames = input[0].length;
    let frame = 0;
    while (frame < frames) {
      const count = Math.min(this.chunkFrames - this.offset, frames - frame);
      for (let index = 0; index < count; index += 1) {
        let sum = 0;
        for (let channel = 0; channel < input.length; channel += 1) {
          sum += input[channel][frame + index] || 0;
        }
        this.buffer[this.offset + index] = sum / input.length;
      }
      this.offset += count;
      frame += count;

      if (this.offset === this.chunkFrames) {
        const completed = this.buffer;
        this.port.postMessage({ samples: completed.buffer, sampleRate }, [completed.buffer]);
        this.buffer = new Float32Array(this.chunkFrames);
        this.offset = 0;
      }
    }
    return true;
  }
}

registerProcessor("learnlens-audio-chunker", LearnLensAudioChunker);
