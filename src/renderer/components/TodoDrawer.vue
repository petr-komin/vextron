<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, inject, type Ref } from 'vue'
import { api } from '../services/api'
import type { TodoItem } from '../../shared/types'
import Drawer from 'primevue/drawer'
import Button from 'primevue/button'
import ProgressSpinner from 'primevue/progressspinner'
import Checkbox from 'primevue/checkbox'

// ─── Props / model ───────────────────────────────────────────────────────────

const visible = defineModel<boolean>('visible', { required: true })

// ─── Injected context (to navigate to source email) ─────────────────────────

const viewMode = inject<Ref<'mail' | 'ai' | 'contacts' | 'todos'>>('viewMode')

// ─── State ───────────────────────────────────────────────────────────────────

const todos = ref<TodoItem[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

// ─── Computed ────────────────────────────────────────────────────────────────

const activeTodos = computed(() => todos.value.filter((t) => !t.done))
const doneTodos = computed(() => todos.value.filter((t) => t.done))

/** Badge count used by the header button */
const activeCount = computed(() => activeTodos.value.length)
defineExpose({ activeCount })

// ─── Data loading ────────────────────────────────────────────────────────────

async function loadTodos(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    todos.value = await api.todos.list()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load todos'
  } finally {
    loading.value = false
  }
}

// Reload when the drawer opens
function onShow(): void {
  loadTodos()
}

// Listen for extraction events from MessageView
function onTodosUpdated(): void {
  if (visible.value) {
    loadTodos()
  }
}

onMounted(() => {
  window.addEventListener('vx:todos-updated', onTodosUpdated)
})

onUnmounted(() => {
  window.removeEventListener('vx:todos-updated', onTodosUpdated)
})

// ─── Actions ─────────────────────────────────────────────────────────────────

async function toggleTodo(todo: TodoItem): Promise<void> {
  const newDone = !todo.done
  // Optimistic update
  todo.done = newDone
  try {
    await api.todos.toggle(todo.id, newDone)
  } catch {
    // Revert on failure
    todo.done = !newDone
  }
}

async function deleteTodo(todo: TodoItem): Promise<void> {
  todos.value = todos.value.filter((t) => t.id !== todo.id)
  try {
    await api.todos.delete(todo.id)
  } catch {
    // Restore on failure
    todos.value = [...todos.value, todo].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
  }
}

/** Navigate to the source email (switch to mail view — user can find it there) */
function goToMessage(todo: TodoItem): void {
  if (viewMode) {
    viewMode.value = 'mail'
  }
  visible.value = false
  // Emit a custom event that AppLayout/MailView can listen to
  window.dispatchEvent(new CustomEvent('vx:open-message', { detail: { messageId: todo.messageId } }))
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '…' : text
}
</script>

