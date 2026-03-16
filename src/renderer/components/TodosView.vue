<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import DOMPurify from 'dompurify'
import { api } from '../services/api'
import type { TodoItem, Message } from '../../shared/types'
import Button from 'primevue/button'
import Checkbox from 'primevue/checkbox'
import ProgressSpinner from 'primevue/progressspinner'

// ─── State ────────────────────────────────────────────────────────────────────

const todos = ref<TodoItem[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

/** Set of todo IDs that are currently expanded */
const expanded = ref<Set<number>>(new Set())

/** Cache of full message objects, keyed by messageId */
const messageCache = ref<Map<number, Message>>(new Map())

/** Set of messageIds currently being fetched */
const fetchingMessages = ref<Set<number>>(new Set())

/** Show done section open */
const doneOpen = ref(false)

// ─── Computed ─────────────────────────────────────────────────────────────────

const activeTodos = computed(() => todos.value.filter((t) => !t.done))
const doneTodos = computed(() => todos.value.filter((t) => t.done))

// ─── Data loading ─────────────────────────────────────────────────────────────

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

async function fetchMessage(messageId: number): Promise<void> {
  if (messageCache.value.has(messageId) || fetchingMessages.value.has(messageId)) return
  fetchingMessages.value.add(messageId)
  try {
    const msg = await window.electronAPI.messages.get(messageId)
    messageCache.value.set(messageId, msg)
    // Trigger reactivity — Map mutations aren't reactive, reassign
    messageCache.value = new Map(messageCache.value)
  } catch (err) {
    console.error('[TodosView] Failed to fetch message', messageId, err)
  } finally {
    fetchingMessages.value.delete(messageId)
    fetchingMessages.value = new Set(fetchingMessages.value)
  }
}

// ─── Expand / collapse ────────────────────────────────────────────────────────

function toggleExpand(todo: TodoItem): void {
  if (expanded.value.has(todo.id)) {
    expanded.value.delete(todo.id)
  } else {
    expanded.value.add(todo.id)
    fetchMessage(todo.messageId)
  }
  // Trigger reactivity
  expanded.value = new Set(expanded.value)
}

function isExpanded(todoId: number): boolean {
  return expanded.value.has(todoId)
}

function isMessageLoading(messageId: number): boolean {
  return fetchingMessages.value.has(messageId)
}

// ─── Actions ─────────────────────────────────────────────────────────────────

async function toggleTodo(todo: TodoItem): Promise<void> {
  const newDone = !todo.done
  todo.done = newDone
  try {
    await api.todos.toggle(todo.id, newDone)
    window.dispatchEvent(new CustomEvent('vx:todos-updated'))
  } catch {
    todo.done = !newDone
  }
}

async function deleteTodo(todo: TodoItem, event: Event): Promise<void> {
  event.stopPropagation()
  todos.value = todos.value.filter((t) => t.id !== todo.id)
  try {
    await api.todos.delete(todo.id)
    window.dispatchEvent(new CustomEvent('vx:todos-updated'))
  } catch {
    todos.value = [...todos.value, todo].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
  }
}

// ─── HTML sanitisation ────────────────────────────────────────────────────────

function sanitize(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'a', 'abbr', 'address', 'b', 'blockquote', 'br', 'caption',
      'code', 'col', 'colgroup', 'dd', 'del', 'details', 'div', 'dl', 'dt',
      'em', 'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'hr', 'i', 'img', 'ins', 'kbd', 'li', 'mark', 'ol', 'p', 'pre',
      'q', 's', 'small', 'span', 'strong', 'sub', 'summary', 'sup',
      'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul',
      'center', 'font', 'big'
    ],
    ALLOWED_ATTR: [
      'href', 'src', 'alt', 'title', 'width', 'height', 'style',
      'class', 'id', 'colspan', 'rowspan', 'align', 'valign',
      'bgcolor', 'color', 'border', 'cellpadding', 'cellspacing',
      'dir', 'lang', 'face', 'size', 'target'
    ],
    FORBID_TAGS: ['form', 'input', 'textarea', 'select', 'button', 'script', 'style', 'iframe', 'object', 'embed'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover']
  })
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear()
  if (isToday) {
    return date.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'short', year: 'numeric' })
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

onMounted(() => {
  loadTodos()
  window.addEventListener('vx:todos-updated', loadTodos)
})

onUnmounted(() => {
  window.removeEventListener('vx:todos-updated', loadTodos)
})
</script>

