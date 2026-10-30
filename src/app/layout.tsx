import type { Metadata } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import './globals.css'
import { Providers } from './providers'

const inter = Inter({ subsets: ['latin'] })
// Tabular digits for every `font-mono` number (prices, balances, ratio ticker).
// Wired to --font-mono in globals.css via the --font-num variable.
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-num', display: 'swap' })

export const metadata: Metadata = {
  metadataBase: new URL('https://erage.app'),
  title: 'ERAGE Protocol — Dual-Backed Ratchet Token on Base',
  description: 'ERAGE is a dual-backed ratchet token on Base Network. Backed 1:1 by ESHARE + RAGE. Only UP — NO inflation EVER. Mint, redeem, and bags get bigger.',
  icons: {
    icon: [
      { url: '/favicon.png', type: 'image/png' },
      { url: '/ERAGE-logo.webp', type: 'image/webp' },
    ],
  },
  openGraph: {
    title: 'ERAGE Protocol — Dual-Backed Ratchet Token on Base',
    description: 'ERAGE is a dual-backed ratchet token on Base Network. Backed 1:1 by ESHARE + RAGE. Only UP — NO inflation EVER. Mint, redeem, and bags get bigger.',
    images: [{ url: '/og-image.png', width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ERAGE Protocol — Dual-Backed Ratchet Token on Base',
    description: 'ERAGE is a dual-backed ratchet token on Base Network. Backed 1:1 by ESHARE + RAGE. Only UP — NO inflation EVER. Mint, redeem, and bags get bigger.',
    images: ['/og-image.png'],
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={mono.variable}>
      <body className={inter.className}>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}