<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { api } from '../services/api'
import { useAccountsStore } from '../stores/accounts'
import { useFoldersStore } from '../stores/folders'
import type { Account, AccountFormData, ThunderbirdProfile, MboxFileInfo, ImportProgress } from '../../shared/types'

import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import Select from 'primevue/select'
import Checkbox from 'primevue/checkbox'
import ProgressBar from 'primevue/progressbar'
import Message from 'primevue/message'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  imported: []
}>()

const accountsStore = useAccountsStore()
const foldersStore = useFoldersStore()

// ── State ────────────────────────────────────────────────────────────────────

type Step = 'scan' | 'select' | 'importing' | 'done'

/** Special value for the "create new account" option in the account Select */
const CREATE_NEW_ACCOUNT = -1

const step = ref<Step>('scan')
const scanning = ref(false)
const importing = ref(false)
const error = ref('')

// Scan results
const profiles = ref<ThunderbirdProfile[]>([])
const selectedProfile = ref<ThunderbirdProfile | null>(null)

// Selection
const selectedMboxFiles = ref<MboxFileInfo[]>([])
const targetAccountId = ref<number | null>(null)

// Progress
const progress = ref<ImportProgress | null>(null)
const importResult = ref<{ totalImported: number; duplicatesSkipped: number; foldersCreated: number } | null>(null)

// ── Computed ─────────────────────────────────────────────────────────────────

/** Detected email for the currently selected profile (most frequent) */
const detectedEmail = computed(() =>
  selectedProfile.value?.detectedEmails?.[0] || null
)

/** Whether we detected an email that doesn't match any existing account */
const detectedEmailIsNew = computed(() => {
  if (!detectedEmail.value) return false
  return !accountsStore.accounts.some(
    (a: Account) => a.email.toLowerCase() === detectedEmail.value!.toLowerCase()
  )
})

/** Account options for the Select dropdown, with optional "Create new" entry */
const accountOptions = computed(() => {
  const existing = accountsStore.accounts.map((a: Account) => ({
    label: `${a.name} (${a.email})`,
    value: a.id
  }))

  if (detectedEmailIsNew.value && detectedEmail.value) {
    existing.push({
      label: `+ Create account for ${detectedEmail.value}`,
      value: CREATE_NEW_ACCOUNT
    })
  }

  return existing
})

const totalSelectedMessages = computed(() =>
  selectedMboxFiles.value.reduce((sum, f) => sum + f.estimatedMessages, 0)
)

const totalSelectedSize = computed(() => {
  const bytes = selectedMboxFiles.value.reduce((sum, f) => sum + f.size, 0)
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
})

const progressPercent = computed(() => {
  if (!progress.value || progress.value.messagesTotal === 0) return 0
  return Math.round((progress.value.messagesProcessed / progress.value.messagesTotal) * 100)
})

// ── Auto-select account when profile changes ─────────────────────────────────

watch(selectedProfile, (profile) => {
  if (!profile) return
  autoSelectAccount(profile)
})

function autoSelectAccount(profile: ThunderbirdProfile): void {
  if (!profile.detectedEmails || profile.detectedEmails.length === 0) return

  // Try to find an existing account matching the detected email
  for (const email of profile.detectedEmails) {
    const match = accountsStore.accounts.find(
      (a: Account) => a.email.toLowerCase() === email.toLowerCase()
    )
    if (match) {
      targetAccountId.value = match.id
      return
    }
  }

  // No match found — pre-select "create new account"
  targetAccountId.value = CREATE_NEW_ACCOUNT
}

// ── Methods ──────────────────────────────────────────────────────────────────

function reset(): void {
  step.value = 'scan'
  scanning.value = false
  importing.value = false
  error.value = ''
  profiles.value = []
  selectedProfile.value = null
  selectedMboxFiles.value = []
  targetAccountId.value = null
  progress.value = null
  importResult.value = null
}

function close(): void {
  emit('update:visible', false)
  // Reset after animation
  setTimeout(reset, 300)
}

