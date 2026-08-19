import { Link } from 'react-router-dom'

export function NotFound() {
  return (
    <div className="empty">
      <h3>Nothing here</h3>
      <p>That page does not exist.</p>
      <Link className="btn" to="/">Back to the timeline</Link>
    </div>
  )
}
