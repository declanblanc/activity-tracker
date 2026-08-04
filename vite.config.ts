import { execSync } from 'node:child_process'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * `<package version>+<short commit SHA>`, e.g. `0.1.0+a1b2c3d`. The SHA is what makes every
 * push to main a distinct version with no one having to remember to bump anything — the
 * semver stays for human-meaningful releases, the SHA moves on every commit. Falls back to
 * the bare package version when there is no git checkout (a source-tarball build).
 */
function appVersion(): string {
  const packageVersion = process.env.npm_package_version ?? '0.0.0'
  try {
    const sha = execSync('git rev-parse --short HEAD').toString().trim()
    return `${packageVersion}+${sha}`
  } catch {
    return packageVersion
  }
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // The shell is precached so the app opens with no network; all data already lives
    // in IndexedDB, so every screen works offline. A new version waits rather than
    // taking over mid-session — `components/UpdatePrompt.tsx` offers the reload.
    VitePWA({
      registerType: 'prompt',
      // Workbox's default glob has no `woff2`, so without this the webfont is the one
      // asset an offline launch has to go to the network for — and swaps to the system
      // stack when it cannot.
      workbox: { globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'] },
      // The manifest's own icons are precached automatically; these two are referenced
      // only from index.html and would otherwise be the one thing an offline launch
      // still went to the network for.
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Activity Tracker',
        short_name: 'Activities',
        description: 'Check off habits and time activities in one place.',
        display: 'standalone',
        start_url: '/',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        icons: [
          // One image per size, declared for both purposes: the glyph already sits
          // inside the centred 80% safe circle a maskable icon needs.
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
    }),
  ],
  // Bake the version in at build time so the Settings screen shows it and it can never drift
  // from the real build — see `appVersion`, which appends the commit SHA so every deploy differs.
  define: { __APP_VERSION__: JSON.stringify(appVersion()) },
  // Vite picks its own port when the default is taken, which loses whichever port the
  // surrounding tooling assigned. Honour `PORT` when it is set.
  server: { port: Number(process.env.PORT) || 5173 },
  test: {
    environment: 'node',
    // Every date assertion in this suite is about local time, and every DST rule differs
    // by zone. Pin one so the suite means the same thing everywhere it runs.
    env: { TZ: 'America/Los_Angeles' },
  },
})
