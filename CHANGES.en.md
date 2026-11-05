# Changelog

Release headings use the base semantic version; `+build.N` is a build identifier, so multiple builds of the same base version are combined.

## [1.1.1] - 2026-07-18

- Added GIF generation options for any image model, with configurable frame count and duration across Images, Edits, Chat, and Infinite Canvas, plus persisted settings.
- GIF previews, history, and saved files preserve animation; clipboard actions prefer original GIF data, explain unsupported formats, and offer a separate static-frame copy option.
- Added PR checks for frontend regression tests, type checking, builds, and Linux Rust targets; fixed Android release setup failing when it tried to install the removed `tools` SDK package.
- Fixed insufficient top status-bar spacing on Android and narrow screens.
- Fixed scrolling in the mobile Infinite Canvas library.
- Manually added Infinite Canvas nodes are now placed at the center of the current viewport.
- Release workflows now generate bilingual notes, a full changelog comparison link, and the download table from the changelog files.

## [1.1.0] - 2026-07-18

- Added responsive layouts for narrow screens and Android, including bottom workspace navigation, hierarchical settings, a slide-out Chat conversation list, mobile Image controls, and a full-screen Infinite Canvas.
- Improved scrolling in the mobile Image advanced panel and removed duplicate model, size, and count controls from the bottom dock.
- Refined the mobile Chat and Infinite Canvas title bars and fixed Android launcher icon synchronization.
- Added an Android arm64 APK release build with GitHub Secrets signing and upload to the matching Release.

## [1.0.1] - 2026-07-18

- Corrected the name of the recommended AI service provider

## [1.0.0] - 2026-07-18

- Added Image Generation, Text Chat, and Infinite Canvas workspaces, with the application shell, settings page, and nested settings pages split into router views.
- Reworked provider and model management with dedicated editing, model metadata, provider-grouped selection, and unsaved-change prompts.
- Added general settings, theme switching, agent management, and prompt variables; Chat now supports persistent conversations, agent switching, and title generation.
- Added the Infinite Canvas library, persistent nodes and documents, reference-image generation, and canvas document management, while improving reference-image node behavior.
- Added custom image dimensions, improved model selection, and refined the image-generation layout.
- Added log rotation and backup/restore for settings, agents, conversations, preview history, and canvas images, including scheduled backups and WebDAV support.

## [0.11.0] - 2026-07-17

- Added enlarged image preview.
- Added copying images to the clipboard.

## [0.10.0] - 2026-07-17

- Added the ability to use a preview image as a reference image.

## [0.9.0] - 2026-07-16

- Added preview history with image and prompt restoration after restart.
- Refactored image storage to support preview history.

## [0.8.0] - 2026-07-16

- Added the ability to stop an active generation task.

## [0.7.0] - 2026-07-16

- Added connection configuration management.

## [0.6.1] - 2026-07-15

- Added sensitive-data redaction and diagnostic logging for troubleshooting requests.

## [0.6.0] - 2026-07-14

- Reworked the model selector and retry-status-code configuration UI.

## [0.5.0] - 2026-07-14

- Added automatic retries for generation requests and related configuration options.

## [0.4.0] - 2026-07-07

- Added system-proxy support for network requests.

## [0.3.0] - 2026-07-03

- Added Chat API mode and connection-configuration import.
- Added application logging and automatic update checks.

## [0.2.0] - 2026-07-03

- Added drag-and-drop and paste import for images.
- Improved build dependencies and the release workflow.
