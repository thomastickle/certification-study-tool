import settings from './icons/settings.svg?raw'
import trash from './icons/trash.svg?raw'
import undo from './icons/undo.svg?raw'
import home from './icons/home.svg?raw'
import practice from './icons/practice.svg?raw'
import exam from './icons/exam.svg?raw'
import review from './icons/review.svg?raw'
import library from './icons/library.svg?raw'
import reports from './icons/reports.svg?raw'
import cloud from './icons/cloud.svg?raw'
import arrow from './icons/arrow.svg?raw'
import chevron from './icons/chevron.svg?raw'
import sidebar from './icons/sidebar.svg?raw'

const icons = {
  settings,
  trash,
  undo,
  home,
  practice,
  quiz: practice,
  exam,
  review,
  importer: library,
  reports,
  cloud,
  arrow,
  chevron,
  sidebar,
} as const

export type StudyIconName = keyof typeof icons

/** Render only trusted, bundled SVG assets inline so their strokes inherit the theme color. */
export function StudyIcon({ name }: { name: StudyIconName }) {
  return <span className="study-icon" dangerouslySetInnerHTML={{ __html: icons[name] }} />
}
