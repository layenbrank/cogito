import {
  Commit,
  CommitContent,
  CommitFile,
  CommitFilePath,
  CommitFileStatus,
  CommitFiles,
  CommitHash,
  CommitHeader,
  CommitMessage
} from '@cogito/design/assistant/commit'
import {
  EnvironmentVariable,
  EnvironmentVariables,
  EnvironmentVariablesContent,
  EnvironmentVariablesHeader,
  EnvironmentVariablesTitle
} from '@cogito/design/assistant/environment-variables'
import { FileTree, FileTreeFile, FileTreeFolder } from '@cogito/design/assistant/file-tree'
import { PackageInfo } from '@cogito/design/assistant/package-info'
import { SchemaDisplay } from '@cogito/design/assistant/schema-display'
import { Snippet } from '@cogito/design/assistant/snippet'
import { StackTrace } from '@cogito/design/assistant/stack-trace'
import { TestResults, TestResultsProgress } from '@cogito/design/assistant/test-results'

import type { ParsedToolSpecial } from '@/views/agent/chat/components/parse-tool-result'

function SpecialToolBody(props: { special: ParsedToolSpecial }) {
  switch (props.special.kind) {
    case 'commit':
      return (
        <Commit defaultOpen>
          <CommitHeader>
            <CommitHash>{props.special.data.hash}</CommitHash>
            <CommitMessage>{props.special.data.message}</CommitMessage>
          </CommitHeader>
          <CommitContent>
            <CommitFiles>
              {props.special.data.files.map(function (file) {
                return (
                  <CommitFile key={file.path}>
                    <CommitFileStatus status={file.status} />
                    <CommitFilePath>{file.path}</CommitFilePath>
                  </CommitFile>
                )
              })}
            </CommitFiles>
          </CommitContent>
        </Commit>
      )
    case 'test':
      return (
        <TestResults summary={props.special.data}>
          <TestResultsProgress />
        </TestResults>
      )
    case 'stack':
      return (
        <StackTrace
          trace={props.special.data}
          defaultOpen
        />
      )
    case 'package':
      return (
        <PackageInfo
          name={props.special.data.name ?? 'package'}
          currentVersion={props.special.data.currentVersion}
          newVersion={props.special.data.newVersion}
          changeType={props.special.data.changeType}
        />
      )
    case 'env':
      return (
        <EnvironmentVariables>
          <EnvironmentVariablesHeader>
            <EnvironmentVariablesTitle>环境变量</EnvironmentVariablesTitle>
          </EnvironmentVariablesHeader>
          <EnvironmentVariablesContent>
            {props.special.data.map(function (entry) {
              return (
                <EnvironmentVariable
                  key={entry.name}
                  name={entry.name}
                  value={entry.value}
                />
              )
            })}
          </EnvironmentVariablesContent>
        </EnvironmentVariables>
      )
    case 'schema':
      return (
        <SchemaDisplay
          method={props.special.data.method}
          path={props.special.data.path}
          description={props.special.data.description}
          parameters={
            props.special.data.parameters ? [...props.special.data.parameters] : undefined
          }
        />
      )
    case 'snippet':
      return <Snippet code={props.special.data} />
    case 'tree':
      return (
        <FileTree className="my-0">
          {props.special.data.map(function (node) {
            if (node.isDirectory) {
              return (
                <FileTreeFolder
                  key={node.path}
                  path={node.path}
                  name={node.path}>
                  {null}
                </FileTreeFolder>
              )
            }
            return (
              <FileTreeFile
                key={node.path}
                path={node.path}
                name={node.path}
              />
            )
          })}
        </FileTree>
      )
    default:
      return null
  }
}

export { SpecialToolBody }
