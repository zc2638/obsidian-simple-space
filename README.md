# Simple Space

A customizable workspace with quick capture, tasks, shortcuts, recent notes, and statistics. Arrange cards to keep everyday actions in one place, without a separate dashboard plugin or CSS snippet.

[简体中文](README.zh-CN.md) · [Build and release guide / 构建与发布](release.md)

Version **0.1.1** requires **Obsidian 1.8.7 or later**. Card labels and settings are currently mainly in Chinese; the instructions below explain the controls. Desktop and mobile interfaces are supported by the implementation, while device-specific microphone, media playback, and sync behavior still need testing on each platform.

## Installation

Before the plugin is listed in the community directory, build or obtain the local ZIP installer and extract its `simple-space` folder into `<vault>/.obsidian/plugins/`. The files `main.js`, `manifest.json`, and `styles.css` must sit directly inside that folder. Reload the app, then enable **Simple Space** in **Settings → Community plugins**.

Open the workspace using the Home icon in the left ribbon or the **Simple Space: 打开工作台** command. To update a manual installation, save current input, disable the plugin, replace the three runtime files, and enable it again. Keep `data.json`, your workspace configuration, notes, and attachments.

## Cards and layout

Use the plus icon in the workspace tab header to add a card. Each card has a settings gear. The pencil icon enables layout editing: drag cards to reorder them, resize with the corner handle, or use the card arrows and size settings. Narrow screens stack cards vertically. Multiple cards of the same type can have independent settings.

| Card | Features |
| --- | --- |
| Welcome / 欢迎卡片 | Greeting, clock, compact date display, calendar drawer, daily notes, and quotes. |
| Quick capture / 即时灵感 | Recent captures first; select **创建** to write text or add links, images, files, audio, video, and existing screen recordings. |
| Tasks / 待办任务 | Markdown tasks with text and media details. Disable **显示进行中状态** in card settings to use only To do and Done. Existing in-progress tasks remain visible under To do without rewriting the note. |
| Shortcuts / 快捷入口 | Configurable links to notes, websites, and supported app URLs. |
| Recent notes / 最近笔记 | Recent files with folder filters, exclusions, sorting, and a display limit. |
| Statistics / 统计卡片 | Optional note, tag, word, and attachment counts. |

Removing a card only removes its display. Associated notes and attachments remain in the vault. Save pending input or finish recording before changing a card source or removing it.

## Captures, tasks, and media

Both capture and task cards use a single file by default. Their default folders are `Simple Space/即时灵感` and `Simple Space/待办任务`. Choose a custom folder, including `.` for the vault root, in card settings. Missing folders are created when content is first saved.

Storage can be split by year, quarter, month, day, or kept in a single file. Optional size rollover defaults to 1024 KB of Markdown text; separate attachments do not count toward that limit. Attachments stay under the configured folder, grouped by the destination note name. A capture or task is kept intact when a new volume is needed.

Tasks use standard Markdown checkboxes. In-progress tasks use an additional `<!-- desk:doing -->` marker. Changing task status updates the original checkbox line while preserving details and attachment links.

Microphone access is requested when recording starts. You can also upload existing audio, video, and system screen recordings. The plugin does not directly record the screen. Pending text and media are backed up on the current device using IndexedDB, including recoverable recording chunks. This reduces loss after an unexpected close, but recovery depends on browser storage availability and successfully persisted chunks. Device drafts are not synced as vault files.

## Configuration and sync

New installations use `Simple Space/workspace.json` for layout and card settings. The plugin folder `data.json` keeps the device configuration-location cache. A different vault folder, including the root, can be selected in plugin settings. Existing configurations are checked before use; invalid files are not overwritten.

Sync the ordinary configuration file, notes, and attachments through your chosen vault sync service. Installing or updating the plugin runtime files is a separate step. Existing installations retain their explicitly selected storage mode. See the [Chinese guide](README.zh-CN.md) for detailed LiveSync setup and conflict handling.

## Vault access and privacy

The plugin enumerates vault file paths for features that need a file index. Recent notes filter and sort Markdown file metadata. Welcome and statistics cards count files; word statistics read Markdown content when that metric is enabled, and tag statistics use the metadata cache. Folder pickers and configuration discovery inspect folders and candidate `workspace.json` files. Capture and task cards select their configured source notes from the file index and read those notes.

This access is needed for the displayed features. The plugin does not send note contents, attachment contents, or file paths to an external service, and it has no analytics or telemetry. Processing and drafts stay in the vault or on the current device. Opening an external shortcut uses your normal browser or app; any sync service you configure handles its own transfers.

## License

MIT. The bundled lunar calendar library retains its own MIT notice in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
