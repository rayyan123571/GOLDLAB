// ─── Dual-printer routing decision (pure, no Electron deps → unit-testable) ───
// The machine has BOTH a thermal printer and the Canon LBP6030 attached. Each job
// must go to the right one automatically. Given the print mode, the receipt type,
// and the two configured device names, decide the ENGINE and the target printer:
//
//   • LAB رسید in overlay_form   → Canon (values onto the pre-printed slip). Canon
//                                  MUST be configured; otherwise error (no thermal
//                                  fallback — that would print a full slip over the
//                                  pre-printed form).
//   • everything else (thermal;  → thermal printer (ESC/POS). Falls back to the
//     udhaar / naqad; lab in        Windows default if the thermal printer is unset.
//     thermal mode)
//
// receipt is the data-receipt tag: 'lab' | 'wasooli' | 'udhar' | 'naqad' | ''.
function routeFor({ printMode, receipt, printerThermal, printerCanon } = {}) {
  const canon = (printerCanon || '').trim()
  const thermal = (printerThermal || '').trim()

  // Overlay applies to the LAB رسید ONLY; any other receipt in overlay mode prints
  // thermal (udhaar/naqad are never overlaid).
  if (printMode === 'overlay_form' && receipt === 'lab') {
    if (!canon) return { engine: 'overlay', deviceName: '', error: 'canon-printer-not-set' }
    return { engine: 'overlay', deviceName: canon }
  }

  // Thermal ESC/POS for everything else (incl. lab in thermal mode, udhaar, naqad).
  // A legacy 'color_form' print_mode lands here → thermal (the mode was removed).
  return { engine: 'thermal', deviceName: thermal } // '' → rasterPrint uses the default
}

module.exports = { routeFor }
