# Manuals for clients

| Document | For | Use it to |
|---|---|---|
| [User manual](user-manual.md) | Everyone | Look up any screen or function. |
| [Configuration guide](configuration-guide.md) | Owners, managers, accountants | Set up and look after the books, stock, menu, modifiers, payments and roles yourself, with worked examples; bring existing books in with the accounting workbook. |
| [Training manuals](training/README.md) | Each role, and the trainer | Train staff before go-live, with exercises and sign-off checklists. |
| [Deployment manual](../18-deployment-manual.md) | Your installer / IT | Install and configure the system for a client, A to Z. |

The screenshots in `img/` are taken from the demo restaurant by `pnpm manual:screenshots`. Run it again after changing the screens, so the manuals stay true.

**PDF copies to hand to the client:** `pnpm manual:pdf` writes the user manual, the configuration guide and every training manual as A4 PDFs into `manual-pdf/`. Put the client's name on the cover with `pnpm manual:pdf -- --client "Kandy Myst Restaurant"`.

**Excel templates** (in `templates/`, regenerate with `pnpm templates`): `accounting-workbook-sample.xlsx` (the accounting workbook filled with a worked example, to show clients what goes where), `accounting-workbook-blank.xlsx`, `data-feeder-sample.xlsx` and `data-feeder-blank.xlsx`. Clients can also download them from the system (Finance → Excel import; Administration → Excel import & export), where the accounting workbook comes with their own chart of accounts and stock items.
