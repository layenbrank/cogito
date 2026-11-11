/**
 * 设置 · 模型：对齐 Qoder — 扁平行列表 +「更新 API Key」对话框。
 */
import { CursorCliStatusSection } from '@/views/agent/settings/sections/cursor-cli-status'
import { ModelEditorDialog } from '@/views/agent/settings/sections/model-editor-dialog'
import { ModelHeader } from '@/views/agent/settings/sections/model-header'
import { ModelTuningSection } from '@/views/agent/settings/sections/model-tuning-section'
import { PlatformModelsSection } from '@/views/agent/settings/sections/model-platform-section'
import { ProviderListSection } from '@/views/agent/settings/sections/model-provider-list-section'
import { useModelInventory } from '@/views/agent/settings/sections/use-model-inventory'

function ModelSection() {
  const inventory = useModelInventory()

  return (
    <div className="flex flex-col gap-5">
      <ModelHeader onAdd={inventory.handleOpenAdd} />

      <ModelTuningSection onModelChange={inventory.handleModelChange} />

      <PlatformModelsSection
        loading={inventory.loading}
        provider={inventory.platformProvider}
        onModelChange={inventory.handleModelChange}
      />

      <ProviderListSection
        loading={inventory.loading}
        configured={inventory.configured}
        storeProviders={inventory.storeProviders}
        probeStatus={inventory.probeStatus}
        onModelChange={inventory.handleModelChange}
        onOpenUpdate={inventory.handleOpenUpdate}
      />

      <CursorCliStatusSection />

      <ModelEditorDialog
        open={inventory.isDialogOpen}
        mode={inventory.editorMode ?? 'update'}
        active={inventory.active}
        addable={inventory.addable}
        pickedAddId={inventory.pickedAddId}
        formValues={inventory.formValues}
        saving={inventory.saving}
        thinking={inventory.editorThinking}
        onThinkingChange={inventory.patchThinking}
        onClose={inventory.closeEditor}
        onPickedAddId={inventory.handlePickedAddId}
        onFieldChange={inventory.patchField}
        onSave={function () {
          void inventory.handleSave()
        }}
      />
    </div>
  )
}

export { ModelSection }
