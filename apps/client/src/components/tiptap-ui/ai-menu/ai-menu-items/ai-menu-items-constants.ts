import type { Language } from "@tiptap-pro/extension-ai"
import { t } from '@/views/knowledge/locale.ts'

export const SUPPORTED_LANGUAGES: Array<{
  label: string
  value: Language
}> = [
  { label: t('EDITOR_LANG_EN'), value: 'en' },
  { label: t('EDITOR_LANG_KO'), value: 'ko' },
  { label: t('EDITOR_LANG_ZH'), value: 'zh' },
  { label: t('EDITOR_LANG_JA'), value: 'ja' },
  { label: t('EDITOR_LANG_ES'), value: 'es' },
  { label: t('EDITOR_LANG_RU'), value: 'ru' },
  { label: t('EDITOR_LANG_FR'), value: 'fr' },
  { label: t('EDITOR_LANG_PT'), value: 'pt' },
  { label: t('EDITOR_LANG_DE'), value: 'de' },
  { label: t('EDITOR_LANG_IT'), value: 'it' },
  { label: t('EDITOR_LANG_NL'), value: 'nl' },
  { label: t('EDITOR_LANG_ID'), value: 'id' },
  { label: t('EDITOR_LANG_VI'), value: 'vi' },
  { label: t('EDITOR_LANG_TR'), value: 'tr' },
  { label: t('EDITOR_LANG_AR'), value: 'ar' },
]

export const SUPPORTED_TONES: Array<{ label: string; value: string }> = [
  { label: t('EDITOR_TONE_ACADEMIC'), value: 'academic' },
  { label: t('EDITOR_TONE_BUSINESS'), value: 'business' },
  { label: t('EDITOR_TONE_CASUAL'), value: 'casual' },
  { label: t('EDITOR_TONE_CHILDFRIENDLY'), value: 'childfriendly' },
  { label: t('EDITOR_TONE_CONFIDENT'), value: 'confident' },
  { label: t('EDITOR_TONE_CONVERSATIONAL'), value: 'conversational' },
  { label: t('EDITOR_TONE_CREATIVE'), value: 'creative' },
  { label: t('EDITOR_TONE_EMOTIONAL'), value: 'emotional' },
  { label: t('EDITOR_TONE_EXCITED'), value: 'excited' },
  { label: t('EDITOR_TONE_FORMAL'), value: 'formal' },
  { label: t('EDITOR_TONE_FRIENDLY'), value: 'friendly' },
  { label: t('EDITOR_TONE_FUNNY'), value: 'funny' },
  { label: t('EDITOR_TONE_HUMOROUS'), value: 'humorous' },
  { label: t('EDITOR_TONE_INFORMATIVE'), value: 'informative' },
  { label: t('EDITOR_TONE_INSPIRATIONAL'), value: 'inspirational' },
  { label: t('EDITOR_TONE_MEMEIFY'), value: 'memeify' },
  { label: t('EDITOR_TONE_NARRATIVE'), value: 'narrative' },
  { label: t('EDITOR_TONE_OBJECTIVE'), value: 'objective' },
  { label: t('EDITOR_TONE_PERSUASIVE'), value: 'persuasive' },
  { label: t('EDITOR_TONE_POETIC'), value: 'poetic' },
]
