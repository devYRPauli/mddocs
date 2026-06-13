import { spawn } from 'node:child_process'
import { platform } from 'node:os'

// Best-effort browser launch; failure is non-fatal (the URL is also printed).
// Skipped when MDDOCS_NO_OPEN is set (used in tests/headless runs).
export function openBrowser(url: string): void {
  if (process.env.MDDOCS_NO_OPEN) return
  const cmd = platform() === 'darwin' ? 'open' : platform() === 'win32' ? 'cmd' : 'xdg-open'
  const args = platform() === 'win32' ? ['/c', 'start', '', url] : [url]
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref()
  } catch {
    /* ignore - user can open the printed URL manually */
  }
}
