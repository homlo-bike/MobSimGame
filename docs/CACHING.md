# Caching, connection status and application updates

## What is cached

| Layer | Used? | What |
| --- | --- | --- |
| Service worker / PWA plugin | **No** | MobSimGame registers no service worker. On start it **unregisters any service worker and deletes all Cache Storage** on its origin, because one left by an older deployment or by another app served on the same host and port (e.g. `localhost:8080`) can keep serving an old page while the server is down. |
| HTTP cache (nginx, port 8080) | Yes | `index.html` and `version.json`: `Cache-Control: no-cache` (always revalidated). `/assets/*`: hashed file names, `immutable`, one year. A new build changes every asset name, so obsolete assets are simply never requested again; nothing needs invalidating. |
| `localStorage` | Yes | The project library: `mobsimgame.projects.v1` (index, active project) and `mobsimgame.project.v1:<id>` (one per project). Edit tokens for shared projects. Projects stored by earlier versions under `mobsimgame.project.v1` are moved into the library on first load. |
| `sessionStorage` | Yes | Server login session, notification centre, update reload guard. Cleared when the tab closes. |
| IndexedDB | No | — |

## Connection status

The status pill in the footer shows one of: **Connected**, **Offline** (the browser
has no network), **Server unreachable** (no healthy answer from `/api/health` within
5 s), **Server problem** (the API answers but its database is unavailable),
**Updating**, or **Checking**. It is never "Connected" without a successful health
check. The editor keeps working in every state; projects autosave in the browser.

Checks run when the app starts, when the browser goes online, when the tab becomes
visible again and every 30 s while the tab is visible (hidden tabs do not poll).
Only changes of state are recorded in the notification centre, never each check.

`GET /api/health` (FastAPI) returns `{"status": "ok" | "degraded", "version", "database"}`.

## Detecting a new version

Each build gets a build id (`MOBSIM_BUILD_ID`, or the build time) that is compiled
into the app and written to `/version.json`. Together with every health check the
app fetches `/version.json` (no cache). A different build id means a newer
deployment: a banner offers **Update now**, **Save project file** and **Later**.

## Updating safely

1. Before reloading, the app checks for work that a reload could lose: a line being
   drawn, a field being edited, or a failing browser autosave. It lists these and
   asks to finish, save a file, or "Update anyway".
2. The project is saved to the browser library; if that fails, the update is refused
   and the user is asked to save a project file first.
3. Stale service workers and caches are removed, then the page reloads and reopens the
   same project.

**No reload loop:** before reloading, the tab records the target build id in
`sessionStorage`. If after the reload it still runs an older build (for example a
proxy or the browser keeps serving the old page), it does not reload again for that
build within 10 minutes; it explains how to force a reload (Ctrl+Shift+R). After a
successful update the record is cleared and a notification confirms the version.

## Notification centre

Toasts are also recorded in the 🔔 menu with severity, time, related object,
read state, dismiss, clear all and a severity filter. Identical notifications (same
severity, kind, title, message and object) are grouped with a count. The list is kept
for the browser session only (`sessionStorage`), up to 200 entries, and is never part
of the project.
