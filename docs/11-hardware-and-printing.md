# 11 — Hardware models and printing

Two hardware models live side by side in the same system. Each POS device is a **workstation** in EMC (*Setup → Devices & printers*) with a **hardware model**: *Dedicated* or *Mobile*. A restaurant can mix them, for example a counter terminal plus floor tablets.

## Model A: Dedicated terminals

| Item | Options |
|------|---------|
| POS device | Windows 10/11 touch POS terminal or any Windows PC with a touch monitor, running the POS full-screen (installed as an app from the browser, or later the POS Shell desktop wrapper) |
| Bill printer | 80 mm ESC/POS thermal, USB or Ethernet (Epson TM-T82III, Xprinter, Rongta, Sewoo…) |
| Cash drawer | RJ11/RJ12 24 V, plugged into the bill printer's DK port. Opened automatically on cash payments and by *No sale* |
| Kitchen | Network KOT printer and/or a kitchen display |
| Print path | Workstation → print queue → **Print Agent** on the same PC → USB/network printer |

## Model B: Mobility (tablets)

| Item | Options |
|------|---------|
| POS device | iPad or Android tablet (10–11"), the POS installed from the browser to the home screen (PWA) |
| Bill and KOT printers | Same physical printers as Model A. **Physical bills and KOTs still print**, as required for VAT bills |
| Print path | Tablet → print queue (cloud) → **Print Agent** on the shop network → printers |
| Where the agent runs | The counter PC, a small always-on mini-PC, or a Raspberry Pi. One agent can drive every printer in the restaurant |

```
 Tablet / Terminal ──(Firestore print queue)──► Print Agent (shop LAN) ──► Bill printer + cash drawer
                                                           │              └► Kitchen KOT printer
                                                           └────────────────► Bar KOT printer
```

### Why a Print Agent
- Browsers and tablets cannot send raw bytes to a USB printer or open a cash drawer. The agent can.
- It works the same for every tablet and terminal, needs no printer drivers on the tablets, and supports cheap ESC/POS printers.
- If a printer fails, the job goes to its **backup printer** (set per printer).
- The **print queue** in EMC shows every job (queued, printed or failed). Jobs can be previewed, printed from the device, or re-sent.
- Jobs expire after 24 hours (Firestore TTL).

### Setting up the Print Agent
1. In EMC → *People → Back-office logins*, invite a login with the **POS terminal** role (for example `printer@restaurant.lk`).
2. In EMC → *Setup → Devices & printers*, add each printer:
   - Network printers: IP address and port 9100.
   - USB on Windows: the printer's share name.
   - USB on Linux: `/dev/usb/lp0`.
   - Set **Print Agent id** (e.g. `AGENT-1`) on each printer.
3. On the shop PC:
   ```bash
   cd apps/print-agent
   cp .env.example .env     # Firebase web config, the terminal login, TENANT_ID, AGENT_ID
   pnpm start               # DRY_RUN=1 writes jobs to ./out instead of printing
   ```
4. Use *Test print* next to each printer in EMC.

**USB printers on Windows:**
- Install the printer with its driver (or "Generic / Text Only") and share it (e.g. as `POS80`).
- Set the printer address to `POS80`. The agent copies raw ESC/POS bytes to `\\localhost\POS80`.

### Printing without the agent (demos)
Set a workstation's printing to **On-screen only**. Bills and KOTs then open as an on-screen preview, which can be printed with the device's own print dialog (AirPrint, Android print or Windows printers).

## What prints
| Document | When | Printer |
|----------|------|---------|
| KOT (kitchen/bar) | *Send*. Items are routed by each menu item's KOT route. Voids print a VOID ticket. Allergens are printed reversed (white on black) | Kitchen / bar printer (with backup) |
| Guest check | *Print bill*, before payment. Carries a LankaQR code when that module is on | Workstation's bill printer |
| Tax invoice | Closing a check. IRD format with invoice number `YYMMM_W01_n`; opens the drawer for cash | Workstation's bill printer |
| X / Z report | *Functions* | Workstation's bill printer |

## Recommended packages
| Package | Contents |
|---------|----------|
| Starter (dedicated) | Windows PC + budget ESC/POS printer + cash drawer |
| Standard (dedicated) | 15.6" Windows touch POS + Epson TM-T82III (USB + LAN) + cash drawer + UPS + 4G failover router |
| Mobility | 1–3 Android tablets or iPads + Ethernet bill printer + cash drawer + network KOT printer + mini-PC or Raspberry Pi for the Print Agent + Wi-Fi access point |
| Hybrid | Counter terminal (Standard) + floor tablets. The counter PC runs the Print Agent for all printers |
