import { BarChart3, CalendarDays, LayoutGrid, Settings2 } from 'lucide-react'
import { lazy, Suspense, type ComponentType, type ReactElement } from 'react'
import { NavLink, Route, Routes } from 'react-router'
import ForgottenPrompt from './components/ForgottenPrompt.tsx'
import UpdatePrompt from './components/UpdatePrompt.tsx'
import Activities from './screens/Activities.tsx'
import Settings from './screens/Settings.tsx'
import Today from './screens/Today.tsx'

/**
 * The one lazily loaded screen. Recharts is 450 kB of a 740 kB precache, for one bar chart on
 * one screen — so the install cost and the cold start of every other screen were paying for a
 * chart most sessions never open.
 */
const Insights = lazy(() => import('./screens/Insights.tsx'))

/**
 * The four screens, in tab order. One list drives both the routes and the nav.
 *
 * Home is "Activities" rather than "Tracker": it holds everything now, checked off or timed, so
 * naming it after the timer half would be a lie about two thirds of the cards on it.
 *
 * `Today` is about intervals and so shows only timed activities. It keeps its tab regardless:
 * filtering the list on "does a timed activity exist" would change the tab bar's column count as
 * data changed, moving every tab under the thumb. It carries an empty state that says what it
 * draws and points back here.
 *
 * There is no Log tab. A per-activity history reads better inside that activity's own sheet, and a
 * fourth screen listing the same entries a fifth way was not worth a tab.
 */
const SCREENS: {
  path: string
  label: string
  Icon: ComponentType<{ className?: string }>
  element?: ReactElement
}[] = [
  { path: '/', label: 'Activities', Icon: LayoutGrid, element: <Activities /> },
  { path: '/today', label: 'Today', Icon: CalendarDays, element: <Today /> },
  { path: '/insights', label: 'Insights', Icon: BarChart3, element: <Insights /> },
  { path: '/settings', label: 'Settings', Icon: Settings2, element: <Settings /> },
]

/**
 * Phone and desktop differ only in where the navigation sits: a thumb-reachable bar pinned to
 * the bottom edge, or a sidebar down the left. Exactly one of the two is rendered at any width —
 * `display: none` keeps the other out of the accessibility tree as well as off the screen, so
 * nothing is announced twice.
 *
 * The sidebar wins over a top bar because the tallest screen in the app is the Today timeline,
 * which is a full day drawn downwards. Vertical space is the scarce resource on a laptop;
 * horizontal space is the surplus one.
 */
export default function App() {
  return (
    // `h-dvh` and not `min-h-dvh`: a percentage height inside a flex item only resolves when the
    // item's own height is definite, and `min-height` does not make it so. Today's timeline asks for
    // exactly the space left over, and under `min-h-dvh` it silently collapsed to its floor instead.
    // The trade is that scrolling moves from the document into `<main>`, which is the app-shell
    // arrangement anyway — the tab bar and the toasts are fixed, so nothing else notices.
    <div className="flex h-dvh flex-col overflow-hidden bg-canvas md:flex-row">
      <Sidebar />
      {/* `min-w-0` so a wide child (the trend chart) cannot push the flex row past the viewport
          instead of shrinking. `clear-nav` leaves room for the bottom bar and the home indicator
          beneath it, and collapses at `md` where neither exists. */}
      <main className="clear-nav min-w-0 flex-1 overflow-y-auto">
        {/* No fallback content: the chunk is served from the same cache as the shell, so the
            wait is a frame or two, and a spinner that flashes is worse than nothing. */}
        <Suspense fallback={null}>
          <Routes>
            {SCREENS.map(({ path, element }) => (
              <Route key={path} path={path} element={element} />
            ))}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </main>
      <BottomBar />
      {/* Mounted here, not on a screen: a forgotten timer is worth raising whichever screen the
          app happens to open on. */}
      <ForgottenPrompt />
      <UpdatePrompt />
    </div>
  )
}

function NotFound() {
  return (
    <section className="screen-pad mx-auto w-full max-w-3xl">
      <h1 className="text-xl font-semibold text-ink">Not found</h1>
      <p className="mt-2 text-sm text-ink-muted">
        That page does not exist. Everything lives behind the four tabs.
      </p>
    </section>
  )
}

/** Desktop navigation: icon and label, pinned beside the content for the whole scroll. */
function Sidebar() {
  return (
    <nav
      aria-label="Main"
      className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col gap-1 border-r border-line bg-surface p-3 md:flex"
    >
      <p className="px-3 pt-2 pb-4 text-sm font-semibold tracking-wide text-ink-muted uppercase">
        Activity Tracker
      </p>
      {SCREENS.map(({ path, label, Icon }) => (
        <NavLink
          key={path}
          to={path}
          end
          className={({ isActive }) =>
            `focus-ring flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              isActive
                ? 'bg-raised text-accent-ink'
                : 'text-ink-muted hover:bg-raised/50 hover:text-ink'
            }`
          }
        >
          <Icon className="size-5 shrink-0" />
          {label}
        </NavLink>
      ))}
    </nav>
  )
}

/**
 * Phone navigation: four tabs across the bottom edge, above the home indicator.
 *
 * The labels are visible rather than `aria-label`-only. The icons alone left several of the
 * destinations as guesswork. The visible text is also the accessible name now, so there are no
 * longer two of those to keep in agreement.
 */
function BottomBar() {
  return (
    <nav
      aria-label="Main"
      // `z-20` above any sticky heading a screen of its own sets at `z-10`, which would otherwise
      // scroll out over the top of the tab bar.
      className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t border-line bg-surface md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {SCREENS.map(({ path, label, Icon }) => (
        <NavLink
          key={path}
          to={path}
          end
          className={({ isActive }) =>
            `focus-ring flex h-16 flex-col items-center justify-center gap-1 ${
              isActive ? 'text-accent-ink' : 'text-ink-muted'
            }`
          }
        >
          <Icon className="size-5 shrink-0" aria-hidden />
          <span className="text-2xs leading-none font-medium">{label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
