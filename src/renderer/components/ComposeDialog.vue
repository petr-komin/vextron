<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import Textarea from 'primevue/textarea'
import Chip from 'primevue/chip'
import { useToast } from 'primevue/usetoast'
import { useAccountsStore } from '../stores/accounts'
import { api } from '../services/api'
import type { Message, ComposeMailData } from '../../shared/types'

export type ComposeMode = 'new' | 'reply' | 'reply-all' | 'forward'

export interface ComposeContext {
  mode: ComposeMode
  originalMessage?: Message
}

const props = defineProps<{
  visible: boolean
  context?: ComposeContext
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  sent: [data: { messageId?: string; originalMessageId?: number; mode: ComposeMode }]
}>()

const toast = useToast()
const accountsStore = useAccountsStore()

// ── Form state ──────────────────────────────────────────────────────────────

const selectedAccountId = ref<number | null>(null)
const toInput = ref('')
const toAddresses = ref<string[]>([])
const ccInput = ref('')
const ccAddresses = ref<string[]>([])
const bccInput = ref('')
const bccAddresses = ref<string[]>([])
const subject = ref('')
const body = ref('')
const sending = ref(false)

/** Show/hide CC and BCC fields */
const showCc = ref(false)
const showBcc = ref(false)

const dialogVisible = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val)
})

const dialogHeader = computed(() => {
  const mode = props.context?.mode ?? 'new'
  switch (mode) {
    case 'reply': return 'Reply'
    case 'reply-all': return 'Reply All'
    case 'forward': return 'Forward'
    default: return 'New Email'
  }
})

const canSend = computed(() => {
  return selectedAccountId.value !== null
    && toAddresses.value.length > 0
    && subject.value.trim().length > 0
    && !sending.value
})

// ── Initialize form when dialog opens or context changes ────────────────────

watch(() => props.visible, (isVisible) => {
  if (isVisible) {
    initializeForm()
  }
})

function initializeForm(): void {
  const ctx = props.context
  const mode = ctx?.mode ?? 'new'
  const msg = ctx?.originalMessage

  // Default to first account or the account of the original message
  if (msg) {
    selectedAccountId.value = msg.accountId
  } else if (accountsStore.accounts.length > 0) {
    selectedAccountId.value = accountsStore.accounts[0].id
  }

  // Reset all fields
  toInput.value = ''
  toAddresses.value = []
  ccInput.value = ''
  ccAddresses.value = []
  bccInput.value = ''
  bccAddresses.value = []
  showCc.value = false
  showBcc.value = false
  subject.value = ''
  body.value = ''
  sending.value = false

  if (!msg) return

  const senderAddr = msg.from.address
  const myAccount = accountsStore.accounts.find(a => a.id === msg.accountId)
  const myEmail = myAccount?.email?.toLowerCase()

  if (mode === 'reply') {
    // Reply to sender
    toAddresses.value = [senderAddr]
    subject.value = msg.subject.startsWith('Re:') ? msg.subject : `Re: ${msg.subject}`
    body.value = buildQuotedBody(msg)
  } else if (mode === 'reply-all') {
    // Reply to sender + all To/CC (excluding self)
    const allRecipients = new Set<string>()
    allRecipients.add(senderAddr)
    for (const addr of [...msg.to, ...msg.cc]) {
      if (addr.address.toLowerCase() !== myEmail) {
        allRecipients.add(addr.address)
      }
    }
    toAddresses.value = Array.from(allRecipients)
    subject.value = msg.subject.startsWith('Re:') ? msg.subject : `Re: ${msg.subject}`
    body.value = buildQuotedBody(msg)
    // If there were CC recipients, show CC field
    if (msg.cc.length > 0) {
      showCc.value = true
    }
  } else if (mode === 'forward') {
    // Forward — no recipients pre-filled
    toAddresses.value = []
    subject.value = msg.subject.startsWith('Fwd:') ? msg.subject : `Fwd: ${msg.subject}`
    body.value = buildForwardBody(msg)
  }
}

function buildQuotedBody(msg: Message): string {
  const date = new Date(msg.date).toLocaleString('cs-CZ')
  const sender = msg.from.name ? `${msg.from.name} <${msg.from.address}>` : msg.from.address
  const header = `\n\nOn ${date}, ${sender} wrote:\n`
  const originalText = msg.bodyText || stripHtml(msg.bodyHtml) || ''
  const quoted = originalText.split('\n').map(line => `> ${line}`).join('\n')
  return header + quoted
}

