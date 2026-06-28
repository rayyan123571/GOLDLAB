# گولڈ لیب — Gold Laboratory Management

Electron + React + Vite + Tailwind desktop app for a gold refining/assay lab,
replicating the reference shop screen. Data persists locally in SQLite (sql.js).

## Run

```bash
npm install
npm run dev      # starts Vite + Electron together
```

The window opens at 1600×900 (the whole UI fits without scrolling).

To build the renderer bundle and run the packaged renderer:

```bash
npm run build
npm start
```

## Screens

- **لیب (Main)** — purity table (Local/Copper/Standard/Silver/Pure Silver),
  weight entry, customer entry, نقد (cash) + ادھار (credit) tables, and the four
  live receipts (وصولی / لیب / ادھار / نقد).
- **روزنامچہ (Daybook)** — date-wise ledger of every transaction with daily totals.
- **ادھار (Accounts)** — per-customer credit history and running balances.

## Where the math lives — `src/logic/purity.js`

> ⚠️ The purity/assay formulas are a **best-guess standard gold-assay model**
> (you chose this). Every number on the main screen comes from this one file.
> Replace `ROW_MODEL`, `computeRow`, and `SILVER_RATE_FACTOR` with your shop's
> real rules and nothing else needs to change.

Unit conversions (1 tola = 11.664 g = 12 masha = 96 ratti) live in
`src/logic/units.js`.

## How calculations work

1. Enter **وزن کنڈے پر** (gross grams) and **وزن پانی میں** (assay alloy grams)
   in the top-left box.
2. The five purity rows auto-fill (خالص سونا, ملاوٹ, tola/masha/ratti, ٹوٹل رقم,
   لیب چارجز, باقی رقم) from the rates in the top bar.
3. **Click any white cell to type your own value** — that cell turns yellow and
   overrides the formula for that cell only. Clear it to return to auto.
4. Tick **پرچی** on a row to drive the لیب رسید / وصولی رسید receipts from it.
5. نقد / ادھار entries post transactions; receipts, customer balances, and the
   green bottom totals all update live.

## Data location

`goldlab.sqlite` is stored in Electron's `userData` folder
(`%AppData%/gold-lab/` on Windows).
