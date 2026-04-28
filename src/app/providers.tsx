'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WagmiProvider, createConfig, http, fallback } from 'wagmi'
import { base } from 'wagmi/chains'
import { injected, metaMask, coinbaseWallet } from 'wagmi/connectors'
import { useState } from 'react'

export const config = createConfig({
  chains: [base],
  connectors: [
    injected(),
    metaMask(),
    coinbaseWallet({ appName: 'GGX Protocol' }),
  ],
  transports: {
    [base.id]: fallback([
      http('https://base-rpc.publicnode.com'),  // primary — no rate limits
      http('https://mainnet.base.org'),          // fallback 1
      http('https://base.llamarpc.com'),         // fallback 2
    ]),
  },
})

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient())

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  )
}
