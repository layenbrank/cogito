import { handleMessage } from '@/features/relay/dispatch.ts'

chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
  return handleMessage(message, sendResponse)
})

chrome.runtime.onMessageExternal.addListener(function (message, _sender, sendResponse) {
  return handleMessage(message, sendResponse)
})
