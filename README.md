# Whishper YouTube Captions Extension

Browser extension scaffold built with WXT, TypeScript, and OXC tooling via `oxlint`.

## What it does

- Injects a control panel on YouTube watch pages.
- Sends the current YouTube URL to the existing Whishper backend through `POST /api/transcriptions`.
- Polls `GET /api/transcriptions/:id` until the job is done.
- Converts returned segments to YouTube `json3` timedtext and registers `Whishper` through YouTube's internal captions store, so it appears in the original captions settings menu and renders through YouTube's captions pipeline.
- Optionally requests a configured Whishper translation target and plays that translation instead of the original transcription.

## Development

```sh
npm install
npm run dev
```

Load the generated `.output/chrome-mv3` directory in a Chromium browser, or run `npm run dev:firefox` for Firefox.

## Settings

Open the extension options page to configure:

- Backend API host, default `http://localhost:8082`
- Language, default `auto`
- Subtitle target language, blank for original transcription or a LibreTranslate target such as `zh`, `fr`, `ja`
- Whisper model size, default `base`
- Device, default `cpu`
- Poll interval, default `5000`

The extension uses the backend implementation field name `sourceUrl` when creating transcription jobs.