async function scanDirectory(): Promise<void> {
  scanning.value = true
  error.value = ''

  try {
    // Opens native folder picker dialog in main process
    const results = await api.import.scan() as ThunderbirdProfile[]

    if (results.length === 0) {
      error.value = 'No mbox files found in the selected directory. Make sure you selected a Thunderbird profile or mail directory.'
      return
    }

    profiles.value = results

    // If only one profile, auto-select it
    if (results.length === 1) {
      selectedProfile.value = results[0]
    }

    step.value = 'select'
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to scan directory'
  } finally {
    scanning.value = false
  }
}

function selectAllMboxes(): void {
  if (selectedProfile.value) {
    selectedMboxFiles.value = [...selectedProfile.value.mboxFiles]
  }
}

function deselectAllMboxes(): void {
  selectedMboxFiles.value = []
}

function isMboxSelected(mbox: MboxFileInfo): boolean {
  return selectedMboxFiles.value.some(f => f.path === mbox.path)
}

function toggleMbox(mbox: MboxFileInfo): void {
  const idx = selectedMboxFiles.value.findIndex(f => f.path === mbox.path)
  if (idx >= 0) {
    selectedMboxFiles.value.splice(idx, 1)
  } else {
    selectedMboxFiles.value.push(mbox)
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Create a stub account for an email address detected in the mbox files.
 * Fills in placeholder values for IMAP/SMTP — the user can configure them later.
 */
async function createStubAccount(email: string): Promise<number> {
  const domain = email.split('@')[1] || 'unknown'
  const name = email.split('@')[0] || 'Imported'

  const stubData: AccountFormData = {
    name: `${name} (imported)`,
    email,
    imapHost: `imap.${domain}`,
    imapPort: 993,
    smtpHost: `smtp.${domain}`,
    smtpPort: 587,
    username: email,
    password: '',
    authType: 'password',
    security: 'tls',
    smtpSecurity: 'starttls',
    color: '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0')
  }

  const account = await accountsStore.createAccount(stubData)
  return account.id
}

async function startImport(): Promise<void> {
  if (!targetAccountId.value || selectedMboxFiles.value.length === 0) return

  step.value = 'importing'
  importing.value = true
  error.value = ''

  let accountId = targetAccountId.value

  // If user chose to create a new account, do it now
  if (accountId === CREATE_NEW_ACCOUNT) {
    if (!detectedEmail.value) {
      error.value = 'No email detected for new account'
      step.value = 'done'
      importing.value = false
      return
    }
    try {
      accountId = await createStubAccount(detectedEmail.value)
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to create account'
      step.value = 'done'
      importing.value = false
      return
    }
  }

  // Listen for progress events
  if (window.electronAPI?.on) {
    window.electronAPI.on('import:progress', (p: unknown) => {
      progress.value = p as ImportProgress
    })
  }

  try {
    const result = await api.import.run(
      accountId,
      JSON.parse(JSON.stringify(selectedMboxFiles.value))
    )
    importResult.value = result
    step.value = 'done'

    // Refresh folders for the target account
    await foldersStore.fetchFolders(accountId)
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Import failed'
    step.value = 'done'
  } finally {
    importing.value = false
    if (window.electronAPI?.removeAllListeners) {
      window.electronAPI.removeAllListeners('import:progress')
    }
  }
}

function onDone(): void {
  emit('imported')
  close()
}
</script>

<template>
  <Dialog
    :visible="props.visible"
    @update:visible="(v) => v ? null : close()"
    modal
    :closable="!importing"
    header="Import from Thunderbird"
    :style="{ width: '650px' }"
    :breakpoints="{ '680px': '95vw' }"
  >
    <!-- Step 1: Scan -->
    <div v-if="step === 'scan'" class="import-step">
      <p class="step-desc">
        Select your Thunderbird profile directory or any folder containing mbox files.
        Typical locations:
      </p>
      <ul class="hint-list">
        <li><code>~/.thunderbird/&lt;profile&gt;/</code> (Linux)</li>
        <li><code>~/Library/Thunderbird/Profiles/&lt;profile&gt;/</code> (macOS)</li>
        <li><code>%APPDATA%\Thunderbird\Profiles\&lt;profile&gt;\</code> (Windows)</li>
      </ul>

      <div class="scan-actions">
        <Button
          label="Browse..."
          icon="pi pi-folder-open"
          @click="scanDirectory"
          :loading="scanning"
        />
      </div>

      <Message v-if="error" severity="error" :closable="false" class="mt-3">
        {{ error }}
      </Message>
    </div>

    <!-- Step 2: Select mbox files + target account -->
    <div v-if="step === 'select'" class="import-step">
      <!-- Profile selector (if multiple) -->
      <div v-if="profiles.length > 1" class="field mb-3">
        <label class="field-label">Mail store:</label>
        <Select
          v-model="selectedProfile"
          :options="profiles"
          optionLabel="label"
          placeholder="Select mail store"
          class="w-full"
        />
      </div>

      <!-- Detected email info -->
      <Message
        v-if="detectedEmail && !detectedEmailIsNew"
        severity="info"
        :closable="false"
        class="mb-3"
      >
        Detected recipient: <strong>{{ detectedEmail }}</strong> — matched to existing account.
      </Message>
      <Message
        v-if="detectedEmail && detectedEmailIsNew"
        severity="warn"
        :closable="false"
        class="mb-3"
      >
        Detected recipient: <strong>{{ detectedEmail }}</strong> — no matching account found.
        A new account with placeholder settings will be created.
      </Message>

      <!-- Account selector -->
      <div class="field mb-3">
        <label class="field-label">Import into account:</label>
        <Select
          v-model="targetAccountId"
          :options="accountOptions"
          optionLabel="label"
          optionValue="value"
          placeholder="Select target account"
          class="w-full"
        />
      </div>

      <!-- Mbox file list -->
      <div v-if="selectedProfile" class="mbox-section">
        <div class="mbox-header">
          <span class="mbox-title">
            Folders found in <strong>{{ selectedProfile.label }}</strong>
          </span>
          <div class="mbox-toggle-btns">
            <Button
              label="All"
              severity="secondary"
              text
              size="small"
              @click="selectAllMboxes"
            />
            <Button
              label="None"
              severity="secondary"
              text
              size="small"
              @click="deselectAllMboxes"
            />
          </div>
        </div>

        <DataTable
          :value="selectedProfile.mboxFiles"
          scrollable
          scrollHeight="300px"
          size="small"
          class="mbox-table"
        >
          <Column header="" style="width: 40px">
            <template #body="{ data }">
              <Checkbox
                :modelValue="isMboxSelected(data)"
                @update:modelValue="toggleMbox(data)"
                :binary="true"
              />
            </template>
          </Column>
          <Column header="Folder" field="relativePath">
            <template #body="{ data }">
              <span class="mbox-name">{{ data.relativePath }}</span>
            </template>
          </Column>
          <Column header="Messages" style="width: 100px; text-align: right">
            <template #body="{ data }">
              <span class="mbox-count">~{{ data.estimatedMessages }}</span>
            </template>
          </Column>
          <Column header="Size" style="width: 90px; text-align: right">
            <template #body="{ data }">
              <span class="mbox-size">{{ formatSize(data.size) }}</span>
            </template>
          </Column>
        </DataTable>

        <div v-if="selectedMboxFiles.length > 0" class="selection-summary">
          {{ selectedMboxFiles.length }} folder(s) selected
          / ~{{ totalSelectedMessages }} messages
          / {{ totalSelectedSize }}
        </div>
      </div>

      <Message v-if="error" severity="error" :closable="false" class="mt-3">
        {{ error }}
      </Message>

      <div class="step-actions">
        <Button
          label="Back"
          severity="secondary"
          text
          @click="step = 'scan'"
        />
        <Button
          label="Start Import"
          icon="pi pi-download"
          :disabled="!targetAccountId || selectedMboxFiles.length === 0"
          @click="startImport"
        />
      </div>
    </div>

    <!-- Step 3: Importing progress -->
    <div v-if="step === 'importing'" class="import-step">
      <div class="progress-section">
        <p class="progress-label">
          Importing emails...
        </p>

        <ProgressBar :value="progressPercent" class="mb-2" />

        <div v-if="progress" class="progress-details">
          <span>
            File {{ progress.currentFileIndex + 1 }} / {{ progress.totalFiles }}:
            <strong>{{ progress.currentFile }}</strong>
          </span>
          <span>
            {{ progress.messagesProcessed }} / ~{{ progress.messagesTotal }} processed
          </span>
        </div>
        <div v-if="progress && (progress.messagesImported > 0 || progress.duplicatesSkipped > 0)" class="progress-counts">
          <span>{{ progress.messagesImported }} imported</span>
          <span v-if="progress.duplicatesSkipped > 0" class="skipped-count">
            {{ progress.duplicatesSkipped }} duplicates skipped
          </span>
        </div>
      </div>
    </div>

    <!-- Step 4: Done -->
    <div v-if="step === 'done'" class="import-step">
      <Message v-if="error" severity="error" :closable="false">
        Import failed: {{ error }}
      </Message>

      <Message v-else-if="importResult" severity="success" :closable="false">
        Import complete!
      </Message>

      <div v-if="importResult" class="result-details">
        <div class="result-row">
          <span class="result-label">Messages imported:</span>
          <strong>{{ importResult.totalImported }}</strong>
        </div>
        <div v-if="importResult.duplicatesSkipped > 0" class="result-row">
          <span class="result-label">Duplicates skipped:</span>
          <strong>{{ importResult.duplicatesSkipped }}</strong>
        </div>
        <div class="result-row">
          <span class="result-label">Folders created:</span>
          <strong>{{ importResult.foldersCreated }}</strong>
        </div>
      </div>

      <div class="step-actions">
        <Button
          label="Done"
          icon="pi pi-check"
          @click="onDone"
        />
      </div>
    </div>
  </Dialog>
</template>

<style scoped>
.import-step {
  padding: 4px 0;
}

.step-desc {
  font-size: 13px;
  color: var(--vx-text-secondary);
  margin: 0 0 12px;
  line-height: 1.5;
}

.hint-list {
  font-size: 12px;
  color: var(--vx-text-muted);
  margin: 0 0 16px;
  padding-left: 20px;
}

.hint-list code {
  background: var(--vx-bg-secondary);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 11px;
}

.scan-actions {
  display: flex;
  gap: 8px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--vx-text-secondary);
}

