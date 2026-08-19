import { useState, type ReactNode } from 'react'

interface Props {
  /** The question a first-time user would actually ask, in their words. */
  question: string
  children: ReactNode
  /** Open on first render — for screens where the concept is the whole point. */
  defaultOpen?: boolean
}

/**
 * A plain-language explainer that stays out of the way once understood.
 * Every screen has one, so "what is this?" always has an answer in reach.
 */
export function Explain({ question, children, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className={`explain${open ? ' open' : ''}`}>
      <button type="button" className="explain-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="explain-mark" aria-hidden="true">?</span>
        <span className="grow">{question}</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
             className="explain-chevron" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && <div className="explain-body">{children}</div>}
    </div>
  )
}

/** A short labelled definition, for spelling out one term at a time. */
export function Term({ word, children }: { word: string; children: ReactNode }) {
  return (
    <p className="explain-term">
      <strong>{word}</strong> {children}
    </p>
  )
}
