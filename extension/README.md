# Alongside Chrome extension

Load this directory unpacked in `chrome://extensions` with Developer mode enabled.
It defaults to the hosted Alongside demo. Enter your demo access code when asked.
For local development, set the app address to `http://127.0.0.1:5176`.

1. Open a YouTube video, GitHub PR, or article in Chrome.
2. Click the Alongside toolbar icon. That page connects automatically.
3. Ask in the sidebar, or choose **Open full board** for drawing space.

The chosen source tab stays bound while you use the board. Each question refreshes
its context. Changing the source URL requires clicking the toolbar icon again;
it never silently switches to another tab. Clicking again on the same page
reopens its lesson and Activity panel. Close Activity whenever you prefer.
Closing Chrome clears bindings; lessons remain saved.

YouTube: playback time, available transcript segments and nearby text. If captions
are unavailable, open YouTube's **Show transcript** panel and refresh context.
PRs: description and loaded diffs. Lazy-loaded/collapsed files are not a complete
repository review. Generic pages: title, selection and bounded main/article text.

The agent can use `page.snapshot()` and synchronous `page.evaluate(code)` through
its current shell/JS tools. Evaluation uses Chrome's debugger API with
`throwOnSideEffect`, not unrestricted evaluation. Chrome shows a debugging banner;
opening DevTools may conflict. Some read expressions are conservatively rejected.
No passwords, cookies or API keys are requested by the extraction code.

Page context is passed to the configured model and retained in the lesson's
conversation/activity. The page must be one you intend to share with that model.

Implementation references:
- https://developer.chrome.com/docs/extensions/reference/api/sidePanel
- https://developer.chrome.com/docs/extensions/reference/api/debugger

## Checks

`npm test` includes the long-transcript regression. `npm run test:extension`
checks the bridge with YouTube/PR fixtures and rejects side-effectful JS.
`RUN_PR_MODEL=1 npm run test:extension` checks a real public PR lesson.
`RUN_EXTENSION_MODEL=1 npm run test:extension` also sends a question through
the real configured model and verifies a saved drawing and answer.

The automated extension copy grants fixture hosts explicitly and submits with
DOM button activation. It does not verify the real toolbar permission gesture
or physical clicks in Chrome's side panel; test those after loading unpacked.

The partner board is the root app; `lesson` and `source` retain identity, while
`view=partner` is no longer needed. Drawing operations play as each SDK call
executes. Excalidraw Undo reverses a completed drawing contribution.
