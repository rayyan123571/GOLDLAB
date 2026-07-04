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
  getFirstReceiptNo: () => call('getFirstReceiptNo'),
  getLastReceiptNo: () => call('getLastReceiptNo'),
  getNextReceiptNo: (current) => call('getNextReceiptNo', current),
  getPrevReceiptNo: (current) => call('getPrevReceiptNo', current),
  resetTransactions: () => call('resetTransactions'),
  resetKachaGold: () => call('resetKachaGold'),
  resetKachaCounter: () => call('resetKachaCounter'),
  addTransaction: (t) => call('addTransaction', t),
  updateTransaction: (id, fields) => call('updateTransaction', id, fields),
  deleteTransaction: (id) => call('deleteTransaction', id),
  settleTransaction: (t) => call('settleTransaction', t),
  addExpense: (e) => call('addExpense', e),
  getExpenses: (from, to) => call('getExpenses', from, to),
  updateExpense: (id, fields) => call('updateExpense', id, fields),
  deleteExpense: (id) => call('deleteExpense', id),
  resetExpenses: () => call('resetExpenses'),
  getExpensesTotalForDate: (date) => call('getExpensesTotalForDate', date),
  exportPDF: (defaultName, opts) => ipcRenderer.invoke('export-pdf', { defaultName, ...(opts || {}) }),
  saveReceipt: (r) => call('saveReceipt', r),
  replaceReceipt: (arg) => call('replaceReceipt', arg),
  freeReceipt: (n) => call('freeReceipt', n),
  getReceiptByNo: (n) => call('getReceiptByNo', n),
  getReport: (opts) => call('getReport', opts),
  reportGroup1: (opts) => call('reportGroup1', opts),
  reportKachaGold: (opts) => call('reportKachaGold', opts),
  getKachaTotalForDate: (date) => call('getKachaTotalForDate', date),
  getCustomerLedger: (id) => call('getCustomerLedger', id),
  listCustomersWithBalances: () => call('listCustomersWithBalances'),
  getDaybook: (date) => call('getDaybook', date),
  listDates: () => call('listDates'),
  getShopTotals: () => call('getShopTotals'),
  // Quit the whole app (the top-left red "X" button calls this).
  quitApp: () => ipcRenderer.invoke('quit-app'),
  // Minimize the window to the taskbar (the "–" button next to the red "X").
  minimizeApp: () => ipcRenderer.invoke('minimize-window'),
  // Maximize / restore toggle — full-screen on/off (the "□" button).
  maximizeApp: () => ipcRenderer.invoke('toggle-maximize')
})
