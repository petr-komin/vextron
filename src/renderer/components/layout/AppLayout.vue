<script setup lang="ts">
import HeaderBar from './HeaderBar.vue'
import Sidebar from './Sidebar.vue'
import MessageList from './MessageList.vue'
import MessageView from './MessageView.vue'
import StatusBar from './StatusBar.vue'

defineProps<{
  showMessageView?: boolean
}>()
</script>

<template>
  <div class="app-layout">
    <HeaderBar class="app-header" />

    <div class="app-body">
      <Sidebar class="app-sidebar" />
      <MessageList class="app-message-list" />
      <MessageView class="app-message-view" />
    </div>

    <StatusBar class="app-statusbar" />
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

.app-statusbar {
  height: var(--vx-statusbar-height);
  flex-shrink: 0;
  background: var(--vx-bg-secondary);
  border-top: 1px solid var(--vx-border);
}
</style>