.mbox-section {
  margin-top: 8px;
}

.mbox-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.mbox-title {
  font-size: 13px;
  color: var(--vx-text-primary);
}

.mbox-toggle-btns {
  display: flex;
  gap: 2px;
}

.mbox-table {
  font-size: 12px;
}

.mbox-name {
  font-family: monospace;
  font-size: 12px;
}

.mbox-count,
.mbox-size {
  font-size: 12px;
  color: var(--vx-text-muted);
}

.selection-summary {
  margin-top: 8px;
  font-size: 12px;
  color: var(--vx-text-secondary);
  font-weight: 600;
}

.step-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--vx-border);
}

.progress-section {
  padding: 16px 0;
}

.progress-label {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 12px;
}

.progress-details {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--vx-text-muted);
  margin-top: 8px;
}

.progress-counts {
  display: flex;
  gap: 16px;
  font-size: 12px;
  color: var(--vx-text-secondary);
  margin-top: 4px;
}

.skipped-count {
  color: var(--vx-text-muted);
  font-style: italic;
}

.result-details {
  margin: 16px 0;
  padding: 12px;
  background: var(--vx-bg-secondary);
  border-radius: 8px;
}

.result-row {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  padding: 4px 0;
}

.result-label {
  color: var(--vx-text-secondary);
}

.mt-3 {
  margin-top: 12px;
}

.mb-2 {
  margin-bottom: 8px;
}

.mb-3 {
  margin-bottom: 12px;
}

.w-full {
  width: 100%;
}
</style>
