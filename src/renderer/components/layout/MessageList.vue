<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useMessagesStore } from '../../stores/messages'
import { useFoldersStore, isUnifiedFolder } from '../../stores/folders'
import type { MessageListItem, MessageFilters, SearchField } from '../../../shared/types'
import ProgressSpinner from 'primevue/progressspinner'
import SelectButton from 'primevue/selectbutton'
import DatePicker from 'primevue/datepicker'
import InputText from 'primevue/inputtext'
import Checkbox from 'primevue/checkbox'

const messagesStore = useMessagesStore()
const foldersStore = useFoldersStore()
const syncing = ref(false)
const listContainer = ref<HTMLElement | null>(null)

// Filter state
const readFilter = ref<string>('all')
const readFilterOptions = [
  { label: 'All', value: 'all' },
  { label: 'Unread', value: 'unread' }
]
const dateRange = ref<Date[] | null>(null)
let suppressFilterWatch = false

// Search state
const searchQuery = ref('')
const searchFieldFrom = ref(true)
const searchFieldSubject = ref(true)
const searchFieldBody = ref(true)
const showSearchFields = ref(false)
let searchDebounce: ReturnType<typeof setTimeout> | null = null

function getSelectedSearchFields(): SearchField[] {
  const fields: SearchField[] = []
  if (searchFieldFrom.value) fields.push('from')
  if (searchFieldSubject.value) fields.push('subject')
  if (searchFieldBody.value) fields.push('body')
  return fields
}

// Build the current filter object and refetch messages
function applyFilters(): void {
  const filters: MessageFilters = {}
  if (readFilter.value === 'unread') {
    filters.unreadOnly = true
  }
  if (dateRange.value && dateRange.value.length >= 1 && dateRange.value[0]) {
    filters.dateFrom = dateRange.value[0].toISOString()
    if (dateRange.value.length >= 2 && dateRange.value[1]) {
      filters.dateTo = dateRange.value[1].toISOString()
    }
  }
  if (searchQuery.value.trim()) {
    filters.searchQuery = searchQuery.value.trim()
    const fields = getSelectedSearchFields()
    // Only set searchFields if not all selected (default = all)
    if (fields.length < 3) {
      filters.searchFields = fields
    }
  }
  messagesStore.setFilters(filters)
  if (foldersStore.activeFolderId) {
    messagesStore.fetchMessages(foldersStore.activeFolderId)
  }
}

function onSearchInput(): void {
  if (searchDebounce) clearTimeout(searchDebounce)
  searchDebounce = setTimeout(() => {
    applyFilters()
  }, 300)
}

function clearSearch(): void {
  searchQuery.value = ''
  showSearchFields.value = false
  applyFilters()
}

function onSearchFieldChange(): void {
  // Re-apply search if there's already a query
  if (searchQuery.value.trim()) {
    applyFilters()
  }
}

function clearDateRange(): void {
  dateRange.value = null
  applyFilters()
}

// Only apply filters when user changes the toggle, not during programmatic resets
watch(readFilter, () => {
  if (suppressFilterWatch) return
  applyFilters()
})

// Load messages from DB when active folder changes, then try IMAP sync in background
watch(
  () => foldersStore.activeFolderId,
  async (folderId) => {
    if (folderId) {
      // Reset filters silently (don't trigger the readFilter watcher)
      suppressFilterWatch = true
      readFilter.value = 'all'
      dateRange.value = null
      searchQuery.value = ''
      showSearchFields.value = false
      messagesStore.clearFilters()
      suppressFilterWatch = false

      // Load messages from DB immediately (fast — indexed query)
      await messagesStore.fetchMessages(folderId)

      // Background IMAP sync — only for real (non-unified) folders
      if (!isUnifiedFolder(folderId)) {
        syncing.value = true
        window.electronAPI.messages.sync(folderId).then(async () => {
          // Sync succeeded — refresh the list to pick up new messages
          await messagesStore.fetchMessages(folderId)
        }).catch((err) => {
          // IMAP unavailable — that's fine, we already show DB data
          console.warn(`[MessageList] Background sync failed for folder ${folderId}:`, err.message || err)
        }).finally(() => {
          syncing.value = false
        })
      }
    }
  }
)

