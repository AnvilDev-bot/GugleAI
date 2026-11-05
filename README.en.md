<div align="center">

<img src=".idea/icon.png" width="256" height="256" alt="Icon" />

# GugleAI

English | [简体中文](README.md)

</div>

GugleAI is a desktop and Android AI workspace built with Tauri 2, Vue 3, and TypeScript. It works with OpenAI-compatible
image and chat APIs, including compatible third-party relay services.

## Screenshots

|                   Image Generation                    |                           Text Chat                            |
|:-----------------------------------------------------:|:--------------------------------------------------------------:|
| ![GugleAI Image Generation workspace](docs/image.png) |         ![GugleAI Text Chat workspace](docs/chat.png)          |
|                  **Infinite Canvas**                  |                       **Model Settings**                       |
| ![GugleAI Infinite Canvas workspace](docs/canvas.png) |       ![GugleAI Model Settings](docs/model-setting.png)        |
|                  **Agent Settings**                   |                      **Backup Settings**                       |
|   ![GugleAI Agent Settings](docs/agent-setting.png)   | ![GugleAI Backup and WebDAV settings](docs/backup-setting.png) |

## Features

### Three workspaces

- **Image Generation**: generate images from prompts with model, size, count, and custom dimensions; add reference
  images with a file picker, drag and drop, or clipboard paste.
- **Text Chat**: use `/chat/completions` for persistent multi-conversation chats with create, rename, delete, clear, and
  message-copy actions; assistant messages show the actual model, and the first exchange can generate a title
  asynchronously.
- **Infinite Canvas**: create or open documents from a canvas library, connect text and image nodes, and pass upstream
  text and references into generation tasks; nodes, images, edges, and viewports are saved per canvas.

### Providers, models, and settings

- Maintain multiple providers in Model Settings. Each provider has its own name, API endpoint, optional image endpoint,
  API key, and model list. The image endpoint falls back to the API endpoint when left blank; leaving an unsaved provider
  prompts you to save, discard, or keep editing.
- Models support an ID, display name, description, image-model flag, and context length. Image Generation, Chat,
  conversation titles, and Canvas nodes select models grouped by provider.
- Press `Ctrl+V` in Image Generation to import a connection directly from newapi channel JSON
  (`_type: "newapi_channel_conn"`) or the `base_url` in a Codex CLI `config.toml`.
- Settings contains Model, Agent, General, Logs, and Backup pages. General Settings provides a user name,
  Light/Dark/Follow System themes, a title-generation model, and startup update checks.
- Narrow screens and Android avoid the top status bar and bottom system safe area while using bottom workspace navigation. Settings uses category,
  provider, and detail levels. Chat moves conversations into a slide-out drawer and places agent/model controls in an
  advanced panel that opens over the message area. Image Generation pins references, prompt, and generation actions to
  the bottom while model, size, and count open upward over the preview. The Canvas library scrolls independently, while
  the editor runs full screen with floating back/title controls at the top left and a circular action menu at the top right.
- Agent Settings lets you edit the default assistant, add or remove chat agents, and change the Infinite Canvas
  prompt-generation rule. System prompts support `{{date}}`, `{{time}}`, `{{datetime}}`, `{{system}}`, `{{arch}}`,
  `{{language}}`, `{{model_name}}`, and `{{username}}` variables.

### Generation control and results

- Advanced Settings provides Auto, Images API, and Chat API modes. In Auto mode, requests with multiple reference images
  use Chat API to work with relays whose `edits` endpoint only accepts one image.
- Stop a generation task at any time; the app cancels the request, retry delay, and result download.
- Preview history stores generated images and prompts and restores them after restart. Results can be enlarged, copied
  as an image or prompt, reused as a reference, saved, deleted, or cleared.
- Result parsing supports `b64_json`, absolute or relative image URLs, image URLs in Chat messages, and embedded base64
  data.
- For any image model, Advanced Settings can switch from default still images to
  GIF (`output_format: "gif"`). `frame_count` accepts integers from 2–64 (default 9); `frame_duration_ms` accepts
  integers from 20–2000 milliseconds (default 200). Settings survive restarts and also apply to Canvas generation
  nodes. Images, Edits, and Chat requests include these parameters when GIF is enabled. Otherwise,
  `output_format`, `frame_count`, and `frame_duration_ms` are omitted entirely. Upstream services determine GIF support.
  Preview, history, and saving preserve animation. The copy button and app context menus copy original GIF bytes,
  using the standard GIF clipboard type when supported, or Chromium web custom formats for compatible receiving apps.
  Unsupported environments show an error instead of silently flattening the animation. Choose “Copy static frame”
  explicitly for PNG, or save the GIF file to preserve animation. Animated paste depends on the receiving app.
- Automatic retries are disabled by default and apply only to generation requests. The default status code is `[504]`
  with up to 5 retries; the Advanced Settings page lets you select or add status codes from 100–599.

### Infinite Canvas details

- The canvas library supports creating, opening, renaming, and confirmed deletion of documents.
- Manually added text or image nodes are placed at the center of the current viewport. Text nodes can generate text
  children. Image nodes can add or replace references and choose auto, preset, or custom dimensions per generation node;
  generation reads only directly connected upstream nodes.
- Manual and automatic edges use different styles, and manual edges can be disconnected with a double-click. Node images
  provide actions to copy prompts or images and save files.
- New canvases open at 60% zoom, and the current viewport and document contents are continuously persisted.

### Logs, backups, and proxy support

- Diagnostic logs record task IDs, stages, durations, request-body sizes, proxy state, and redacted error details. Logs
  rotate at application startup or when the active file exceeds 100 KB.
