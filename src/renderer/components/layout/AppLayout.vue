<script setup lang="ts">
import { inject, ref, type Ref } from 'vue'
import HeaderBar from './HeaderBar.vue'
import Sidebar from './Sidebar.vue'
import MessageList from './MessageList.vue'
import MessageView from './MessageView.vue'
import StatusBar from './StatusBar.vue'
import AiOverview from '../ai/AiOverview.vue'
import ContactsView from '../contacts/ContactsView.vue'
import ComposeDialog from '../ComposeDialog.vue'
import TodoDrawer from '../TodoDrawer.vue'
import TodosView from '../TodosView.vue'
import type { ComposeContext, ComposeMode } from '../ComposeDialog.vue'
import { useMessagesStore } from '../../stores/messages'
import { useFoldersStore } from '../../stores/folders'
import { api } from '../../services/api'

/** View mode injected from MailView */
const viewMode = inject<Ref<'mail' | 'ai' | 'contacts' | 'todos'>>('viewMode', ref('mail'))

const messagesStore = useMessagesStore()
const foldersStore = useFoldersStore()

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

// ── Todo drawer state ───────────────────────────────────────────────────────

const todoDrawerVisible = ref(false)
const todoDrawerRef = ref<InstanceType<typeof TodoDrawer> | null>(null)

const activeTodoCount = ref(0)

// Keep badge count in sync — drawer exposes activeCount
function onTodoDrawerShow(): void {
  // Badge is updated via the drawer's activeCount after it loads
}

// Listen for extraction events to update badge without opening drawer
function refreshTodoBadge(): void {
  api.todos.list().then((items) => {
    activeTodoCount.value = items.filter((t) => !t.done).length
  }).catch(() => {})
}

// Initial badge load
refreshTodoBadge()

// Update badge when todos are extracted anywhere in the app
if (typeof window !== 'undefined') {
  window.addEventListener('vx:todos-updated', refreshTodoBadge)
}

// ── Open message from Todo drawer ───────────────────────────────────────────

/**
 * Navigate to a specific message when the Todo drawer requests it.
 * Fetches the message to discover its folder, switches to that folder,
 * then selects the message so it appears in the reading pane.
 */
async function openMessage(messageId: number): Promise<void> {
  try {
    // Fetch full message to get folderId (messages:get is the only single-message channel)
    const message = await window.electronAPI.messages.get(messageId)
    // Switch to mail view (TodoDrawer already does this, but be defensive)
    viewMode.value = 'mail'
    // Switch to the folder that contains this message — triggers MessageList's folder watcher
    foldersStore.setActiveFolder(message.folderId)
    // Select the message; this immediately loads the body into the reading pane
    messagesStore.selectMessage(messageId)
  } catch (err) {
    console.error('[AppLayout] Failed to open message from todo:', err)
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('vx:open-message', (e: Event) => {
    const { messageId } = (e as CustomEvent<{ messageId: number }>).detail
    openMessage(messageId)
  })
}

defineProps<{
  showMessageView?: boolean
}>()
</script>

<template>
  <div class="app-layout">
    <HeaderBar
      class="app-header"
      :active-todo-count="activeTodoCount"
      @compose="openCompose('new')"
      @open-todos="todoDrawerVisible = true"
    />

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
    <div v-else-if="viewMode === 'ai'" class="app-body app-body-ai">
      <AiOverview class="app-ai-overview" />
    </div>

    <!-- Contacts / Favorite senders view -->
    <div v-else-if="viewMode === 'contacts'" class="app-body app-body-contacts">
      <ContactsView class="app-contacts-view" />
    </div>

    <!-- Todo list view -->
    <div v-else-if="viewMode === 'todos'" class="app-body app-body-todos">
      <TodosView class="app-todos-view" />
    </div>

    <StatusBar class="app-statusbar" />

    <!-- Compose Dialog (teleported to body by PrimeVue) -->
    <ComposeDialog
      v-model:visible="composeVisible"
      :context="composeContext"
      @sent="onSent"
    />

    <!-- Todo Drawer (teleported to body by PrimeVue) -->
    <TodoDrawer
      ref="todoDrawerRef"
      v-model:visible="todoDrawerVisible"
      @show="onTodoDrawerShow"
      @hide="refreshTodoBadge"
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

.app-body-contacts {
  display: flex;
}

.app-contacts-view {
  flex: 1;
  background: var(--vx-bg-primary);
  overflow: hidden;
}

.app-body-todos {
  display: flex;
}

.app-todos-view {
  flex: 1;
  background: var(--vx-bg-primary);
  overflow: hidden;
}

.app-statusbar {
  height: var(--vx-statusbar-height);
  flex-shrink: 0;
  background: var(--vx-bg-secondary);
  border-top: 1px solid var(--vx-border);
}
</style>
