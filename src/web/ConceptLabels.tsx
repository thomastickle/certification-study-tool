import type { QuizQuestion } from '../shared/quiz-contracts.ts'

/** Render only labels saved in this attempt, including after mappings change. */
export function ConceptLabels({ question }: { question: QuizQuestion }) {
  if (!question.concepts?.length) {
    return null
  }
  return (
    <div className="concept-labels">
      <p className="muted">
        Reviewed concepts: {question.concepts.map((concept) => concept.name).join('; ')}
      </p>
      {question.variationNote && <p className="muted">{question.variationNote}</p>}
    </div>
  )
}