function selectMessage(message: MessageListItem): void {
  messagesStore.selectMessage(message.id)
  // Mark as read
  if (!message.flags.seen) {
    messagesStore.setFlags(message.id, { seen: true })
  }
}

function isSelected(messageId: number): boolean {
  return messagesStore.activeMessageId === messageId
}

function formatDate(dateStr: string): string {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  const now = new Date()
  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear()

  if (isToday) {
    return date.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'short' })
}

function priorityClass(priority?: string): string {
  if (!priority) return ''
  return `priority-${priority}`
}

// Infinite scroll
function onScroll(): void {
  const el = listContainer.value
  if (!el) return
  // Load more when within 200px of the bottom
  const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200
  if (nearBottom && messagesStore.hasMore && !messagesStore.loadingMore) {
    messagesStore.loadMoreMessages()
  }
}
</script>

<template>
  <div class="message-list">
    <!-- Folder header -->
    <div class="list-header vx-no-select" v-if="foldersStore.activeFolderId">
      <span class="list-title">{{ foldersStore.activeFolderName }}</span>
      <span class="list-count">
        <i v-if="syncing" class="pi pi-spin pi-sync" style="font-size: 11px; margin-right: 4px" />
        {{ messagesStore.messageList.length }} / {{ messagesStore.totalCount }}
      </span>
    </div>

    <!-- Filters toolbar -->
    <div class="filters-bar vx-no-select" v-if="foldersStore.activeFolderId">
      <SelectButton
        v-model="readFilter"
        :options="readFilterOptions"
        optionLabel="label"
        optionValue="value"
        :allowEmpty="false"
        class="filter-read-toggle"
      />
      <div class="filter-date">
        <DatePicker
          v-model="dateRange"
          selectionMode="range"
          placeholder="Date range..."
          dateFormat="dd.mm.yy"
          :showIcon="true"
          :showButtonBar="true"
          :manualInput="false"
          class="filter-datepicker"
          panelClass="vx-datepicker-panel"
          @hide="applyFilters"
        />
        <button
          v-if="dateRange && dateRange.length > 0"
          class="filter-clear-date"
          @click="clearDateRange"
          title="Clear date filter"
        >
          <i class="pi pi-times" />
        </button>
      </div>
    </div>

    <!-- Search bar -->
    <div class="search-bar vx-no-select" v-if="foldersStore.activeFolderId">
      <div class="search-input-wrapper">
        <i class="pi pi-search search-icon" />
        <InputText
          v-model="searchQuery"
          placeholder="Search messages..."
          class="search-input"
          @input="onSearchInput"
          @keydown.escape="clearSearch"
        />
        <button
          v-if="searchQuery"
          class="search-clear"
          @click="clearSearch"
          title="Clear search"
        >
          <i class="pi pi-times" />
        </button>
        <button
          class="search-fields-toggle"
          :class="{ active: showSearchFields }"
          @click="showSearchFields = !showSearchFields"
          title="Search fields"
        >
          <i class="pi pi-sliders-h" />
        </button>
      </div>
      <div v-if="showSearchFields" class="search-fields">
        <label class="search-field-option">
          <Checkbox v-model="searchFieldFrom" :binary="true" @change="onSearchFieldChange" />
          <span>From</span>
        </label>
        <label class="search-field-option">
          <Checkbox v-model="searchFieldSubject" :binary="true" @change="onSearchFieldChange" />
          <span>Subject</span>
        </label>
        <label class="search-field-option">
          <Checkbox v-model="searchFieldBody" :binary="true" @change="onSearchFieldChange" />
          <span>Body</span>
        </label>
      </div>
    </div>

    <!-- Loading state (only show full spinner when loading from DB AND no messages yet) -->
    <div v-if="messagesStore.loading && messagesStore.messageList.length === 0" class="list-loading">
      <ProgressSpinner
        style="width: 32px; height: 32px"
        strokeWidth="3"
      />
    </div>

    <!-- Messages -->
    <div
      v-else-if="messagesStore.messageList.length > 0"
      ref="listContainer"
      class="list-items"
      @scroll="onScroll"
    >
      <div
        v-for="msg in messagesStore.messageList"
        :key="msg.id"
        class="message-item"
        :class="{
          selected: isSelected(msg.id),
          unread: !msg.flags.seen,
          flagged: msg.flags.flagged
        }"
        @click="selectMessage(msg)"
      >
        <!-- Priority indicator -->
        <div
          v-if="msg.aiPriority"
          class="priority-dot"
          :class="priorityClass(msg.aiPriority)"
        />

        <div class="message-content">
          <div class="message-top">
            <span class="message-from vx-truncate">
              {{ msg.from.name || msg.from.address }}
            </span>
            <span class="message-date">{{ formatDate(msg.date) }}</span>
          </div>
          <div class="message-subject vx-truncate">{{ msg.subject }}</div>
          <div class="message-preview vx-truncate">{{ msg.preview }}</div>

          <!-- AI category badge -->
          <div class="message-meta" v-if="msg.aiCategory">
            <span class="ai-badge">{{ msg.aiCategory }}</span>
          </div>
        </div>

        <!-- Flags -->
        <div class="message-flags">
          <i v-if="msg.flags.flagged" class="pi pi-star-fill flag-star" />
          <i v-if="msg.hasAttachments" class="pi pi-paperclip flag-attachment" />
        </div>
      </div>

      <!-- Load more indicator -->
      <div v-if="messagesStore.loadingMore" class="load-more-indicator">
        <ProgressSpinner style="width: 24px; height: 24px" strokeWidth="3" />
        <span>Loading more...</span>
      </div>
      <div v-else-if="messagesStore.hasMore" class="load-more-indicator load-more-hint">
        <span>Scroll down to load more ({{ messagesStore.totalCount - messagesStore.messageList.length }} remaining)</span>
      </div>
    </div>

    <!-- Empty state -->
    <div v-else-if="!messagesStore.loading && foldersStore.activeFolderId" class="list-empty">
      <i class="pi pi-inbox" style="font-size: 2rem; margin-bottom: 8px" />
      <p v-if="searchQuery">No messages matching "{{ searchQuery }}"</p>
      <p v-else-if="readFilter === 'unread'">No unread messages</p>
      <p v-else>No messages in this folder</p>
    </div>

    <!-- No folder selected -->
    <div v-else class="list-empty">
      <i class="pi pi-arrow-left" style="font-size: 1.5rem; margin-bottom: 8px" />
      <p>Select a folder</p>
    </div>
  </div>