function buildForwardBody(msg: Message): string {
  const date = new Date(msg.date).toLocaleString('cs-CZ')
  const sender = msg.from.name ? `${msg.from.name} <${msg.from.address}>` : msg.from.address
  const toStr = msg.to.map(a => a.name ? `${a.name} <${a.address}>` : a.address).join(', ')
  const header = `\n\n---------- Forwarded message ----------\nFrom: ${sender}\nDate: ${date}\nSubject: ${msg.subject}\nTo: ${toStr}\n\n`
  const originalText = msg.bodyText || stripHtml(msg.bodyHtml) || ''
  return header + originalText
}

function stripHtml(html: string): string {
  if (!html) return ''
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return doc.body.textContent || ''
}

// ── Address chip helpers ────────────────────────────────────────────────────

function addAddress(target: 'to' | 'cc' | 'bcc'): void {
  const inputRef = target === 'to' ? toInput : target === 'cc' ? ccInput : bccInput
  const listRef = target === 'to' ? toAddresses : target === 'cc' ? ccAddresses : bccAddresses
  const raw = inputRef.value.trim()
  if (!raw) return

  // Support comma/semicolon separated addresses
  const addresses = raw.split(/[,;]\s*/).map(a => a.trim()).filter(a => a.length > 0)
  for (const addr of addresses) {
    if (!listRef.value.includes(addr)) {
      listRef.value.push(addr)
    }
  }
  inputRef.value = ''
}

function removeAddress(target: 'to' | 'cc' | 'bcc', index: number): void {
  const listRef = target === 'to' ? toAddresses : target === 'cc' ? ccAddresses : bccAddresses
  listRef.value.splice(index, 1)
}

function onAddressKeydown(e: KeyboardEvent, target: 'to' | 'cc' | 'bcc'): void {
  if (e.key === 'Enter' || e.key === 'Tab' || e.key === ',') {
    e.preventDefault()
    addAddress(target)
  }
}

// ── Send ────────────────────────────────────────────────────────────────────

