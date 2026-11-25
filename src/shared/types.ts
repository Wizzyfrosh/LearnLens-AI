export type TranscriptSource = "manual" | "native-track" | "visible-captions";

export interface TranscriptSegment {
  id: string;
  startSeconds: number;
  endSeconds: number;
  text: string;
  source: TranscriptSource;
}

export interface VideoContext {
  videoId: string;
  title: string;
  url: string;
  platform: "youtube";
}

export type InferencePreference = "prefer_on_device" | "only_on_device" | "only_in_cloud";

export interface TutorReply {
  text: string;
  inferenceSource: "ON_DEVICE" | "IN_CLOUD" | "UNKNOWN";
}