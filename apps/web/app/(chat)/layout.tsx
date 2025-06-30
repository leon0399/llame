
import { SidebarInset, SidebarProvider, AppSidebar } from './components/app-sidebar';

export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
    return (
    <>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          {children}
        </SidebarInset>
      </SidebarProvider>
    </>
  )
}