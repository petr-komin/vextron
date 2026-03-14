<script setup lang="ts">
import { ref, computed, onMounted, watch, inject, type Ref } from 'vue'
import DOMPurify from 'dompurify'
import { api } from '../../services/api'
import { useMessagesStore } from '../../stores/messages'
import type { AnalyzedMessageItem, SemanticSearchResult, Message } from '../../../shared/types'
import ProgressSpinner from 'primevue/progressspinner'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Dialog from 'primevue/dialog'

const messagesStore = useMessagesStore()
const viewMode = inject<Ref<'mail' | 'ai'>>('viewMode')

const analyzedMessages = ref<AnalyzedMessageItem[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

// ─── Semantic Search state ───────────────────────────────────────────────────

const searchQuery = ref('')
const searchResults = ref<SemanticSearchResult[]>([])
const searching = ref(false)
const searchError = ref<string | null>(null)
const isSearchActive = computed(() => searchResults.value.length > 0 || searching.value || searchError.value !== null)

let searchDebounce: ReturnType<typeof setTimeout> | null = null

function onSearchInput(): void {
  if (searchDebounce) clearTimeout(searchDebounce)

  if (!searchQuery.value.trim()) {
    clearSearch()
    return
  }

  // Debounce: wait 500ms after user stops typing
  searchDebounce = setTimeout(() => {
    performSearch()
  }, 500)
}

async function performSearch(): Promise<void> {
  const query = searchQuery.value.trim()
  if (!query) return

  searching.value = true
  searchError.value = null

  try {
    searchResults.value = await api.ai.search(query)
  } catch (err) {
    console.error('[AiOverview] Semantic search failed:', err)
    searchError.value = err instanceof Error ? err.message : 'Search failed'
    searchResults.value = []
  } finally {
    searching.value = false
  }
}

function clearSearch(): void {
  searchQuery.value = ''
  searchResults.value = []
  searchError.value = null
  if (searchDebounce) clearTimeout(searchDebounce)
}

function formatSimilarity(score: number): string {
  return `${Math.round(score * 100)}%`
}

// ─── Message Detail Dialog ──────────────────────────────────────────────────

const dialogVisible = ref(false)
const dialogMessage = ref<Message | null>(null)
const dialogLoading = ref(false)

async function openMessageDialog(result: SemanticSearchResult | AnalyzedMessageItem): Promise<void> {
  dialogVisible.value = true
  dialogLoading.value = true
  dialogMessage.value = null

  try {
    dialogMessage.value = await api.messages.get(result.id)
  } catch (err) {
    console.error('[AiOverview] Failed to load message:', err)
  } finally {
    dialogLoading.value = false
  }
}

function closeDialog(): void {
  dialogVisible.value = false
  dialogMessage.value = null
}

/**
 * Navigate to the message in the main mail view (from the dialog).
 */
function goToMessage(): void {
  if (!dialogMessage.value) return
  closeDialog()
  if (viewMode) viewMode.value = 'mail'
  messagesStore.selectMessage(dialogMessage.value.id)
}

/**
 * Sanitize HTML for display in dialog (same logic as MessageView).
 * Always blocks remote images for safety.
 */
function sanitizeDialogHtml(html: string): string {
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'a', 'abbr', 'address', 'b', 'blockquote', 'br', 'caption',
      'code', 'col', 'colgroup', 'dd', 'del', 'details', 'div', 'dl', 'dt',
      'em', 'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'hr', 'i', 'img', 'ins', 'kbd', 'li', 'mark', 'ol', 'p', 'pre',
      'q', 's', 'small', 'span', 'strong', 'sub', 'summary', 'sup',
      'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul',
      'center', 'font', 'big'
    ],
    ALLOWED_ATTR: [
      'href', 'src', 'alt', 'title', 'width', 'height', 'style',
      'class', 'id', 'colspan', 'rowspan', 'align', 'valign',
      'bgcolor', 'color', 'border', 'cellpadding', 'cellspacing',
      'dir', 'lang', 'face', 'size', 'target'
    ],
    ADD_ATTR: ['target'],
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['form', 'input', 'textarea', 'select', 'button', 'script', 'style', 'iframe', 'object', 'embed'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover']
  })

  // Block remote images
  const doc = new DOMParser().parseFromString(clean, 'text/html')
  doc.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src')
    if (src && (src.startsWith('http://') || src.startsWith('https://'))) {
      img.removeAttribute('src')
      img.classList.add('vx-blocked-image')
    }
  })
  doc.querySelectorAll('[style]').forEach((el) => {
    const style = el.getAttribute('style') ?? ''
    if (/url\s*\(\s*['"]?https?:\/\//i.test(style)) {
      el.setAttribute('style', style.replace(/url\s*\(\s*['"]?https?:\/\/[^)]*\)/gi, 'url()'))
    }
  })

  return doc.body.innerHTML
}

function formatFullDate(dateStr: string): string {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  return date.toLocaleString('cs-CZ', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/** Category display configuration */
const categoryConfig: Record<string, { label: string; icon: string; color: string }> = {
  work: { label: 'Work', icon: 'pi pi-briefcase', color: '#1a73e8' },
  personal: { label: 'Personal', icon: 'pi pi-user', color: '#5b4cd6' },
  finance: { label: 'Finance', icon: 'pi pi-dollar', color: '#188038' },
  shopping: { label: 'Shopping', icon: 'pi pi-shopping-cart', color: '#e37400' },
  social: { label: 'Social', icon: 'pi pi-users', color: '#d93025' },
  newsletter: { label: 'Newsletter', icon: 'pi pi-book', color: '#7c4dff' },
  notification: { label: 'Notification', icon: 'pi pi-bell', color: '#00897b' },
  spam: { label: 'Spam', icon: 'pi pi-exclamation-triangle', color: '#d93025' },
  travel: { label: 'Travel', icon: 'pi pi-compass', color: '#0277bd' },
  health: { label: 'Health', icon: 'pi pi-heart', color: '#c2185b' },
  education: { label: 'Education', icon: 'pi pi-graduation-cap', color: '#6a1b9a' },
  other: { label: 'Other', icon: 'pi pi-inbox', color: '#888888' }
}

/** Group messages by AI category */
const groupedMessages = computed(() => {
  const groups: Record<string, AnalyzedMessageItem[]> = {}

  for (const msg of analyzedMessages.value) {
    const cat = msg.aiCategory || 'other'
    if (!groups[cat]) groups[cat] = []
    groups[cat].push(msg)
  }

  // Sort categories: put categories with more messages first, but use a stable order
  const categoryOrder = Object.keys(categoryConfig)
  const sorted: { category: string; messages: AnalyzedMessageItem[] }[] = []

  for (const cat of categoryOrder) {
    if (groups[cat]?.length) {
      sorted.push({ category: cat, messages: groups[cat] })
    }
  }

  // Add any categories not in our config (custom categories from AI)
  for (const [cat, msgs] of Object.entries(groups)) {
    if (!categoryOrder.includes(cat)) {
      sorted.push({ category: cat, messages: msgs })
    }
  }

  return sorted
})

const totalAnalyzed = computed(() => analyzedMessages.value.length)

async function fetchAnalyzed(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    analyzedMessages.value = await api.messages.listAnalyzed()
  } catch (err) {
    console.error('[AiOverview] Failed to fetch analyzed messages:', err)
    error.value = err instanceof Error ? err.message : 'Failed to load analyzed messages'
  } finally {
    loading.value = false
  }
}

function getCategoryInfo(category: string) {
  return categoryConfig[category] ?? { label: category, icon: 'pi pi-tag', color: '#888888' }
}

function formatDate(dateStr: string): string {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) {
    return date.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })
  } else if (diffDays === 1) {
    return 'Yesterday'
  } else if (diffDays < 7) {
    return date.toLocaleDateString('cs-CZ', { weekday: 'short' })
  } else {
    return date.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'short', year: 'numeric' })
  }
}

function selectMessage(msg: AnalyzedMessageItem): void {
  // When in search mode, open dialog to keep search results visible
  if (isSearchActive.value) {
    openMessageDialog(msg)
    return
  }
  // In grouped view, navigate to mail view as before
  if (viewMode) viewMode.value = 'mail'
  messagesStore.selectMessage(msg.id)
}

// Fetch on mount
onMounted(fetchAnalyzed)

// Refetch when switching to AI view
watch(
  () => viewMode?.value,
  (newMode) => {
    if (newMode === 'ai') fetchAnalyzed()
  }
)
</script>

<template>
  <div class="ai-overview">
    <!-- Header -->
    <div class="ai-overview-header">
      <div class="ai-overview-title">
        <i class="pi pi-sparkles" />
        <h2>AI Overview</h2>
        <span v-if="totalAnalyzed > 0" class="analyzed-count">{{ totalAnalyzed }} analyzed</span>
      </div>
      <Button
        icon="pi pi-refresh"
        severity="secondary"
        text
        rounded
        size="small"
        :loading="loading"
        v-tooltip.bottom="'Refresh'"
        @click="fetchAnalyzed"
      />
    </div>

    <!-- Semantic Search Bar -->
    <div class="search-bar">
      <span class="search-icon">
        <i class="pi pi-search" />
      </span>
      <InputText
        v-model="searchQuery"
        placeholder="Semantic search across AI-analyzed emails..."
        class="search-input"
        @input="onSearchInput"
        @keyup.enter="performSearch"
        @keyup.escape="clearSearch"
      />
      <Button
        v-if="searchQuery"
        icon="pi pi-times"
        severity="secondary"
        text
        rounded
        size="small"
        class="search-clear"
        @click="clearSearch"
      />
      <ProgressSpinner
        v-if="searching"
        style="width: 20px; height: 20px"
        strokeWidth="4"
        class="search-spinner"
      />
    </div>

    <!-- Search Results -->
    <template v-if="isSearchActive">
      <div v-if="searching && searchResults.length === 0" class="ai-overview-loading">
        <ProgressSpinner style="width: 40px; height: 40px" strokeWidth="3" />
        <span>Searching...</span>
      </div>

      <div v-else-if="searchError" class="ai-overview-error">
        <i class="pi pi-exclamation-triangle" />
        <span>{{ searchError }}</span>
        <Button label="Retry" size="small" text @click="performSearch" />
      </div>

      <div v-else-if="searchResults.length === 0 && !searching" class="ai-overview-empty">
        <i class="pi pi-search" style="font-size: 2rem; margin-bottom: 8px; opacity: 0.3" />
        <p>No matching emails found</p>
        <p class="empty-hint">Try a different search query or analyze more emails first.</p>
      </div>

      <div v-else class="ai-overview-content">
        <div class="search-results-header">
          <span class="search-results-count">{{ searchResults.length }} result{{ searchResults.length !== 1 ? 's' : '' }}</span>
        </div>

        <div class="category-messages">
          <div
            v-for="result in searchResults"
            :key="result.id"
            class="message-card"
            :class="{ unread: !result.flags.seen }"
            @click="selectMessage(result)"
          >
            <div class="card-top">
              <div class="card-sender">
                <span class="sender-name">{{ result.from.name || result.from.address }}</span>
                <span v-if="result.accountEmail" class="account-badge">{{ result.accountEmail }}</span>
              </div>
              <div class="card-meta">
                <span class="similarity-badge" v-tooltip.bottom="'Semantic similarity'">
                  {{ formatSimilarity(result.similarity) }}
                </span>
                <span
                  class="priority-badge"
                  :class="`priority-${result.aiPriority}`"
                >
                  {{ result.aiPriority.toUpperCase() }}
                </span>
                <span
                  class="category-pill"
                  :style="{ '--cat-color': getCategoryInfo(result.aiCategory).color }"
                >
                  <i :class="getCategoryInfo(result.aiCategory).icon" style="font-size: 10px" />
                  {{ getCategoryInfo(result.aiCategory).label }}
                </span>
                <span class="card-date">{{ formatDate(result.date) }}</span>
              </div>
            </div>
            <div class="card-subject">{{ result.subject }}</div>
            <div class="card-summary">{{ result.aiSummary }}</div>
          </div>
        </div>
      </div>
    </template>

    <!-- Normal grouped view (when not searching) -->
    <template v-else>
      <!-- Loading -->
      <div v-if="loading && analyzedMessages.length === 0" class="ai-overview-loading">
        <ProgressSpinner style="width: 40px; height: 40px" strokeWidth="3" />
        <span>Loading analyzed messages...</span>
      </div>

      <!-- Error -->
      <div v-else-if="error" class="ai-overview-error">
        <i class="pi pi-exclamation-triangle" />
        <span>{{ error }}</span>
        <Button label="Retry" size="small" text @click="fetchAnalyzed" />
      </div>

      <!-- Empty state -->
      <div v-else-if="analyzedMessages.length === 0" class="ai-overview-empty">
        <i class="pi pi-sparkles" style="font-size: 3rem; margin-bottom: 12px; opacity: 0.3" />
        <p>No analyzed emails yet</p>
        <p class="empty-hint">
          Use the <i class="pi pi-sparkles" /> button on individual emails to analyze them with AI.
        </p>
      </div>

      <!-- Grouped messages -->
      <div v-else class="ai-overview-content">
        <div
          v-for="group in groupedMessages"
          :key="group.category"
          class="category-section"
        >
          <!-- Category header -->
          <div class="category-header" :style="{ '--cat-color': getCategoryInfo(group.category).color }">
            <i :class="getCategoryInfo(group.category).icon" class="category-icon" />
            <span class="category-name">{{ getCategoryInfo(group.category).label }}</span>
            <span class="category-count">{{ group.messages.length }}</span>
          </div>

          <!-- Message cards -->
          <div class="category-messages">
            <div
              v-for="msg in group.messages"
              :key="msg.id"
              class="message-card"
              :class="{ unread: !msg.flags.seen }"
              @click="selectMessage(msg)"
            >
              <div class="card-top">
                <div class="card-sender">
                  <span class="sender-name">{{ msg.from.name || msg.from.address }}</span>
                  <span v-if="msg.accountEmail" class="account-badge">{{ msg.accountEmail }}</span>
                </div>
                <div class="card-meta">
                  <span
                    class="priority-badge"
                    :class="`priority-${msg.aiPriority}`"
                  >
                    {{ msg.aiPriority.toUpperCase() }}
                  </span>
                  <span class="card-date">{{ formatDate(msg.date) }}</span>
                </div>
              </div>
              <div class="card-subject">{{ msg.subject }}</div>
              <div class="card-summary">{{ msg.aiSummary }}</div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- Message Detail Dialog -->
    <Dialog
      v-model:visible="dialogVisible"
      :style="{ width: '800px', maxHeight: '85vh' }"
      modal
      :closable="true"
      :draggable="false"
      @hide="closeDialog"
    >
      <template #header>
        <div class="dialog-header">
          <span class="dialog-title">{{ dialogMessage?.subject || 'Loading...' }}</span>
        </div>
      </template>

      <!-- Loading -->
      <div v-if="dialogLoading" class="dialog-loading">
        <ProgressSpinner style="width: 40px; height: 40px" strokeWidth="3" />
        <span>Loading message...</span>
      </div>

      <!-- Message content -->
      <div v-else-if="dialogMessage" class="dialog-content">
        <!-- Sender info -->
        <div class="dialog-sender">
          <div class="dialog-avatar">
            {{ (dialogMessage.from.name || dialogMessage.from.address).charAt(0).toUpperCase() }}
          </div>
          <div class="dialog-sender-info">
            <div class="dialog-sender-name">{{ dialogMessage.from.name || dialogMessage.from.address }}</div>
            <div class="dialog-sender-email">{{ dialogMessage.from.address }}</div>
          </div>
          <div class="dialog-date">{{ formatFullDate(dialogMessage.date) }}</div>
        </div>

        <!-- Recipients -->
        <div v-if="dialogMessage.to.length > 0" class="dialog-recipients">
          <span class="dialog-recipients-label">To:</span>
          <span v-for="(addr, i) in dialogMessage.to" :key="i">
            {{ addr.name || addr.address }}{{ i < dialogMessage.to.length - 1 ? ', ' : '' }}
          </span>
        </div>

        <!-- AI panel -->
        <div v-if="dialogMessage.aiSummary || dialogMessage.aiCategory" class="dialog-ai-panel">
          <div class="dialog-ai-header">
            <i class="pi pi-sparkles" />
            AI Analysis
          </div>
          <div v-if="dialogMessage.aiPriority" class="dialog-ai-field">
            <span class="dialog-ai-label">Priority:</span>
            <span class="priority-badge" :class="`priority-${dialogMessage.aiPriority}`">
              {{ dialogMessage.aiPriority.toUpperCase() }}
            </span>
          </div>
          <div v-if="dialogMessage.aiCategory" class="dialog-ai-field">
            <span class="dialog-ai-label">Category:</span>
            <span
              class="category-pill"
              :style="{ '--cat-color': getCategoryInfo(dialogMessage.aiCategory).color }"
            >
              <i :class="getCategoryInfo(dialogMessage.aiCategory).icon" style="font-size: 10px" />
              {{ getCategoryInfo(dialogMessage.aiCategory).label }}
            </span>
          </div>
          <div v-if="dialogMessage.aiSummary" class="dialog-ai-field">
            <span class="dialog-ai-label">Summary:</span>
            <span>{{ dialogMessage.aiSummary }}</span>
          </div>
        </div>

        <!-- Body -->
        <div class="dialog-body">
          <div
            v-if="dialogMessage.bodyHtml"
            class="dialog-body-html"
            v-html="sanitizeDialogHtml(dialogMessage.bodyHtml)"
          />
          <pre v-else class="dialog-body-text">{{ dialogMessage.bodyText }}</pre>
        </div>
      </div>

      <template #footer>
        <div class="dialog-footer">
          <Button
            label="Open in Mail View"
            icon="pi pi-external-link"
            size="small"
            text
            @click="goToMessage"
          />
          <Button
            label="Close"
            severity="secondary"
            size="small"
            @click="closeDialog"
          />
        </div>
      </template>
    </Dialog>
  </div>
</template>

<style scoped>
.ai-overview {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--vx-bg-primary);
}

