import type { IpcMainInvokeEvent } from 'electron'
import { eq, desc } from 'drizzle-orm'
import { getDb } from '../services/db/connection'
import { todos } from '../services/db/schema/todos'
import { messages } from '../services/db/schema/messages'
import { extractTodos } from '../services/ai/extract'
import type { TodoItem } from '../../shared/types'

export const todosHandlers = {
  /**
   * Extract todo items from an email using AI.
   * Overwrites any previously extracted todos for the same message.
   */
  'todos:extract': async (_event: IpcMainInvokeEvent, messageId: number): Promise<TodoItem[]> => {
    return extractTodos(messageId)
  },

  /**
   * List all todo items across all messages, newest first.
   * Joins with messages to populate messageSubject and messageFrom.
   */
  'todos:list': async (_event: IpcMainInvokeEvent): Promise<TodoItem[]> => {
    const db = getDb()
    const rows = await db
      .select({
        id: todos.id,
        messageId: todos.messageId,
        text: todos.text,
        done: todos.done,
        createdAt: todos.createdAt,
        messageSubject: messages.subject,
        messageFrom: messages.fromAddress,
        messageFromName: messages.fromName
      })
      .from(todos)
      .innerJoin(messages, eq(todos.messageId, messages.id))
      .orderBy(desc(todos.createdAt))

    return rows.map((r) => ({
      id: r.id,
      messageId: r.messageId,
      text: r.text,
      done: r.done,
      createdAt: r.createdAt.toISOString(),
      messageSubject: r.messageSubject ?? undefined,
      messageFrom: r.messageFromName
        ? `${r.messageFromName} <${r.messageFrom}>`
        : r.messageFrom
    }))
  },

  /**
   * Toggle the done state of a todo item.
   */
  'todos:toggle': async (_event: IpcMainInvokeEvent, id: number, done: boolean): Promise<void> => {
    const db = getDb()
    await db.update(todos).set({ done }).where(eq(todos.id, id))
  },

  /**
   * Permanently delete a todo item.
   */
  'todos:delete': async (_event: IpcMainInvokeEvent, id: number): Promise<void> => {
    const db = getDb()
    await db.delete(todos).where(eq(todos.id, id))
  }
}
