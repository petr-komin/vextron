<script setup lang="ts">
import { computed, ref, watch, onMounted } from 'vue'
import DOMPurify from 'dompurify'
import { useMessagesStore } from '../../stores/messages'
import { useContactsStore } from '../../stores/contacts'
import { api } from '../../services/api'
import { useAvatar } from '../../composables/useAvatar'
import type { Attachment } from '../../../shared/types'
import Button from 'primevue/button'
import ProgressSpinner from 'primevue/progressspinner'
import { useToast } from 'primevue/usetoast'

const messagesStore = useMessagesStore()
const contactsStore = useContactsStore()
const toast = useToast()

const emit = defineEmits<{
  reply: []
  'reply-all': []
  forward: []
}>()

/** Whether the user allowed remote images for the current message */
const imagesAllowed = ref(false)

/** In-memory cache of allowlisted sender domains */
const allowedDomains = ref<Set<string>>(new Set())

/** AI analyze loading state */
const aiAnalyzing = ref(false)

/** Whether AI config is set up */
const aiConfigured = ref(false)

/** Whether the current sender is already a favorite contact */
const isFavoriteContact = ref(false)

/** Loading state for the favorite button */
const addingToFavorites = ref(false)

/** Sender avatar resolution */
const senderEmail = computed(() => messagesStore.activeMessage?.from?.address ?? null)
const senderAvatarUrl = useAvatar(senderEmail)
/** Set to true when the avatar img fails to load — falls back to initial letter */
const senderAvatarError = ref(false)
watch(senderEmail, () => {
  senderAvatarError.value = false
})

/** Load the allowlist from DB on mount + check AI config */
onMounted(async () => {
  try {
    const entries = await api.settings.imageAllowlist.list()
    allowedDomains.value = new Set(entries.map((e) => e.domain.toLowerCase()))
  } catch (err) {
    console.error('[MessageView] Failed to load image allowlist:', err)
  }

  try {
    const config = await api.ai.getConfig()
    aiConfigured.value = config !== null && config.isActive
  } catch {
    aiConfigured.value = false
  }
})

/**
 * Extract the domain from a sender email address.
 */
function getSenderDomain(): string | null {
  const addr = messagesStore.activeMessage?.from?.address
  if (!addr) return null
  const atIndex = addr.lastIndexOf('@')
  if (atIndex < 0) return null
  return addr.substring(atIndex + 1).toLowerCase().trim()
}

// Reset when switching messages; auto-allow if sender domain is allowlisted
watch(() => messagesStore.activeMessage?.id, async () => {
  const domain = getSenderDomain()
  if (domain && allowedDomains.value.has(domain)) {
    imagesAllowed.value = true
  } else {
    imagesAllowed.value = false
  }

  // Check if sender is a favorite contact
  const msg = messagesStore.activeMessage
  if (msg?.from?.address) {
    isFavoriteContact.value = await contactsStore.isContact(msg.accountId, msg.from.address)
  } else {
    isFavoriteContact.value = false
  }
})

/**
 * Sanitize HTML email body to prevent XSS attacks.
 * Blocks remote images by default (replaces src with data-blocked-src).
 */