<template>
  <Drawer
    v-model:visible="visible"
    position="right"
    :style="{ width: '420px' }"
    @show="onShow"
  >
    <template #header>
      <div class="drawer-header">
        <i class="pi pi-list-check" />
        <span>Todo List</span>
        <span v-if="activeCount > 0" class="drawer-badge">{{ activeCount }}</span>
      </div>
    </template>

    <!-- Loading -->
    <div v-if="loading" class="drawer-loading">
      <ProgressSpinner style="width: 32px; height: 32px" />
    </div>

    <!-- Error -->
    <div v-else-if="error" class="drawer-error">
      <i class="pi pi-exclamation-triangle" />
      {{ error }}
    </div>

    <!-- Empty state -->
    <div v-else-if="todos.length === 0" class="drawer-empty">
      <i class="pi pi-list-check" style="font-size: 2.5rem; opacity: 0.2" />
      <p>No todos yet</p>
      <p class="drawer-empty-hint">
        Open an email and click the
        <i class="pi pi-list-check" style="font-size: 11px" />
        button to extract action items with AI.
      </p>
    </div>

    <!-- Todo list -->
    <div v-else class="todo-sections">

      <!-- Active todos -->
      <div v-if="activeTodos.length > 0" class="todo-section">
        <div class="section-label">To do · {{ activeTodos.length }}</div>
        <div
          v-for="todo in activeTodos"
          :key="todo.id"
          class="todo-item"
        >
          <Checkbox
            :modelValue="false"
            binary
            @change="toggleTodo(todo)"
            class="todo-checkbox"
          />
          <div class="todo-content">
            <div class="todo-text">{{ todo.text }}</div>
            <div v-if="todo.messageSubject || todo.messageFrom" class="todo-source">
              <button class="todo-source-link" @click="goToMessage(todo)">
                <i class="pi pi-envelope" />
                {{ truncate(todo.messageSubject || todo.messageFrom || '', 50) }}
              </button>
            </div>
          </div>
          <button class="todo-delete" @click="deleteTodo(todo)" title="Delete">
            <i class="pi pi-times" />
          </button>
        </div>
      </div>

      <!-- Done todos -->
      <details v-if="doneTodos.length > 0" class="todo-section todo-section--done">
        <summary class="section-label section-label--summary">
          Done · {{ doneTodos.length }}
          <i class="pi pi-chevron-down section-chevron" />
        </summary>
        <div
          v-for="todo in doneTodos"
          :key="todo.id"
          class="todo-item todo-item--done"
        >
          <Checkbox
            :modelValue="true"
            binary
            @change="toggleTodo(todo)"
            class="todo-checkbox"
          />
          <div class="todo-content">
            <div class="todo-text">{{ todo.text }}</div>
            <div v-if="todo.messageSubject || todo.messageFrom" class="todo-source">
              <button class="todo-source-link" @click="goToMessage(todo)">
                <i class="pi pi-envelope" />
                {{ truncate(todo.messageSubject || todo.messageFrom || '', 50) }}
              </button>
            </div>
          </div>
          <button class="todo-delete" @click="deleteTodo(todo)" title="Delete">
            <i class="pi pi-times" />
          </button>
        </div>
      </details>

    </div>
  </Drawer>
</template>

<style scoped>
.drawer-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 15px;
}

.drawer-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 5px;
  border-radius: 10px;
  background: var(--vx-accent);
  color: white;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
}

.drawer-loading,
.drawer-error {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 40px 20px;
  color: var(--p-text-muted-color);
}

.drawer-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 60px 20px 20px;
  text-align: center;
  color: var(--p-text-muted-color);
}

.drawer-empty p {
  margin: 0;
}

.drawer-empty-hint {
  font-size: 12px;
  opacity: 0.7;
  max-width: 260px;
  line-height: 1.5;
}

/* ─── Sections ─────────────────────────────────────────────────── */

.todo-sections {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.todo-section {
  border-bottom: 1px solid var(--p-content-border-color);
}

.section-label {
  padding: 10px 0 6px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--p-text-muted-color);
}

.section-label--summary {
  display: flex;
  align-items: center;
  gap: 6px;
  list-style: none;
  cursor: pointer;
  user-select: none;
}

.section-label--summary::-webkit-details-marker {
  display: none;
}

.section-chevron {
  font-size: 10px;
  margin-left: auto;
  transition: transform 0.2s;
}

details[open] .section-chevron {
  transform: rotate(180deg);
}

/* ─── Todo items ───────────────────────────────────────────────── */

.todo-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 0;
  border-radius: 6px;
}

.todo-item--done .todo-text {
  text-decoration: line-through;
  opacity: 0.5;
}

.todo-checkbox {
  flex-shrink: 0;
  margin-top: 2px;
}

.todo-content {
  flex: 1;
  min-width: 0;
}

.todo-text {
  font-size: 13px;
  line-height: 1.4;
  word-break: break-word;
}

.todo-source {
  margin-top: 3px;
}

.todo-source-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--p-text-muted-color);
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 280px;
  transition: color 0.15s;
}

.todo-source-link:hover {
  color: var(--vx-accent);
}

.todo-delete {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  background: none;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  color: var(--p-text-muted-color);
  opacity: 0;
  transition: opacity 0.15s, color 0.15s;
  font-size: 11px;
}

.todo-item:hover .todo-delete {
  opacity: 1;
}

.todo-delete:hover {
  color: var(--p-red-500);
}
</style>
