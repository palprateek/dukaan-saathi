# Dukaan Saathi — one-page pitch

*PDF version: [`docs/Dukaan-Saathi-Pitch.pdf`](docs/Dukaan-Saathi-Pitch.pdf) — a single A4 page.*

**A Hinglish voice ledger for kirana shops.** A shopkeeper speaks; stock, the udhaar khata and the
day's numbers update themselves.

## The problem

A kirana counter runs on memory and a notebook. The owner already knows the entry they want to make;
the friction is the notebook, the app form, and the ten taps between remembering and recording.
Existing voice assistants answer questions, but they do not safely change a shop ledger.

## The solution

Dukaan Saathi treats one spoken Hinglish sentence as a ledger movement, not a chat message.

- “Aaj 20 kilo chawal aaya aur 5 kilo sugar.” → two stock-ins and one receipt.
- “Ramesh ko 2 kilo chawal udhaar diya.” → stock −2 kg, Ramesh +₹120.
- “Aaj kitni sale hui?” → a computed answer from today's bills.

Ambiguous writes ask one precise question. Stock shortfalls and fuzzy ASR repairs need a “haan”.
Every write can be reversed with “undo karo”.

## What makes it different

- **Hinglish in, ledger out.** Built for the counter, not the office.
- **Offline-first.** The phone caches the shop and queues fully specified writes with an `opId`;
  the server replays them idempotently. Wi-Fi loss never stops a sale.
- **One thumb.** A native Android app with a home-screen mic widget that opens straight into
  listening.

## Gnani inside

Prisma turns Hinglish speech into text, with the shop's items and customers as keyterms. Timbre speaks
confirmations and summaries in the Poorvi Hinglish voice. Evon is wired as an endpoint-driven intent
seam. A deterministic local engine is the always-on fallback, so the demo works with no API key.

Verified round trip: Timbre audio of “Aaj bees kilo chawal aaya aur paanch kilo sugar” → Prisma
`आज 20 किलो चावल आया और 5 किलो sugar।` → two stock entries.

## Proof

24/24 tests pass. The Android app was exercised on an Android 15 emulator: stock-in, udhaar, a
computed sale, a server-offline sale with banner and local receipt, automatic idempotent replay,
TTS in `hi-IN`, widget placement and tap-to-listen. The 82-second demo shows all six beats.

## Links

- **Demo:** [docs/demo/dukaan-saathi-demo.mp4](docs/demo/dukaan-saathi-demo.mp4)
- **APK:** [v0.1.0 release](https://github.com/palprateek/dukaan-saathi/releases/tag/v0.1.0)
- **Source and setup:** [README.md](README.md)

Built by **Prateek Pal** · [github.com/palprateek](https://github.com/palprateek)
