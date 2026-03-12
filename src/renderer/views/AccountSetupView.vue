<script setup lang="ts">
import { ref, computed, toRaw } from 'vue'
import { useRouter } from 'vue-router'
import { useAccountsStore } from '../stores/accounts'
import { useToast } from 'primevue/usetoast'
import type { AccountFormData } from '../../shared/types'

import Stepper from 'primevue/stepper'
import StepList from 'primevue/steplist'
import StepPanels from 'primevue/steppanels'
import Step from 'primevue/step'
import StepPanel from 'primevue/steppanel'
import InputText from 'primevue/inputtext'
import Password from 'primevue/password'
import Select from 'primevue/select'
import InputNumber from 'primevue/inputnumber'
import Button from 'primevue/button'
import FloatLabel from 'primevue/floatlabel'
import Message from 'primevue/message'

const router = useRouter()
const accountsStore = useAccountsStore()
const toast = useToast()

const testing = ref(false)
const testResult = ref<{ success: boolean; error?: string } | null>(null)
const saving = ref(false)
const syncing = ref(false)
const syncStatus = ref('')

const form = ref<AccountFormData>({
  name: '',
  email: '',
  imapHost: '',
  imapPort: 993,
  smtpHost: '',
  smtpPort: 587,
  username: '',
  password: '',
  authType: 'password',
  security: 'tls',
  smtpSecurity: 'starttls',
  color: '#7c6cf0'
})

const securityOptions = [
  { label: 'SSL/TLS', value: 'tls' },
  { label: 'STARTTLS', value: 'starttls' },
  { label: 'None', value: 'none' }
]

const colorOptions = [
  '#7c6cf0', '#4A90D9', '#2ecc71', '#e74c3c',
  '#f39c12', '#9b59b6', '#1abc9c', '#e67e22'
]

// Auto-detect server settings from email
function autoDetect(): void {
  const email = form.value.email
  if (!email || !email.includes('@')) return

  const domain = email.split('@')[1]
  form.value.username = email

  // Common provider presets
  const presets: Record<string, Partial<AccountFormData>> = {
    'gmail.com': {
      imapHost: 'imap.gmail.com', imapPort: 993,
      smtpHost: 'smtp.gmail.com', smtpPort: 587,
      security: 'tls', smtpSecurity: 'starttls'
    },
    'outlook.com': {
      imapHost: 'outlook.office365.com', imapPort: 993,
      smtpHost: 'smtp.office365.com', smtpPort: 587,
      security: 'tls', smtpSecurity: 'starttls'
    },
    'hotmail.com': {
      imapHost: 'outlook.office365.com', imapPort: 993,
      smtpHost: 'smtp.office365.com', smtpPort: 587,
      security: 'tls', smtpSecurity: 'starttls'
    },
    'seznam.cz': {
      imapHost: 'imap.seznam.cz', imapPort: 993,
      smtpHost: 'smtp.seznam.cz', smtpPort: 465,
      security: 'tls', smtpSecurity: 'tls'
    },
    'email.cz': {
      imapHost: 'imap.seznam.cz', imapPort: 993,
      smtpHost: 'smtp.seznam.cz', smtpPort: 465,
      security: 'tls', smtpSecurity: 'tls'
    },
    'yahoo.com': {
      imapHost: 'imap.mail.yahoo.com', imapPort: 993,
      smtpHost: 'smtp.mail.yahoo.com', smtpPort: 587,
      security: 'tls', smtpSecurity: 'starttls'
    }
  }

  const preset = presets[domain]
  if (preset) {
    Object.assign(form.value, preset)
    form.value.name = form.value.name || domain.split('.')[0]
  } else {
    // Generic fallback
    form.value.imapHost = `imap.${domain}`
    form.value.smtpHost = `smtp.${domain}`
    form.value.name = form.value.name || domain.split('.')[0]
  }
}

/** Convert reactive form data to a plain cloneable object */
function getFormData(): AccountFormData {
  return JSON.parse(JSON.stringify(toRaw(form.value)))
}

async function testConnection(): Promise<void> {
  testing.value = true
  testResult.value = null
  try {
    testResult.value = await accountsStore.testConnection(getFormData())
  } catch (error) {
    testResult.value = {
      success: false,
      error: error instanceof Error ? error.message : 'Connection test failed'
    }
  } finally {
    testing.value = false
  }
}

async function saveAccount(): Promise<void> {
  saving.value = true
  try {
    const account = await accountsStore.createAccount(getFormData())
    toast.add({
      severity: 'success',
      summary: 'Account added',
      detail: `${form.value.email} has been configured successfully`,
      life: 3000
    })

    // Trigger initial sync in the background
    syncing.value = true
    syncStatus.value = 'Syncing folders and messages...'
    try {
      await window.electronAPI.sync.fullAccount(account.id, true)
      syncStatus.value = 'Sync complete!'
    } catch (syncError) {
      console.error('Initial sync failed:', syncError)
      syncStatus.value = 'Sync failed, you can retry from the mail view.'
      toast.add({
        severity: 'warn',
        summary: 'Sync issue',
        detail: 'Account saved but initial sync failed. Messages will sync when you open folders.',
        life: 5000
      })
    } finally {
      syncing.value = false
    }

    router.push({ name: 'mail' })
  } catch (error) {
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: error instanceof Error ? error.message : 'Failed to save account',
      life: 5000
    })
  } finally {
    saving.value = false
  }
}

