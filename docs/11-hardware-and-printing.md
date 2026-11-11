# 11 — Hardware models and printing

Three hardware models live side by side in the same system. Each POS device is a **workstation** in EMC (*Setup → Devices & printers*) with a **hardware model**: *Dedicated* or *Mobile*. A restaurant can mix them, for example a counter terminal plus floor tablets.

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

## Model C: One phone and a Bluetooth printer (small businesses)

For a small restaurant with **one phone** (or tablet) and **one receipt printer beside it**, and no PC. The phone prints straight to the printer over Bluetooth: no Print Agent, no network printer.

| Item | Options |
|------|---------|
| POS device | An Android phone or tablet with Chrome (recommended). iPhone/iPad: only in the **Bluefy** browser (Safari and Chrome on iOS have no Bluetooth for web apps) |
| Printer | 58 or 80 mm ESC/POS thermal printer with Bluetooth, for example **Xprinter XP-T80Q** (80 mm, USB + Bluetooth, ESC/POS, 200 mm/s, 24 V cash drawer port) |
| Cash drawer | Plugged into the printer's drawer port; opens on cash payments |
| Kitchen | Kitchen tickets print on the same printer (the steward hands them to the kitchen), or on a kitchen printer through a Print Agent if there is one |
| Print path | Phone → **Bluetooth** → printer, from the browser (Web Bluetooth) or through the **RawBT** app |

```
 Phone (POS) ──Bluetooth──► Receipt printer ──► cash drawer
      │
      └──(internet)──► Firebase: orders, bills, reports, books
```

**Two Bluetooth routes** (per workstation, *Bluetooth route*):

| Route | Works with | Notes |
|---|---|---|
| **From the browser** (Chrome on Android) | Printers with **Bluetooth Low Energy (BLE)**, which most current Bluetooth receipt printers have alongside classic Bluetooth | Choose the printer once from the phone's POS (**Connect printer**); it reconnects by itself while the POS is open. The POS looks for the printing services receipt printers use (18F0, Xprinter/Gprinter E7810A71, Microchip transparent UART and others) and sends ESC/POS in small packets |
| **Through the RawBT app** (Android) | **Any** Bluetooth printer, including classic Bluetooth (SPP) only | Install RawBT from Google Play, pair the printer in Android's Bluetooth settings (PIN usually 0000 or 1234), choose it in RawBT. The POS hands each print to RawBT |

**Setting it up:** back office → *Workstations & printers* → the phone's workstation → **Printing: Bluetooth printer next to this phone or tablet**, the route and the paper width (or choose *Bluetooth printer beside it* when connecting the phone). Then on the phone: the **printer button** → **Choose the printer** → **Test print**. Printer records and the Print Agent are not needed.

**When the printer is off:** prints wait on the phone (the printer button shows how many) and print as soon as it is connected again. Nothing is lost if one never prints: the bill is in the system and can be reprinted from *Orders*.

> **Which route for the XP-T80Q?** Try **From the browser** first: switch the printer on, press *Choose the printer* on the phone and look for it in the list (named like *XP-T80Q* or *Printer001*). If it doesn't appear, or the test page doesn't print, its Bluetooth is classic only: use **Through the RawBT app**.

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
| Single phone (Model C) | 1 Android phone (Chrome) + Bluetooth ESC/POS printer (for example Xprinter XP-T80Q) + cash drawer on the printer. No PC |
| Hybrid | Counter terminal (Standard) + floor tablets. The counter PC runs the Print Agent for all printers |
