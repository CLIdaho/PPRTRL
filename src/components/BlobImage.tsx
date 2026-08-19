import { useEffect, useState } from 'react'
import { getBlob } from '../db/repo'

/**
 * Object URLs for stored blobs, created on mount and revoked on unmount so a
 * long scroll through a case does not leak memory.
 */
export function useBlobUrl(attachmentId: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!attachmentId) {
      setUrl(null)
      return
    }
    let revoked = false
    let created: string | null = null
    void getBlob(attachmentId).then((blob) => {
      if (!blob || revoked) return
      created = URL.createObjectURL(blob)
      setUrl(created)
    })
    return () => {
      revoked = true
      if (created) URL.revokeObjectURL(created)
      setUrl(null)
    }
  }, [attachmentId])

  return url
}

interface Props {
  attachmentId: string
  alt: string
  className?: string
}

export function BlobImage({ attachmentId, alt, className }: Props) {
  const url = useBlobUrl(attachmentId)
  if (!url) return <div className={className} aria-hidden="true" />
  return <img className={className} src={url} alt={alt} loading="lazy" />
}
