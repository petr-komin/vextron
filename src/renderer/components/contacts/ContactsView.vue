<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import DOMPurify from 'dompurify'
import { useContactsStore } from '../../stores/contacts'
import { api } from '../../services/api'
import { useAvatarBatch } from '../../composables/useAvatar'
import type { Contact, MessageListItem, Attachment } from '../../../shared/types'
import ComposeDialog from '../ComposeDialog.vue'
import type { ComposeContext, ComposeMode } from '../ComposeDialog.vue'
import Button from 'primevue/button'
import ProgressSpinner from 'primevue/progressspinner'
import { useToast } from 'primevue/usetoast'

const contactsStore = useContactsStore()
const toast = useToast()

// ─── State ──────────────────────────────────────────────────────────────────

const removingId = ref<number | null>(null)

/** Whether the user allowed remote images for the current message */
const imagesAllowed = ref(false)

/** In-memory cache of allowlisted sender domains */
const allowedDomains = ref<Set<string>>(new Set())

/** Contact avatar batch resolution */
const contactEmails = computed(() =>
  contactsStore.contactsList.map((c) => c.email.toLowerCase().trim())
)
const contactAvatarMap = useAvatarBatch(contactEmails)
/** Tracks which contact emails had img load errors — falls back to initial letter */
const contactAvatarErrors = ref(new Set<string>())

// ─── Lifecycle ──────────────────────────────────────────────────────────────

onMounted(async () => {
  await contactsStore.fetchContacts()
  try {
    const entries = await api.settings.imageAllowlist.list()
    allowedDomains.value = new Set(entries.map((e) => e.domain.toLowerCase()))
  } catch { /* ignore */ }
})

// Reset images allowed when switching messages
watch(() => contactsStore.activeMessage?.id, () => {
  const addr = contactsStore.activeMessage?.from?.address
  if (addr) {
    const domain = addr.substring(addr.lastIndexOf('@') + 1).toLowerCase().trim()
    imagesAllowed.value = allowedDomains.value.has(domain)
  } else {
    imagesAllowed.value = false
  }
})

// ─── Computed ───────────────────────────────────────────────────────────────

const sanitizedHtml = computed(() => {
  const raw = contactsStore.activeMessage?.bodyHtml
  if (!raw) return ''

  const clean = DOMPurify.sanitize(raw, {
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

  if (imagesAllowed.value) return clean

  // Block remote images
  const doc = new DOMParser().parseFromString(clean, 'text/html')
  doc.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src')
    if (src && (src.startsWith('http://') || src.startsWith('https://'))) {
      img.setAttribute('data-blocked-src', src)
      img.removeAttribute('src')
      img.classList.add('vx-blocked-image')
    }
  })
  return doc.body.innerHTML
})

// ─── Methods ────────────────────────────────────────────────────────────────

function selectContact(contact: Contact): void {
  contactsStore.selectContact(contact)
}

function selectMessage(msg: MessageListItem): void {
  contactsStore.selectMessage(msg.id)
}

async function removeContact(contact: Contact): Promise<void> {
  removingId.value = contact.id
  try {
    await contactsStore.removeContact(contact.id)
    toast.add({
      severity: 'info',
      summary: 'Contact removed',
      detail: `${contact.name || contact.email} removed from favorites`,
      life: 3000
    })
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: err instanceof Error ? err.message : 'Failed to remove contact',
      life: 5000
    })
  } finally {
    removingId.value = null
  }
}

function onMessageListScroll(event: Event): void {
  const el = event.target as HTMLElement
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 100) {
    contactsStore.loadMoreMessages()
  }
}