const sanitizedHtml = computed(() => {
  const raw = messagesStore.activeMessage?.bodyHtml
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

  // Block remote images: move src → data-blocked-src, add placeholder class
  const doc = new DOMParser().parseFromString(clean, 'text/html')
  let hasRemoteImages = false
  doc.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src')
    if (src && (src.startsWith('http://') || src.startsWith('https://'))) {
      img.setAttribute('data-blocked-src', src)
      img.removeAttribute('src')
      img.classList.add('vx-blocked-image')
      hasRemoteImages = true
    }
  })

  // Also block CSS background images in inline styles
  doc.querySelectorAll('[style]').forEach((el) => {
    const style = el.getAttribute('style') ?? ''
    if (/url\s*\(\s*['"]?https?:\/\//i.test(style)) {
      el.setAttribute('data-blocked-style', style)
      el.setAttribute('style', style.replace(/url\s*\(\s*['"]?https?:\/\/[^)]*\)/gi, 'url()'))
      hasRemoteImages = true
    }
  })

  _hasRemoteImages.value = hasRemoteImages
  return doc.body.innerHTML
})

/** Tracks whether the current message contains remote images */
const _hasRemoteImages = ref(false)
const showImageBanner = computed(() => _hasRemoteImages.value && !imagesAllowed.value)

function allowImages(): void {
  imagesAllowed.value = true
}

/**
 * Add the sender's domain to the permanent allowlist.
 * Images are loaded immediately and will auto-load for all future
 * messages from this domain.
 */
async function allowSenderDomain(): Promise<void> {
  const domain = getSenderDomain()
  if (!domain) return
  try {
    await api.settings.imageAllowlist.add(domain)
    allowedDomains.value.add(domain)
    imagesAllowed.value = true
  } catch (err) {
    console.error('[MessageView] Failed to add domain to allowlist:', err)
    // Fallback: at least allow for this message
    imagesAllowed.value = true
  }
}

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

/**
 * Check if current message is older than 7 days.
 */
const isMessageTooOld = computed(() => {
  const msg = messagesStore.activeMessage
  if (!msg?.date) return false
  const ageMs = Date.now() - new Date(msg.date).getTime()
  return ageMs > 7 * 24 * 60 * 60 * 1000
})

/**
 * Check if message already has AI analysis.
 */
const hasAiAnalysis = computed(() => {
  const msg = messagesStore.activeMessage
  return !!(msg?.aiSummary || msg?.aiCategory)
})

/**
 * Tooltip text for the AI analyze button.
 */
const aiButtonTooltip = computed(() => {
  if (!aiConfigured.value) return 'Configure AI in Settings first'
  if (isMessageTooOld.value) return 'Email is older than 7 days'
  if (hasAiAnalysis.value) return 'Re-analyze with AI'
  return 'Analyze with AI'
})

/**
 * Run AI analysis (summary + classification) on the current message.
 */
async function analyzeWithAi(): Promise<void> {
  const msg = messagesStore.activeMessage
  if (!msg || aiAnalyzing.value) return

  aiAnalyzing.value = true
  try {
    const result = await api.ai.analyze(msg.id)

    // Update the active message in the store with AI results
    messagesStore.activeMessage = {
      ...msg,
      aiSummary: result.summary,
      aiCategory: result.category,
      aiPriority: result.priority
    }

    toast.add({
      severity: 'success',
      summary: 'AI Analysis Complete',
      detail: `Category: ${result.category} | Priority: ${result.priority}`,
      life: 3000
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    toast.add({
      severity: 'error',
      summary: 'AI Analysis Failed',
      detail: message,
      life: 5000
    })
  } finally {
    aiAnalyzing.value = false
  }
}

/**
 * Block the current sender's domain from AI processing.
 */
async function blockSenderFromAi(): Promise<void> {
  const domain = getSenderDomain()
  if (!domain) return

  try {
    await api.ai.blacklist.add(domain, 'domain')
    toast.add({
      severity: 'info',
      summary: 'Sender Blocked from AI',
      detail: `All emails from ${domain} will be excluded from AI analysis.`,
      life: 4000
    })
  } catch (err) {
    console.error('[MessageView] Failed to add blacklist rule:', err)
    toast.add({
      severity: 'error',
      summary: 'Failed to Block Sender',
      detail: err instanceof Error ? err.message : 'Unknown error',
      life: 5000
    })
  }
}

// ─── Attachment helpers ──────────────────────────────────────────────────────

/** Set of partNumbers currently being downloaded/opened */
const attachmentLoading = ref<Set<string>>(new Set())

/** Get a PrimeIcons icon class for common file types */
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

/** Format file size to human-readable string */
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / Math.pow(1024, i)
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`
}

/** Save an attachment to disk via native file dialog */
async function saveAttachment(att: Attachment): Promise<void> {
  const msg = messagesStore.activeMessage
  if (!msg || attachmentLoading.value.has(att.partNumber)) return

  attachmentLoading.value.add(att.partNumber)
  try {
    const result = await api.attachments.download(msg.id, att.partNumber, att.filename)
    if (result.success) {
      toast.add({
        severity: 'success',
        summary: 'Saved',
        detail: `${att.filename} saved successfully`,
        life: 3000
      })
    } else if (result.error) {
      toast.add({
        severity: 'error',
        summary: 'Save Failed',
        detail: result.error,
        life: 5000
      })
    }
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Save Failed',
      detail: err instanceof Error ? err.message : 'Unknown error',
      life: 5000
    })
  } finally {
    attachmentLoading.value.delete(att.partNumber)
  }
}

/** Open an attachment with the system default application */
async function openAttachment(att: Attachment): Promise<void> {
  const msg = messagesStore.activeMessage
  if (!msg || attachmentLoading.value.has(att.partNumber)) return

  attachmentLoading.value.add(att.partNumber)
  try {
    const result = await api.attachments.open(msg.id, att.partNumber, att.filename)
    if (!result.success && result.error) {
      toast.add({
        severity: 'error',
        summary: 'Open Failed',
        detail: result.error,
        life: 5000
      })
    }
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Open Failed',
      detail: err instanceof Error ? err.message : 'Unknown error',
      life: 5000
    })
  } finally {
    attachmentLoading.value.delete(att.partNumber)
  }
}

/**
 * Add the current sender to favorite contacts.
 */
async function addToFavorites(): Promise<void> {
  const msg = messagesStore.activeMessage
  if (!msg?.from?.address || addingToFavorites.value) return

  addingToFavorites.value = true
  try {
    await contactsStore.addContact(msg.accountId, msg.from.address, msg.from.name || '')
    isFavoriteContact.value = true
    toast.add({
      severity: 'success',
      summary: 'Added to Favorites',
      detail: `${msg.from.name || msg.from.address} added to favorite senders`,
      life: 3000
    })
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: err instanceof Error ? err.message : 'Failed to add contact',
      life: 5000
    })
  } finally {
    addingToFavorites.value = false
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
            icon="pi pi-sparkles"
            :severity="hasAiAnalysis ? 'success' : 'secondary'"
            text
            rounded
            size="small"
            :loading="aiAnalyzing"
            :disabled="!aiConfigured || isMessageTooOld"
            v-tooltip.bottom="aiButtonTooltip"
            @click="analyzeWithAi"
          />
          <Button
            icon="pi pi-ban"
            severity="secondary"
            text
            rounded
            size="small"
            v-tooltip.bottom="'Block sender from AI'"
            @click="blockSenderFromAi"
          />
          <span class="action-separator" />
          <Button
            icon="pi pi-reply"
            severity="secondary"
            text
            rounded
            size="small"
            v-tooltip.bottom="'Reply'"
            @click="emit('reply')"
          />
          <Button
            icon="pi pi-reply"
            severity="secondary"
            text
            rounded
            size="small"
            v-tooltip.bottom="'Reply All'"
            @click="emit('reply-all')"
            class="reply-all-btn"
          />
          <Button
            icon="pi pi-arrow-right"
            severity="secondary"
            text
            rounded
            size="small"
            v-tooltip.bottom="'Forward'"
            @click="emit('forward')"
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
        <div class="sender-avatar" :class="{ 'sender-avatar--has-img': senderAvatarUrl && !senderAvatarError }">
          <img
            v-if="senderAvatarUrl && !senderAvatarError"
            :src="senderAvatarUrl"
            class="sender-avatar-img"
            @error="senderAvatarError = true"
          />
          <span v-else>{{ (messagesStore.activeMessage.from.name || messagesStore.activeMessage.from.address).charAt(0).toUpperCase() }}</span>
        </div>
        <div class="sender-info">
          <div class="sender-name">
            {{ messagesStore.activeMessage.from.name || messagesStore.activeMessage.from.address }}
          </div>
          <div class="sender-email">
            {{ messagesStore.activeMessage.from.address }}
          </div>
        </div>
        <Button
          v-if="!isFavoriteContact"
          icon="pi pi-user-plus"
          severity="secondary"
          text
          rounded
          size="small"
          :loading="addingToFavorites"
          v-tooltip.bottom="'Add to favorite senders'"
          @click="addToFavorites"
        />
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

      <!-- Remote image blocking banner -->
      <div v-if="showImageBanner" class="image-banner">
        <i class="pi pi-image" />
        <span>Remote images are blocked to protect your privacy</span>
        <div class="image-banner-actions">
          <Button label="Load images" size="small" text @click="allowImages" />
          <Button
            label="Always allow from this sender"
            size="small"
            text
            @click="allowSenderDomain"
          />
        </div>
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

      <!-- Attachments panel -->
      <div
        v-if="messagesStore.activeMessage.attachments && messagesStore.activeMessage.attachments.length > 0"
        class="attachments-panel"
      >
        <div class="attachments-header">
          <i class="pi pi-paperclip" />
          {{ messagesStore.activeMessage.attachments.length }}
          {{ messagesStore.activeMessage.attachments.length === 1 ? 'attachment' : 'attachments' }}
        </div>
        <div class="attachments-list">
          <div
            v-for="att in messagesStore.activeMessage.attachments"
            :key="att.partNumber"
            class="attachment-item"
          >
            <i :class="getAttachmentIcon(att.contentType, att.filename)" class="attachment-icon" />
            <div class="attachment-info">
              <span class="attachment-name" :title="att.filename">{{ att.filename }}</span>
              <span class="attachment-size">{{ formatFileSize(att.size) }}</span>
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
  align-items: center;
}

.action-separator {
  width: 1px;
  height: 20px;
  background: var(--vx-border);
  margin: 0 4px;
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
  overflow: hidden;
}

.sender-avatar--has-img {
  background-color: transparent;
}

.sender-avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 50%;
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

/* ─── Attachments panel ─────────────────────────────────────────────────── */

.attachments-panel {
  margin: 0 20px 12px;
  padding: 10px 12px;
  background: var(--vx-bg-secondary);
  border: 1px solid var(--vx-border);
  border-radius: 8px;
}

.attachments-header {
  font-weight: 600;
  font-size: 12px;
  color: var(--vx-text-secondary);
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.attachments-header .pi-paperclip {
  font-size: 13px;
}

.attachments-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.attachment-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 6px;
  transition: background 0.1s;
}

.attachment-item:hover {
  background: var(--vx-bg-hover);
}

.attachment-icon {
  font-size: 16px;
  color: var(--vx-accent);
  flex-shrink: 0;
  width: 20px;
  text-align: center;
}

.attachment-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.attachment-name {
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.attachment-size {
  font-size: 10px;
  color: var(--vx-text-muted);
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

.image-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 20px 8px;
  padding: 8px 12px;
  background: #fef3cd;
  border: 1px solid #ffc107;
  border-radius: 6px;
  font-size: 12px;
  color: #664d03;
}

.image-banner .pi-image {
  font-size: 14px;
  flex-shrink: 0;
}

.image-banner span {
  flex: 1;
}

.image-banner-actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
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

/* Default cell padding for HTML email tables that don't specify their own */
.body-html :deep(td),
.body-html :deep(th) {
  padding: 4px 8px;
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

.reply-all-btn :deep(.pi-reply) {
  /* Double-arrow effect: add a shadow offset to simulate two reply arrows */
  text-shadow: 2px 0 0 currentColor;
}
</style>
