<script setup lang="ts">
import { computed, ref, watch, onMounted } from 'vue'
import DOMPurify from 'dompurify'
import { useMessagesStore } from '../../stores/messages'
import { api } from '../../services/api'
import Button from 'primevue/button'
import ProgressSpinner from 'primevue/progressspinner'
import { useToast } from 'primevue/usetoast'

const messagesStore = useMessagesStore()
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
watch(() => messagesStore.activeMessage?.id, () => {
  const domain = getSenderDomain()
  if (domain && allowedDomains.value.has(domain)) {
    imagesAllowed.value = true
  } else {
    imagesAllowed.value = false
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