.ai-overview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px 12px;
  border-bottom: 1px solid var(--vx-border);
  flex-shrink: 0;
}

/* ─── Search bar ─────────────────────────────────────────────────────────── */

.search-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 24px;
  border-bottom: 1px solid var(--vx-border);
  flex-shrink: 0;
}

.search-icon {
  color: var(--vx-text-muted);
  font-size: 14px;
  flex-shrink: 0;
}

.search-input {
  flex: 1;
  border: none !important;
  box-shadow: none !important;
  background: transparent !important;
  font-size: 13px;
  padding: 4px 0;
}

.search-input:focus {
  outline: none !important;
}

.search-clear {
  flex-shrink: 0;
}

.search-spinner {
  flex-shrink: 0;
}

.search-results-header {
  margin-bottom: 12px;
}

.search-results-count {
  font-size: 12px;
  font-weight: 600;
  color: var(--vx-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.similarity-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 700;
  background: rgba(26, 115, 232, 0.1);
  color: #1a73e8;
  cursor: default;
}

.category-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
  background: color-mix(in srgb, var(--cat-color, #888) 10%, transparent);
  color: var(--cat-color, #888);
}

.ai-overview-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ai-overview-title .pi-sparkles {
  color: var(--vx-accent);
  font-size: 18px;
}

.ai-overview-title h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.analyzed-count {
  font-size: 12px;
  color: var(--vx-text-muted);
  background: var(--vx-bg-tertiary);
  padding: 2px 8px;
  border-radius: 10px;
}

.ai-overview-loading,
.ai-overview-error,
.ai-overview-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  gap: 8px;
  color: var(--vx-text-muted);
}

.ai-overview-error {
  color: var(--vx-danger);
}

.empty-hint {
  font-size: 12px;
  color: var(--vx-text-muted);
  margin-top: 4px;
}

.ai-overview-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px 24px 24px;
}

/* ─── Category sections ──────────────────────────────────────────────────── */

.category-section {
  margin-bottom: 24px;
}

.category-section:last-child {
  margin-bottom: 0;
}

.category-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 2px solid var(--cat-color, var(--vx-border));
  margin-bottom: 12px;
}

