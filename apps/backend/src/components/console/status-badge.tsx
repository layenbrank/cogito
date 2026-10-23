import { Badge } from '@cogito/design/components/badge'

function StatusBadge(props: { status: string }) {
  const status = props.status.toUpperCase()
  const variant =
    status === 'ACTIVE' || status === 'OK' || status === 'DONE' || status === 'SUCCESS'
      ? 'success'
      : status === 'DISABLED' || status === 'FAILED' || status === 'ERROR'
        ? 'destructive'
        : 'secondary'

  return (
    <Badge
      variant={variant}
      className="font-mono text-[10px] tracking-wide uppercase">
      {props.status}
    </Badge>
  )
}

export { StatusBadge }
