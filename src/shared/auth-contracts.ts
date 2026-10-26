export type StudyRole = 'admin' | 'student'

export type SessionUser = { id: string; name: string; role: StudyRole }

export type Session = { user: SessionUser | null }
