import type { IpcMainInvokeEvent } from 'electron'
import { sendMail } from '../services/smtp/send'
import type { ComposeMailData, SendMailResult } from '../../shared/types'

export const mailHandlers = {
  'mail:send': async (_event: IpcMainInvokeEvent, data: ComposeMailData): Promise<SendMailResult> => {
    return sendMail({
      accountId: data.accountId,
      to: data.to,
      cc: data.cc,
      bcc: data.bcc,
      subject: data.subject,
      bodyText: data.bodyText,
      bodyHtml: data.bodyHtml,
      inReplyTo: data.inReplyTo,
      references: data.references
    })
  }
}
