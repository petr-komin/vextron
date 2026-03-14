<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../services/api'
import type { AiConfig, AiProvider, AiBlacklistRule, AiBlacklistPatternType } from '../../shared/types'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import InputSwitch from 'primevue/inputswitch'
import Password from 'primevue/password'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Dialog from 'primevue/dialog'
import { useToast } from 'primevue/usetoast'

const router = useRouter()
const toast = useToast()

// ─── AI Config state ─────────────────────────────────────────────────────────

const aiProvider = ref<AiProvider>('together')
const aiApiKey = ref('')
const aiModel = ref('meta-llama/Llama-3.3-70B-Instruct-Turbo')
const aiBaseUrl = ref('https://api.together.xyz/v1')
const aiEmbeddingModel = ref('')
const aiIsActive = ref(true)
const aiSaving = ref(false)
const aiLoaded = ref(false)

const providerOptions = [
  { label: 'Together.ai', value: 'together' },
  { label: 'OpenAI', value: 'openai' },
  { label: 'Ollama (local)', value: 'ollama' }
]

const defaultBaseUrls: Record<AiProvider, string> = {
  together: 'https://api.together.xyz/v1',
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  ollama: 'http://localhost:11434/v1'
}

const defaultModels: Record<AiProvider, string> = {
  together: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-haiku-20240307',
  ollama: 'llama3.1'
}

const defaultEmbeddingModels: Record<AiProvider, string> = {
  together: 'intfloat/multilingual-e5-large-instruct',
  openai: 'text-embedding-3-small',
  anthropic: '',
  ollama: 'nomic-embed-text'
}

function onProviderChange(): void {
  aiBaseUrl.value = defaultBaseUrls[aiProvider.value]
  aiModel.value = defaultModels[aiProvider.value]
  aiEmbeddingModel.value = defaultEmbeddingModels[aiProvider.value]
}

async function loadAiConfig(): Promise<void> {
  try {
    const config = await api.ai.getConfig()
    if (config) {
      aiProvider.value = config.provider
      aiApiKey.value = config.apiKey || ''
      aiModel.value = config.model
      aiBaseUrl.value = config.baseUrl || defaultBaseUrls[config.provider]
      aiEmbeddingModel.value = config.embeddingModel || ''
      aiIsActive.value = config.isActive
    }
    aiLoaded.value = true
  } catch (err) {
    console.error('[Settings] Failed to load AI config:', err)
    aiLoaded.value = true
  }
}

async function saveAiConfig(): Promise<void> {
  aiSaving.value = true
  try {
    await api.ai.setConfig({
      provider: aiProvider.value,
      apiKey: aiApiKey.value || undefined,
      model: aiModel.value,
      baseUrl: aiBaseUrl.value || undefined,
      embeddingModel: aiEmbeddingModel.value || undefined,
      isActive: aiIsActive.value
    })
    toast.add({
      severity: 'success',
      summary: 'AI Config Saved',
      detail: `Provider: ${aiProvider.value} | Model: ${aiModel.value}`,
      life: 3000
    })
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Failed to Save AI Config',
      detail: err instanceof Error ? err.message : 'Unknown error',
      life: 5000
    })
  } finally {
    aiSaving.value = false
  }
}

// ─── AI Blacklist state ──────────────────────────────────────────────────────

const blacklistRules = ref<AiBlacklistRule[]>([])
const blacklistLoading = ref(false)
const showAddRuleDialog = ref(false)
const newRulePattern = ref('')
const newRuleType = ref<AiBlacklistPatternType>('domain')
const addingRule = ref(false)

const patternTypeOptions = [
  { label: 'Sender domain', value: 'domain', placeholder: 'e.g. github.com' },
  { label: 'Sender address', value: 'address', placeholder: 'e.g. noreply@example.com' },
  { label: 'Subject pattern', value: 'subject', placeholder: 'e.g. Your order*' }
]

const selectedPatternTypeOption = ref(patternTypeOptions[0])

function onPatternTypeChange(): void {
  newRuleType.value = selectedPatternTypeOption.value.value as AiBlacklistPatternType
}

async function loadBlacklist(): Promise<void> {
  blacklistLoading.value = true
  try {
    blacklistRules.value = await api.ai.blacklist.list()
  } catch (err) {
    console.error('[Settings] Failed to load blacklist:', err)
  } finally {
    blacklistLoading.value = false
  }
}

function openAddRuleDialog(): void {
  newRulePattern.value = ''
  newRuleType.value = 'domain'
  selectedPatternTypeOption.value = patternTypeOptions[0]
  showAddRuleDialog.value = true
}