</template>

<style scoped>
.message-list {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--vx-border);
  flex-shrink: 0;
}

.list-title {
  font-weight: 600;
  font-size: 13px;
}

.list-count {
  font-size: 11px;
  color: var(--vx-text-muted);
}

/* Filters toolbar */
.filters-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--vx-border);
  flex-shrink: 0;
  background: var(--vx-bg-secondary);
}

.filter-read-toggle :deep(.p-selectbutton) {
  display: flex;
}

.filter-read-toggle :deep(.p-togglebutton) {
  padding: 4px 10px;
  font-size: 11px;
}

.filter-date {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
}

.filter-datepicker {
  width: 180px;
  font-size: 11px;
}

.filter-datepicker :deep(.p-inputtext) {
  padding: 4px 8px;
  font-size: 11px;
}

.filter-datepicker :deep(.p-datepicker-trigger) {
  padding: 4px 6px;
}

.filter-clear-date {
  background: none;
  border: none;
  color: var(--vx-text-muted);
  cursor: pointer;
  padding: 4px;
  font-size: 10px;
  display: flex;
  align-items: center;
}

.filter-clear-date:hover {
  color: var(--vx-text-primary);
}

/* Search bar */
.search-bar {
  padding: 6px 10px;
  border-bottom: 1px solid var(--vx-border);
  flex-shrink: 0;
}

