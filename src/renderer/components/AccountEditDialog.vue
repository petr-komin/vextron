<script setup lang="ts">
import { ref, watch, toRaw } from 'vue'
import { useAccountsStore } from '../stores/accounts'
import { useToast } from 'primevue/usetoast'
import type { Account, AccountFormData } from '../../shared/types'

import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import Password from 'primevue/password'
import Select from 'primevue/select'
import InputNumber from 'primevue/inputnumber'
import Button from 'primevue/button'
import FloatLabel from 'primevue/floatlabel'
import Message from 'primevue/message'
import ConfirmDialog from 'primevue/confirmdialog'
import { useConfirm } from 'primevue/useconfirm'

const props = defineProps<{
  visible: boolean
  account: Account | null
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  deleted: [accountId: number]
}>()

const accountsStore = useAccountsStore()
const toast = useToast()
const confirm = useConfirm()

const saving = ref(false)
const testing = ref(false)
const testResult = ref<{ success: boolean; error?: string } | null>(null)

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

// Populate form when account changes
watch(
  () => props.account,
  (account) => {
    if (account) {
      form.value = {
        name: account.name,
        email: account.email,
        imapHost: account.imapHost,
        imapPort: account.imapPort,
        smtpHost: account.smtpHost,
        smtpPort: account.smtpPort,
        username: account.username,
        password: '', // password is never sent to renderer
        authType: account.authType,
        security: account.security,
        smtpSecurity: account.smtpSecurity,
        color: account.color
      }
      testResult.value = null
    }
  },
  { immediate: true }
)

function getFormData(): Partial<AccountFormData> {
  const data = JSON.parse(JSON.stringify(toRaw(form.value))) as AccountFormData
  // Only include password if user typed a new one
  if (!data.password) {
    const { password, ...rest } = data
    return rest
  }
  return data
}

async function testConnection(): Promise<void> {
  testing.value = true
  testResult.value = null
  try {
    // For testing, we need a full AccountFormData with password.
    // If user didn't enter a new password, warn them.
    if (!form.value.password) {
      testResult.value = {
        success: false,
        error: 'Enter your password to test the connection.'
      }
      return
    }
    const data = JSON.parse(JSON.stringify(toRaw(form.value))) as AccountFormData
    testResult.value = await accountsStore.testConnection(data)
  } catch (error) {
    testResult.value = {
      success: false,
      error: error instanceof Error ? error.message : 'Connection test failed'
    }
  } finally {
    testing.value = false
  }
}

async function save(): Promise<void> {
  if (!props.account) return
  saving.value = true
  try {
    await accountsStore.updateAccount(props.account.id, getFormData())
    toast.add({
      severity: 'success',
      summary: 'Account updated',
      detail: `${form.value.name} has been updated`,
      life: 3000
    })
    emit('update:visible', false)
  } catch (error) {
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: error instanceof Error ? error.message : 'Failed to update account',
      life: 5000
    })
  } finally {
    saving.value = false
  }
}

function confirmDelete(): void {
  if (!props.account) return
  confirm.require({
    message: `Delete account "${props.account.name}" (${props.account.email})? This will remove all synced messages and folders locally.`,
    header: 'Delete Account',
    icon: 'pi pi-exclamation-triangle',
    rejectLabel: 'Cancel',
    acceptLabel: 'Delete',
    acceptClass: 'p-button-danger',
    accept: async () => {
      if (!props.account) return
      try {
        const id = props.account.id
        await accountsStore.deleteAccount(id)
        toast.add({
          severity: 'info',
          summary: 'Account deleted',
          detail: 'Account and its local data have been removed',
          life: 3000
        })
        emit('deleted', id)
        emit('update:visible', false)
      } catch (error) {
        toast.add({
          severity: 'error',
          summary: 'Error',
          detail: error instanceof Error ? error.message : 'Failed to delete account',
          life: 5000
        })
      }
    }
  })
}

function close(): void {
  emit('update:visible', false)
}
</script>