- Local backups package settings, agents, conversations, preview history, and canvas images into ZIP files. Manual
  backups, scheduled backups, import, export, and deletion are supported; importing replaces the corresponding local
  data and reloads the app.
- WebDAV supports connection tests, uploading local backups, listing or downloading remote backups, and restoring
  directly from a remote ZIP. Local and WebDAV automatic backups have independent enablement, interval, and retention
  settings, and each policy prunes only its own automatic backups.
- All network requests pass through the Tauri HTTP wrapper and use the system proxy. Logs hide API keys, Authorization
  headers, passwords, tokens, query parameters, and long base64 data.

## API compatibility

- If a provider endpoint has no version path, the app appends `/v1`; existing paths such as `/v1` and `/v2`, including
  third-party relay paths, are preserved.
- A provider can use a separate image endpoint. Image Generation and Canvas image nodes send Images, Edits, and image
  generation requests made through Chat mode, plus relative result downloads, to that endpoint; a blank value falls back
  to the provider API endpoint. Text Chat and conversation titles continue to use the provider API endpoint.
- Images mode without references calls `/images/generations`.
- Images mode with references calls `/images/edits`.
- Chat mode calls `/chat/completions` and extracts results from text, image URLs, or embedded base64 data.
- Relative image URLs are resolved against the provider endpoint; absolute URLs are also supported.
- Update checks and result downloads do not use the automatic retry mechanism for generation requests.

## Quick start

### Prerequisites

- [Node.js 20.19 or newer](https://nodejs.org/)
- [pnpm](https://pnpm.io/)
- [Rust](https://www.rust-lang.org/)
- Android builds also require JDK 17, the Android SDK and NDK, and the `aarch64-linux-android` Rust target

The project uses `pnpm` for frontend dependencies and Cargo for Rust dependencies. Do not mix npm, Yarn, or other lock
files.

### Install and run

```bash
# Install dependencies
pnpm install

# Run GIF configuration and request regression tests
pnpm test

# Start the Tauri desktop development app
pnpm tauri dev

# Type-check and build the frontend
pnpm build

# Build desktop installers
pnpm tauri build

# Initialize the Android project once
pnpm tauri android init

# Build the Android arm64 APK
pnpm tauri android build --target aarch64 --apk
```

The Android release job signs APKs with the `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS`, and `ANDROID_KEY_PASSWORD` GitHub Actions Secrets. If the complete signing configuration is not
available, desktop releases continue while the Android build and upload are skipped.

On first launch, open **Settings → Model Settings**, add a provider with its endpoint and API key, then add or edit its
models.

## Typical workflow

1. Add a provider and save its model list. A bare domain is accepted; the app adds the API version path when needed.
2. Select a provider-grouped model in Image Generation, Chat, or Infinite Canvas.
3. Expand Advanced Settings to choose the image API mode and retry rules. Use `Ctrl+Enter` to submit an image prompt or
   chat message.
4. Manage conversations and agents in Chat; in Infinite Canvas, create nodes, connect upstream content, and generate
   text or images independently.
5. Use the preview context menu to copy, reuse, save, or delete results. Export a ZIP or use WebDAV from Backup Settings
   when moving data to another installation.

## Project structure

```text
src/
├─ views/                    # Image, Chat, Canvas, and Settings pages
├─ router/                   # Vue Router hash-history routes
├─ composables/controller/   # Dependency composition and shared view model
├─ composables/fetch/        # Tauri HTTP wrapper and system-proxy handling
├─ composables/workspace/    # Image, Chat, and Canvas workspace state
├─ composables/settings/     # Provider, generation, app, and agent settings
├─ services/transport/       # Images, Edits, Chat requests, and parsing
├─ services/history/         # IndexedDB preview history
├─ services/canvas-storage/  # IndexedDB canvas documents
├─ services/backup/          # ZIP backup and restore
├─ domain/                   # Shared models, defaults, and normalization
├─ api/, chat/, canvas/       # API, conversation, and canvas domain objects
└─ styles/                   # App, settings, and workspace styles
src-tauri/
├─ src/lib.rs                # File saving, log rotation, and proxy commands
├─ capabilities/             # Minimal Tauri permissions
├─ icons/android/            # Android launcher icon sources
├─ tauri.android.conf.json   # Android pre-build icon synchronization
└─ tauri.conf.json           # App and build configuration
```

`src/App.vue` contains the application shell, router outlet, and global overlays. Page components live in `src/views/`,
and all network requests go through `src/composables/fetch/index.ts`.

## Data and security

- Providers, models, generation options, theme, agents, and conversations are stored locally. Preview history, canvas
  documents, and backups use IndexedDB.
- Backup archives may contain API keys, WebDAV usernames, and passwords. Treat backup files as credentials and protect
  them accordingly.
- Diagnostic logs do not record complete Authorization headers, API keys, or long base64 payloads; still review service
  addresses and error details before sharing logs.

## Download

Download installers from the [Releases](../../releases) page. Release builds support Windows (x86, x86_64, arm64),
Linux (x86_64, arm64), macOS (Intel, Apple Silicon), and Android (arm64 APK). Release notes automatically collect
Git commit subjects in their original language, excluding merge commits, under bilingual headings with a full
comparison link and platform download table. There are no manually maintained changelog files.
`<version>+build.N` builds compare against the highest earlier build or stable tag reachable from the target commit;
a stable tag ranks after builds of the same base version and is not their baseline. Stable releases compare only against an earlier stable version. When no baseline exists, all history through the
target commit is listed. Reruns use the fixed target commit and do not include changes from future versions.

## License

This project is licensed under the [GNU Lesser General Public License v3.0](LICENSE).
