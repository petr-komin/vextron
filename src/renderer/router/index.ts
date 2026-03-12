import { createRouter, createWebHashHistory } from 'vue-router'
import MailView from '../views/MailView.vue'
import AccountSetupView from '../views/AccountSetupView.vue'
import SettingsView from '../views/SettingsView.vue'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      name: 'mail',
      component: MailView
    },
    {
      path: '/setup',
      name: 'account-setup',
      component: AccountSetupView
    },
    {
      path: '/settings',
      name: 'settings',
      component: SettingsView
    }
  ]
})

export default router
