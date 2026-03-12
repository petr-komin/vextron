<script setup lang="ts">
import { computed } from 'vue'
import DOMPurify from 'dompurify'
import { useMessagesStore } from '../../stores/messages'
import Button from 'primevue/button'
import ProgressSpinner from 'primevue/progressspinner'

const messagesStore = useMessagesStore()

/**
 * Sanitize HTML email body to prevent XSS attacks.
 * Allows safe tags/attributes for email rendering but strips scripts,
 * event handlers, and other dangerous content.
 */
const sanitizedHtml = computed(() => {
  const raw = messagesStore.activeMessage?.bodyHtml
  if (!raw) return ''

  return DOMPurify.sanitize(raw, {
    // Allow typical email HTML elements
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
    // Force all links to open externally
    ADD_ATTR: ['target'],
    // Block data URIs for images (can be used for tracking/attacks)
    ALLOW_DATA_ATTR: false,
    // Forbid form elements
    FORBID_TAGS: ['form', 'input', 'textarea', 'select', 'button', 'script', 'style', 'iframe', 'object', 'embed'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover']
  })
})

function formatDate(dateStr: string): string {
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

function toggleFlag(): void {
  if (messagesStore.activeMessage) {
    messagesStore.setFlags(messagesStore.activeMessage.id, {
      flagged: !messagesStore.activeMessage.flags.flagged
    })
  }
}

function deleteMessage(): void {
  if (messagesStore.activeMessage) {
    messagesStore.deleteMessage(messagesStore.activeMessage.id)
  }
}
</script>

<template>
  <div class="message-view">
    <!-- Loading -->
    <div v-if="messagesStore.loadingMessage" class="view-loading">
      <ProgressSpinner style="width: 40px; height: 40px" strokeWidth="3" />
    </div>

    <!-- Message content -->
    <div v-else-if="messagesStore.activeMessage" class="view-content">
      <!-- Header -->
      <div class="view-header">
        <h2 class="view-subject">{{ messagesStore.activeMessage.subject }}</h2>

        <div class="view-actions">
          <Button
            icon="pi pi-reply"
            severity="secondary"
            text
            rounded
            size="small"
            v-tooltip.bottom="'Reply'"
          />
          <Button
            icon="pi pi-arrow-right"
            severity="secondary"
            text
            rounded
            size="small"
            v-tooltip.bottom="'Forward'"
          />
          <Button
            :icon="messagesStore.activeMessage.flags.flagged ? 'pi pi-star-fill' : 'pi pi-star'"
            severity="secondary"
            text
            rounded
            size="small"
            v-tooltip.bottom="'Toggle star'"
            @click="toggleFlag"
          />
          <Button
            icon="pi pi-trash"
            severity="danger"
            text
            rounded
            size="small"
            v-tooltip.bottom="'Delete'"
            @click="deleteMessage"
          />
        </div>
      </div>

      <!-- Sender info -->
      <div class="view-sender">
        <div class="sender-avatar">
          {{ (messagesStore.activeMessage.from.name || messagesStore.activeMessage.from.address).charAt(0).toUpperCase() }}
        </div>
        <div class="sender-info">
          <div class="sender-name">
            {{ messagesStore.activeMessage.from.name || messagesStore.activeMessage.from.address }}
          </div>
          <div class="sender-email">
            {{ messagesStore.activeMessage.from.address }}
          </div>
        </div>
        <div class="view-date">
          {{ formatDate(messagesStore.activeMessage.date) }}
        </div>
      </div>

      <!-- Recipients -->
      <div class="view-recipients" v-if="messagesStore.activeMessage.to.length > 0">
        <span class="recipients-label">To:</span>
        <span
          v-for="(addr, i) in messagesStore.activeMessage.to"
          :key="i"
          class="recipient"
        >
          {{ addr.name || addr.address }}{{ i < messagesStore.activeMessage.to.length - 1 ? ', ' : '' }}
        </span>
      </div>

      <!-- AI info panel -->
      <div
        v-if="messagesStore.activeMessage.aiSummary || messagesStore.activeMessage.aiCategory"
        class="ai-panel"
      >
        <div class="ai-panel-header">
          <i class="pi pi-sparkles" />
          AI Analysis
        </div>
        <div v-if="messagesStore.activeMessage.aiPriority" class="ai-field">
          <span class="ai-label">Priority:</span>
          <span
            class="ai-priority"
            :class="`priority-${messagesStore.activeMessage.aiPriority}`"
          >
            {{ messagesStore.activeMessage.aiPriority.toUpperCase() }}
          </span>
        </div>
        <div v-if="messagesStore.activeMessage.aiCategory" class="ai-field">
          <span class="ai-label">Category:</span>
          <span>{{ messagesStore.activeMessage.aiCategory }}</span>
        </div>
        <div v-if="messagesStore.activeMessage.aiSummary" class="ai-field">
          <span class="ai-label">Summary:</span>
          <span>{{ messagesStore.activeMessage.aiSummary }}</span>
        </div>
      </div>

      <!-- Body -->
      <div class="view-body">
        <div
          v-if="messagesStore.activeMessage.bodyHtml"
          class="body-html"
          v-html="sanitizedHtml"
        />
        <pre
          v-else
          class="body-text"
        >{{ messagesStore.activeMessage.bodyText }}</pre>
      </div>
    </div>

    <!-- No message selected -->
    <div v-else class="view-empty">
      <i class="pi pi-envelope" style="font-size: 3rem; margin-bottom: 12px; opacity: 0.3" />
      <p>Select a message to read</p>
    </div>
  </div>
</template>

<style scoped>
.message-view {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.view-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
}

.view-content {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.view-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--vx-border);
}

.view-subject {
  font-size: 18px;
  font-weight: 600;
  line-height: 1.3;
  flex: 1;
  margin: 0;
}

.view-actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}

.view-sender {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 20px;
}

.sender-avatar {
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

.sender-info {
  flex: 1;
  min-width: 0;
}

.sender-name {
  font-weight: 600;
  font-size: 14px;
}

.sender-email {
  font-size: 12px;
  color: var(--vx-text-muted);
}

.view-date {
  font-size: 12px;
  color: var(--vx-text-muted);
  flex-shrink: 0;
}

.view-recipients {
  padding: 0 20px 8px;
  font-size: 12px;
  color: var(--vx-text-muted);
}

.recipients-label {
  font-weight: 600;
  margin-right: 4px;
}

.ai-panel {
  margin: 0 20px 12px;
  padding: 12px;
  background: var(--vx-bg-secondary);
  border: 1px solid var(--vx-border);
  border-radius: 8px;
}

.ai-panel-header {
  font-weight: 600;
  font-size: 12px;
  color: var(--vx-accent);
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.ai-field {
  font-size: 12px;
  margin-bottom: 4px;
  line-height: 1.4;
}

.ai-label {
  font-weight: 600;
  margin-right: 4px;
  color: var(--vx-text-secondary);
}

.ai-priority {
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 700;
}

.ai-priority.priority-high {
  background: rgba(217, 48, 37, 0.1);
  color: var(--vx-priority-high);
}

.ai-priority.priority-medium {
  background: rgba(227, 116, 0, 0.1);
  color: var(--vx-priority-medium);
}

.ai-priority.priority-low {
  background: rgba(26, 115, 232, 0.1);
  color: var(--vx-priority-low);
}

.view-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
}

.body-html {
  line-height: 1.6;
  word-break: break-word;
}

.body-html :deep(img) {
  max-width: 100%;
  height: auto;
}

.body-text {
  white-space: pre-wrap;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.6;
}

.view-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  color: var(--vx-text-muted);
}
</style>
