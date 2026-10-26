/**
 * 指令草稿（directive_draft 表）IPC 契约。
 *
 * 与 corex 指令库分离：这里只存「待确认草稿」，确认后才经 `sidecar:saveDirective` 落 corex.db。
 */
import { z } from 'zod'

const DirectiveDraftSchema = z.object({
  id: z.string(),
  threadID: z.string().nullish(),
  workspaceID: z.string().nullish(),
  name: z.string(),
  definition: z.string(),
  status: z.string(),
  error: z.string().nullish(),
  createdAt: z.number(),
  updatedAt: z.number()
})

const DraftSaveSchema = z.object({
  id: z.string().optional(),
  threadID: z.string().nullish(),
  workspaceID: z.string().nullish(),
  name: z.string().min(1),
  definition: z.string().min(1)
})

const DraftStatusSchema = z.object({
  id: z.string().min(1),
  status: z.enum(['pending', 'saved', 'discarded']),
  error: z.string().nullish()
})

type DirectiveDraft = z.infer<typeof DirectiveDraftSchema>
type DraftSave = z.infer<typeof DraftSaveSchema>
type DraftStatus = z.infer<typeof DraftStatusSchema>

export { DirectiveDraftSchema, DraftSaveSchema, DraftStatusSchema }
export type { DirectiveDraft, DraftSave, DraftStatus }