function formatDate(dateStr: string): string {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) {
    return date.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })
  }
  if (diffDays < 7) {
    return date.toLocaleDateString('cs-CZ', { weekday: 'short', hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'short', year: 'numeric' })
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

function contactInitial(contact: Contact): string {
  return (contact.name || contact.email).charAt(0).toUpperCase()
}

// ─── Compose dialog state ───────────────────────────────────────────────────

const composeVisible = ref(false)
const composeContext = ref<ComposeContext>({ mode: 'new' })

function openCompose(mode: ComposeMode): void {
  const ctx: ComposeContext = { mode }
  if (mode !== 'new' && contactsStore.activeMessage) {
    // Deep-clone to strip reactive proxies (structured clone can't handle them)
    ctx.originalMessage = JSON.parse(JSON.stringify(contactsStore.activeMessage))
  }
  composeContext.value = ctx
  composeVisible.value = true
}

/**
 * Handle successful send — mark original message as answered if this was a reply.
 */
function onSent(data: { messageId?: string; originalMessageId?: number; mode: ComposeMode }): void {
  if ((data.mode === 'reply' || data.mode === 'reply-all') && data.originalMessageId) {
    // Update answered flag locally + in backend
    api.messages.setFlags(data.originalMessageId, { answered: true })
    if (contactsStore.activeMessage && contactsStore.activeMessage.id === data.originalMessageId) {
      contactsStore.activeMessage.flags.answered = true
    }
  }
}

// ─── Star / Delete ──────────────────────────────────────────────────────────

function toggleFlag(): void {
  const msg = contactsStore.activeMessage
  if (!msg) return
  const newFlagged = !msg.flags.flagged
  api.messages.setFlags(msg.id, { flagged: newFlagged })
  msg.flags.flagged = newFlagged
  // Update in message list too
  const item = contactsStore.messageList.find((m) => m.id === msg.id)
  if (item) item.flags.flagged = newFlagged
}

async function deleteMessage(): Promise<void> {
  const msg = contactsStore.activeMessage
  if (!msg) return
  try {
    await api.messages.delete(msg.id)
    // Remove from message list
    const idx = contactsStore.messageList.findIndex((m) => m.id === msg.id)
    if (idx >= 0) {
      contactsStore.messageList.splice(idx, 1)
      contactsStore.totalCount = Math.max(0, contactsStore.totalCount - 1)
    }
    // Clear active message
    contactsStore.activeMessage = null
    toast.add({
      severity: 'info',
      summary: 'Deleted',
      detail: 'Message moved to trash',
      life: 3000
    })
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Delete Failed',
      detail: err instanceof Error ? err.message : 'Failed to delete message',
      life: 5000
    })
  }
}

// ─── Attachment helpers ─────────────────────────────────────────────────────

const attachmentLoading = ref<Set<string>>(new Set())

