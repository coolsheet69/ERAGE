import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { Providers } from './providers'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'ERAGE Protocol',
  description: 'Dual-backed ratchet token on Base. — Only UP!!  NO inflation EVER!!',
  icons: {
    icon: [
      { url: '/favicon.png', type: 'image/png' },
      { url: '/ERAGE-logo.webp', type: 'image/webp' },
    ],
  },
  openGraph: {
    title: 'ERAGE Protocol',
    description: 'Dual-backed ratchet token on Base. — Only UP!!  NO inflation EVER!!',
    images: ['/ERAGE-logo.webp'],
  },
  twitter: {
    card: 'summary',
    title: 'ERAGE Protocol',
    description: 'Dual-backed ratchet token on Base. — Only UP!!  NO inflation EVER!!',
    images: ['/ERAGE-logo.webp'],
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