<template>
  <Dialog
    :visible="visible"
    @update:visible="emit('update:visible', $event)"
    header="Edit Account"
    :style="{ width: '620px' }"
    modal
    :closable="true"
    :draggable="false"
  >
    <div class="edit-form" v-if="account">
      <!-- Basic info -->
      <div class="form-section">
        <div class="form-row">
          <FloatLabel class="form-field flex-grow">
            <InputText
              id="edit-name"
              v-model="form.name"
              class="w-full"
            />
            <label for="edit-name">Account Name</label>
          </FloatLabel>
          <FloatLabel class="form-field flex-grow">
            <InputText
              id="edit-email"
              v-model="form.email"
              type="email"
              class="w-full"
            />
            <label for="edit-email">Email Address</label>
          </FloatLabel>
        </div>

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

      <!-- Server settings -->
      <div class="form-section">
        <h4 class="section-title">IMAP (Incoming)</h4>
        <div class="form-row">
          <FloatLabel class="form-field flex-grow">
            <InputText
              id="edit-imap-host"
              v-model="form.imapHost"
              class="w-full"
            />
            <label for="edit-imap-host">IMAP Server</label>
          </FloatLabel>
          <FloatLabel class="form-field" style="width: 100px">
            <InputNumber
              id="edit-imap-port"
              v-model="form.imapPort"
              :useGrouping="false"
              class="w-full"
            />
            <label for="edit-imap-port">Port</label>
          </FloatLabel>
          <Select
            v-model="form.security"
            :options="securityOptions"
            optionLabel="label"
            optionValue="value"
            placeholder="Security"
            class="form-field"
            style="width: 130px"
          />
        </div>

        <h4 class="section-title">SMTP (Outgoing)</h4>
        <div class="form-row">
          <FloatLabel class="form-field flex-grow">
            <InputText
              id="edit-smtp-host"
              v-model="form.smtpHost"
              class="w-full"
            />
            <label for="edit-smtp-host">SMTP Server</label>
          </FloatLabel>
          <FloatLabel class="form-field" style="width: 100px">
            <InputNumber
              id="edit-smtp-port"
              v-model="form.smtpPort"
              :useGrouping="false"
              class="w-full"
            />
            <label for="edit-smtp-port">Port</label>
          </FloatLabel>
          <Select
            v-model="form.smtpSecurity"
            :options="securityOptions"
            optionLabel="label"
            optionValue="value"
            placeholder="Security"
            class="form-field"
            style="width: 130px"
          />
        </div>
      </div>

      <!-- Authentication -->
      <div class="form-section">
        <h4 class="section-title">Authentication</h4>
        <div class="form-row">
          <FloatLabel class="form-field flex-grow">
            <InputText
              id="edit-username"
              v-model="form.username"
              class="w-full"
            />
            <label for="edit-username">Username</label>
          </FloatLabel>
          <FloatLabel class="form-field flex-grow">
            <Password
              id="edit-password"
              v-model="form.password"
              :feedback="false"
              toggleMask
              class="w-full"
              inputClass="w-full"
              placeholder="Leave blank to keep current"
            />
            <label for="edit-password">Password</label>
          </FloatLabel>
        </div>
        <p class="password-hint">Leave password blank to keep the current one.</p>
      </div>

      <!-- Test result -->
      <Message v-if="testResult?.success" severity="success" :closable="false">
        Connection test successful!
      </Message>
      <Message v-if="testResult && !testResult.success" severity="error" :closable="false">
        {{ testResult.error }}
      </Message>

      <!-- Actions -->
      <div class="dialog-actions">
        <Button
          label="Delete Account"
          icon="pi pi-trash"
          severity="danger"
          text
          @click="confirmDelete"
        />
        <div class="dialog-actions-right">
          <Button
            label="Test Connection"
            icon="pi pi-bolt"
            severity="info"
            outlined
            size="small"
            :loading="testing"
            @click="testConnection"
          />
          <Button
            label="Cancel"
            severity="secondary"
            text
            @click="close"
          />
          <Button
            label="Save"
            icon="pi pi-check"
            :loading="saving"
            @click="save"
          />
        </div>
      </div>
    </div>
  </Dialog>
  <ConfirmDialog />
</template>

<style scoped>
.edit-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-section {
  padding-bottom: 12px;
  border-bottom: 1px solid var(--vx-border);
}

.form-row {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  margin-bottom: 12px;
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
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 10px;
  margin-top: 4px;
  color: var(--vx-text-secondary);
}

.color-picker {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.color-swatch {
  width: 24px;
  height: 24px;
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

.password-hint {
  font-size: 11px;
  color: var(--vx-text-muted);
  margin-top: -4px;
}

.dialog-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 8px;
}

.dialog-actions-right {
  display: flex;
  gap: 8px;
  align-items: center;
}
</style>
