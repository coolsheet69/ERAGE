'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WagmiProvider, createConfig, http, fallback } from 'wagmi'
import { base } from 'wagmi/chains'
import { injected, metaMask, coinbaseWallet } from 'wagmi/connectors'
import { useState } from 'react'

// Same data behavior as the production build that has been running for months:
// no multicall batching, default React Query caching. The only change is that
// base.llamarpc.com was removed — it blocks browser requests (CORS), so it could
// never serve as a fallback from erage.app anyway.
export const config = createConfig({
  chains: [base],
  connectors: [
    injected(),
    metaMask(),
    coinbaseWallet({ appName: 'ERAGE Protocol' }),
  ],
  transports: {
    [base.id]: fallback([
      http('https://base-rpc.publicnode.com'),  // primary
      http('https://mainnet.base.org'),          // fallback
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
