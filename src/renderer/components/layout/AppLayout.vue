<script setup lang="ts">
import { inject, ref, type Ref } from 'vue'
import HeaderBar from './HeaderBar.vue'
import Sidebar from './Sidebar.vue'
import MessageList from './MessageList.vue'
import MessageView from './MessageView.vue'
import StatusBar from './StatusBar.vue'
import AiOverview from '../ai/AiOverview.vue'
import ComposeDialog from '../ComposeDialog.vue'
import type { ComposeContext, ComposeMode } from '../ComposeDialog.vue'
import { useMessagesStore } from '../../stores/messages'

/** View mode injected from MailView */
const viewMode = inject<Ref<'mail' | 'ai'>>('viewMode', ref('mail'))

const messagesStore = useMessagesStore()

// ── Compose dialog state ────────────────────────────────────────────────────

const composeVisible = ref(false)
const composeContext = ref<ComposeContext>({ mode: 'new' })

function openCompose(mode: ComposeMode = 'new'): void {
  const ctx: ComposeContext = { mode }
  if (mode !== 'new' && messagesStore.activeMessage) {
    // Deep-clone to strip reactive proxies (structured clone can't handle them)
    ctx.originalMessage = JSON.parse(JSON.stringify(messagesStore.activeMessage))
  }
  composeContext.value = ctx
  composeVisible.value = true
}

/**
 * Handle successful send — mark original message as answered if this was a reply.
 */
function onSent(data: { messageId?: string; originalMessageId?: number; mode: ComposeMode }): void {
  if ((data.mode === 'reply' || data.mode === 'reply-all') && data.originalMessageId) {
    messagesStore.setFlags(data.originalMessageId, { answered: true })
  }
}

defineProps<{
  showMessageView?: boolean
}>()
</script>

<template>
  <div class="app-layout">
    <HeaderBar class="app-header" @compose="openCompose('new')" />

    <!-- Normal 3-panel mail view -->
    <div v-if="viewMode === 'mail'" class="app-body">
      <Sidebar class="app-sidebar" />
      <MessageList class="app-message-list" />
      <MessageView
        class="app-message-view"
        @reply="openCompose('reply')"
        @reply-all="openCompose('reply-all')"
        @forward="openCompose('forward')"
      />
    </div>

    <!-- AI Overview grouped view -->
    <div v-else class="app-body app-body-ai">
      <AiOverview class="app-ai-overview" />
    </div>

    <StatusBar class="app-statusbar" />

    <!-- Compose Dialog (teleported to body by PrimeVue) -->
    <ComposeDialog
      v-model:visible="composeVisible"
      :context="composeContext"
      @sent="onSent"
    />
  </div>
</template>

<style scoped>
.app-layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
}

.app-header {
  height: var(--vx-header-height);
  flex-shrink: 0;
  background: var(--vx-bg-secondary);
  border-bottom: 1px solid var(--vx-border);
}

.app-body {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.app-body-ai {
  display: flex;
}

.app-sidebar {
  width: var(--vx-sidebar-width);
  min-width: 180px;
  max-width: 360px;
  flex-shrink: 0;
  background: var(--vx-bg-secondary);
  border-right: 1px solid var(--vx-border);
  overflow-y: auto;
  resize: horizontal;
}

.app-message-list {
  width: var(--vx-messagelist-width);
  min-width: 280px;
  max-width: 600px;
  flex-shrink: 0;
  background: var(--vx-bg-primary);
  border-right: 1px solid var(--vx-border);
  overflow-y: auto;
  resize: horizontal;
}

.app-message-view {
  flex: 1;
  min-width: 300px;
  background: var(--vx-bg-primary);
  overflow-y: auto;
}

.app-ai-overview {
  flex: 1;
  background: var(--vx-bg-primary);
  overflow-y: auto;
}

.app-statusbar {
  height: var(--vx-statusbar-height);
  flex-shrink: 0;
  background: var(--vx-bg-secondary);
  border-top: 1px solid var(--vx-border);
}
</style>
