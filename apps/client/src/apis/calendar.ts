/**
 * 日历（`calendar:*`）、提醒（`reminder:*`）、倒计时（`countdown:*`）接口。
 */
import { invoke } from '@tauri-apps/api/core'

import { CHANNELS } from '@/shared/ipc/channels'


// ------------------------------------------------------------ 日历

function GET_CALENDAR_EVENTS<T>(params: unknown = {}): Promise<T> {
  return invoke<T>(CHANNELS.CALENDAR.READ, { params })
}

function POST_CALENDAR_EVENTS<T = string[]>(params: unknown): Promise<T> {
  return invoke<T>(CHANNELS.CALENDAR.WRITE, { params })
}

function PATCH_CALENDAR_EVENTS<T = void>(params: unknown): Promise<T> {
  return invoke<T>(CHANNELS.CALENDAR.UPDATE, { params })
}

function DELETE_CALENDAR_EVENTS<T = void>(params: unknown): Promise<T> {
  return invoke<T>(CHANNELS.CALENDAR.REMOVE, { params })
}

// ------------------------------------------------------------ 提醒

function GET_REMINDERS<T>(params: unknown = {}): Promise<T> {
  return invoke<T>(CHANNELS.REMINDER.READ, { params })
}

function POST_REMINDERS<T = string[]>(params: unknown): Promise<T> {
  return invoke<T>(CHANNELS.REMINDER.WRITE, { params })
}

function PATCH_REMINDERS<T = void>(params: unknown): Promise<T> {
  return invoke<T>(CHANNELS.REMINDER.UPDATE, { params })
}

function DELETE_REMINDERS<T = void>(params: unknown): Promise<T> {
  return invoke<T>(CHANNELS.REMINDER.REMOVE, { params })
}

// ------------------------------------------------------------ 倒计时

function GET_COUNTDOWN<T>(): Promise<T> {
  return invoke<T>(CHANNELS.COUNTDOWN.READ)
}

function PATCH_COUNTDOWN<T = void>(params: unknown): Promise<T> {
  return invoke<T>(CHANNELS.COUNTDOWN.UPDATE, { params })
}

export {
  DELETE_CALENDAR_EVENTS,
  DELETE_REMINDERS,
  GET_CALENDAR_EVENTS,
  GET_COUNTDOWN,
  GET_REMINDERS,
  PATCH_CALENDAR_EVENTS,
  PATCH_COUNTDOWN,
  PATCH_REMINDERS,
  POST_CALENDAR_EVENTS,
  POST_REMINDERS
}