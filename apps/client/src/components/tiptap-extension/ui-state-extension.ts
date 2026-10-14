import { Extension } from "@tiptap/core"

export interface UiState {
  aiGenerationIsSelection: boolean
  aiGenerationIsLoading: boolean
  aiGenerationActive: boolean
  aiGenerationHasMessage: boolean
  commentInputVisible: boolean
  lockDragHandle: boolean
  isDragging: boolean
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    uiState: {
      aiGenerationSetIsSelection: (value: boolean) => ReturnType
      aiGenerationSetIsLoading: (value: boolean) => ReturnType
      aiGenerationShow: () => ReturnType
      aiGenerationHide: () => ReturnType
      aiGenerationHasMessage: (value: boolean) => ReturnType

      commentInputShow: () => ReturnType
      commentInputHide: () => ReturnType

      setLockDragHandle: (value: boolean) => ReturnType

      resetUiState: () => ReturnType
      setIsDragging: (value: boolean) => ReturnType
    }
  }

  interface Storage {
    uiState: UiState
  }
}

export const defaultUiState: UiState = {
  aiGenerationIsSelection: false,
  aiGenerationIsLoading: false,
  aiGenerationActive: false,
  aiGenerationHasMessage: false,
  commentInputVisible: false,
  lockDragHandle: false,
  isDragging: false,
} as const

export const UiState = Extension.create<UiState>({
  name: "uiState",

  addStorage() {
    return {
      uiState: { ...defaultUiState },
    }
  },

  addCommands() {
    /* storage 在 tiptap 侧是 any；在闭包里惰性取（onCreate 会整体替换 storage），并收敛成 UiState */
    const createBooleanSetter =
      (key: keyof UiState) => (value: boolean) => () => {
        const uiState = this.storage as UiState
        uiState[key] = value
        return true
      }

    const createToggle = (key: keyof UiState, value: boolean) => () => () => {
      const uiState = this.storage as UiState
      uiState[key] = value
      return true
    }

    return {
      // AI Generation commands
      aiGenerationSetIsSelection: createBooleanSetter(
        "aiGenerationIsSelection"
      ),
      aiGenerationSetIsLoading: createBooleanSetter("aiGenerationIsLoading"),
      aiGenerationHasMessage: createBooleanSetter("aiGenerationHasMessage"),
      aiGenerationShow: createToggle("aiGenerationActive", true),
      aiGenerationHide: createToggle("aiGenerationActive", false),

      // Comment input commands
      commentInputShow: createToggle("commentInputVisible", true),
      commentInputHide: createToggle("commentInputVisible", false),

      // Drag handle commands
      setLockDragHandle: createBooleanSetter("lockDragHandle"),
      setIsDragging: createBooleanSetter("isDragging"),

      // Reset command
      resetUiState: () => () => {
        Object.assign(this.storage, { ...defaultUiState })
        return true
      },
    }
  },

  onCreate() {
    this.storage = { ...defaultUiState }
  },
})
