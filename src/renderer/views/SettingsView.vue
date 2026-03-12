<script setup lang="ts">
import { useRouter } from 'vue-router'
import Button from 'primevue/button'

const router = useRouter()
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
          <h2>AI Configuration</h2>
          <p class="section-description">
            Configure AI provider for email classification, summarization,
            and smart notifications. This will be available in a future update.
          </p>
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

.section-description {
  font-size: 13px;
  color: var(--vx-text-muted);
  margin-bottom: 16px;
  line-height: 1.5;
}
</style>
