# LearnLens AI

**Watch. Understand. Remember. Apply.**

LearnLens AI is a context-aware learning companion for educational videos. It connects a video to its accessible transcript, then helps learners ask grounded questions and understand concepts with timestamp-aware answers.

## Project status

Early development. The first milestone is a Chrome Manifest V3 extension that detects YouTube videos, reads captions that the page makes legitimately accessible, and provides a contextual AI tutor through Chrome's side panel.

## Initial scope

- Chrome extension built with React, TypeScript, and Vite
- YouTube video detection and caption-track discovery
- Timestamped transcript model and manual transcript import
- Firebase AI Logic hybrid inference (on-device where supported, cloud where configured)
- Explicit local-only mode; no silent cloud fallback

TikTok and Facebook support will be capability-based. LearnLens will not scrape private endpoints, bypass DRM, or claim transcript access where a platform does not expose captions.

## Development

The project scaffold and implementation instructions will be added as the first milestone is built. Do not commit Firebase credentials or API secrets.

## License

Apache-2.0. See [LICENSE](./LICENSE).