.category-icon {
  color: var(--cat-color, var(--vx-text-secondary));
  font-size: 14px;
}

.category-name {
  font-weight: 600;
  font-size: 14px;
  color: var(--cat-color, var(--vx-text-primary));
}

.category-count {
  font-size: 11px;
  color: var(--vx-text-muted);
  background: var(--vx-bg-tertiary);
  padding: 1px 7px;
  border-radius: 8px;
}

/* ─── Message cards ──────────────────────────────────────────────────────── */

.category-messages {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.message-card {
  padding: 12px 16px;
  background: var(--vx-bg-secondary);
  border: 1px solid var(--vx-border);
  border-radius: 8px;
  cursor: pointer;
  transition: background-color 0.15s, border-color 0.15s;
}

.message-card:hover {
  background: var(--vx-bg-hover);
  border-color: var(--vx-accent);
}

.message-card.unread {
  border-left: 3px solid var(--vx-accent);
}

.card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}

.card-sender {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}

.sender-name {
  font-weight: 600;
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.account-badge {
  font-size: 10px;
  color: var(--vx-text-muted);
  background: var(--vx-bg-tertiary);
  padding: 1px 6px;
  border-radius: 4px;
  white-space: nowrap;
  flex-shrink: 0;
}

.card-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.priority-badge {
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 700;
}

.priority-badge.priority-high {
  background: rgba(217, 48, 37, 0.1);
  color: var(--vx-priority-high);
}

.priority-badge.priority-medium {
  background: rgba(227, 116, 0, 0.1);
  color: var(--vx-priority-medium);
}

.priority-badge.priority-low {
  background: rgba(26, 115, 232, 0.1);
  color: var(--vx-priority-low);
}

.card-date {
  font-size: 11px;
  color: var(--vx-text-muted);
  white-space: nowrap;
}

.card-subject {
  font-size: 13px;
  font-weight: 500;
  margin-bottom: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.message-card.unread .card-subject {
  font-weight: 700;
}

.card-summary {
  font-size: 12px;
  color: var(--vx-text-secondary);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* ─── Message Detail Dialog ──────────────────────────────────────────────── */

.dialog-header {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
  padding-right: 16px;
}

.dialog-title {
  font-weight: 600;
  font-size: 16px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dialog-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 40px 0;
  color: var(--vx-text-muted);
}

.dialog-content {
  display: flex;
  flex-direction: column;
}

.dialog-sender {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.dialog-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background-color: var(--vx-accent);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 14px;
  flex-shrink: 0;
}

.dialog-sender-info {
  flex: 1;
  min-width: 0;
}

.dialog-sender-name {
  font-weight: 600;
  font-size: 14px;
}

.dialog-sender-email {
  font-size: 12px;
  color: var(--vx-text-muted);
}

.dialog-date {
  font-size: 12px;
  color: var(--vx-text-muted);
  flex-shrink: 0;
}

.dialog-recipients {
  font-size: 12px;
  color: var(--vx-text-muted);
  margin-bottom: 12px;
}

.dialog-recipients-label {
  font-weight: 600;
  margin-right: 4px;
}

.dialog-ai-panel {
  padding: 12px;
  background: var(--vx-bg-secondary);
  border: 1px solid var(--vx-border);
  border-radius: 8px;
  margin-bottom: 16px;
}

.dialog-ai-header {
  font-weight: 600;
  font-size: 12px;
  color: var(--vx-accent);
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.dialog-ai-field {
  font-size: 12px;
  margin-bottom: 4px;
  line-height: 1.4;
}

.dialog-ai-label {
  font-weight: 600;
  margin-right: 4px;
  color: var(--vx-text-secondary);
}

.dialog-body {
  max-height: 50vh;
  overflow-y: auto;
  border-top: 1px solid var(--vx-border);
  padding-top: 16px;
}

.dialog-body-html {
  line-height: 1.6;
  word-break: break-word;
}

.dialog-body-html :deep(img) {
  max-width: 100%;
  height: auto;
}

.dialog-body-html :deep(img.vx-blocked-image) {
  display: inline-block;
  min-width: 24px;
  min-height: 24px;
  background: var(--vx-bg-secondary);
  border: 1px dashed var(--vx-border);
  border-radius: 4px;
}

.dialog-body-text {
  white-space: pre-wrap;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.6;
}

.dialog-footer {
  display: flex;
  justify-content: space-between;
  width: 100%;
}
</style>
