import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { Providers } from './providers'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
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
    <html lang="en">
      <body className={inter.className}>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}