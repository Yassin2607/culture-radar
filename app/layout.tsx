import type { Metadata } from 'next'
import { Barlow_Condensed, DM_Sans, Archivo_Black, Newsreader, Inter } from 'next/font/google'
import AppShell from '@/components/layout/AppShell'
import './globals.css'

const barlowCondensed = Barlow_Condensed({
  subsets: ['latin'],
  weight: ['600', '700'],
  variable: '--font-display',
  display: 'swap',
})

const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  style: ['normal', 'italic'],
  variable: '--font-body',
  display: 'swap',
})

// JackandAI brand fonts — scoped via .jai-app class to Culture/Moments Radar
const archivoBlack = Archivo_Black({
  subsets: ['latin'],
  weight: ['400'],
  variable: '--font-jai-display',
  display: 'swap',
})
const newsreader = Newsreader({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  style: ['normal', 'italic'],
  variable: '--font-jai-serif',
  display: 'swap',
})
const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-jai-body',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Action Tools — Content QA Platform',
  description: 'Internal content quality assurance tools for Action',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${barlowCondensed.variable} ${dmSans.variable} ${archivoBlack.variable} ${newsreader.variable} ${inter.variable}`}>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  )
}
