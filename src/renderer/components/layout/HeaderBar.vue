<script setup lang="ts">
import { useRouter } from 'vue-router'
import Button from 'primevue/button'
import SelectButton from 'primevue/selectbutton'
import { ref, inject, type Ref } from 'vue'
import ThunderbirdImportDialog from '../ThunderbirdImportDialog.vue'

const router = useRouter()
const importDialogVisible = ref(false)

const emit = defineEmits<{
  compose: []
}>()

/** View mode injected from MailView */
const viewMode = inject<Ref<'mail' | 'ai' | 'contacts'>>('viewMode', ref('mail'))

const viewModeOptions = [
  { label: 'Mail', value: 'mail', icon: 'pi pi-envelope' },
  { label: 'AI Overview', value: 'ai', icon: 'pi pi-sparkles' },
  { label: 'Contacts', value: 'contacts', icon: 'pi pi-users' }
]

function onImported() {
  // Could refresh folder lists, etc.
}
</script>

<template>
  <header class="header-bar vx-no-select">
    <div class="header-left">
      <span class="header-logo">Vextron</span>
    </div>

    <div class="header-center">
      <SelectButton
        v-model="viewMode"
        :options="viewModeOptions"
        optionLabel="label"
        optionValue="value"
        :allowEmpty="false"
        class="view-mode-toggle"
      >
        <template #option="{ option }">
          <i :class="option.icon" style="margin-right: 4px" />
          <span>{{ option.label }}</span>
        </template>
      </SelectButton>
    </div>

    <div class="header-right">
      <Button
        icon="pi pi-pencil"
        severity="secondary"
        text
        rounded
        aria-label="Compose"
        v-tooltip.bottom="'Compose new email'"
        @click="emit('compose')"
      />
      <Button
        icon="pi pi-download"
        severity="secondary"
        text
        rounded
        aria-label="Import"
        v-tooltip.bottom="'Import from Thunderbird'"
        @click="importDialogVisible = true"
      />
      <Button
        icon="pi pi-cog"
        severity="secondary"
        text
        rounded
        aria-label="Settings"
        v-tooltip.bottom="'Settings'"
        @click="router.push({ name: 'settings' })"
      />
    </div>

    <!-- Dialog rendered inside header root to keep single-root template.
         PrimeVue Dialog uses Teleport to <body> anyway, so position is unaffected. -->
    <ThunderbirdImportDialog
      v-model:visible="importDialogVisible"
      @imported="onImported"
    />
  </header>
</template>

<style scoped>
.header-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  height: 100%;
  gap: 16px;
}

.header-left {
  display: flex;
  align-items: center;
  min-width: 180px;
}

.header-logo {
  font-size: 16px;
  font-weight: 700;
  color: var(--vx-accent);
  letter-spacing: 0.5px;
}

.header-center {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.view-mode-toggle :deep(.p-selectbutton) {
  font-size: 12px;
}

.view-mode-toggle :deep(.p-togglebutton) {
  padding: 4px 12px;
  font-size: 12px;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 4px;
}
</style>