.search-input-wrapper {
  display: flex;
  align-items: center;
  background: var(--vx-bg-primary);
  border: 1px solid var(--vx-border);
  border-radius: 6px;
  padding: 0 8px;
  gap: 6px;
}

.search-input-wrapper:focus-within {
  border-color: var(--vx-accent);
}

.search-icon {
  font-size: 12px;
  color: var(--vx-text-muted);
  flex-shrink: 0;
}

.search-input {
  flex: 1;
  border: none !important;
  background: transparent !important;
  box-shadow: none !important;
  padding: 5px 0 !important;
  font-size: 12px !important;
  outline: none !important;
}

.search-clear,
.search-fields-toggle {
  background: none;
  border: none;
  color: var(--vx-text-muted);
  cursor: pointer;
  padding: 3px;
  font-size: 11px;
  display: flex;
  align-items: center;
  border-radius: 3px;
  flex-shrink: 0;
}

.search-clear:hover,
.search-fields-toggle:hover {
  color: var(--vx-text-primary);
  background: var(--vx-bg-hover);
}

.search-fields-toggle.active {
  color: var(--vx-accent);
}

.search-fields {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 4px 0;
}

.search-field-option {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--vx-text-secondary);
  cursor: pointer;
}

.search-field-option :deep(.p-checkbox) {
  width: 16px;
  height: 16px;
}

.search-field-option :deep(.p-checkbox-box) {
  width: 16px;
  height: 16px;
}

.list-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
}

.list-items {
  flex: 1;
  overflow-y: auto;
}

.message-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  cursor: pointer;
  border-bottom: 1px solid var(--vx-border);
  transition: background-color 0.1s;
  position: relative;
}

.message-item:hover {
  background-color: var(--vx-bg-hover);
}

.message-item.selected {
  background-color: var(--vx-bg-tertiary);
  border-left: 2px solid var(--vx-accent);
}

.message-item.unread .message-from,
.message-item.unread .message-subject {
  font-weight: 600;
  color: var(--vx-text-primary);
}

.priority-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
  margin-top: 6px;
}

.priority-dot.priority-high { background-color: var(--vx-priority-high); }
.priority-dot.priority-medium { background-color: var(--vx-priority-medium); }
.priority-dot.priority-low { background-color: var(--vx-priority-low); }

.message-content {
  flex: 1;
  min-width: 0;
}

.message-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 2px;
}

.message-from {
  font-size: 13px;
  color: var(--vx-text-secondary);
  flex: 1;
}

.message-date {
  font-size: 11px;
  color: var(--vx-text-muted);
  flex-shrink: 0;
}

.message-subject {
  font-size: 13px;
  color: var(--vx-text-secondary);
  margin-bottom: 2px;
}

.message-preview {
  font-size: 12px;
  color: var(--vx-text-muted);
}

.message-meta {
  margin-top: 4px;
}

.ai-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 8px;
  background-color: var(--vx-bg-hover);
  color: var(--vx-accent);
  border: 1px solid var(--vx-border);
}

.message-flags {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.flag-star {
  color: var(--vx-warning);
  font-size: 12px;
}

.flag-attachment {
  color: var(--vx-text-muted);
  font-size: 11px;
}

.load-more-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px;
  color: var(--vx-text-muted);
  font-size: 12px;
}

.load-more-hint {
  font-size: 11px;
  opacity: 0.6;
}

.list-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  color: var(--vx-text-muted);
  padding: 24px;
  text-align: center;
}
</style>