async function addBlacklistRule(): Promise<void> {
  if (!newRulePattern.value.trim()) return

  addingRule.value = true
  try {
    await api.ai.blacklist.add(newRulePattern.value.trim(), newRuleType.value)
    showAddRuleDialog.value = false
    await loadBlacklist()
    toast.add({
      severity: 'success',
      summary: 'Blacklist Rule Added',
      detail: `${newRuleType.value}: ${newRulePattern.value}`,
      life: 3000
    })
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Failed to Add Rule',
      detail: err instanceof Error ? err.message : 'Unknown error',
      life: 5000
    })
  } finally {
    addingRule.value = false
  }
}

async function removeBlacklistRule(rule: AiBlacklistRule): Promise<void> {
  try {
    await api.ai.blacklist.remove(rule.id)
    await loadBlacklist()
    toast.add({
      severity: 'info',
      summary: 'Rule Removed',
      detail: `${rule.patternType}: ${rule.pattern}`,
      life: 3000
    })
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Failed to Remove Rule',
      detail: err instanceof Error ? err.message : 'Unknown error',
      life: 5000
    })
  }
}

function formatPatternType(type: string): string {
  switch (type) {
    case 'domain': return 'Domain'
    case 'address': return 'Address'
    case 'subject': return 'Subject'
    default: return type
  }
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString('cs-CZ', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  })
}

// ─── Init ────────────────────────────────────────────────────────────────────

onMounted(() => {
  loadAiConfig()
  loadBlacklist()
})
</script>

<template>
  <div class="settings-page">
    <div class="settings-container">
      <div class="settings-header">
        <Button
          icon="pi pi-arrow-left"
          severity="secondary"
          text
          rounded
          @click="router.push({ name: 'mail' })"
        />
        <h1>Settings</h1>
      </div>

      <div class="settings-sections">
        <!-- Accounts section -->
        <section class="settings-section">
          <h2>Accounts</h2>
          <p class="section-description">Manage your email accounts</p>
          <Button
            label="Add Account"
            icon="pi pi-plus"
            size="small"
            @click="router.push({ name: 'account-setup' })"
          />
        </section>

        <!-- AI Configuration section -->
        <section class="settings-section">
          <div class="section-title-row">
            <h2>AI Configuration</h2>
            <InputSwitch v-model="aiIsActive" />
          </div>
          <p class="section-description">
            Configure AI provider for email classification and summarization.
          </p>

          <div v-if="aiLoaded" class="ai-config-form">
            <div class="form-row">
              <label class="form-label">Provider</label>
              <Select
                v-model="aiProvider"
                :options="providerOptions"
                optionLabel="label"
                optionValue="value"
                class="form-input"
                @change="onProviderChange"
              />
            </div>

            <div class="form-row">
              <label class="form-label">API Key</label>
              <Password
                v-model="aiApiKey"
                :feedback="false"
                toggleMask
                class="form-input"
                :placeholder="aiProvider === 'ollama' ? 'Not required for Ollama' : 'Enter your API key'"
                inputClass="form-password-input"
              />
            </div>

            <div class="form-row">
              <label class="form-label">Model</label>
              <InputText
                v-model="aiModel"
                class="form-input"
                placeholder="Model identifier"
              />
            </div>

            <div class="form-row">
              <label class="form-label">Embedding Model</label>
              <InputText
                v-model="aiEmbeddingModel"
                class="form-input"
                placeholder="Model for vector embeddings (e.g. intfloat/multilingual-e5-large-instruct)"
              />
              <small class="form-hint">
                Used for semantic search in AI Overview. Leave empty to use the provider default.
              </small>
            </div>

            <div class="form-row">
              <label class="form-label">Base URL</label>
              <InputText
                v-model="aiBaseUrl"
                class="form-input"
                placeholder="API base URL"
              />
            </div>

            <div class="form-actions">
              <Button
                label="Save Configuration"
                icon="pi pi-check"
                size="small"
                :loading="aiSaving"
                @click="saveAiConfig"
              />
            </div>
          </div>
        </section>

        <!-- AI Blacklist section -->
        <section class="settings-section">
          <div class="section-title-row">
            <h2>AI Blacklist</h2>
            <Button
              label="Add Rule"
              icon="pi pi-plus"
              size="small"
              severity="secondary"
              @click="openAddRuleDialog"
            />
          </div>
          <p class="section-description">
            Emails matching these rules will be excluded from AI analysis.
            Use wildcards (*) for subject patterns.
          </p>

          <DataTable
            :value="blacklistRules"
            :loading="blacklistLoading"
            size="small"
            stripedRows
            class="blacklist-table"
            :pt="{ root: { style: 'font-size: 13px' } }"
          >
            <template #empty>
              <div class="table-empty">No blacklist rules configured</div>
            </template>
            <Column field="patternType" header="Type" style="width: 100px">
              <template #body="{ data }">
                <span class="pattern-type-badge" :class="`type-${data.patternType}`">
                  {{ formatPatternType(data.patternType) }}
                </span>
              </template>
            </Column>
            <Column field="pattern" header="Pattern">
              <template #body="{ data }">
                <code class="pattern-value">{{ data.pattern }}</code>
              </template>
            </Column>
            <Column field="createdAt" header="Added" style="width: 120px">
              <template #body="{ data }">
                {{ formatDate(data.createdAt) }}
              </template>
            </Column>
            <Column style="width: 50px">
              <template #body="{ data }">
                <Button
                  icon="pi pi-trash"
                  severity="danger"
                  text
                  rounded
                  size="small"
                  @click="removeBlacklistRule(data)"
                />
              </template>
            </Column>
          </DataTable>
        </section>

        <!-- Database section -->
        <section class="settings-section">
          <h2>Database</h2>
          <p class="section-description">
            PostgreSQL connection settings. Current: localhost:5432/vextron
          </p>
        </section>
      </div>
    </div>

    <!-- Add Rule Dialog -->
    <Dialog
      v-model:visible="showAddRuleDialog"
      header="Add Blacklist Rule"
      :modal="true"
      :style="{ width: '450px' }"
    >
      <div class="dialog-form">
        <div class="form-row">
          <label class="form-label">Rule Type</label>
          <Select
            v-model="selectedPatternTypeOption"
            :options="patternTypeOptions"
            optionLabel="label"
            class="form-input"
            @change="onPatternTypeChange"
          />
        </div>

        <div class="form-row">
          <label class="form-label">Pattern</label>
          <InputText
            v-model="newRulePattern"
            class="form-input"
            :placeholder="selectedPatternTypeOption.placeholder"
            @keyup.enter="addBlacklistRule"
          />
        </div>

        <div v-if="newRuleType === 'subject'" class="form-hint">
          Use * as a wildcard. Example: <code>Your order*</code> matches "Your order #12345"
        </div>
      </div>

      <template #footer>
        <Button
          label="Cancel"
          severity="secondary"
          text
          @click="showAddRuleDialog = false"
        />
        <Button
          label="Add Rule"
          icon="pi pi-plus"
          :loading="addingRule"
          :disabled="!newRulePattern.trim()"
          @click="addBlacklistRule"
        />
      </template>
    </Dialog>
  </div>
