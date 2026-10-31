import { Source, Sources, SourcesContent, SourcesTrigger } from '@cogito/design/assistant/sources'

function SourcesBlock(props: { sources: readonly { title: string; href: string }[] }) {
  if (props.sources.length === 0) return null
  return (
    <Sources className="mb-0">
      <SourcesTrigger count={props.sources.length}>
        <p className="font-medium">引用 {props.sources.length} 个来源</p>
      </SourcesTrigger>
      <SourcesContent>
        {props.sources.map(function (source) {
          return (
            <Source
              key={source.href}
              href={source.href}
              title={source.title}
            />
          )
        })}
      </SourcesContent>
    </Sources>
  )
}

export { SourcesBlock }