<template>
  <div class="todos-view">

    <!-- Header -->
    <div class="todos-header">
      <span class="todos-title">
        <i class="pi pi-list-check" />
        Todos
        <span v-if="activeTodos.length > 0" class="todos-count">{{ activeTodos.length }}</span>
      </span>
      <Button
        icon="pi pi-refresh"
        severity="secondary"
        text
        rounded
        size="small"
        v-tooltip.bottom="'Reload'"
        :loading="loading"
        @click="loadTodos"
      />
    </div>

    <!-- Loading -->
    <div v-if="loading && todos.length === 0" class="todos-loading">
      <ProgressSpinner style="width: 36px; height: 36px" />
    </div>

    <!-- Error -->
    <div v-else-if="error" class="todos-error">
      <i class="pi pi-exclamation-triangle" />
      {{ error }}
    </div>

    <!-- Empty state -->
    <div v-else-if="todos.length === 0" class="todos-empty">
      <i class="pi pi-list-check todos-empty-icon" />
      <p>No todos yet</p>
      <p class="todos-empty-hint">
        Open an email and click the <i class="pi pi-list-check" style="font-size: 11px" /> button to extract action items with AI.
      </p>
    </div>

    <!-- Content -->
    <div v-else class="todos-content">

      <!-- Active todos -->
      <div v-if="activeTodos.length > 0" class="todos-section">
        <div class="section-label">To do · {{ activeTodos.length }}</div>
        <div
          v-for="todo in activeTodos"
          :key="todo.id"
          class="todo-card"
          :class="{ 'todo-card--expanded': isExpanded(todo.id) }"
        >
          <!-- Row: checkbox + text + meta + actions -->
          <div class="todo-row" @click="toggleExpand(todo)">
            <Checkbox
              :modelValue="false"
              binary
              class="todo-checkbox"
              @change.stop="toggleTodo(todo)"
              @click.stop
            />
            <div class="todo-main">
              <div class="todo-text">{{ todo.text }}</div>
              <div class="todo-meta">
                <span v-if="todo.messageFrom" class="todo-from">{{ todo.messageFrom }}</span>
                <span v-if="todo.messageFrom && todo.messageSubject" class="meta-sep">·</span>
                <span v-if="todo.messageSubject" class="todo-subject">{{ todo.messageSubject }}</span>
              </div>
            </div>
            <div class="todo-actions" @click.stop>
              <i
                class="pi todo-chevron"
                :class="isExpanded(todo.id) ? 'pi-chevron-up' : 'pi-chevron-down'"
              />
              <Button
                icon="pi pi-times"
                severity="secondary"
                text
                rounded
                size="small"
                class="todo-delete"
                v-tooltip.bottom="'Delete'"
                @click="deleteTodo(todo, $event)"
              />
            </div>
          </div>

          <!-- Expanded email body -->
          <div v-if="isExpanded(todo.id)" class="todo-body">
            <div v-if="isMessageLoading(todo.messageId)" class="body-loading">
              <ProgressSpinner style="width: 24px; height: 24px" />
            </div>
            <template v-else-if="messageCache.get(todo.messageId) as Message | undefined">
              <div class="body-email-header">
                <span class="body-from">{{ messageCache.get(todo.messageId)!.from.name || messageCache.get(todo.messageId)!.from.address }}</span>
                <span class="body-date">{{ formatDate(messageCache.get(todo.messageId)!.date) }}</span>
              </div>
              <div
                v-if="messageCache.get(todo.messageId)!.bodyHtml"
                class="body-html"
                v-html="sanitize(messageCache.get(todo.messageId)!.bodyHtml)"
              />
              <pre v-else class="body-text">{{ messageCache.get(todo.messageId)!.bodyText }}</pre>
            </template>
            <div v-else class="body-loading">
              <i class="pi pi-exclamation-triangle" />
              Could not load email content.
            </div>
          </div>
        </div>
      </div>

      <!-- Done todos (collapsible) -->
      <details v-if="doneTodos.length > 0" class="todos-section" :open="doneOpen" @toggle="doneOpen = ($event.target as HTMLDetailsElement).open">
        <summary class="section-label section-label--summary">
          Done · {{ doneTodos.length }}
          <i class="pi pi-chevron-down section-chevron" :class="{ 'section-chevron--open': doneOpen }" />
        </summary>
        <div
          v-for="todo in doneTodos"
          :key="todo.id"
          class="todo-card todo-card--done"
          :class="{ 'todo-card--expanded': isExpanded(todo.id) }"
        >
          <div class="todo-row" @click="toggleExpand(todo)">
            <Checkbox
              :modelValue="true"
              binary
              class="todo-checkbox"
              @change.stop="toggleTodo(todo)"
              @click.stop
            />
            <div class="todo-main">
              <div class="todo-text">{{ todo.text }}</div>
              <div class="todo-meta">
                <span v-if="todo.messageFrom" class="todo-from">{{ todo.messageFrom }}</span>
                <span v-if="todo.messageFrom && todo.messageSubject" class="meta-sep">·</span>
                <span v-if="todo.messageSubject" class="todo-subject">{{ todo.messageSubject }}</span>
              </div>
            </div>
            <div class="todo-actions" @click.stop>
              <i
                class="pi todo-chevron"
                :class="isExpanded(todo.id) ? 'pi-chevron-up' : 'pi-chevron-down'"
              />
              <Button
                icon="pi pi-times"
                severity="secondary"
                text
                rounded
                size="small"
                class="todo-delete"
                v-tooltip.bottom="'Delete'"
                @click="deleteTodo(todo, $event)"
              />
            </div>
          </div>

          <div v-if="isExpanded(todo.id)" class="todo-body">
            <div v-if="isMessageLoading(todo.messageId)" class="body-loading">
              <ProgressSpinner style="width: 24px; height: 24px" />
            </div>
            <template v-else-if="messageCache.get(todo.messageId) as Message | undefined">
              <div class="body-email-header">
                <span class="body-from">{{ messageCache.get(todo.messageId)!.from.name || messageCache.get(todo.messageId)!.from.address }}</span>
                <span class="body-date">{{ formatDate(messageCache.get(todo.messageId)!.date) }}</span>
              </div>
              <div
                v-if="messageCache.get(todo.messageId)!.bodyHtml"
                class="body-html"
                v-html="sanitize(messageCache.get(todo.messageId)!.bodyHtml)"
              />
              <pre v-else class="body-text">{{ messageCache.get(todo.messageId)!.bodyText }}</pre>
            </template>
            <div v-else class="body-loading">
              <i class="pi pi-exclamation-triangle" />
              Could not load email content.
            </div>
          </div>
        </div>
      </details>

    </div>
  </div>