async function send(): Promise<void> {
  if (!canSend.value || !selectedAccountId.value) return

  sending.value = true
  const mode = props.context?.mode ?? 'new'
  const orig = props.context?.originalMessage

  try {
    // Flush any typed but un-committed addresses
    addAddress('to')
    addAddress('cc')
    addAddress('bcc')

    const data: ComposeMailData = {
      accountId: selectedAccountId.value,
      to: [...toAddresses.value],
      cc: ccAddresses.value.length > 0 ? [...ccAddresses.value] : undefined,
      bcc: bccAddresses.value.length > 0 ? [...bccAddresses.value] : undefined,
      subject: subject.value,
      bodyText: body.value
    }

    // Threading headers for reply/reply-all
    if ((mode === 'reply' || mode === 'reply-all') && orig) {
      if (orig.messageId) {
        data.inReplyTo = orig.messageId
        data.references = [orig.messageId]
      }
    }

    // Strip reactive proxies — structured clone (Electron IPC) cannot handle them
    const plainData: ComposeMailData = JSON.parse(JSON.stringify(data))
    const result = await api.mail.send(plainData)

    if (result.success) {
      toast.add({
        severity: 'success',
        summary: 'Email Sent',
        detail: 'Your message has been sent successfully.',
        life: 3000
      })
      emit('sent', {
        messageId: result.messageId,
        originalMessageId: orig?.id,
        mode
      })
      dialogVisible.value = false
    } else {
      toast.add({
        severity: 'error',
        summary: 'Send Failed',
        detail: result.error || 'Unknown error',
        life: 5000
      })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    toast.add({
      severity: 'error',
      summary: 'Send Failed',
      detail: message,
      life: 5000
    })
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <Dialog
    v-model:visible="dialogVisible"
    :header="dialogHeader"
    modal
    :style="{ width: '720px', maxWidth: '90vw' }"
    :closable="!sending"
    :closeOnEscape="!sending"
    class="compose-dialog"
  >
    <div class="compose-form">
      <!-- From (account selector) -->
      <div class="compose-field">
        <label class="field-label">From</label>
        <Select
          v-model="selectedAccountId"
          :options="accountsStore.accounts"
          optionLabel="email"
          optionValue="id"
          placeholder="Select account"
          class="field-input"
        />
      </div>

      <!-- To -->
      <div class="compose-field">
        <label class="field-label">To</label>
        <div class="address-field">
          <div class="address-chips">
            <Chip
              v-for="(addr, i) in toAddresses"
              :key="addr"
              :label="addr"
              removable
              @remove="removeAddress('to', i)"
            />
          </div>
          <InputText
            v-model="toInput"
            placeholder="Add recipient..."
            class="address-input"
            @keydown="onAddressKeydown($event, 'to')"
            @blur="addAddress('to')"
          />
          <div class="address-toggles" v-if="!showCc || !showBcc">
            <Button
              v-if="!showCc"
              label="CC"
              text
              size="small"
              @click="showCc = true"
            />
            <Button
              v-if="!showBcc"
              label="BCC"
              text
              size="small"
              @click="showBcc = true"
            />
          </div>
        </div>
      </div>

      <!-- CC (optional) -->
      <div v-if="showCc" class="compose-field">
        <label class="field-label">CC</label>
        <div class="address-field">
          <div class="address-chips">
            <Chip
              v-for="(addr, i) in ccAddresses"
              :key="addr"
              :label="addr"
              removable
              @remove="removeAddress('cc', i)"
            />
          </div>
          <InputText
            v-model="ccInput"
            placeholder="Add CC recipient..."
            class="address-input"
            @keydown="onAddressKeydown($event, 'cc')"
            @blur="addAddress('cc')"
          />
        </div>
      </div>

      <!-- BCC (optional) -->
      <div v-if="showBcc" class="compose-field">
        <label class="field-label">BCC</label>
        <div class="address-field">
          <div class="address-chips">
            <Chip
              v-for="(addr, i) in bccAddresses"
              :key="addr"
              :label="addr"
              removable
              @remove="removeAddress('bcc', i)"
            />
          </div>
          <InputText
            v-model="bccInput"
            placeholder="Add BCC recipient..."
            class="address-input"
            @keydown="onAddressKeydown($event, 'bcc')"
            @blur="addAddress('bcc')"
          />
        </div>
      </div>

      <!-- Subject -->
      <div class="compose-field">
        <label class="field-label">Subject</label>
        <InputText
          v-model="subject"
          placeholder="Subject"
          class="field-input"
        />
      </div>

      <!-- Body -->
      <div class="compose-field compose-body-field">
        <Textarea
          v-model="body"
          placeholder="Write your message..."
          :autoResize="false"
          class="compose-body"
          rows="14"
        />
      </div>
    </div>

    <template #footer>
      <div class="compose-footer">
        <Button
          label="Discard"
          severity="secondary"
          text
          :disabled="sending"
          @click="dialogVisible = false"
        />
        <Button
          label="Send"
          icon="pi pi-send"
          :loading="sending"
          :disabled="!canSend"
          @click="send"
        />
      </div>
    </template>
  </Dialog>
</template>

<style scoped>
.compose-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.compose-field {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.field-label {
  width: 60px;
  flex-shrink: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--vx-text-secondary);
  padding-top: 8px;
  text-align: right;
}

.field-input {
  flex: 1;
}

.address-field {
  flex: 1;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  border: 1px solid var(--p-inputtext-border-color, var(--vx-border));
  border-radius: var(--p-inputtext-border-radius, 6px);
  padding: 4px 8px;
  min-height: 38px;
  background: var(--p-inputtext-background, var(--vx-bg-primary));
}

.address-field:focus-within {
  border-color: var(--p-inputtext-focus-border-color, var(--vx-accent));
  outline: 0 none;
  box-shadow: var(--p-inputtext-focus-ring-shadow, 0 0 0 0.2rem rgba(59, 130, 246, 0.2));
}

.address-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.address-chips :deep(.p-chip) {
  font-size: 12px;
}

.address-input {
  flex: 1;
  min-width: 120px;
  border: none !important;
  box-shadow: none !important;
  padding: 4px;
  font-size: 13px;
  background: transparent !important;
}

.address-input:focus {
  outline: none !important;
  box-shadow: none !important;
}

.address-toggles {
  display: flex;
  gap: 0;
  flex-shrink: 0;
}

.address-toggles :deep(.p-button) {
  font-size: 11px;
  padding: 2px 6px;
}

.compose-body-field {
  flex-direction: column;
}

.compose-body-field .field-label {
  display: none;
}

.compose-body {
  width: 100%;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.6;
  resize: vertical;
}

.compose-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