</template>

<style scoped>
.settings-page {
  height: 100vh;
  overflow-y: auto;
  background: var(--vx-bg-primary);
  padding: 24px;
}

.settings-container {
  max-width: 720px;
  margin: 0 auto;
}

.settings-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 32px;
}

.settings-header h1 {
  font-size: 24px;
  font-weight: 700;
}

.settings-sections {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.settings-section {
  background: var(--vx-bg-secondary);
  border: 1px solid var(--vx-border);
  border-radius: 8px;
  padding: 20px;
}

.settings-section h2 {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 8px;
}

.section-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.section-title-row h2 {
  margin-bottom: 0;
}

.section-description {
  font-size: 13px;
  color: var(--vx-text-muted);
  margin-bottom: 16px;
  line-height: 1.5;
}

/* ── AI Config Form ────────────────────────────────────────────────────────── */

.ai-config-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.form-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.form-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--vx-text-secondary);
}

.form-input {
  width: 100%;
}

:deep(.form-password-input) {
  width: 100%;
}

.form-actions {
  margin-top: 8px;
}

.form-hint {
  font-size: 12px;
  color: var(--vx-text-muted);
  margin-top: 4px;
}

.form-hint code {
  background: var(--vx-bg-primary);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 11px;
}

/* ── Blacklist Table ───────────────────────────────────────────────────────── */

.blacklist-table {
  margin-top: 8px;
}

.table-empty {
  text-align: center;
  color: var(--vx-text-muted);
  padding: 16px 0;
  font-size: 13px;
}

.pattern-type-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
}

.pattern-type-badge.type-domain {
  background: rgba(26, 115, 232, 0.1);
  color: #1a73e8;
}

.pattern-type-badge.type-address {
  background: rgba(52, 168, 83, 0.1);
  color: #34a853;
}

.pattern-type-badge.type-subject {
  background: rgba(251, 188, 4, 0.15);
  color: #c77c00;
}

.pattern-value {
  font-size: 12px;
  background: var(--vx-bg-primary);
  padding: 2px 6px;
  border-radius: 3px;
}

/* ── Dialog ────────────────────────────────────────────────────────────────── */

.dialog-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
</style>