const canProceedBasic = computed(() =>
  form.value.name.trim() !== '' && form.value.email.includes('@')
)

const canProceedServer = computed(() =>
  form.value.imapHost.trim() !== '' &&
  form.value.smtpHost.trim() !== '' &&
  form.value.username.trim() !== '' &&
  form.value.password.trim() !== ''
)
</script>

<template>
  <div class="setup-page">
    <div class="setup-container">
      <div class="setup-header">
        <h1>Add Email Account</h1>
        <p>Configure your IMAP email account to get started with Vextron</p>
      </div>

      <Stepper value="1" linear>
        <StepList>
          <Step value="1">Basic Info</Step>
          <Step value="2">Server Settings</Step>
          <Step value="3">Verify & Save</Step>
        </StepList>
        <StepPanels>
          <!-- Step 1: Basic Info -->
          <StepPanel v-slot="{ activateCallback }" value="1">
            <div class="step-content">
              <div class="form-grid">
                <FloatLabel class="form-field">
                  <InputText
                    id="account-name"
                    v-model="form.name"
                    class="w-full"
                  />
                  <label for="account-name">Account Name</label>
                </FloatLabel>

                <FloatLabel class="form-field">
                  <InputText
                    id="email"
                    v-model="form.email"
                    type="email"
                    class="w-full"
                    @blur="autoDetect"
                  />
                  <label for="email">Email Address</label>
                </FloatLabel>

                <!-- Color picker -->
                <div class="form-field">
                  <label class="field-label">Account Color</label>
                  <div class="color-picker">
                    <div
                      v-for="color in colorOptions"
                      :key="color"
                      class="color-swatch"
                      :class="{ active: form.color === color }"
                      :style="{ backgroundColor: color }"
                      @click="form.color = color"
                    />
                  </div>
                </div>
              </div>

              <div class="step-actions">
                <Button
                  label="Skip to Mail"
                  severity="secondary"
                  text
                  @click="router.push({ name: 'mail' })"
                  v-if="accountsStore.hasAccounts"
                />
                <Button
                  label="Next"
                  icon="pi pi-arrow-right"
                  iconPos="right"
                  :disabled="!canProceedBasic"
                  @click="activateCallback('2')"
                />
              </div>
            </div>
          </StepPanel>

          <!-- Step 2: Server Settings -->
          <StepPanel v-slot="{ activateCallback }" value="2">
            <div class="step-content">
              <h3 class="section-title">IMAP (Incoming)</h3>
              <div class="form-row">
                <FloatLabel class="form-field flex-grow">
                  <InputText
                    id="imap-host"
                    v-model="form.imapHost"
                    class="w-full"
                  />
                  <label for="imap-host">IMAP Server</label>
                </FloatLabel>
                <FloatLabel class="form-field" style="width: 120px">
                  <InputNumber
                    id="imap-port"
                    v-model="form.imapPort"
                    :useGrouping="false"
                    class="w-full"
                  />
                  <label for="imap-port">Port</label>
                </FloatLabel>
                <Select
                  v-model="form.security"
                  :options="securityOptions"
                  optionLabel="label"
                  optionValue="value"
                  placeholder="Security"
                  class="form-field"
                  style="width: 150px"
                />
              </div>

              <h3 class="section-title">SMTP (Outgoing)</h3>
              <div class="form-row">
                <FloatLabel class="form-field flex-grow">
                  <InputText
                    id="smtp-host"
                    v-model="form.smtpHost"
                    class="w-full"
                  />
                  <label for="smtp-host">SMTP Server</label>
                </FloatLabel>
                <FloatLabel class="form-field" style="width: 120px">
                  <InputNumber
                    id="smtp-port"
                    v-model="form.smtpPort"
                    :useGrouping="false"
                    class="w-full"
                  />
                  <label for="smtp-port">Port</label>
                </FloatLabel>
                <Select
                  v-model="form.smtpSecurity"
                  :options="securityOptions"
                  optionLabel="label"
                  optionValue="value"
                  placeholder="Security"
                  class="form-field"
                  style="width: 150px"
                />
              </div>

              <h3 class="section-title">Authentication</h3>
              <div class="form-row">
                <FloatLabel class="form-field flex-grow">
                  <InputText
                    id="username"
                    v-model="form.username"
                    class="w-full"
                  />
                  <label for="username">Username</label>
                </FloatLabel>
                <FloatLabel class="form-field flex-grow">
                  <Password
                    id="password"
                    v-model="form.password"
                    :feedback="false"
                    toggleMask
                    class="w-full"
                    inputClass="w-full"
                  />
                  <label for="password">Password</label>
                </FloatLabel>
              </div>

              <!-- Test connection result -->
              <Message v-if="testResult?.success" severity="success" :closable="false">
                Connection test successful! Your IMAP server is reachable.
              </Message>
              <Message v-if="testResult && !testResult.success" severity="error" :closable="false">
                Connection failed: {{ testResult.error }}
              </Message>

              <div class="step-actions">
                <Button
                  label="Back"
                  severity="secondary"
                  text
                  @click="activateCallback('1')"
                />
                <Button
                  label="Test Connection"
                  icon="pi pi-bolt"
                  severity="info"
                  outlined
                  :loading="testing"
                  :disabled="!canProceedServer"
                  @click="testConnection"
                />
                <Button
                  label="Next"
                  icon="pi pi-arrow-right"
                  iconPos="right"
                  :disabled="!canProceedServer"
                  @click="activateCallback('3')"
                />
              </div>
            </div>
          </StepPanel>

          <!-- Step 3: Verify & Save -->
          <StepPanel v-slot="{ activateCallback }" value="3">
            <div class="step-content">
              <!-- Summary -->
              <div class="summary-card">
                <h3>Account Summary</h3>
                <div class="summary-grid">
                  <div class="summary-item">
                    <span class="summary-label">Name</span>
                    <span>{{ form.name }}</span>
                  </div>
                  <div class="summary-item">
                    <span class="summary-label">Email</span>
                    <span>{{ form.email }}</span>
                  </div>
                  <div class="summary-item">
                    <span class="summary-label">IMAP</span>
                    <span>{{ form.imapHost }}:{{ form.imapPort }} ({{ form.security }})</span>
                  </div>
                  <div class="summary-item">
                    <span class="summary-label">SMTP</span>
                    <span>{{ form.smtpHost }}:{{ form.smtpPort }} ({{ form.smtpSecurity }})</span>
                  </div>
                </div>
              </div>

              <!-- Test status reminder -->
              <Message v-if="testResult?.success" severity="success" :closable="false">
                Connection verified successfully.
              </Message>
              <Message v-if="!testResult" severity="warn" :closable="false">
                Connection has not been tested. You can still save, but consider going back to test first.
              </Message>

              <div class="step-actions">
                <Button
                  label="Back"
                  severity="secondary"
                  text
                  @click="activateCallback('2')"
                  :disabled="saving || syncing"
                />
                <Button
                  :label="syncing ? syncStatus : 'Save Account'"
                  :icon="syncing ? 'pi pi-sync pi-spin' : 'pi pi-check'"
                  :loading="saving || syncing"
                  @click="saveAccount"
                />
              </div>
            </div>
          </StepPanel>
        </StepPanels>
      </Stepper>
    </div>
  </div>
