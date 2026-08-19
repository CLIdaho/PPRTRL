import { useRef, useState } from 'react'
import { PaperclipIcon } from './icons'

interface Props {
  onFiles: (files: File[]) => void
  label?: string
}

/**
 * Accepts anything: photos, video, audio, PDFs, documents, archives. Evidence
 * arrives in whatever format it arrives in, so nothing is filtered out here.
 */
export function FilePicker({ onFiles, label = 'Attach files' }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)

  const take = (list: FileList | null) => {
    const files = [...(list ?? [])]
    if (files.length) onFiles(files)
  }

  return (
    <div
      className={`dropzone${over ? ' over' : ''}`}
      onClick={() => input.current?.click()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          input.current?.click()
        }
      }}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        take(e.dataTransfer.files)
      }}
      role="button"
      tabIndex={0}
    >
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          take(e.target.files)
          e.target.value = ''
        }}
      />
      <div className="row" style={{ justifyContent: 'center', gap: 8 }}>
        <PaperclipIcon />
        <span style={{ fontWeight: 540 }}>{label}</span>
      </div>
      <p className="tiny faint" style={{ marginTop: 5 }}>
        Photos, video, audio, PDFs, documents — anything. Hashed on the way in.
      </p>
    </div>
  )
}
