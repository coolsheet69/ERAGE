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
    coinbaseWallet({ appName: 'ERAGE Protocol' }),
  ],
  // Multicall batching: every useReadContract fired within the same ~16ms window is
  // bundled into a single eth_call to Multicall3 (deployed on Base). The dashboard
  // makes ~80 reads on load — this turns them into a handful of RPC requests
  // instead of ~80 separate ones competing for the public RPC's rate limit.
  batch: {
    multicall: {
      wait: 16,        // collect reads across a frame before sending
      batchSize: 4096, // bytes of calldata per multicall; splits automatically above this
    },
  },
  transports: {
    [base.id]: fallback([
      http('https://base-rpc.publicnode.com'),  // primary
      http('https://mainnet.base.org'),          // fallback 1
      http('https://base.llamarpc.com'),         // fallback 2
    ]),
  },
})

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        // Each read already has its own refetchInterval (plus the 30s refresh in
        // page.tsx), so re-fetching all ~80 reads every time the tab regains focus
        // just adds an RPC burst. Results also count as fresh for 10s so a remount
        // doesn't immediately re-request them.
        refetchOnWindowFocus: false,
        staleTime: 10_000,
      },
    },
  }))

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  )
}
