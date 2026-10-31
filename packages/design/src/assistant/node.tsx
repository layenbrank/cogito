import { Handle, Position } from '@xyflow/react'
import { cn } from 'cn'
import type { ComponentProps } from 'react'

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from '../components/card'

type NodeProps = ComponentProps<typeof Card> & {
  handles: {
    target: boolean
    source: boolean
  }
}

function Node({ handles, className, ...props }: NodeProps) {
  return (
    <Card
      data-slot="canvas-node"
      className={cn(
        'node-container relative size-full h-auto w-sm gap-0 rounded-md p-0',
        className
      )}
      {...props}>
      {handles.target ? (
        <Handle
          position={Position.Left}
          type="target"
        />
      ) : null}
      {handles.source ? (
        <Handle
          position={Position.Right}
          type="source"
        />
      ) : null}
      {props.children}
    </Card>
  )
}

type NodeHeaderProps = ComponentProps<typeof CardHeader>

function NodeHeader({ className, ...props }: NodeHeaderProps) {
  return (
    <CardHeader
      className={cn('gap-0.5 rounded-t-md border-b bg-secondary p-3!', className)}
      {...props}
    />
  )
}

type NodeTitleProps = ComponentProps<typeof CardTitle>

function NodeTitle(props: NodeTitleProps) {
  return <CardTitle {...props} />
}

type NodeDescriptionProps = ComponentProps<typeof CardDescription>

function NodeDescription(props: NodeDescriptionProps) {
  return <CardDescription {...props} />
}

type NodeActionProps = ComponentProps<typeof CardAction>

function NodeAction(props: NodeActionProps) {
  return <CardAction {...props} />
}

type NodeContentProps = ComponentProps<typeof CardContent>

function NodeContent({ className, ...props }: NodeContentProps) {
  return (
    <CardContent
      className={cn('p-3', className)}
      {...props}
    />
  )
}

type NodeFooterProps = ComponentProps<typeof CardFooter>

function NodeFooter({ className, ...props }: NodeFooterProps) {
  return (
    <CardFooter
      className={cn('bg-secondary rounded-b-md border-t p-3!', className)}
      {...props}
    />
  )
}

export {
  Node,
  NodeAction,
  NodeContent,
  NodeDescription,
  NodeFooter,
  NodeHeader,
  NodeTitle
}
export type { NodeProps }
