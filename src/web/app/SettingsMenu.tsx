import { useRef } from 'react'
import { StudyIcon } from '../shared/ui/StudyIcon.tsx'
import { ThemeControl } from './ThemeControl.tsx'

/** Open appearance settings without unmounting or navigating away from a study session. */
export function SettingsMenu() {
  const dialog = useRef<HTMLDialogElement>(null)

  return (
    <>
      <button
        className="settings-trigger"
        aria-label="Settings"
        aria-haspopup="dialog"
        title="Settings"
        onClick={() => dialog.current?.showModal()}
      >
        <StudyIcon name="settings" />
        <span>Settings</span>
      </button>
      <dialog ref={dialog} className="settings-dialog" aria-labelledby="settings-title">
        <div className="settings-heading">
          <h2 id="settings-title">Settings</h2>
          <button aria-label="Close settings" onClick={() => dialog.current?.close()}>
            Close
          </button>
        </div>
        <h3>Appearance</h3>
        <p>Choose a palette and use your system appearance or select light or dark mode.</p>
        <ThemeControl />
        <p>Your choices are saved in this browser.</p>
      </dialog>
    </>
  )
}