function getAttachmentIcon(contentType: string, filename: string): string {
  const ct = contentType.toLowerCase()
  if (ct.startsWith('image/')) return 'pi pi-image'
  if (ct === 'application/pdf') return 'pi pi-file-pdf'
  if (ct.includes('spreadsheet') || ct.includes('excel') || filename.match(/\.xlsx?$/i)) return 'pi pi-file-excel'
  if (ct.includes('word') || ct.includes('document') || filename.match(/\.docx?$/i)) return 'pi pi-file-word'
  if (ct.includes('zip') || ct.includes('archive') || ct.includes('compressed')) return 'pi pi-box'
  if (ct.startsWith('text/')) return 'pi pi-file'
  if (ct.startsWith('video/')) return 'pi pi-video'
  if (ct.startsWith('audio/')) return 'pi pi-volume-up'
  return 'pi pi-file'
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / Math.pow(1024, i)
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`
}

async function saveAttachment(att: Attachment): Promise<void> {
  const msg = contactsStore.activeMessage
  if (!msg || attachmentLoading.value.has(att.partNumber)) return

  attachmentLoading.value.add(att.partNumber)
  try {
    const result = await api.attachments.download(msg.id, att.partNumber, att.filename)
    if (result.success) {
      toast.add({ severity: 'success', summary: 'Saved', detail: `${att.filename} saved successfully`, life: 3000 })
    } else if (result.error) {
      toast.add({ severity: 'error', summary: 'Save Failed', detail: result.error, life: 5000 })
    }
  } catch (err) {
    toast.add({ severity: 'error', summary: 'Save Failed', detail: err instanceof Error ? err.message : 'Unknown error', life: 5000 })
  } finally {
    attachmentLoading.value.delete(att.partNumber)
  }
}

async function openAttachment(att: Attachment): Promise<void> {
  const msg = contactsStore.activeMessage
  if (!msg || attachmentLoading.value.has(att.partNumber)) return

  attachmentLoading.value.add(att.partNumber)
  try {
    const result = await api.attachments.open(msg.id, att.partNumber, att.filename)
    if (!result.success && result.error) {
      toast.add({ severity: 'error', summary: 'Open Failed', detail: result.error, life: 5000 })
    }
  } catch (err) {
    toast.add({ severity: 'error', summary: 'Open Failed', detail: err instanceof Error ? err.message : 'Unknown error', life: 5000 })
  } finally {
    attachmentLoading.value.delete(att.partNumber)
  }
}
</script>

<template>
  <div class="contacts-view">
    <!-- Left panel: contacts list -->
    <div class="contacts-panel">
      <div class="contacts-header">
        <h3 class="contacts-title">
          <i class="pi pi-users" />
          Favorite Senders
        </h3>
        <span class="contacts-count" v-if="contactsStore.contactsList.length > 0">
          {{ contactsStore.contactsList.length }}
        </span>
      </div>

      <div v-if="contactsStore.loading" class="contacts-loading">
        <ProgressSpinner style="width: 30px; height: 30px" strokeWidth="3" />
      </div>

      <div v-else-if="contactsStore.contactsList.length === 0" class="contacts-empty">
        <i class="pi pi-user-plus" style="font-size: 2rem; opacity: 0.3; margin-bottom: 8px" />
        <p>No favorite senders yet</p>
        <p class="contacts-empty-hint">
          Open an email and click the star icon next to the sender to add them here.
        </p>
      </div>

      <div v-else class="contacts-list">
        <div
          v-for="contact in contactsStore.contactsList"
          :key="contact.id"
          class="contact-item"
          :class="{ active: contactsStore.activeContact?.id === contact.id }"
          @click="selectContact(contact)"
        >
          <div
            class="contact-avatar"
            :class="{ 'contact-avatar--has-img': contactAvatarMap[contact.email.toLowerCase().trim()] && !contactAvatarErrors.has(contact.email.toLowerCase().trim()) }"
          >
            <img
              v-if="contactAvatarMap[contact.email.toLowerCase().trim()] && !contactAvatarErrors.has(contact.email.toLowerCase().trim())"
              :src="contactAvatarMap[contact.email.toLowerCase().trim()]"
              class="contact-avatar-img"
              @error="contactAvatarErrors.add(contact.email.toLowerCase().trim())"
            />
            <span v-else>{{ contactInitial(contact) }}</span>
          </div>
          <div class="contact-info">
            <div class="contact-name">{{ contact.name || contact.email }}</div>
            <div class="contact-email" v-if="contact.name">{{ contact.email }}</div>
          </div>
          <Button
            icon="pi pi-times"
            severity="secondary"
            text
            rounded
            size="small"
            class="contact-remove"
            :loading="removingId === contact.id"
            v-tooltip.left="'Remove from favorites'"
            @click.stop="removeContact(contact)"
          />
        </div>
      </div>
    </div>

    <!-- Right panel: messages from selected contact -->
    <div class="messages-panel">
      <!-- No contact selected -->
      <div v-if="!contactsStore.activeContact" class="messages-empty">
        <i class="pi pi-users" style="font-size: 3rem; opacity: 0.2; margin-bottom: 12px" />
        <p>Select a contact to view their emails</p>
      </div>

      <!-- Contact selected — message list + detail -->
      <template v-else>
        <!-- Message list header -->
        <div class="messages-header">
          <div class="messages-header-info">
            <h3>{{ contactsStore.activeContact.name || contactsStore.activeContact.email }}</h3>
            <span class="messages-header-count">
              {{ contactsStore.totalCount }} {{ contactsStore.totalCount === 1 ? 'email' : 'emails' }}
            </span>
          </div>
        </div>

        <div class="messages-content">
          <!-- Message list (left sub-panel) -->
          <div class="message-list-panel" @scroll="onMessageListScroll">
            <div v-if="contactsStore.loadingMessages" class="messages-loading">
              <ProgressSpinner style="width: 30px; height: 30px" strokeWidth="3" />
            </div>

            <template v-else>
              <div
                v-for="msg in contactsStore.messageList"
                :key="msg.id"
                class="message-item"
                :class="{
                  active: contactsStore.activeMessage?.id === msg.id,
                  unread: !msg.flags.seen
                }"
                @click="selectMessage(msg)"
              >
                <div class="message-item-top">
                  <span class="message-item-subject">{{ msg.subject || '(no subject)' }}</span>
                  <span class="message-item-date">{{ formatDate(msg.date) }}</span>
                </div>
                <div class="message-item-preview">{{ msg.preview }}</div>
                <div class="message-item-badges" v-if="msg.aiCategory">
                  <span class="ai-badge">{{ msg.aiCategory }}</span>
                </div>
              </div>

              <div v-if="contactsStore.messageList.length === 0" class="messages-none">
                No emails from this contact.
              </div>

              <div v-if="contactsStore.loadingMore" class="messages-loading-more">
                <ProgressSpinner style="width: 20px; height: 20px" strokeWidth="3" />
              </div>
            </template>
          </div>

          <!-- Message detail (right sub-panel) -->
          <div class="message-detail-panel">
            <div v-if="contactsStore.loadingMessage" class="detail-loading">
              <ProgressSpinner style="width: 40px; height: 40px" strokeWidth="3" />
            </div>

            <div v-else-if="contactsStore.activeMessage" class="detail-content">
              <div class="detail-header">
                <div class="detail-header-top">
                  <h2 class="detail-subject">{{ contactsStore.activeMessage.subject }}</h2>
                  <div class="detail-actions">
                    <Button
                      icon="pi pi-reply"
                      severity="secondary"
                      text
                      rounded
                      size="small"
                      v-tooltip.bottom="'Reply'"
                      @click="openCompose('reply')"
                    />
                    <Button
                      icon="pi pi-reply"
                      severity="secondary"
                      text
                      rounded
                      size="small"
                      v-tooltip.bottom="'Reply All'"
                      @click="openCompose('reply-all')"
                      class="reply-all-btn"
                    />
                    <Button
                      icon="pi pi-arrow-right"
                      severity="secondary"
                      text
                      rounded
                      size="small"
                      v-tooltip.bottom="'Forward'"
                      @click="openCompose('forward')"
                    />
                    <Button
                      :icon="contactsStore.activeMessage.flags.flagged ? 'pi pi-star-fill' : 'pi pi-star'"
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
                <div class="detail-meta">
                  <span class="detail-date">{{ formatFullDate(contactsStore.activeMessage.date) }}</span>
                </div>
              </div>

              <!-- Recipients -->
              <div class="detail-recipients" v-if="contactsStore.activeMessage.to.length > 0">
                <span class="detail-recipients-label">To:</span>
                <span
                  v-for="(addr, i) in contactsStore.activeMessage.to"
                  :key="i"
                >
                  {{ addr.name || addr.address }}{{ i < contactsStore.activeMessage.to.length - 1 ? ', ' : '' }}
                </span>
              </div>

              <!-- AI panel -->
              <div
                v-if="contactsStore.activeMessage.aiSummary || contactsStore.activeMessage.aiCategory"
                class="detail-ai-panel"
              >
                <div class="detail-ai-header">
                  <i class="pi pi-sparkles" />
                  AI Analysis
                </div>
                <div v-if="contactsStore.activeMessage.aiPriority" class="detail-ai-field">
                  <span class="detail-ai-label">Priority:</span>
                  <span
                    class="ai-priority-badge"
                    :class="`priority-${contactsStore.activeMessage.aiPriority}`"
                  >
                    {{ contactsStore.activeMessage.aiPriority.toUpperCase() }}
                  </span>
                </div>
                <div v-if="contactsStore.activeMessage.aiCategory" class="detail-ai-field">
                  <span class="detail-ai-label">Category:</span>
                  <span>{{ contactsStore.activeMessage.aiCategory }}</span>
                </div>
                <div v-if="contactsStore.activeMessage.aiSummary" class="detail-ai-field">
                  <span class="detail-ai-label">Summary:</span>
                  <span>{{ contactsStore.activeMessage.aiSummary }}</span>
                </div>
              </div>

              <!-- Attachments panel -->
              <div
                v-if="contactsStore.activeMessage.attachments && contactsStore.activeMessage.attachments.length > 0"
                class="detail-attachments-panel"
              >
                <div class="detail-attachments-header">
                  <i class="pi pi-paperclip" />
                  {{ contactsStore.activeMessage.attachments.length }}
                  {{ contactsStore.activeMessage.attachments.length === 1 ? 'attachment' : 'attachments' }}
                </div>
                <div class="detail-attachments-list">
                  <div
                    v-for="att in contactsStore.activeMessage.attachments"
                    :key="att.partNumber"
                    class="detail-attachment-item"
                  >
                    <i :class="getAttachmentIcon(att.contentType, att.filename)" class="detail-attachment-icon" />
                    <div class="detail-attachment-info">
                      <span class="detail-attachment-name" :title="att.filename">{{ att.filename }}</span>
                      <span class="detail-attachment-size">{{ formatFileSize(att.size) }}</span>
                    </div>
                    <Button
                      icon="pi pi-external-link"
                      severity="secondary"
                      text
                      rounded
                      size="small"
                      :loading="attachmentLoading.has(att.partNumber)"
                      v-tooltip.bottom="'Open'"
                      @click="openAttachment(att)"
                    />
                    <Button
                      icon="pi pi-download"
                      severity="secondary"
                      text
                      rounded
                      size="small"
                      :loading="attachmentLoading.has(att.partNumber)"
                      v-tooltip.bottom="'Save as...'"
                      @click="saveAttachment(att)"
                    />
                  </div>
                </div>
              </div>

              <!-- Body -->
              <div class="detail-body">
                <div
                  v-if="contactsStore.activeMessage.bodyHtml"
                  class="body-html"
                  v-html="sanitizedHtml"
                />
                <pre
                  v-else
                  class="body-text"
                >{{ contactsStore.activeMessage.bodyText }}</pre>
              </div>
            </div>

            <div v-else class="detail-empty">
              <i class="pi pi-envelope" style="font-size: 2.5rem; opacity: 0.2; margin-bottom: 8px" />
              <p>Select an email to read</p>
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- Compose Dialog -->
    <ComposeDialog
      v-model:visible="composeVisible"
      :context="composeContext"
      @sent="onSent"
    />
  </div>
</template>

<style scoped>
.contacts-view {
  display: flex;
  height: 100%;
  width: 100%;
}

/* ─── Left panel: contacts list ─────────────────────────────────────────── */

.contacts-panel {
  width: 240px;
  min-width: 200px;
  max-width: 320px;
  flex-shrink: 0;
  background: var(--vx-bg-secondary);
  border-right: 1px solid var(--vx-border);
  display: flex;
  flex-direction: column;
  resize: horizontal;
  overflow: hidden;
}

.contacts-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid var(--vx-border);
}

.contacts-title {
  font-size: 13px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--vx-text-primary);
}

.contacts-title .pi {
  font-size: 14px;
  color: var(--vx-accent);
}

.contacts-count {
  font-size: 11px;
  background: var(--vx-accent);
  color: white;
  border-radius: 10px;
  padding: 1px 7px;
  font-weight: 600;
}

.contacts-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.contacts-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 16px;
  text-align: center;
  color: var(--vx-text-muted);
  flex: 1;
}

.contacts-empty-hint {
  font-size: 11px;
  margin-top: 4px;
  line-height: 1.4;
}

.contacts-list {
  flex: 1;
  overflow-y: auto;
}

.contact-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  cursor: pointer;
  border-bottom: 1px solid var(--vx-border);
  transition: background 0.1s;
}

.contact-item:hover {
  background: var(--vx-bg-hover);
}

.contact-item.active {
  background: var(--vx-bg-tertiary);
  border-left: 3px solid var(--vx-accent);
  padding-left: 11px;
}

.contact-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--vx-accent);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 13px;
  flex-shrink: 0;
  overflow: hidden;
}

.contact-avatar--has-img {
  background: transparent;
}

.contact-avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 50%;
}

.contact-info {
  flex: 1;
  min-width: 0;
}

.contact-name {
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.contact-email {
  font-size: 11px;
  color: var(--vx-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.contact-remove {
  opacity: 0;
  transition: opacity 0.15s;
  flex-shrink: 0;
}

.contact-item:hover .contact-remove {
  opacity: 1;
}

/* ─── Right panel: messages ─────────────────────────────────────────────── */

.messages-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--vx-bg-primary);
}

.messages-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  color: var(--vx-text-muted);
}

.messages-header {
  display: flex;
  align-items: center;
  padding: 10px 16px;
  border-bottom: 1px solid var(--vx-border);
  background: var(--vx-bg-secondary);
  flex-shrink: 0;
}

.messages-header-info h3 {
  font-size: 14px;
  font-weight: 600;
}

.messages-header-count {
  font-size: 11px;
  color: var(--vx-text-muted);
}

.messages-content {
  display: flex;
  flex: 1;
  min-height: 0;
}

/* ─── Message list sub-panel ────────────────────────────────────────────── */

.message-list-panel {
  width: 340px;
  min-width: 260px;
  max-width: 500px;
  flex-shrink: 0;
  overflow-y: auto;
  border-right: 1px solid var(--vx-border);
  resize: horizontal;
}

.messages-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.messages-none {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  color: var(--vx-text-muted);
  font-size: 12px;
}

.messages-loading-more {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
}

.message-item {
  padding: 10px 14px;
  border-bottom: 1px solid var(--vx-border);
  cursor: pointer;
  transition: background 0.1s;
}

.message-item:hover {
  background: var(--vx-bg-hover);
}

.message-item.active {
  background: var(--vx-bg-tertiary);
}

.message-item.unread {
  border-left: 3px solid var(--vx-accent);
  padding-left: 11px;
}

.message-item-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 4px;
}

.message-item-subject {
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

.message-item.unread .message-item-subject {
  font-weight: 700;
}

.message-item-date {
  font-size: 10px;
  color: var(--vx-text-muted);
  white-space: nowrap;
  flex-shrink: 0;
}

.message-item-preview {
  font-size: 11px;
  color: var(--vx-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.3;
}

.message-item-badges {
  margin-top: 4px;
}

.ai-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(91, 76, 214, 0.1);
  color: var(--vx-accent);
  font-weight: 500;
}

/* ─── Message detail sub-panel ──────────────────────────────────────────── */

.message-detail-panel {
  flex: 1;
  overflow-y: auto;
  min-width: 300px;
}

.detail-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}

.detail-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--vx-text-muted);
}

.detail-content {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.detail-header {
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--vx-border);
}

.detail-header-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 4px;
}

.detail-subject {
  font-size: 17px;
  font-weight: 600;
  line-height: 1.3;
  margin: 0;
  flex: 1;
}

.detail-actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
  align-items: center;
}

.reply-all-btn :deep(.pi-reply) {
  text-shadow: 2px 0 0 currentColor;
}

.detail-meta {
  display: flex;
  align-items: center;
  gap: 12px;
}

.detail-date {
  font-size: 12px;
  color: var(--vx-text-muted);
}

.detail-recipients {
  padding: 8px 20px;
  font-size: 12px;
  color: var(--vx-text-muted);
}

.detail-recipients-label {
  font-weight: 600;
  margin-right: 4px;
}

.detail-ai-panel {
  margin: 0 20px 12px;
  padding: 12px;
  background: var(--vx-bg-secondary);
  border: 1px solid var(--vx-border);
  border-radius: 8px;
}

.detail-ai-header {
  font-weight: 600;
  font-size: 12px;
  color: var(--vx-accent);
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.detail-ai-field {
  font-size: 12px;
  margin-bottom: 4px;
  line-height: 1.4;
}

.detail-ai-label {
  font-weight: 600;
  margin-right: 4px;
  color: var(--vx-text-secondary);
}

.ai-priority-badge {
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 700;
}

.ai-priority-badge.priority-high {
  background: rgba(217, 48, 37, 0.1);
  color: var(--vx-priority-high);
}

.ai-priority-badge.priority-medium {
  background: rgba(227, 116, 0, 0.1);
  color: var(--vx-priority-medium);
}

.ai-priority-badge.priority-low {
  background: rgba(26, 115, 232, 0.1);
  color: var(--vx-priority-low);
}

/* ─── Attachments panel ─────────────────────────────────────────────────── */

.detail-attachments-panel {
  margin: 0 20px 12px;
  padding: 10px 12px;
  background: var(--vx-bg-secondary);
  border: 1px solid var(--vx-border);
  border-radius: 8px;
}

.detail-attachments-header {
  font-weight: 600;
  font-size: 12px;
  color: var(--vx-text-secondary);
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.detail-attachments-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.detail-attachment-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 6px;
  transition: background 0.1s;
}

.detail-attachment-item:hover {
  background: var(--vx-bg-hover);
}

.detail-attachment-icon {
  font-size: 16px;
  color: var(--vx-accent);
  flex-shrink: 0;
  width: 20px;
  text-align: center;
}

.detail-attachment-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.detail-attachment-name {
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.detail-attachment-size {
  font-size: 10px;
  color: var(--vx-text-muted);
}

.detail-body {
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

.body-html :deep(img.vx-blocked-image) {
  display: inline-block;
  min-width: 24px;
  min-height: 24px;
  background: var(--vx-bg-secondary);
  border: 1px dashed var(--vx-border);
  border-radius: 4px;
}

.body-text {
  white-space: pre-wrap;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.6;
}
</style>
