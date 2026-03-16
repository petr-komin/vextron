import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Contact, MessageListItem, Message } from '../../shared/types'
import { api } from '../services/api'

export const useContactsStore = defineStore('contacts', () => {
  const contactsList = ref<Contact[]>([])
  const activeContact = ref<Contact | null>(null)
  const messageList = ref<MessageListItem[]>([])
  const activeMessage = ref<Message | null>(null)
  const loading = ref(false)
  const loadingMessages = ref(false)
  const loadingMessage = ref(false)
  const loadingMore = ref(false)
  const currentPage = ref(1)
  const pageSize = ref(50)
  const totalCount = ref(0)

  const hasMore = computed(() =>
    messageList.value.length < totalCount.value
  )

  /**
   * Fetch all favorite contacts.
   */
  async function fetchContacts(): Promise<void> {
    loading.value = true
    try {
      contactsList.value = await api.contacts.listFavorites()
    } catch (err) {
      console.error('[ContactsStore] Failed to fetch contacts:', err)
    } finally {
      loading.value = false
    }
  }

  /**
   * Select a contact and load their messages.
   */
  async function selectContact(contact: Contact): Promise<void> {
    activeContact.value = contact
    activeMessage.value = null
    currentPage.value = 1
    messageList.value = []
    totalCount.value = 0
    await fetchMessages(contact.email)
  }

  /**
   * Fetch messages from the selected contact's email.
   */
  async function fetchMessages(email: string): Promise<void> {
    loadingMessages.value = true
    try {
      const [msgs, count] = await Promise.all([
        api.contacts.messages(email, currentPage.value, pageSize.value),
        api.contacts.messagesCount(email)
      ])
      messageList.value = msgs
      totalCount.value = count
    } catch (err) {
      console.error('[ContactsStore] Failed to fetch messages:', err)
    } finally {
      loadingMessages.value = false
    }
  }

  /**
   * Load more messages (pagination).
   */
  async function loadMoreMessages(): Promise<void> {
    if (!activeContact.value || loadingMore.value || !hasMore.value) return
    loadingMore.value = true
    try {
      currentPage.value++
      const msgs = await api.contacts.messages(
        activeContact.value.email,
        currentPage.value,
        pageSize.value
      )
      messageList.value = [...messageList.value, ...msgs]
    } catch (err) {
      console.error('[ContactsStore] Failed to load more messages:', err)
      currentPage.value--
    } finally {
      loadingMore.value = false
    }
  }

  /**
   * Select a message and load full content.
   */
  async function selectMessage(messageId: number): Promise<void> {
    loadingMessage.value = true
    try {
      activeMessage.value = await api.messages.get(messageId)
      // Mark as read
      if (activeMessage.value && !activeMessage.value.flags.seen) {
        await api.messages.setFlags(messageId, { seen: true })
        activeMessage.value.flags.seen = true
        // Update in list too
        const item = messageList.value.find((m) => m.id === messageId)
        if (item) item.flags.seen = true
      }
    } catch (err) {
      console.error('[ContactsStore] Failed to load message:', err)
    } finally {
      loadingMessage.value = false
    }
  }

  /**
   * Add a contact as favorite.
   */
  async function addContact(accountId: number, email: string, name: string): Promise<Contact> {
    const contact = await api.contacts.add(accountId, email, name)
    // Refresh the list
    await fetchContacts()
    return contact
  }

  /**
   * Remove a contact from favorites.
   */
  async function removeContact(id: number): Promise<void> {
    await api.contacts.remove(id)
    // If this was the active contact, clear it
    if (activeContact.value?.id === id) {
      activeContact.value = null
      messageList.value = []
      activeMessage.value = null
      totalCount.value = 0
    }
    // Refresh the list
    await fetchContacts()
  }

  /**
   * Check if a sender email is a favorite contact for a given account.
   */
  async function isContact(accountId: number, email: string): Promise<boolean> {
    try {
      return await api.contacts.check(accountId, email)
    } catch {
      return false
    }
  }

  function clearSelection(): void {
    activeContact.value = null
    messageList.value = []
    activeMessage.value = null
    totalCount.value = 0
    currentPage.value = 1
  }

  return {
    contactsList,
    activeContact,
    messageList,
    activeMessage,
    loading,
    loadingMessages,
    loadingMessage,
    loadingMore,
    totalCount,
    hasMore,
    fetchContacts,
    selectContact,
    fetchMessages,
    loadMoreMessages,
    selectMessage,
    addContact,
    removeContact,
    isContact,
    clearSelection
  }
})
