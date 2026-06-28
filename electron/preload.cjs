const { contextBridge, ipcRenderer } = require('electron')

// Thin typed-ish bridge. Every DB call funnels through one IPC channel.
const call = (fn, ...args) => ipcRenderer.invoke('db', { fn, args })

contextBridge.exposeInMainWorld('api', {
  getRates: () => call('getRates'),
  saveRates: (r) => call('saveRates', r),
  findCustomers: (q) => call('findCustomers', q),
  getCustomer: (id) => call('getCustomer', id),
  upsertCustomer: (c) => call('upsertCustomer', c),
  nextReceiptNo: () => call('nextReceiptNo'),
  addTransaction: (t) => call('addTransaction', t),
  saveReceipt: (r) => call('saveReceipt', r),
  getCustomerLedger: (id) => call('getCustomerLedger', id),
  getDaybook: (date) => call('getDaybook', date),
  listDates: () => call('listDates'),
  getShopTotals: () => call('getShopTotals')
})