</template>

<style scoped>
.todos-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

/* ─── Header ───────────────────────────────────────────────────── */

.todos-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px 10px;
  border-bottom: 1px solid var(--p-content-border-color);
  flex-shrink: 0;
}

.todos-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 600;
}

.todos-count {
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

/* ─── States ───────────────────────────────────────────────────── */

.todos-loading,
.todos-error {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 60px 20px;
  color: var(--p-text-muted-color);
}

.todos-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 80px 20px 20px;
  text-align: center;
  color: var(--p-text-muted-color);
}

.todos-empty-icon {
  font-size: 3rem;
  opacity: 0.2;
}

.todos-empty p {
  margin: 0;
}

.todos-empty-hint {
  font-size: 12px;
  opacity: 0.7;
  max-width: 280px;
  line-height: 1.6;
}

/* ─── Content area ─────────────────────────────────────────────── */

.todos-content {
  flex: 1;
  overflow-y: auto;
  padding: 0 16px 24px;
}

.todos-section {
  margin-bottom: 8px;
}

.section-label {
  padding: 14px 0 6px;
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

.section-chevron--open {
  transform: rotate(180deg);
}

/* ─── Todo card ────────────────────────────────────────────────── */

.todo-card {
  border: 1px solid var(--p-content-border-color);
  border-radius: 8px;
  margin-bottom: 6px;
  overflow: hidden;
  transition: border-color 0.15s, box-shadow 0.15s;
  background: var(--p-content-background);
}

.todo-card:hover {
  border-color: var(--vx-accent);
  box-shadow: 0 1px 4px rgba(0,0,0,0.06);
}

.todo-card--expanded {
  border-color: var(--vx-accent);
}

.todo-card--done {
  opacity: 0.65;
}

.todo-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  cursor: pointer;
  user-select: none;
}

.todo-checkbox {
  flex-shrink: 0;
}

.todo-main {
  flex: 1;
  min-width: 0;
}

.todo-text {
  font-size: 13px;
  font-weight: 500;
  line-height: 1.4;
  word-break: break-word;
}

.todo-card--done .todo-text {
  text-decoration: line-through;
}

.todo-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 3px;
  font-size: 11px;
  color: var(--p-text-muted-color);
  overflow: hidden;
  white-space: nowrap;
}

.todo-from {
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 200px;
  flex-shrink: 0;
}

.meta-sep {
  flex-shrink: 0;
}

.todo-subject {
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}

.todo-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.todo-chevron {
  font-size: 11px;
  color: var(--p-text-muted-color);
  padding: 4px;
}

.todo-delete {
  opacity: 0;
  transition: opacity 0.15s;
}

.todo-card:hover .todo-delete {
  opacity: 1;
}

/* ─── Expanded body ────────────────────────────────────────────── */

.todo-body {
  border-top: 1px solid var(--p-content-border-color);
  padding: 12px 16px 16px;
  background: var(--vx-bg-primary, var(--p-content-background));
}

.body-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px 0;
  color: var(--p-text-muted-color);
  font-size: 12px;
}

.body-email-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--p-content-border-color);
}

.body-from {
  font-size: 12px;
  font-weight: 600;
  color: var(--p-text-color);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.body-date {
  font-size: 11px;
  color: var(--p-text-muted-color);
  flex-shrink: 0;
}

/* HTML email body */
.body-html {
  font-size: 13px;
  line-height: 1.5;
  overflow-x: auto;
  word-break: break-word;
}

.body-html :deep(td),
.body-html :deep(th) {
  padding: 4px 8px;
}

.body-html :deep(a) {
  color: var(--vx-accent);
}

/* Plain text fallback */
.body-text {
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  font-family: inherit;
  color: var(--p-text-color);
}
</style>
