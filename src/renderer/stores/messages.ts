import { defineStore } from 'pinia'
import { ref, computed, toRaw } from 'vue'
import type { MessageListItem, Message, MessageFlags, MessageFilters } from '../../shared/types'

export const useMessagesStore = defineStore('messages', () => {
  const messageList = ref<MessageListItem[]>([])
  const activeMessage = ref<Message | null>(null)
  const activeMessageId = ref<number | null>(null)
  const loading = ref(false)
  const loadingMore = ref(false)
  const loadingMessage = ref(false)
  const currentFolderId = ref<number | null>(null)
  const currentPage = ref(1)
  const pageSize = ref(50)
  const totalCount = ref(0)
  const filters = ref<MessageFilters>({})

  const unreadCount = computed(() =>
    messageList.value.filter((m) => !m.flags.seen).length
  )

  const hasMore = computed(() =>
    messageList.value.length < totalCount.value
  )

  function getPlainFilters(): MessageFilters | undefined {
    const f = toRaw(filters.value)
    if (!f.unreadOnly && !f.dateFrom && !f.dateTo) return undefined
    return JSON.parse(JSON.stringify(f))
  }

  async function fetchMessages(folderId: number, page: number = 1): Promise<void> {
    loading.value = true
    currentFolderId.value = folderId
    currentPage.value = page
    try {
      const plainFilters = getPlainFilters()
      const [msgs, count] = await Promise.all([
        window.electronAPI.messages.list(folderId, page, pageSize.value, plainFilters),
        window.electronAPI.messages.count(folderId, plainFilters)
      ])
      messageList.value = msgs
      totalCount.value = count
    } catch (error) {
      console.error('Failed to fetch messages:', error)
    } finally {
      loading.value = false
    }
  }

  async function loadMoreMessages(): Promise<void> {
    if (!currentFolderId.value || loadingMore.value || !hasMore.value) return
    loadingMore.value = true
    const nextPage = currentPage.value + 1
    try {
      const plainFilters = getPlainFilters()
      const more = await window.electronAPI.messages.list(
        currentFolderId.value, nextPage, pageSize.value, plainFilters
      )
      if (more.length > 0) {
        messageList.value = [...messageList.value, ...more]
        currentPage.value = nextPage
      }
    } catch (error) {
      console.error('Failed to load more messages:', error)
    } finally {
      loadingMore.value = false
    }
  }

  async function fetchMessage(messageId: number): Promise<void> {
    loadingMessage.value = true
    activeMessageId.value = messageId
    try {
      activeMessage.value = await window.electronAPI.messages.get(messageId)
    } catch (error) {
      console.error('Failed to fetch message:', error)
    } finally {
      loadingMessage.value = false
    }
  }

  async function setFlags(messageId: number, flags: Partial<MessageFlags>): Promise<void> {
    await window.electronAPI.messages.setFlags(messageId, flags)

    // Update local state
    const item = messageList.value.find((m) => m.id === messageId)
    if (item) {
      item.flags = { ...item.flags, ...flags }
    }
    if (activeMessage.value?.id === messageId) {
      activeMessage.value.flags = { ...activeMessage.value.flags, ...flags }
    }
  }

  async function deleteMessage(messageId: number): Promise<void> {
    await window.electronAPI.messages.delete(messageId)
    messageList.value = messageList.value.filter((m) => m.id !== messageId)
    totalCount.value = Math.max(0, totalCount.value - 1)
    if (activeMessageId.value === messageId) {
      activeMessage.value = null
      activeMessageId.value = null
    }
  }

  async function moveMessage(messageId: number, targetFolderId: number): Promise<void> {
    await window.electronAPI.messages.move(messageId, targetFolderId)
    messageList.value = messageList.value.filter((m) => m.id !== messageId)
    totalCount.value = Math.max(0, totalCount.value - 1)
    if (activeMessageId.value === messageId) {
      activeMessage.value = null
      activeMessageId.value = null
    }
  }

  function selectMessage(messageId: number): void {
    activeMessageId.value = messageId
    fetchMessage(messageId)
  }

  function clearSelection(): void {
    activeMessage.value = null
    activeMessageId.value = null
  }

  function setFilters(newFilters: MessageFilters): void {
    filters.value = { ...newFilters }
  }

  function clearFilters(): void {
    filters.value = {}
  }

  return {
    messageList,
    activeMessage,
    activeMessageId,
    loading,
    loadingMore,
    loadingMessage,
    currentFolderId,
    currentPage,
    pageSize,
    totalCount,
    filters,
    unreadCount,
    hasMore,
    fetchMessages,
    loadMoreMessages,
    fetchMessage,
    selectMessage,
    clearSelection,
    setFlags,
    deleteMessage,
    moveMessage,
    setFilters,
    clearFilters
  }
})
