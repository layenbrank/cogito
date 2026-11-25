import { useSearchParams } from 'react-router-dom'

function useQueryText() {
  const [params, writeParams] = useSearchParams()
  const query = params.get('q') ?? ''

  function writeQuery(value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set('q', value)
    else next.delete('q')
    writeParams(next, { replace: true })
  }

  return { query, writeQuery, params, writeParams }
}

export { useQueryText }
