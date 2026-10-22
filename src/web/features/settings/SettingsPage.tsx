import { ThemeControl } from '../../app/ThemeControl.tsx'
import type { ThemeControlProps } from '../../app/ThemeControl.tsx'
import './settings.css'

/** Group workspace configuration by purpose, starting with browser-local appearance. */
export function SettingsPage({ appearance }: { appearance: ThemeControlProps }) {
  return (
    <main className="settings-page">
      <div className="page-heading">
        <div>
          <h1>Settings</h1>
          <p className="intro">Make this workspace your own.</p>
        </div>
      </div>
      <section className="settings-section" aria-labelledby="appearance-title">
        <h2 id="appearance-title">Appearance</h2>
        <p>Choose a palette and use your system appearance or select light or dark mode.</p>
        <ThemeControl {...appearance} />
        <p className="settings-note">Your choices are saved in this browser.</p>
      </section>
    </main>
  )
}
