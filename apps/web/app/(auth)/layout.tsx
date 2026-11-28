/** The signed-out frame: the product's name at the top left and one form.
 *  The form centres on a wide screen; on a phone it sits near the top, so
 *  the on-screen keyboard does not push it out of view. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col gap-10 bg-background px-4 py-6 md:px-10">
      <p className="text-lg font-semibold tracking-tight">llame</p>
      <main className="flex flex-1 justify-center md:items-center md:pb-16">
        {children}
      </main>
    </div>
  );
}
