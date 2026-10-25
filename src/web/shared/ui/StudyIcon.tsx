const paths = {
  settings:
    'M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7',
  undo: 'M9 4 3 10l6 6M3 10h11a7 7 0 0 1 7 7v3',
  home: 'M3 10 12 3l9 7M5 9v12h5v-7h4v7h5V9',
  practice: 'M8 3h8l4 4v14H4V3h4m8 0v5h4M8 12h8M8 16h5',
  quiz: 'M8 3h8l4 4v14H4V3h4m8 0v5h4M8 12h8M8 16h5',
  exam: 'M9 4H5v17h14V4h-4M9 2h6v5H9zM8 12l2 2 5-5M8 18h8',
  review: 'M3 11a9 9 0 1 1 2.7 7M3 4v7h7M12 7v5l3 2',
  importer: 'M3 4h5v16H3zM8 6h5v14H8zM14 5l4-1 4 15-4 1zM3 8h5M8 10h5m3-1 4-1',
  reports: 'M4 3v18h17M9 16v-4m5 4V8m5 8V5',
  cloud: 'M7 18a5 5 0 1 1 .6-10A6 6 0 0 1 19 10a4 4 0 0 1-1 8H7',
  arrow: 'M5 12h14m-5-5 5 5-5 5',
  chevron: 'm14 7-5 5 5 5',
  sidebar: 'M3 4h18v16H3zM9 4v16m7-11-3 3 3 3',
} as const

export type StudyIconName = keyof typeof paths

/** Use a consistent, decorative icon set without adding an external asset dependency. */
export function StudyIcon({ name }: { name: StudyIconName }) {
  return (
    <svg
      className="study-icon"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={paths[name]} />
    </svg>
  )
}
