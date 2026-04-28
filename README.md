# GGX Protocol Dashboard

A sleek, one-screen DeFi dashboard for the GGX Protocol on Base mainnet.

## Protocol Overview

**GGX** is a seigniorage token backed by both **ESHARE** and **RAGE** tokens.

### How It Works

- **Mint**: 1 ESHARE + 1 RAGE = 1 GGX (after 5% tax)
- **Redeem**: 1 GGX → ESHARE + RAGE (based on current backing ratio)
- **Zap Mint**: One-click mint from ETH, ESHARE only, or RAGE only

### Tax Structure (5% Total)

| Tax | Rate | Purpose |
|-----|------|---------|
| Backing Tax | 2% | Stays in contract, raises floor for everyone |
| ESHARE Burn | 1% | Deflationary pressure on ESHARE |
| RAGE Burn | 1% | Deflationary pressure on RAGE |
| Treasury | 1% | Minted GGX to treasury |

### Key Feature: Floor Only Goes Up

The backing ratio can only increase, never decrease. This is achieved through:
1. 2% backing tax on every transaction
2. Burn mechanism reducing token supply
3. Users can burn GGX to increase backing ratio

---

## 🚀 Quick Start

### Step 1: Extract the ZIP
Extract `ggx-protocol.zip` to a folder like `C:\Users\marke\Desktop\ggx-protocol`

### Step 2: Delete conflicting package.json (if exists)
```powershell
# Check for package.json in your user folder (NOT in the project folder)
Remove-Item -Path "C:\Users\marke\package.json" -ErrorAction SilentlyContinue
Remove-Item -Path "C:\Users\marke\package-lock.json" -ErrorAction SilentlyContinue
```

### Step 3: Navigate to project and install
```powershell
cd C:\Users\marke\Desktop\ggx-protocol
npm install
```

### Step 4: Run dev server
```powershell
npm run dev
```

### Step 5: Open in browser
Go to: http://localhost:3000

---

## Contract Addresses (Base Mainnet)

| Contract | Address | Explorer |
|----------|---------|----------|
| GGX | `0x82EBE787e7E1f061E77307fE1037bE024EDd602e` | [View](https://basescan.org/address/0x82EBE787e7E1f061E77307fE1037bE024EDd602e) |
| GGXZap | `0x34169647c94C5c8cD5c3171F320790bAD2D97dA4` | [View](https://basescan.org/address/0x34169647c94C5c8cD5c3171F320790bAD2D97dA4) |
| ESHARE | `0xb7C10146bA1b618956a38605AB6496523d450871` | [View](https://basescan.org/address/0xb7C10146bA1b618956a38605AB6496523d450871) |
| RAGE | `0xc0df50143EA93AeC63e38A6ED4E92B378079eA15` | [View](https://basescan.org/address/0xc0df50143EA93AeC63e38A6ED4E92B378079eA15) |

---

## Dashboard Features

- **Live Backing Ratio Chart** - Animated chart showing ratio history
- **Token Balances** - GGX, ESHARE, RAGE balances at a glance
- **Mint GGX** - Provide equal amounts of ESHARE + RAGE
- **Redeem GGX** - Get ESHARE + RAGE based on current backing
- **Zap Mint** - One-click mint from ETH, ESHARE only, or RAGE only
- **One-Screen Layout** - Everything visible without scrolling

---

## Tech Stack

- **Next.js 16** - React framework with Turbopack
- **Tailwind CSS 4** - Styling
- **wagmi v3** - Ethereum wallet interactions
- **viem** - Ethereum utilities
- **Lucide React** - Icons

---

## Configuration

For WalletConnect integration, update the `projectId` in `src/app/providers.tsx`:

```typescript
const projectId = 'your-walletconnect-project-id'
```

Get your project ID at [WalletConnect Cloud](https://cloud.walletconnect.com/).

---

## License

MIT