</template>

<style scoped>
.setup-page {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background: var(--vx-bg-primary);
  padding: 24px;
}

.setup-container {
  width: 100%;
  max-width: 720px;
  background: var(--vx-bg-secondary);
  border: 1px solid var(--vx-border);
  border-radius: 12px;
  padding: 32px;
}

.setup-header {
  text-align: center;
  margin-bottom: 32px;
}

.setup-header h1 {
  font-size: 24px;
  font-weight: 700;
  margin-bottom: 8px;
}

.setup-header p {
  color: var(--vx-text-muted);
  font-size: 14px;
}

/* Override PrimeVue stepper panel internal padding */
.setup-container :deep(.p-steppanel-content) {
  padding: 0;
}

.step-content {
  padding: 24px 16px;
}

.form-grid {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.form-row {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  margin-bottom: 16px;
}

.form-field {
  min-width: 0;
}

.flex-grow {
  flex: 1;
}

.field-label {
  font-size: 12px;
  color: var(--vx-text-secondary);
  margin-bottom: 8px;
  display: block;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 12px;
  margin-top: 8px;
  color: var(--vx-text-secondary);
}

.color-picker {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.color-swatch {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  cursor: pointer;
  border: 2px solid transparent;
  transition: all 0.15s;
}

.color-swatch:hover {
  transform: scale(1.1);
}

.color-swatch.active {
  border-color: var(--vx-text-primary);
  box-shadow: 0 0 0 2px var(--vx-bg-secondary), 0 0 0 4px var(--vx-text-primary);
}

.step-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid var(--vx-border);
}

.summary-card {
  background: var(--vx-bg-tertiary);
  border: 1px solid var(--vx-border);
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 16px;
}

.summary-card h3 {
  font-size: 14px;
  margin-bottom: 12px;
}

.summary-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.summary-item {
  font-size: 13px;
}

.summary-label {
  display: block;
  font-size: 11px;
  color: var(--vx-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 2px;
}
</style>
