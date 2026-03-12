import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Account, AccountFormData, ConnectionStatus } from '../../shared/types'

export const useAccountsStore = defineStore('accounts', () => {
  const accounts = ref<Account[]>([])
  const activeAccountId = ref<number | null>(null)
  const loading = ref(false)
  const connectionStatuses = ref<Map<number, ConnectionStatus>>(new Map())

  const activeAccount = computed(() =>
    accounts.value.find((a) => a.id === activeAccountId.value) ?? null
  )

  const hasAccounts = computed(() => accounts.value.length > 0)

  async function fetchAccounts(): Promise<void> {
    loading.value = true
    try {
      accounts.value = await window.electronAPI.accounts.list()
      if (accounts.value.length > 0 && !activeAccountId.value) {
        activeAccountId.value = accounts.value[0].id
      }
    } catch (error) {
      console.error('Failed to fetch accounts:', error)
    } finally {
      loading.value = false
    }
  }

  async function createAccount(data: AccountFormData): Promise<Account> {
    const account = await window.electronAPI.accounts.create(data)
    accounts.value.push(account)
    if (!activeAccountId.value) {
      activeAccountId.value = account.id
    }
    return account
  }

  async function updateAccount(id: number, data: Partial<AccountFormData>): Promise<void> {
    const account = await window.electronAPI.accounts.update(id, data)
    const index = accounts.value.findIndex((a) => a.id === id)
    if (index >= 0) {
      accounts.value[index] = account
    }
  }

  async function deleteAccount(id: number): Promise<void> {
    await window.electronAPI.accounts.delete(id)
    accounts.value = accounts.value.filter((a) => a.id !== id)
    if (activeAccountId.value === id) {
      activeAccountId.value = accounts.value[0]?.id ?? null
    }
  }

  async function testConnection(data: AccountFormData): Promise<{ success: boolean; error?: string }> {
    return window.electronAPI.accounts.test(data)
  }

  function setActiveAccount(id: number): void {
    activeAccountId.value = id
  }

  return {
    accounts,
    activeAccountId,
    activeAccount,
    hasAccounts,
    loading,
    connectionStatuses,
    fetchAccounts,
    createAccount,
    updateAccount,
    deleteAccount,
    testConnection,
    setActiveAccount
  }
})
