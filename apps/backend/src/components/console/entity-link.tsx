import { Link } from 'react-router-dom'

interface EntityLinkProps {
  to: string
  children: string
}

function EntityLink(props: EntityLinkProps) {
  return (
    <Link
      to={props.to}
      className="text-primary hover:underline"
      onClick={function (event) {
        event.stopPropagation()
      }}>
      {props.children}
    </Link>
  )
}

export { EntityLink }
