import type { IpcMainInvokeEvent } from 'electron'
import { resolveAvatar, resolveBatch } from '../services/avatar'
import type { AvatarResult } from '../../shared/types'

export const avatarsHandlers = {
  /**
   * Resolve avatar URL for a single email address.
   * Returns { url, source } — url is always set (identicon as last resort).
   */
  'avatars:resolve': async (
    _event: IpcMainInvokeEvent,
    email: string
  ): Promise<AvatarResult> => {
    return resolveAvatar(email)
  },

  /**
   * Resolve avatar URLs for multiple email addresses in parallel.
   * Returns a map of email (lowercase) → { url, source }.
   * Emails that fail resolution are omitted from the result.
   */
  'avatars:batch': async (
    _event: IpcMainInvokeEvent,
    emails: string[]
  ): Promise<Record<string, AvatarResult>> => {
    return resolveBatch(emails)
  }
}
