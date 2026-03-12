<script setup lang="ts">
import { useRouter } from 'vue-router'
import Button from 'primevue/button'
import { ref } from 'vue'
import ThunderbirdImportDialog from '../ThunderbirdImportDialog.vue'

const router = useRouter()
const importDialogVisible = ref(false)

function onImported() {
  // Could refresh folder lists, etc.
}
</script>

<template>
  <header class="header-bar vx-no-select">
    <div class="header-left">
      <span class="header-logo">Vextron</span>
    </div>

    <div class="header-center" />

    <div class="header-right">
      <Button
        icon="pi pi-pencil"
        severity="secondary"
        text
        rounded
        aria-label="Compose"
        v-tooltip.bottom="'Compose new email'"
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
}

.header-right {
  display: flex;
  align-items: center;
  gap: 4px;
}
</style>
