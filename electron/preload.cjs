const { contextBridge, ipcRenderer } = require('electron')

// Thin typed-ish bridge. Every DB call funnels through one IPC channel.
const call = (fn, ...args) => ipcRenderer.invoke('db', { fn, args })

contextBridge.exposeInMainWorld('api', {
  getRates: () => call('getRates'),
  saveRates: (r) => call('saveRates', r),
  findCustomers: (q) => call('findCustomers', q),
  getCustomer: (id) => call('getCustomer', id),
  peekNextCustomerId: () => call('peekNextCustomerId'),
  getFirstCustomer: () => call('getFirstCustomer'),
  getLastCustomer: () => call('getLastCustomer'),
  getNextCustomer: (id) => call('getNextCustomer', id),
  getPrevCustomer: (id) => call('getPrevCustomer', id),
  upsertCustomer: (c) => call('upsertCustomer', c),
  nextReceiptNo: () => call('nextReceiptNo'),
  resetTransactions: () => call('resetTransactions'),
  addTransaction: (t) => call('addTransaction', t),
  updateTransaction: (id, fields) => call('updateTransaction', id, fields),
  deleteTransaction: (id) => call('deleteTransaction', id),
  settleTransaction: (t) => call('settleTransaction', t),
  addExpense: (e) => call('addExpense', e),
  getExpenses: (from, to) => call('getExpenses', from, to),
  exportPDF: (defaultName, opts) => ipcRenderer.invoke('export-pdf', { defaultName, ...(opts || {}) }),
  saveReceipt: (r) => call('saveReceipt', r),
  getReceiptByNo: (n) => call('getReceiptByNo', n),
  getReport: (opts) => call('getReport', opts),
  reportGroup1: (opts) => call('reportGroup1', opts),
  getCustomerLedger: (id) => call('getCustomerLedger', id),
  listCustomersWithBalances: () => call('listCustomersWithBalances'),
  getDaybook: (date) => call('getDaybook', date),
  listDates: () => call('listDates'),
  getShopTotals: () => call('getShopTotals')
})
