/** The signed-out frame: the product's name over one centred form, with
 *  phone-width gutters so the card uses the screen instead of a third of it. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background px-4 py-10">
      <p className="text-xl font-semibold tracking-tight">llame</p>
      {children}
    </div>
  );
}
