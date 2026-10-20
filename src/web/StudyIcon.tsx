const paths = {
  home: 'M3 10 12 3l9 7M5 9v12h5v-7h4v7h5V9',
  practice: 'M8 3h8l4 4v14H4V3h4m8 0v5h4M8 12h8M8 16h5',
  quiz: 'M8 3h8l4 4v14H4V3h4m8 0v5h4M8 12h8M8 16h5',
  exam: 'M9 4H5v17h14V4h-4M9 2h6v5H9zM8 12l2 2 5-5M8 18h8',
  review: 'M3 11a9 9 0 1 1 2.7 7M3 4v7h7M12 7v5l3 2',
  importer: 'M4 4h6l2 3h8v14H4zM12 11v6m-3-3 3 3 3-3',
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
